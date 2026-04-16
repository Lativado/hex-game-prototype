// gameEngine.ts

export type Owner = 1 | 2;

export type Tile = {
  q: number;
  r: number;
  owner: Owner | null;
  troops: number;
  terrain: string;
};

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
};

const PRODUCTION_CAP = 20;
const STORAGE_CAP = 30;

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

// ------------------------------
// Simulation Pieces
// ------------------------------

function applyTick(tiles: Tile[]): Tile[] {
  return tiles.map((t) => {
    if (
      (t.owner === 1 || t.owner === 2) &&
      t.terrain !== "water" &&
      t.troops < PRODUCTION_CAP
    ) {
      return { ...t, troops: t.troops + 1 };
    }
    return t;
  });
}

function resolveMoves(tiles: Tile[], moves: PendingMove[]) {
  let next = [...tiles];

  const groups = new Map<string, PendingMove[]>();

  moves.forEach((m) => {
    const key = `${m.to.q},${m.to.r}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  });

  groups.forEach((groupMoves) => {
    const { q, r } = groupMoves[0].to;
    const target = next.find((t) => t.q === q && t.r === r);
    if (!target) return;

    const attacksByOwner = new Map<number, number>();

    groupMoves.forEach((m) => {
      attacksByOwner.set(
        m.owner,
        (attacksByOwner.get(m.owner) || 0) + m.amount,
      );
    });

    const [attackerOwner, attackPower] = Array.from(
      attacksByOwner.entries(),
    ).sort((a, b) => b[1] - a[1])[0];

    let newtroops: number;
    let newOwner = target.owner;

    if (target.owner === attackerOwner) {
      newtroops = target.troops + attackPower;
    } else {
      const defenseMultiplier = target.owner === null ? 0.7 : 1.0;
      const defense = Math.floor(target.troops * defenseMultiplier);

      if (attackPower >= defense) {
        newtroops = attackPower - defense;
        newOwner = attackerOwner;
      } else {
        newtroops = target.troops - attackPower;
        if (newtroops <= 0) {
          newtroops = 0;
          newOwner = attackerOwner;
        }
      }
    }

    newtroops = Math.min(STORAGE_CAP, Math.max(0, newtroops));

    next = next.map((t) =>
      t.q === q && t.r === r ? { ...t, troops: newtroops, owner: newOwner } : t,
    );
  });

  return next;
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
  const maxTransfer = STORAGE_CAP - target.troops;

  return Math.max(0, Math.min(baseAmount, maxTransfer));
}

export function applyCivilianGrowth(tiles: Tile[]) {
  return tiles.map((t) => {
    if (t.owner == null || t.capacity === 0) return t;

    const growthFactor = 1 - t.civilians / t.capacity;
    const growth = t.growthRate * growthFactor;

    const newCivilians = t.civilians + growth;

    return {
      ...t,
      civilians: newCivilians > t.capacity - 0.01 ? t.capacity : newCivilians,
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

  tiles = applyTick(tiles);
  tiles = applyCivilianGrowth(tiles);

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
  };
}
