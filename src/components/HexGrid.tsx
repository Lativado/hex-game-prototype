"use client";

import { useEffect, useState } from "react";
import { generateGrid } from "../lib/hexGrid";
import { Tile } from "@/types/tile";

const HEX_SIZE = 30;
const PRODUCTION_CAP = 20;
const STORAGE_CAP = 30;

const BTN =
  "px-3 py-1 border border-gray-400 bg-gray-200 text-gray-900 rounded hover:bg-gray-300";

const directions = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

// ------------------------------
// Types
// ------------------------------

type PendingMove = {
  from: { q: number; r: number };
  to: { q: number; r: number };
  amount: number;
  owner: number;
  resolvesAt: number;
};

type ScheduledAction = {
  id: string;
  owner: number;
  from: { q: number; r: number };
  to: { q: number; r: number };
  amount: number;
  executeAt: number;
};

// ------------------------------
// Helpers
// ------------------------------

function hexToPixel(q: number, r: number) {
  const x = HEX_SIZE * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r);
  const y = HEX_SIZE * (3 / 2) * r;
  return { x, y };
}

function getHexPoints(x: number, y: number) {
  const points = [];
  for (let i = 0; i < 6; i++) {
    const angle = ((60 * i - 30) * Math.PI) / 180;
    const px = x + HEX_SIZE * Math.cos(angle);
    const py = y + HEX_SIZE * Math.sin(angle);
    points.push(`${px},${py}`);
  }
  return points.join(" ");
}

function getColor(owner: number | null, terrain: string, units: number) {
  if (terrain === "water") return "#1e3a8a";

  const ratio = units / STORAGE_CAP;

  if (owner === 1) return `rgb(34, ${Math.floor(150 + ratio * 100)}, 94)`;
  if (owner === 2) return `rgb(${Math.floor(150 + ratio * 100)}, 68, 68)`;

  return "#ffffff";
}

function getValidMoves(tiles: Tile[], selected: string | null): Set<string> {
  const moves = new Set<string>();
  if (!selected) return moves;

  const [q, r] = selected.split(",").map(Number);

  directions.forEach(([dq, dr]) => {
    const tile = tiles.find((t) => t.q === q + dq && t.r === r + dr);
    if (tile && tile.terrain !== "water") {
      moves.add(`${tile.q},${tile.r}`);
    }
  });

  return moves;
}

function applyTick(tiles: Tile[]): Tile[] {
  return tiles.map((t) => {
    if (
      (t.owner === 1 || t.owner === 2) &&
      t.terrain !== "water" &&
      t.units < PRODUCTION_CAP
    ) {
      return { ...t, units: t.units + 1 };
    }
    return t;
  });
}

// ------------------------------
// Core Systems
// ------------------------------

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

    let newUnits: number;
    let newOwner = target.owner;

    if (target.owner === attackerOwner) {
      newUnits = target.units + attackPower;
    } else {
      const defenseMultiplier = target.owner === null ? 0.7 : 1.0;
      const defense = Math.floor(target.units * defenseMultiplier);

      if (attackPower >= defense) {
        newUnits = attackPower - defense;
        newOwner = attackerOwner;
      } else {
        newUnits = target.units - attackPower;

        if (newUnits <= 0) {
          newUnits = 0;
          newOwner = attackerOwner;
        }
      }
    }

    newUnits = Math.min(STORAGE_CAP, Math.max(0, newUnits));

    next = next.map((t) =>
      t.q === q && t.r === r ? { ...t, units: newUnits, owner: newOwner } : t,
    );
  });

  return next;
}

