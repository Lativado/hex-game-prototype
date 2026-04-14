"use client";

import { useEffect, useState } from "react";
import { generateGrid } from "../lib/hexGrid";
import { Tile } from "@/types/tile";

const HEX_SIZE = 30;
const PRODUCTION_CAP = 20;
const STORAGE_CAP = 30;

// Axial direction vectors for hex neighbors
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

// Color tiles with intensity
function getColor(owner: number | null, terrain: string, units: number) {
  if (terrain === "water") return "#1e3a8a";

  const ratio = units / STORAGE_CAP;

  if (owner === 1) {
    const g = Math.floor(150 + ratio * 100);
    return `rgb(34, ${g}, 94)`;
  }

  if (owner === 2) {
    const r = Math.floor(150 + ratio * 100);
    return `rgb(${r}, 68, 68)`;
  }

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

// Growth
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

// Unified movement + combat
function applyMove(
  tiles: Tile[],
  source: Tile,
  target: Tile,
  amount: number,
  owner: number,
): { tiles: Tile[]; captured: boolean } {
  let captured = false;

  const result = tiles.map((t) => {
    if (t.q === source.q && t.r === source.r) {
      return { ...t, units: t.units - amount };
    }

    if (t.q === target.q && t.r === target.r) {
      // Friendly merge
      if (t.owner === owner) {
        return { ...t, units: t.units + amount };
      }

      const defenseMultiplier = t.owner === null ? 0.7 : 1.0;
      const defense = Math.floor(t.units * defenseMultiplier);

      if (amount > defense) {
        captured = true;
        return {
          ...t,
          units: amount - defense,
          owner,
        };
      } else {
        return {
          ...t,
          units: t.units - amount,
        };
      }
    }

    return t;
  });

  return { tiles: result, captured };
}

// Bot
function runBotTurn(tiles: Tile[]): Tile[] {
  const enemyTiles = tiles.filter((t) => t.owner === 2 && t.units > 1);
  if (enemyTiles.length === 0) return tiles;

  const source = enemyTiles[Math.floor(Math.random() * enemyTiles.length)];

  const neighbors = directions
    .map(([dq, dr]) =>
      tiles.find((t) => t.q === source.q + dq && t.r === source.r + dr),
    )
    .filter((t): t is Tile => !!t && t.terrain !== "water" && t.owner !== 2);

  if (neighbors.length === 0) return tiles;

  neighbors.sort((a, b) => a.units - b.units);
  const target = neighbors[0];

  const movable = source.units - 1;
  const space = STORAGE_CAP - target.units;
  const amount = Math.min(movable, space);

  if (amount <= 0) return tiles;

  return applyMove(tiles, source, target, amount, 2).tiles;
}

export default function HexGrid() {
  const [tiles, setTiles] = useState<Tile[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [usedTiles, setUsedTiles] = useState<Set<string>>(new Set());

  const selectedTile =
    tiles && selected ? tiles.find((t) => `${t.q},${t.r}` === selected) : null;

  function resetGame() {
    localStorage.removeItem("tiles");
    setTiles(generateGrid(5));
    setSelected(null);
  }

  useEffect(() => {
    const saved = localStorage.getItem("tiles");
    const initial = saved ? JSON.parse(saved) : generateGrid(5);
    setTiles(initial);
  }, []);

  useEffect(() => {
    if (tiles) {
      localStorage.setItem("tiles", JSON.stringify(tiles));
    }
  }, [tiles]);

  function runTick() {
    setTiles((prev) => {
      if (!prev) return prev;
      let next = applyTick(prev);
      next = runBotTurn(next);
      return next;
    });

    setUsedTiles(new Set());
    setTick((t) => t + 1);
  }

  useEffect(() => {
    const interval = setInterval(runTick, 3000);
    return () => clearInterval(interval);
  }, [tiles]);

  if (!tiles) return null;

  const validMoves = getValidMoves(tiles, selected);

  return (
    <div>
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

      <svg width={600} height={600} style={{ border: "1px solid gray" }}>
        {tiles.map((tile) => {
          const { q, r, owner, units, terrain } = tile;
          const { x, y } = hexToPixel(q, r);
          const key = `${q},${r}`;

          const isSelected = selected === key;
          const isValidMove = validMoves.has(key);
          const isUsed = usedTiles.has(key);

          return (
            <g key={key}>
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

                  if (selected === key) {
                    setSelected(null);
                    return;
                  }

                  if (usedTiles.has(selected)) return;

                  if (validMoves.has(key)) {
                    const [fromQ, fromR] = selected.split(",").map(Number);

                    const source = tiles.find(
                      (t) => t.q === fromQ && t.r === fromR,
                    );
                    const target = tiles.find((t) => t.q === q && t.r === r);

                    if (!source || !target) return;
                    if (source.units <= 1) return;
                    if (target.units >= STORAGE_CAP) return;

                    const movable = source.units - 1;
                    const space = STORAGE_CAP - target.units;
                    const amount = Math.min(movable, space);

                    if (amount > 0) {
                      setTiles((prev) => {
                        if (!prev) return prev;

                        const result = applyMove(
                          prev,
                          source,
                          target,
                          amount,
                          1,
                        );

                        setUsedTiles((prevUsed) => {
                          const next = new Set(prevUsed);
                          next.add(selected);

                          if (target.owner === 1 || result.captured) {
                            next.add(key);
                          }

                          return next;
                        });

                        return result.tiles;
                      });
                    }

                    setSelected(null);
                    return;
                  }

                  // Allow switching selection to another owned tile anytime
                  if (owner === 1 && key !== selected) {
                    setSelected(key);
                    return;
                  }
                }}
                style={{ cursor: "pointer" }}
              />

              {terrain !== "water" && (
                <text
                  x={x + 300}
                  y={y + 305}
                  textAnchor="middle"
                  fontSize="12"
                  fill="black"
                  pointerEvents="none"
                >
                  {units}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {selectedTile && (
        <div style={{ marginTop: 10, padding: 8, border: "1px solid gray" }}>
          <div>
            <strong>Tile</strong>
          </div>
          <div>
            Coords: {selectedTile.q}, {selectedTile.r}
          </div>
          <div>Owner: {selectedTile.owner ?? "none"}</div>
          <div>Units: {selectedTile.units}</div>
          <div>Terrain: {selectedTile.terrain}</div>
        </div>
      )}
    </div>
  );
}
