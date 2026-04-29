// gameEngine.ts
import type {
  GameState,
  GameStatus,
  PendingMove,
  ScheduledAction,
  TickResult,
} from "@/types/game";
import type { Owner, PlayerState, PlayersState } from "@/types/player";
import type { Tile } from "@/types/tile";

const GARRISON_LIMIT = 50;
const AUTOMATION_SUPPLY_RESERVE = 200;
const AUTOMATION_CAP_LOGISTICS_BUDGET = 20;
export const SUPPLY_STOCKPILE_CAP = 200;
const CIVILIANS_PER_SUPPLY = 20;
const MIN_SUPPLY_INCOME = 1;
const BASE_DRAFT_RATE = 0.04;
const POPULATION_DRAFT_RATE_BONUS = 0.04;
const DRAFT_SUPPLY_COST_PER_TEN_PERCENT = 1;
const BASE_CIVILIAN_GROWTH_RATE = 0.03;
const MIN_CIVILIAN_GROWTH = 0.05;
const BASE_CIVILIAN_CAPTURE_RETENTION = 0.65;
const DEVASTATION_PER_CAPTURE = 0.25;
const MAX_DEVASTATION = 1;
const DEVASTATION_RETENTION_PENALTY = 0.5;
const DEVASTATION_GROWTH_PENALTY = 0.7;
const DEVASTATION_RECOVERY_PER_TICK = 0.02;
const LOW_POPULATION_RECOVERY_CAPACITY_RATIO = 0.15;
const LOW_POPULATION_RECOVERY_GROWTH = 0.12;
const BOT_TARGET_RANDOMNESS = 1.6;

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

export function getDraftCostPerTroop(draftTargetRatio: number) {
  return Math.ceil(draftTargetRatio * 10 * DRAFT_SUPPLY_COST_PER_TEN_PERCENT);
}

function getDesiredAttackAmount(target: Tile) {
  return getEffectiveDefense(target) + 1;
}

function getTileKey(tile: Tile) {
  return `${tile.q},${tile.r}`;
}

function getEffectiveDefense(tile: Tile) {
  if (tile.troops <= 0) return 0;

  const defenseMultiplier = tile.owner === null ? 0.7 : 1.0;
  return Math.max(1, Math.floor(tile.troops * defenseMultiplier));
}

function isAttackMove(source: Tile, target: Tile) {
  return source.owner !== target.owner;
}

function getCivilianCapacity(tile: Tile) {
  return Math.max(0, tile.populationCapacity - tile.troops);
}

function getCivilianCapacityRatio(tile: Tile) {
  const civilianCapacity = getCivilianCapacity(tile);

  if (civilianCapacity <= 0) return 0;

  return Math.min(1, tile.civilians / civilianCapacity);
}

function getLowPopulationRecoveryGrowth(tile: Tile) {
  const civilianCapacityRatio = getCivilianCapacityRatio(tile);

  if (civilianCapacityRatio >= LOW_POPULATION_RECOVERY_CAPACITY_RATIO) return 0;

  const recoveryPressure =
    1 - civilianCapacityRatio / LOW_POPULATION_RECOVERY_CAPACITY_RATIO;

  return LOW_POPULATION_RECOVERY_GROWTH * recoveryPressure;
}

function getDevastation(tile: Tile) {
  return tile.devastation ?? 0;
}

function getCaptureCivilianRetention(devastation: number) {
  return Math.max(
    0.2,
    BASE_CIVILIAN_CAPTURE_RETENTION *
      (1 - devastation * DEVASTATION_RETENTION_PENALTY),
  );
}

function getDevastationGrowthMultiplier(tile: Tile) {
  return Math.max(0.2, 1 - getDevastation(tile) * DEVASTATION_GROWTH_PENALTY);
}