function getBotMove(tiles: Tile[], tick: number): PendingMove | null {
  const owned = tiles.filter((t) => t.owner === 2 && t.units > 1);
  if (!owned.length) return null;

  const source = owned[Math.floor(Math.random() * owned.length)];

  const neighbors = directions
    .map(([dq, dr]) =>
      tiles.find((t) => t.q === source.q + dq && t.r === source.r + dr),
    )
    .filter((t): t is Tile => !!t && t.terrain !== "water" && t.owner !== 2);

  if (!neighbors.length) return null;

  neighbors.sort((a, b) => a.units - b.units);
  const target = neighbors[0];

  const amount = source.units - 1;
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
    if (tile.units < 10) return;

    const neighbors = directions
      .map(([dq, dr]) =>
        tiles.find((t) => t.q === tile.q + dq && t.r === tile.r + dr),
      )
      .filter((t): t is Tile => !!t && t.terrain !== "water");

    if (!neighbors.length) return;

    neighbors.sort((a, b) => a.units - b.units);
    const target = neighbors[0];

    actions.push({
      id: `${tile.q},${tile.r}-${tick}`,
      owner: 1,
      from: { q: tile.q, r: tile.r },
      to: { q: target.q, r: target.r },
      amount: tile.units - 1,
      executeAt: tick + 1,
    });
  });

  return actions;
}

// ------------------------------
// Component
// ------------------------------

