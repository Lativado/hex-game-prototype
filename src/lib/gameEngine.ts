// gameEngine.ts
import type {
  GameState,
  GameStatus,
  PendingMove,
  ScheduledAction,
  TickResult,
} from "@/types/game";
import type { Owner, PlayersState } from "@/types/player";
import type { Tile } from "@/types/tile";

const GARRISON_LIMIT = 50;
const AUTOMATION_MAX_MOVE_AMOUNT = 4;
const AUTOMATION_SUPPLY_RESERVE = 200;

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

function getMaxAffordableMoveAmount(supply: number) {
  return Math.floor(supply / 1.5);
}

function getAutomationMoveCost(amount: number) {
  if (amount <= 1) return amount;

  return getMoveCost(amount);
}

function getMaxAffordableAutomationMoveAmount(supply: number) {
  if (supply <= 1) return supply;

  return getMaxAffordableMoveAmount(supply);
}

function getDesiredAttackAmount(target: Tile) {
  return getEffectiveDefense(target) + 1;
}

function getDesiredAutomationAmount(source: Tile, target: Tile) {
  if (target.owner !== source.owner) {
    return getDesiredAttackAmount(target);
  }

  return Math.min(2, Math.max(0, GARRISON_LIMIT - target.troops));
}

function getTileKey(tile: Tile) {
  return `${tile.q},${tile.r}`;
}

function getEffectiveDefense(tile: Tile) {
  const defenseMultiplier = tile.owner === null ? 0.7 : 1.0;
  return Math.floor(tile.troops * defenseMultiplier);
}

function getGameStatus(tiles: Tile[]): GameStatus {
  const owners = new Set<Owner>();

  tiles.forEach((tile) => {
    if (tile.owner !== null) {
      owners.add(tile.owner);
    }
  });

  if (owners.size !== 1) {
    return { type: "active" };
  }

  return {
    type: "won",
    winner: Array.from(owners)[0],
  };
}

export function canExecuteMove(
  owner: Owner,
  amount: number,
  players: PlayersState,
): boolean {
  const cost = getMoveCost(amount);

  return players[owner].supply >= cost;
}

export function applyMoveCost(
  owner: Owner,
  amount: number,
  players: PlayersState,
): PlayersState {
  const cost = getMoveCost(amount);

  return {
    ...players,
    [owner]: {
      ...players[owner],
      supply: players[owner].supply - cost,
    },
  };
}

