"use client";

import { useEffect, useState } from "react";
import { generateGrid } from "../lib/hexGrid";
import { Tile } from "@/types/tile";

const HEX_SIZE = 30;
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
  const [usedTiles, setUsedTiles] = useState<Set<string>>(new Set());

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
    setUsedTiles(new Set());
  }

  useEffect(() => {
    const saved = localStorage.getItem("tiles");
    const initial = saved ? JSON.parse(saved) : generateGrid(5);
    setTiles(initial);
  }, []);

  useEffect(() => {
    if (tiles) localStorage.setItem("tiles", JSON.stringify(tiles));
  }, [tiles]);

  function runTick() {
    const nextTick = tick + 1;

    const resolving = pendingMoves.filter((m) => m.resolvesAt === nextTick);
    const remaining = pendingMoves.filter((m) => m.resolvesAt > nextTick);

    setTiles((prev) => {
      if (!prev) return prev;

      let next = applyTick(prev);

      const groups = new Map<string, PendingMove[]>();

      resolving.forEach((m) => {
        const key = `${m.to.q},${m.to.r}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(m);
      });

      groups.forEach((moves) => {
        const { q, r } = moves[0].to;
        const target = next.find((t) => t.q === q && t.r === r);
        if (!target) return;

        const totalAttack = moves.reduce((sum, m) => sum + m.amount, 0);

        let newUnits = target.units;
        let newOwner = target.owner;

        if (target.owner === moves[0].owner) {
          newUnits += totalAttack;
        } else {
          const defenseMultiplier = target.owner === null ? 0.7 : 1.0;
          const defense = Math.floor(target.units * defenseMultiplier);

          if (totalAttack > defense) {
            newUnits = totalAttack - defense;
            newOwner = moves[0].owner;
          } else {
            newUnits = target.units - totalAttack;
          }
        }

        let overflow = 0;
        if (newUnits > STORAGE_CAP) {
          overflow = newUnits - STORAGE_CAP;
          newUnits = STORAGE_CAP;
        }

        next = next.map((t) =>
          t.q === q && t.r === r
            ? { ...t, units: Math.max(0, newUnits), owner: newOwner }
            : t,
        );

        if (overflow > 0) {
          let remainingOverflow = overflow;

          for (const move of moves) {
            if (remainingOverflow <= 0) break;

            const giveBack = Math.min(move.amount, remainingOverflow);

            next = next.map((t) => {
              if (
                t.q === move.from.q &&
                t.r === move.from.r &&
                t.owner === move.owner
              ) {
                return {
                  ...t,
                  units: Math.min(STORAGE_CAP, t.units + giveBack),
                };
              }
              return t;
            });

            remainingOverflow -= giveBack;
          }
        }
      });

      return next;
    });

    setPendingMoves(remaining);
    setUsedTiles(new Set());
    setTick(nextTick);
  }

  useEffect(() => {
    const interval = setInterval(runTick, 3000);
    return () => clearInterval(interval);
  }, [tick, pendingMoves]);

  if (!tiles) return null;

  const validMoves = getValidMoves(tiles, selected);

  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <button
          className="px-3 py-1 border border-gray-400 bg-gray-200 text-gray-900 rounded hover:bg-gray-300"
          onClick={runTick}
        >
          Run Tick
        </button>
        <button
          className="px-3 py-1 border border-gray-400 bg-gray-200 text-gray-900 rounded hover:bg-gray-300"
          onClick={resetGame}
          style={{ marginLeft: 10 }}
        >
          Reset Game
        </button>
      </div>

      <svg width={600} height={600} style={{ border: "1px solid gray" }}>
        {pendingMoves.map((move, i) => {
          const from = hexToPixel(move.from.q, move.from.r);
          const to = hexToPixel(move.to.q, move.to.r);

          return (
            <line
              key={i}
              x1={from.x + 300}
              y1={from.y + 300}
              x2={to.x + 300}
              y2={to.y + 300}
              stroke={move.owner === 1 ? "green" : "red"}
              strokeWidth={2}
              opacity={0.5}
              pointerEvents="none"
            />
          );
        })}

        {tiles.map((tile) => {
          const { q, r, owner, units, terrain } = tile;
          const { x, y } = hexToPixel(q, r);
          const key = `${q},${r}`;

          const isSelected = selected === key;
          const isValidMove = validMoves.has(key);
          const isUsed = usedTiles.has(key);

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
                opacity={isUsed ? 0.5 : 1}
                stroke="black"
                onClick={() => {
                  if (terrain === "water") return;

                  if (!selected) {
                    if (owner === 1) setSelected(key);
                    return;
                  }

                  if (usedTiles.has(selected)) return;

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

                    setUsedTiles((prevUsed) => {
                      const next = new Set(prevUsed);
                      next.add(selected);
                      return next;
                    });

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
                    key={i}
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
      </svg>
    </div>
  );
}
