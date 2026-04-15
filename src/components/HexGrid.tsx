"use client";

import { useEffect, useState } from "react";
import { generateGrid } from "../lib/hexGrid";
import { Tile } from "@/types/tile";

const HEX_SIZE = 30;
const PRODUCTION_CAP = 20;
const STORAGE_CAP = 30;

// Centralized button styling
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

export default function HexGrid() {
  const [tiles, setTiles] = useState<Tile[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  type PendingMove = {
    from: { q: number; r: number };
    to: { q: number; r: number };
    amount: number;
    owner: number;
    resolvesAt: number;
  };

  const [pendingMoves, setPendingMoves] = useState<PendingMove[]>([]);

  function resetGame() {
    localStorage.removeItem("tiles");
    setTiles(generateGrid(5));
    setSelected(null);
    setPendingMoves([]);
    setTick(0);
  }

  useEffect(() => {
    const saved = localStorage.getItem("tiles");
    const initial = saved ? JSON.parse(saved) : generateGrid(5);
    setTiles(initial);
  }, []);

  useEffect(() => {
    if (tiles) localStorage.setItem("tiles", JSON.stringify(tiles));
  }, [tiles]);

  // Tick drives simulation
  useEffect(() => {
    if (!tiles) return;
    runTick();
  }, [tick]);

  // Interval ONLY advances time
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  function getBotMove(
    currentTiles: Tile[],
    currentTick: number,
  ): PendingMove | null {
    const enemyTiles = currentTiles.filter((t) => t.owner === 2 && t.units > 1);
    if (enemyTiles.length === 0) return null;

    const source = enemyTiles[Math.floor(Math.random() * enemyTiles.length)];

    const neighbors = directions
      .map(([dq, dr]) =>
        currentTiles.find(
          (t) => t.q === source.q + dq && t.r === source.r + dr,
        ),
      )
      .filter((t): t is Tile => !!t && t.terrain !== "water" && t.owner !== 2);

    if (neighbors.length === 0) return null;

    neighbors.sort((a, b) => a.units - b.units);
    const target = neighbors[0];

    const amount = source.units - 1;
    if (amount <= 0) return null;

    return {
      from: { q: source.q, r: source.r },
      to: { q: target.q, r: target.r },
      amount,
      owner: 2,
      resolvesAt: currentTick + 1,
    };
  }

  function runTick() {
    if (!tiles) return;

    const currentTick = tick;

    const resolving = pendingMoves.filter((m) => m.resolvesAt === currentTick);
    const remaining = pendingMoves.filter((m) => m.resolvesAt > currentTick);

    let next = applyTick(tiles);

    const groups = new Map<string, PendingMove[]>();

    resolving.forEach((m) => {
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

    const botMove = getBotMove(next, currentTick);

    if (botMove) {
      next = next.map((t) =>
        t.q === botMove.from.q && t.r === botMove.from.r
          ? { ...t, units: t.units - botMove.amount }
          : t,
      );
    }

    setTiles(next);
    setPendingMoves(botMove ? [...remaining, botMove] : remaining);
  }

  if (!tiles) return null;

  const validMoves = getValidMoves(tiles, selected);

  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <button className={BTN} onClick={() => setTick((t) => t + 1)}>
          Run Tick
        </button>
        <button className={BTN} onClick={resetGame} style={{ marginLeft: 10 }}>
          Reset Game
        </button>
      </div>

      <svg width={600} height={600} style={{ border: "1px solid gray" }}>
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

                  if (validMoves.has(key)) {
                    const [fromQ, fromR] = selected.split(",").map(Number);

                    const source = tiles.find(
                      (t) => t.q === fromQ && t.r === fromR,
                    );

                    if (!source || source.units <= 1) return;

                    const amount = source.units - 1;

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

              {/* Debug circles */}
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

        {/* Debug arrows */}
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
              pointerEvents="none"
            />
          );
        })}
      </svg>
    </div>
  );
}
