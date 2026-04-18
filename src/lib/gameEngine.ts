// gameEngine.ts
import type { Tile } from "@/types/tile";

export type Owner = 1 | 2;

export type PendingMove = {
  from: { q: number; r: number };
  to: { q: number; r: number };
  amount: number;
  owner: Owner;
  resolvesAt: number;
};

export type ScheduledAction = {
  id: string;
  owner: Owner;
  from: { q: number; r: number };
  to: { q: number; r: number };
  amount: number;
  executeAt: number;
};

export type GameState = {
  tiles: Tile[];
  pendingMoves: PendingMove[];
  scheduledActions: ScheduledAction[];
  tick: number;
  playerSupply: number;
  botSupply: number;
  automationEnabled: boolean;
  targetMilitaryRatio: number;
};

const GARRISON_LIMIT = 50;

const directions = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

// ------------------------------
// Core Rules
// ------------------------------

export function getMoveCost(amount: number) {
  return Math.ceil(amount * 1.5);
}

export function canExecuteMove(
  owner: Owner,
  amount: number,
  playerSupply: number,
  botSupply: number,
) {
  const cost = getMoveCost(amount);

  if (owner === 1) return playerSupply >= cost;
  if (owner === 2) return botSupply >= cost;

  return false;
}

export function applyMoveCost(
  owner: Owner,
  amount: number,
  playerSupply: number,
  botSupply: number,
) {
  const cost = getMoveCost(amount);

  if (owner === 1) {
    return {
      playerSupply: playerSupply - cost,
      botSupply,
    };
  }

  return {
    playerSupply,
    botSupply: botSupply - cost,
  };
}

export function tryCreateMove(
  intent: PendingMove,
  playerSupply: number,
  botSupply: number,
) {
  if (!canExecuteMove(intent.owner, intent.amount, playerSupply, botSupply)) {
    return null;
  }

  return intent;
}

export function applyDraft(tiles: Tile[], draftTargetRatio: number): Tile[] {
  return tiles.map((t) => {
    if (t.owner == null || t.terrain === "water") return t;

    const totalPop = t.civilians + t.troops;
    if (totalPop <= 0) return t;

    // Integer target to avoid float jitter
    const targetTroops = Math.floor(totalPop * draftTargetRatio);
    const troopDeficit = targetTroops - t.troops;

    // If we're at/above target, do nothing (keep progress so it can finish later)
    if (troopDeficit <= 0) return t;

    const draftRate = 0.05;

    // Accumulate fractional progress
    const totalDraft = (t.draftProgress ?? 0) + t.civilians * draftRate;

    const usableTroops = Math.floor(totalDraft);

    const actualDraft = Math.min(
      usableTroops,
      Math.floor(t.civilians),
      troopDeficit,
    );

    // Keep leftover fractional progress
    const remainingDraftProgress = totalDraft - actualDraft;

    return {
      ...t,
      civilians: t.civilians - actualDraft,
      troops: t.troops + actualDraft,
      draftProgress: remainingDraftProgress,
    };
  });
}