export function tryCreateMove(
  intent: PendingMove,
  players: PlayersState,
): PendingMove | null {
  if (!canExecuteMove(intent.owner, intent.amount, players)) {
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
    const attacksByOwner = new Map<Owner, number>();

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

function getLandNeighbors(tiles: Tile[], tile: Tile) {
  return directions
    .map(([dq, dr]) => tiles.find((t) => t.q === tile.q + dq && t.r === tile.r + dr))
    .filter((t): t is Tile => !!t && t.terrain !== "water");
}

function isFrontlineTile(tiles: Tile[], tile: Tile, owner: Owner) {
  if (tile.owner !== owner) return false;

  return getLandNeighbors(tiles, tile).some((neighbor) => neighbor.owner !== owner);
}

function getFriendlyFrontlineDistance(
  tiles: Tile[],
  tile: Tile,
  owner: Owner,
): number {
  if (tile.owner !== owner) return Number.POSITIVE_INFINITY;
  if (isFrontlineTile(tiles, tile, owner)) return 0;

  const visited = new Set<string>([getTileKey(tile)]);
  const queue = [{ tile, distance: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const neighbor of getLandNeighbors(tiles, current.tile)) {
      if (neighbor.owner !== owner) continue;

      const key = getTileKey(neighbor);
      if (visited.has(key)) continue;

      if (isFrontlineTile(tiles, neighbor, owner)) {
        return current.distance + 1;
      }

      visited.add(key);
      queue.push({ tile: neighbor, distance: current.distance + 1 });
    }
  }

  return Number.POSITIVE_INFINITY;
}

function runAutomation(
  tiles: Tile[],
  tick: number,
  availableSupply: number,
): ScheduledAction[] {
  const actions: ScheduledAction[] = [];
  let remainingSupply = availableSupply;
  const usedSources = new Set<string>();

  const addActions = (
    candidates: {
      source: Tile;
      target: Tile;
    }[],
    reserveFloor = 0,
  ) => {
    candidates.forEach(({ source, target }) => {
      const spendableSupply = remainingSupply - reserveFloor;

      if (spendableSupply < getAutomationMoveCost(1)) return;
      if (usedSources.has(getTileKey(source))) return;

      const maxTransferAmount = getMaxTransferAmount(
        tiles,
        { q: source.q, r: source.r },
        { q: target.q, r: target.r },
      );
      const maxAffordableAmount =
        getMaxAffordableAutomationMoveAmount(spendableSupply);

      const amount = Math.min(
        maxTransferAmount,
        maxAffordableAmount,
        getDesiredAutomationAmount(source, target),
        AUTOMATION_MAX_MOVE_AMOUNT,
      );

      if (amount <= 0) return;

      actions.push({
        id: `${source.q},${source.r}-${tick}`,
        owner: 1,
        from: { q: source.q, r: source.r },
        to: { q: target.q, r: target.r },
        amount,
        executeAt: tick + 1,
      });

      usedSources.add(getTileKey(source));
      remainingSupply -= getAutomationMoveCost(amount);
    });
  };

  const movableTiles = tiles.filter((tile) => tile.owner === 1 && tile.troops > 1);

  const attackCandidates = movableTiles
    .flatMap((source) =>
      getLandNeighbors(tiles, source)
        .filter((target) => target.owner !== 1)
        .map((target) => ({ source, target })),
    )
    .filter(
      ({ source, target }) =>
        getMaxTransferAmount(
          tiles,
          { q: source.q, r: source.r },
          { q: target.q, r: target.r },
        ) >= getDesiredAttackAmount(target),
    )
    .sort((a, b) => {
      const defenseDiff = getEffectiveDefense(a.target) - getEffectiveDefense(b.target);
      if (defenseDiff !== 0) return defenseDiff;

      return b.source.troops - a.source.troops;
    });

  addActions(attackCandidates);

  const directFrontlineReinforcementCandidates = movableTiles
    .filter((source) => !isFrontlineTile(tiles, source, 1))
    .flatMap((source) =>
      getLandNeighbors(tiles, source)
        .filter(
          (target) =>
            target.owner === 1 &&
            target.troops < GARRISON_LIMIT &&
            isFrontlineTile(tiles, target, 1),
        )
        .map((target) => ({ source, target })),
    )
    .sort((a, b) => {
      const targetDiff = a.target.troops - b.target.troops;
      if (targetDiff !== 0) return targetDiff;

      return b.source.troops - a.source.troops;
    });

  addActions(directFrontlineReinforcementCandidates);

  if (remainingSupply < AUTOMATION_SUPPLY_RESERVE) {
    return actions;
  }

  const frontlineDistances = new Map<string, number>();
  tiles.forEach((tile) => {
    if (tile.owner !== 1) return;
    frontlineDistances.set(getTileKey(tile), getFriendlyFrontlineDistance(tiles, tile, 1));
  });

  const towardFrontReinforcementCandidates = movableTiles
    .filter((source) => !isFrontlineTile(tiles, source, 1))
    .flatMap((source) => {
      const sourceDistance =
        frontlineDistances.get(getTileKey(source)) ?? Number.POSITIVE_INFINITY;

      if (!Number.isFinite(sourceDistance)) return [];

      const neighbors = getLandNeighbors(tiles, source);

      return neighbors
        .filter(
          (target) =>
            target.owner === 1 &&
            target.troops < GARRISON_LIMIT &&
            (frontlineDistances.get(getTileKey(target)) ??
              Number.POSITIVE_INFINITY) < sourceDistance,
        )
        .map((target) => ({ source, target }));
    })
    .sort((a, b) => {
      const aDistance =
        frontlineDistances.get(getTileKey(a.target)) ?? Number.POSITIVE_INFINITY;
      const bDistance =
        frontlineDistances.get(getTileKey(b.target)) ?? Number.POSITIVE_INFINITY;
      const distanceDiff = aDistance - bDistance;

      if (distanceDiff !== 0) return distanceDiff;

      const targetDiff = a.target.troops - b.target.troops;
      return targetDiff === 0 ? b.source.troops - a.source.troops : targetDiff;
    });

  addActions(towardFrontReinforcementCandidates, AUTOMATION_SUPPLY_RESERVE);

  return actions;
}

function executeScheduledActions(
  tiles: Tile[],
  scheduled: ScheduledAction[],
  currentTick: number,
) {
  const pendingMoves: PendingMove[] = [];
  let nextTiles = tiles;

  scheduled.forEach((action) => {
    if (action.executeAt !== currentTick) return;

    const source = nextTiles.find(
      (t) => t.q === action.from.q && t.r === action.from.r,
    );

    if (!source || source.owner !== action.owner || source.troops <= 1) {
      return;
    }

    const amount = Math.min(
      action.amount,
      getMaxTransferAmount(nextTiles, action.from, action.to),
    );

    if (amount <= 0) return;

    nextTiles = nextTiles.map((t) =>
      t.q === action.from.q && t.r === action.from.r
        ? { ...t, troops: t.troops - amount }
        : t,
    );

    pendingMoves.push({
      from: action.from,
      to: action.to,
      amount,
      owner: action.owner,
      resolvesAt: currentTick + 1,
    });
  });

  return {
    tiles: nextTiles,
    pendingMoves,
    scheduledActions: scheduled.filter((a) => a.executeAt > currentTick),
  };
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

export function processTick(state: GameState, players: PlayersState): TickResult {
  if (state.status.type === "won") {
    return {
      gameState: state,
      players,
    };
  }

  const currentTick = state.tick;

  let tiles = [...state.tiles];
  let scheduled = [...state.scheduledActions];
  let nextPlayers = players;

  // ------------------------------
  // 1. Scheduled → Pending
  // ------------------------------
  const executedActions = executeScheduledActions(tiles, scheduled, currentTick);
  tiles = executedActions.tiles;
  scheduled = executedActions.scheduledActions;

  const combined = [...state.pendingMoves, ...executedActions.pendingMoves];

  // ------------------------------
  // 2. Resolve moves
  // ------------------------------
  const resolving = combined.filter((m) => m.resolvesAt === currentTick);
  const nextPending = combined.filter((m) => m.resolvesAt > currentTick);

  tiles = resolveMoves(tiles, resolving);

  // ------------------------------
  // 3. Growth + Draft
  // ------------------------------
  tiles = applyCivilianGrowth(tiles);

  tiles = tiles.map((t) => {
    if (!t.owner) return t;
    const ratio = nextPlayers[t.owner as Owner].targetMilitaryRatio;
    return applyDraft([t], ratio)[0];
  });

  // ------------------------------
  // 4. Income
  // ------------------------------
  let playerTiles = 0;
  let botTiles = 0;

  tiles.forEach((t) => {
    if (t.owner === 1) playerTiles++;
    if (t.owner === 2) botTiles++;
  });

  nextPlayers = {
    ...nextPlayers,
    1: {
      ...nextPlayers[1],
      supply: nextPlayers[1].supply + Math.floor(playerTiles / 2),
    },
    2: {
      ...nextPlayers[2],
      supply: nextPlayers[2].supply + Math.floor(botTiles / 2),
    },
  };

  // ------------------------------
  // 5. Automation (Player 1)
  // ------------------------------
  if (nextPlayers[1].automationEnabled) {
    const autoActions = runAutomation(
      tiles,
      currentTick,
      nextPlayers[1].supply,
    );

    const validActions: ScheduledAction[] = [];

    autoActions.forEach((a) => {
      const cost = getAutomationMoveCost(a.amount);

      if (nextPlayers[a.owner].supply >= cost) {
        nextPlayers = {
          ...nextPlayers,
          [a.owner]: {
            ...nextPlayers[a.owner],
            supply: nextPlayers[a.owner].supply - cost,
          },
        };
        validActions.push(a);
      }
    });

    scheduled = [...scheduled, ...validActions];
  }

  // ------------------------------
  // 6. Bot move
  // ------------------------------
  const botMove = getBotMove(tiles, currentTick);

  const finalPending = [...nextPending];

  if (botMove) {
    const move = tryCreateMove(botMove, nextPlayers);

    if (move) {
      nextPlayers = applyMoveCost(move.owner, move.amount, nextPlayers);

      // Remove troops from source immediately
      tiles = tiles.map((t) =>
        t.q === move.from.q && t.r === move.from.r
          ? { ...t, troops: t.troops - move.amount }
          : t,
      );

      finalPending.push(move);
    }
  }

  // ------------------------------
  // 7. Return new state
  // ------------------------------
  const status = getGameStatus(tiles);

  return {
    gameState: {
      tiles,
      pendingMoves: status.type === "won" ? [] : finalPending,
      scheduledActions: status.type === "won" ? [] : scheduled,
      tick: currentTick + 1,
      status,
    },
    players: nextPlayers,
  };
}