export default function HexGrid() {
  const [tiles, setTiles] = useState<Tile[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [pendingMoves, setPendingMoves] = useState<PendingMove[]>([]);
  const [scheduledActions, setScheduledActions] = useState<ScheduledAction[]>(
    [],
  );
  const [automationEnabled, setAutomationEnabled] = useState(false);
  const [playerSupply, setPlayerSupply] = useState(0);
  const [botSupply, setBotSupply] = useState(0);

  function resetGame() {
    localStorage.removeItem("tiles");

    const fresh = generateGrid(5);

    setTiles(fresh);
    setSelected(null);

    // core simulation
    setPendingMoves([]);
    setScheduledActions([]);
    setTick(0);

    // economy
    setPlayerSupply(0);
    setBotSupply(0);

    // automation
    setAutomationEnabled(false);
  }

  useEffect(() => {
    setTiles(generateGrid(5));
  }, []);

  useEffect(() => {
    if (!tiles) return;

    const currentTick = tick;

    const ready = scheduledActions.filter((a) => a.executeAt === currentTick);
    const future = scheduledActions.filter((a) => a.executeAt > currentTick);

    const newMoves: PendingMove[] = ready.map((a) => ({
      from: a.from,
      to: a.to,
      amount: a.amount,
      owner: a.owner,
      resolvesAt: currentTick + 1,
    }));

    const combined = [...pendingMoves, ...newMoves];

    const resolving = combined.filter((m) => m.resolvesAt === currentTick);
    const remaining = combined.filter((m) => m.resolvesAt > currentTick);

    let next = applyTick(tiles);

    // Tiles generate supply.
    let playerIncome = 0;
    let botIncome = 0;

    tiles.forEach((t) => {
      if (t.owner === 1) playerIncome += 1;
      if (t.owner === 2) botIncome += 1;
    });

    setPlayerSupply((s) => s + playerIncome);
    setBotSupply((s) => s + botIncome);

    next = resolveMoves(next, resolving);

    let nextScheduled = future;

    if (automationEnabled) {
      nextScheduled = [...nextScheduled, ...runAutomation(next, currentTick)];
    }

    const botMove = getBotMove(next, currentTick);

    if (botMove && botSupply >= botMove.amount) {
      setBotSupply((s) => s - botMove.amount);

      next = next.map((t) =>
        t.q === botMove.from.q && t.r === botMove.from.r
          ? { ...t, units: t.units - botMove.amount }
          : t,
      );
    } else {
      // Do nothing, bot can't afford move
    }

    const nextPending = botMove ? [...remaining, botMove] : remaining;

    setTiles(next);
    setPendingMoves(nextPending);
    setScheduledActions(nextScheduled);
  }, [tick]);

  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 3000);
    return () => clearInterval(i);
  }, []);

  if (!tiles) return null;

  const validMoves = getValidMoves(tiles, selected);

  return (
    <div style={{ position: "relative" }}>
      <div style={{ marginBottom: 10 }}>
        <button className={BTN} onClick={() => setTick((t) => t + 1)}>
          Run Tick
        </button>
        <button className={BTN} onClick={resetGame} style={{ marginLeft: 10 }}>
          Reset Game
        </button>
        <button
          className={BTN}
          onClick={() => setAutomationEnabled((a) => !a)}
          style={{ marginLeft: 10 }}
        >
          Auto: {automationEnabled ? "ON" : "OFF"}
        </button>
      </div>

      <svg width={600} height={600} style={{ border: "1px solid gray" }}>
        {/* INTERACTIVE LAYER */}
        <g>
          {tiles.map((tile) => {
            const { q, r, owner, units, terrain } = tile;
            const { x, y } = hexToPixel(q, r);
            const key = `${q},${r}`;

            const isSelected = selected === key;
            const isValidMove = validMoves.has(key);

            return (
              <g key={key} style={{ cursor: "pointer" }}>
                <polygon
                  points={getHexPoints(x + 300, y + 300)}
                  fill={
                    isSelected
                      ? "orange"
                      : isValidMove
                        ? "#fde68a"
                        : getColor(owner, terrain, units)
                  }
                  stroke="black"
                  onClick={() => {
                    if (terrain === "water") return;

                    if (!selected) {
                      if (owner === 1) setSelected(key);
                      return;
                    }

                    if (isValidMove) {
                      const [fromQ, fromR] = selected.split(",").map(Number);

                      const source = tiles.find(
                        (t) => t.q === fromQ && t.r === fromR,
                      );

                      if (!source || source.units <= 1) return;

                      const amount = source.units - 1;

                      // Moves cost supply
                      const cost = amount;

                      if (playerSupply < cost) return; // block move

                      setPlayerSupply((s) => s - cost);

                      setTiles((prev) =>
                        prev
                          ? prev.map((t) =>
                              t.q === source.q && t.r === source.r
                                ? { ...t, units: t.units - amount }
                                : t,
                            )
                          : prev,
                      );

                      setPendingMoves((prev) => [
                        ...prev,
                        {
                          from: { q: source.q, r: source.r },
                          to: { q, r },
                          amount,
                          owner: 1,
                          resolvesAt: tick + 1,
                        },
                      ]);

                      setSelected(null);
                      return;
                    }

                    if (owner === 1) setSelected(key);
                  }}
                />

                {pendingMoves
                  .filter((m) => m.to.q === q && m.to.r === r)
                  .map((m, i) => (
                    <circle
                      key={`circle-${i}`}
                      cx={x + 300}
                      cy={y + 300}
                      r={6}
                      fill={m.owner === 1 ? "green" : "red"}
                      opacity={0.7}
                      pointerEvents="none"
                    />
                  ))}

                {terrain !== "water" && (
                  <text
                    x={x + 300}
                    y={y + 305}
                    textAnchor="middle"
                    fontSize="12"
                    pointerEvents="none"
                  >
                    {units}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* NON-INTERACTIVE OVERLAY LAYER */}
        <g pointerEvents="none">
          {/* Debug circles */}
          {tiles.map((tile) => {
            const { q, r } = tile;
            const { x, y } = hexToPixel(q, r);

            return pendingMoves
              .filter((m) => m.to.q === q && m.to.r === r)
              .map((m, i) => (
                <circle
                  key={`circle-${i}`}
                  cx={x + 300}
                  cy={y + 300}
                  r={6}
                  fill={m.owner === 1 ? "green" : "red"}
                  opacity={0.7}
                />
              ));
          })}

          {/* Arrows */}
          {pendingMoves.map((move, i) => {
            const from = hexToPixel(move.from.q, move.from.r);
            const to = hexToPixel(move.to.q, move.to.r);

            return (
              <line
                key={`line-${i}`}
                x1={from.x + 300}
                y1={from.y + 300}
                x2={to.x + 300}
                y2={to.y + 300}
                stroke={move.owner === 1 ? "lime" : "red"}
                strokeWidth={3}
                opacity={0.9}
              />
            );
          })}
        </g>
      </svg>

      <div
        style={{
          position: "absolute",
          bottom: 10,
          left: 10,
          background: "rgba(0,0,0,0.7)",
          color: "white",
          padding: "8px 10px",
          fontSize: 12,
          borderRadius: 6,
        }}
      >
        <div style={{ marginBottom: 10 }}>
          <span style={{ marginRight: 15 }}>Player Supply: {playerSupply}</span>
          <span>Bot Supply: {botSupply}</span>
        </div>
        <div>Tick: {tick}</div>
        <div>Scheduled: {scheduledActions.length}</div>
        <div>Pending: {pendingMoves.length}</div>
      </div>
    </div>
  );
}