function resolveMoves(tiles: Tile[], moves: PendingMove[]): Tile[] {
  // Group moves by target tile
  const groups = new Map<string, PendingMove[]>();

  moves.forEach((m) => {
    const key = `${m.to.q},${m.to.r}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  });

  return tiles.map((tile) => {
    const key = `${tile.q},${tile.r}`;
    const groupMoves = groups.get(key);

    // No incoming moves → unchanged
    if (!groupMoves || groupMoves.length === 0) {
      return tile;
    }

    const originalOwner = tile.owner;

    // Sum attacks by owner
    const attacksByOwner = new Map<number, number>();

    groupMoves.forEach((m) => {
      attacksByOwner.set(
        m.owner,
        (attacksByOwner.get(m.owner) || 0) + m.amount,
      );
    });

    // Find strongest attacker
    const [attackerOwner, attackPower] = Array.from(
      attacksByOwner.entries(),
    ).sort((a, b) => b[1] - a[1])[0];

    let newOwner = tile.owner;
    let newTroops = tile.troops;
    let newCivilians = tile.civilians;

    if (tile.owner === attackerOwner) {
      // Reinforcement
      newTroops = tile.troops + attackPower;
    } else {
      const defenseMultiplier = tile.owner === null ? 0.7 : 1.0;
      const defense = Math.floor(tile.troops * defenseMultiplier);

      if (attackPower >= defense) {
        newTroops = attackPower - defense;
        newOwner = attackerOwner;
      } else {
        newTroops = tile.troops - attackPower;

        if (newTroops <= 0) {
          newTroops = 0;
          newOwner = attackerOwner;
        }
      }
    }

    // Apply civilian loss ONCE if ownership changed from original
    if (originalOwner !== newOwner) {
      newCivilians = tile.civilians * 0.7;
    }

    // Handle garrison limit WITHOUT silent deletion
    let overflow = 0;

    if (newTroops > GARRISON_LIMIT) {
      overflow = newTroops - GARRISON_LIMIT;
      newTroops = GARRISON_LIMIT;
    }

    return {
      ...tile,
      owner: newOwner,
      troops: Math.max(0, newTroops),
      civilians: newCivilians,
      overflowTroops: overflow,
    };
  });
}

function getBotMove(tiles: Tile[], tick: number): PendingMove | null {
  const owned = tiles.filter((t) => t.owner === 2 && t.troops > 1);
  if (!owned.length) return null;

  const source = owned[Math.floor(Math.random() * owned.length)];

  const neighbors = directions
    .map(([dq, dr]) =>
      tiles.find((t) => t.q === source.q + dq && t.r === source.r + dr),
    )
    .filter((t): t is Tile => !!t && t.terrain !== "water" && t.owner !== 2);

  if (!neighbors.length) return null;

  neighbors.sort((a, b) => a.troops - b.troops);
  const target = neighbors[0];

  const amount = getMaxTransferAmount(
    tiles,
    { q: source.q, r: source.r },
    { q: target.q, r: target.r },
  );

  if (amount <= 0) return null;

  return {
    from: { q: source.q, r: source.r },
    to: { q: target.q, r: target.r },
    amount,
    owner: 2,
    resolvesAt: tick + 1,
  };
}

function runAutomation(tiles: Tile[], tick: number): ScheduledAction[] {
  const actions: ScheduledAction[] = [];

  tiles.forEach((tile) => {
    if (tile.owner !== 1) return;
    if (tile.troops < 10) return;

    const neighbors = directions
      .map(([dq, dr]) =>
        tiles.find((t) => t.q === tile.q + dq && t.r === tile.r + dr),
      )
      .filter((t): t is Tile => !!t && t.terrain !== "water");

    if (!neighbors.length) return;

    neighbors.sort((a, b) => a.troops - b.troops);
    const target = neighbors[0];

    const amount = getMaxTransferAmount(
      tiles,
      { q: tile.q, r: tile.r },
      { q: target.q, r: target.r },
    );

    if (amount <= 0) return;

    actions.push({
      id: `${tile.q},${tile.r}-${tick}`,
      owner: 1,
      from: { q: tile.q, r: tile.r },
      to: { q: target.q, r: target.r },
      amount: amount,
      executeAt: tick + 1,
    });
  });

  return actions;
}

export function getMaxTransferAmount(
  tiles: Tile[],
  from: { q: number; r: number },
  to: { q: number; r: number },
) {
  const source = tiles.find((t) => t.q === from.q && t.r === from.r);
  const target = tiles.find((t) => t.q === to.q && t.r === to.r);

  if (!source || !target) return 0;
  if (source.troops <= 1) return 0;

  const baseAmount = source.troops - 1;

  // Combat: ignore cap
  if (target.owner !== source.owner) {
    return baseAmount;
  }

  // Friendly: respect cap
  const maxTransfer = GARRISON_LIMIT - target.troops;

  return Math.max(0, Math.min(baseAmount, maxTransfer));
}

export function applyCivilianGrowth(tiles: Tile[]) {
  return tiles.map((t) => {
    if (t.owner == null || t.populationCapacity === 0) return t;

    const total = t.civilians + t.troops;
    if (total >= t.populationCapacity) return t;

    const growthFactor = 1 - total / t.populationCapacity;
    const growth = t.growthRate * growthFactor;

    const civilianCap = t.populationCapacity - t.troops;

    const newCivilians = Math.min(t.civilians + growth, civilianCap);

    return {
      ...t,
      civilians: newCivilians > civilianCap - 0.01 ? civilianCap : newCivilians,
    };
  });
}

// ------------------------------
// MAIN ENGINE
// ------------------------------

export function processTick(state: GameState): GameState {
  const currentTick = state.tick;

  let tiles = [...state.tiles];

  let pendingMoves = [...state.pendingMoves];
  let scheduled = [...state.scheduledActions];
  let playerSupply = state.playerSupply;
  let botSupply = state.botSupply;

  // 1. Scheduled → Pending
  const ready = scheduled.filter((a) => a.executeAt === currentTick);
  scheduled = scheduled.filter((a) => a.executeAt > currentTick);

  const newMoves: PendingMove[] = ready.map((a) => ({
    from: a.from,
    to: a.to,
    amount: a.amount,
    owner: a.owner,
    resolvesAt: currentTick + 1,
  }));

  const combined = [...pendingMoves, ...newMoves];

  // 2. Resolve
  const resolving = combined.filter((m) => m.resolvesAt === currentTick);
  const remaining = combined.filter((m) => m.resolvesAt > currentTick);

  tiles = resolveMoves(tiles, resolving);

  tiles = applyCivilianGrowth(tiles);
  tiles = applyDraft(tiles, state.targetMilitaryRatio);

  // 3. Income
  let playerTiles = 0;
  let botTiles = 0;

  tiles.forEach((t) => {
    if (t.owner === 1) playerTiles++;
    if (t.owner === 2) botTiles++;
  });

  playerSupply += Math.floor(playerTiles / 2);
  botSupply += Math.floor(botTiles / 2);

  // 4. Automation
  if (state.automationEnabled) {
    const autoActions = runAutomation(tiles, currentTick);

    const validActions: ScheduledAction[] = [];

    autoActions.forEach((a) => {
      if (canExecuteMove(a.owner, a.amount, playerSupply, botSupply)) {
        const supplies = applyMoveCost(
          a.owner,
          a.amount,
          playerSupply,
          botSupply,
        );

        playerSupply = supplies.playerSupply;
        botSupply = supplies.botSupply;

        validActions.push(a);
      }
    });

    scheduled = [...scheduled, ...validActions];
  }

  // 5. Bot
  let nextPending = combined.filter((m) => m.resolvesAt > currentTick);

  const botMove = getBotMove(tiles, currentTick);

  if (botMove) {
    const move = tryCreateMove(botMove, playerSupply, botSupply);

    if (move) {
      const supplies = applyMoveCost(
        move.owner,
        move.amount,
        playerSupply,
        botSupply,
      );

      playerSupply = supplies.playerSupply;
      botSupply = supplies.botSupply;

      tiles = tiles.map((t) =>
        t.q === move.from.q && t.r === move.from.r
          ? { ...t, troops: t.troops - move.amount }
          : t,
      );

      nextPending = [...nextPending, move];
    }
  }

  return {
    tiles,
    pendingMoves: nextPending,
    scheduledActions: scheduled,
    tick: currentTick + 1,
    playerSupply,
    botSupply,
    automationEnabled: state.automationEnabled,
    targetMilitaryRatio: state.targetMilitaryRatio,
  };
}