function recoverDevastation(tile: Tile) {
  return Math.max(0, getDevastation(tile) - DEVASTATION_RECOVERY_PER_TICK);
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

export function getSupplyIncome(civilians: number | undefined) {
  if (civilians === undefined) return 0;

  return Math.max(
    MIN_SUPPLY_INCOME,
    Math.floor(civilians / CIVILIANS_PER_SUPPLY),
  );
}

export function getSupplyIncomeByOwner(tiles: Tile[]) {
  const civiliansByOwner = new Map<Owner, number>();

  tiles.forEach((tile) => {
    if (tile.owner === null || tile.terrain === "water") return;

    civiliansByOwner.set(
      tile.owner,
      (civiliansByOwner.get(tile.owner) ?? 0) + tile.civilians,
    );
  });

  return civiliansByOwner;
}

export function clampSupply(supply: number) {
  return Math.max(0, Math.min(SUPPLY_STOCKPILE_CAP, supply));
}

function addCappedSupply(supply: number, amount: number) {
  if (supply >= SUPPLY_STOCKPILE_CAP) return supply;

  return Math.min(SUPPLY_STOCKPILE_CAP, supply + amount);
}

function addSupplyIncome(
  player: PlayerState,
  civilians: number | undefined,
): PlayerState {
  if (civilians === undefined) return player;

  const income = getSupplyIncome(civilians);

  return {
    ...player,
    supply: addCappedSupply(player.supply, income),
  };
}

function canAfford(supply: number, cost: number) {
  return supply >= cost;
}

export function canExecuteMove(
  owner: Owner,
  amount: number,
  players: PlayersState,
): boolean {
  const cost = getMoveCost(amount);

  return canAfford(players[owner].supply, cost);
}

export function applyMoveCost(
  owner: Owner,
  amount: number,
  players: PlayersState,
): PlayersState | null {
  const cost = getMoveCost(amount);
  const supply = players[owner].supply;

  if (!canAfford(supply, cost)) return null;

  return {
    ...players,
    [owner]: {
      ...players[owner],
      supply: supply - cost,
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

function applyDraft(
  tiles: Tile[],
  players: PlayersState,
): { tiles: Tile[]; players: PlayersState } {
  let nextPlayers = players;

  const draftedTiles = tiles.map((t) => {
    if (t.owner == null || t.terrain === "water") return t;

    const owner = t.owner;
    const draftTargetRatio = nextPlayers[owner].targetMilitaryRatio;
    const totalPop = t.civilians + t.troops;
    if (totalPop <= 0) return t;

    // Integer target to avoid float jitter
    const targetTroops = Math.floor(totalPop * draftTargetRatio);
    const troopDeficit = targetTroops - t.troops;

    // If we're at/above target, do nothing (keep progress so it can finish later)
    if (troopDeficit <= 0) return t;

    const draftRate =
      BASE_DRAFT_RATE + getCivilianCapacityRatio(t) * POPULATION_DRAFT_RATE_BONUS;

    // Accumulate fractional progress
    const totalDraft = (t.draftProgress ?? 0) + t.civilians * draftRate;

    const usableTroops = Math.floor(totalDraft);

    const actualDraft = Math.min(
      usableTroops,
      Math.floor(t.civilians),
      troopDeficit,
    );

    const draftCost = getDraftCostPerTroop(draftTargetRatio);
    const affordableDraft = Math.min(
      actualDraft,
      Math.floor(Math.max(0, nextPlayers[owner].supply) / draftCost),
    );

    if (affordableDraft <= 0) return t;

    // Keep leftover fractional progress
    const remainingDraftProgress = totalDraft - affordableDraft;
    nextPlayers = {
      ...nextPlayers,
      [owner]: {
        ...nextPlayers[owner],
        supply: nextPlayers[owner].supply - affordableDraft * draftCost,
      },
    };

    return {
      ...t,
      civilians: t.civilians - affordableDraft,
      troops: t.troops + affordableDraft,
      draftProgress: remainingDraftProgress,
    };
  });

  return {
    tiles: draftedTiles,
    players: nextPlayers,
  };
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
    let newDevastation = getDevastation(tile);

    if (tile.owner === attackerOwner) {
      // Reinforcement
      newTroops = tile.troops + attackPower;
    } else {
      const defense = getEffectiveDefense(tile);
      const survivingAttackers = attackPower - defense;

      if (survivingAttackers > 0) {
        newTroops = survivingAttackers;
        newOwner = attackerOwner;
      } else {
        newTroops = Math.max(0, tile.troops - attackPower);
      }
    }

    // Apply civilian loss ONCE if ownership changed from original
    if (originalOwner !== newOwner) {
      newDevastation = Math.min(
        MAX_DEVASTATION,
        newDevastation + DEVASTATION_PER_CAPTURE,
      );
      newCivilians =
        tile.civilians * getCaptureCivilianRetention(newDevastation);
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
      devastation: newDevastation,
      overflowTroops: overflow,
    };
  });
}

function getBotMove(tiles: Tile[], tick: number): PendingMove | null {
  const candidates = tiles
    .filter((source) => source.owner === 2 && source.troops > 1)
    .flatMap((source) =>
      getLandNeighbors(tiles, source)
        .filter((target) => target.owner !== 2)
        .map((target) => ({ source, target })),
    )
    .filter(
      ({ source, target }) =>
        getMaxTransferAmount(
          tiles,
          { q: source.q, r: source.r },
          { q: target.q, r: target.r },
        ) > 0,
    )
    .map((candidate) => {
      const targetDefense = getEffectiveDefense(candidate.target);
      const playerTargetBonus = candidate.target.owner === 1 ? 2 : 0;
      const sourceStrengthBonus = candidate.source.troops / GARRISON_LIMIT;
      const score =
        1 / (targetDefense + 1) + playerTargetBonus + sourceStrengthBonus;

      return {
        ...candidate,
        weight: Math.max(0.01, score ** BOT_TARGET_RANDOMNESS),
      };
    });

  const totalWeight = candidates.reduce(
    (total, candidate) => total + candidate.weight,
    0,
  );

  let roll = Math.random() * totalWeight;
  const candidate = candidates.find((candidate) => {
    roll -= candidate.weight;
    return roll <= 0;
  });

  if (!candidate) return null;

  const { source, target } = candidate;

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
    source: "bot",
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

function getAutomationLogisticsReserveFloor(availableSupply: number) {
  if (availableSupply >= SUPPLY_STOCKPILE_CAP) {
    return Math.max(0, SUPPLY_STOCKPILE_CAP - AUTOMATION_CAP_LOGISTICS_BUDGET);
  }

  return AUTOMATION_SUPPLY_RESERVE;
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

      if (spendableSupply < getMoveCost(1)) return;
      if (usedSources.has(getTileKey(source))) return;

      const maxTransferAmount = getMaxTransferAmount(
        tiles,
        { q: source.q, r: source.r },
        { q: target.q, r: target.r },
      );
      const amount = maxTransferAmount;

      if (amount <= 0) return;
      if (getMoveCost(amount) > spendableSupply) {
        return;
      }

      actions.push({
        id: `${source.q},${source.r}-${tick}`,
        owner: 1,
        from: { q: source.q, r: source.r },
        to: { q: target.q, r: target.r },
        amount,
        executeAt: tick + 1,
      });

      usedSources.add(getTileKey(source));
      remainingSupply -= getMoveCost(amount);
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
    .flatMap((source) =>
      getLandNeighbors(tiles, source)
        .filter(
          (target) =>
            target.owner === 1 &&
            target.troops < GARRISON_LIMIT &&
            target.troops < source.troops &&
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

  const logisticsReserveFloor =
    getAutomationLogisticsReserveFloor(availableSupply);

  if (remainingSupply < logisticsReserveFloor) {
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

  addActions(towardFrontReinforcementCandidates, logisticsReserveFloor);

  return actions;
}

function executeScheduledActions(
  tiles: Tile[],
  scheduled: ScheduledAction[],
  currentTick: number,
  players: PlayersState,
) {
  const pendingMoves: PendingMove[] = [];
  let nextTiles = tiles;
  let nextPlayers = players;

  scheduled.forEach((action) => {
    if (action.executeAt !== currentTick) return;

    const source = nextTiles.find(
      (t) => t.q === action.from.q && t.r === action.from.r,
    );

    if (!source || source.owner !== action.owner || source.troops <= 1) {
      return;
    }

    const target = nextTiles.find(
      (t) => t.q === action.to.q && t.r === action.to.r,
    );

    if (!target) return;

    const maxTransferAmount = getMaxTransferAmount(
      nextTiles,
      action.from,
      action.to,
    );
    const amount = isAttackMove(source, target)
      ? maxTransferAmount
      : Math.min(action.amount, maxTransferAmount);

    if (amount <= 0) return;
    const paidPlayers = applyMoveCost(action.owner, amount, nextPlayers);

    if (!paidPlayers) return;

    nextPlayers = paidPlayers;

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
      source: "scheduled",
      resolvesAt: currentTick + 1,
    });
  });

  return {
    tiles: nextTiles,
    players: nextPlayers,
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

    const civilianCap = getCivilianCapacity(t);
    if (civilianCap <= 0) return t;

    const housingPressure = 1 - t.civilians / civilianCap;
    const populationGrowth =
      t.civilians * t.growthRate * BASE_CIVILIAN_GROWTH_RATE;
    const recoveryGrowth = getLowPopulationRecoveryGrowth(t);
    const growth =
      Math.max(MIN_CIVILIAN_GROWTH, recoveryGrowth, populationGrowth) *
      housingPressure *
      getDevastationGrowthMultiplier(t);

    const newCivilians = Math.min(t.civilians + growth, civilianCap);

    return {
      ...t,
      civilians: newCivilians > civilianCap - 0.01 ? civilianCap : newCivilians,
      devastation: recoverDevastation(t),
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
  const executedActions = executeScheduledActions(
    tiles,
    scheduled,
    currentTick,
    nextPlayers,
  );
  tiles = executedActions.tiles;
  nextPlayers = executedActions.players;
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

  const draftResult = applyDraft(tiles, nextPlayers);
  tiles = draftResult.tiles;
  nextPlayers = draftResult.players;

  // ------------------------------
  // 4. Income
  // ------------------------------
  const supplyIncomeByOwner = getSupplyIncomeByOwner(tiles);

  nextPlayers = {
    1: addSupplyIncome(nextPlayers[1], supplyIncomeByOwner.get(1)),
    2: addSupplyIncome(nextPlayers[2], supplyIncomeByOwner.get(2)),
  };

  // ------------------------------
  // 5. Automation (Player 1)
  // ------------------------------
  const finalPending = [...nextPending];

  if (nextPlayers[1].automationEnabled) {
    const autoActions = runAutomation(
      tiles,
      currentTick,
      nextPlayers[1].supply,
    );

    autoActions.forEach((a) => {
      const source = tiles.find((t) => t.q === a.from.q && t.r === a.from.r);
      const target = tiles.find((t) => t.q === a.to.q && t.r === a.to.r);

      if (!source || !target) {
        return;
      }

      const maxTransferAmount = getMaxTransferAmount(tiles, a.from, a.to);
      const amount = maxTransferAmount;

      if (amount !== a.amount || getMoveCost(amount) > nextPlayers[a.owner].supply) {
        return;
      }

      const paidPlayers = applyMoveCost(a.owner, amount, nextPlayers);

      if (amount <= 0 || !paidPlayers) {
        return;
      }

      nextPlayers = paidPlayers;

      tiles = tiles.map((t) =>
        t.q === a.from.q && t.r === a.from.r
          ? { ...t, troops: t.troops - amount }
          : t,
      );

      finalPending.push({
        from: a.from,
        to: a.to,
        amount,
        owner: a.owner,
        source: "automation",
        resolvesAt: currentTick + 1,
      });
    });
  }

  // ------------------------------
  // 6. Bot move
  // ------------------------------
  const botMove = getBotMove(tiles, currentTick);

  if (botMove) {
    const move = tryCreateMove(botMove, nextPlayers);

    if (move) {
      const paidPlayers = applyMoveCost(move.owner, move.amount, nextPlayers);

      if (paidPlayers) {
        nextPlayers = paidPlayers;

        // Remove troops from source immediately
        tiles = tiles.map((t) =>
          t.q === move.from.q && t.r === move.from.r
            ? { ...t, troops: t.troops - move.amount }
            : t,
        );

        finalPending.push(move);
      }
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
