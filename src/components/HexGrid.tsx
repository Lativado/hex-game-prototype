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

// Convert hex coordinates to pixel position
function hexToPixel(q: number, r: number) {
  const x = HEX_SIZE * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r);
  const y = HEX_SIZE * (3 / 2) * r;
  return { x, y };
}

// Generate polygon points for a hex tile
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

function getEnemyTiles(tiles: Tile[]) {
  return tiles.filter((t) => t.owner === 2 && t.units > 1);
}

function runBotTurn(tiles: Tile[]): Tile[] {
  const enemyTiles = getEnemyTiles(tiles);
  if (enemyTiles.length === 0) return tiles;

  const source = enemyTiles[Math.floor(Math.random() * enemyTiles.length)];

  const neighbors = directions
    .map(([dq, dr]) => {
      const nq = source.q + dq;
      const nr = source.r + dr;
      return tiles.find((t) => t.q === nq && t.r === nr);
    })
    .filter((t): t is Tile => !!t && t.terrain !== "water" && t.owner !== 2);

  if (neighbors.length === 0) return tiles;

  const target = neighbors[Math.floor(Math.random() * neighbors.length)];

  const movable = source.units - 1;
  const space = STORAGE_CAP - target.units;
  const amount = Math.min(movable, space);

  if (amount <= 0) return tiles;

  return applyMoveWithOwner(tiles, source, target, amount, 2);
}

// Color tiles based on terrain + ownership
function getColor(owner: number | null, terrain: string, units: number) {
  if (terrain === "water") return "#1e3a8a";

  // normalize 0 → STORAGE_CAP
  const ratio = units / STORAGE_CAP;

  if (owner === 1) {
    // green scales brighter with units
    const g = Math.floor(150 + ratio * 100); // 150 → 250
    return `rgb(34, ${g}, 94)`; // base green tone
  }

  if (owner === 2) {
    // red scales brighter with units
    const r = Math.floor(150 + ratio * 100);
    return `rgb(${r}, 68, 68)`;
  }

  // neutral stays simple (or you could also scale it)
  return "#ffffff";
}

// Determine which tiles are valid move targets from the selected tile
function getValidMoves(tiles: Tile[], selected: string | null): Set<string> {
  const moves = new Set<string>();

  if (!selected) return moves;

  const [q, r] = selected.split(",").map(Number);

  directions.forEach(([dq, dr]) => {
    const nq = q + dq;
    const nr = r + dr;

    const tile = tiles.find((t) => t.q === nq && t.r === nr);

    // Only allow movement to existing, non-water tiles
    if (tile && tile.terrain !== "water") {
      moves.add(`${nq},${nr}`);
    }
  });

  return moves;
}

// Apply one game tick: grow units on owned land tiles up to a cap
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

function applyMoveWithOwner(
  tiles: Tile[],
  source: Tile,
  target: Tile,
  amount: number,
  owner: number,
): Tile[] {
  return tiles.map((t) => {
    if (t.q === source.q && t.r === source.r) {
      return { ...t, units: t.units - amount };
    }

    if (t.q === target.q && t.r === target.r) {
      // reuse your resistance logic here, but replace owner with `owner`
      // example:
      if (t.owner === owner) {
        return { ...t, units: t.units + amount };
      }

      const defenseMultiplier = t.owner === null ? 0.7 : 1.0;
      const defense = Math.floor(t.units * defenseMultiplier);

      if (amount > defense) {
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
}

// Apply movement from one tile to another
function applyMove(
  tiles: Tile[],
  from: string,
  to: string,
  amount: number,
): Tile[] {
  const [fromQ, fromR] = from.split(",").map(Number);
  const [toQ, toR] = to.split(",").map(Number);

  return tiles.map((t) => {
    // Source tile
    if (t.q === fromQ && t.r === fromR) {
      return { ...t, units: t.units - amount };
    }

    // Destination tile
    if (t.q === toQ && t.r === toR) {
      const attack = amount;

      // Friendly tile → merge
      if (t.owner === 1) {
        return {
          ...t,
          units: t.units + attack,
        };
      }

      const defenseMultiplier = t.owner === null ? 0.7 : 1.0;
      const effectiveDefense = Math.floor(t.units * defenseMultiplier);

      if (attack > effectiveDefense) {
        return {
          ...t,
          units: attack - effectiveDefense,
          owner: 1,
        };
      } else {
        return {
          ...t,
          units: t.units - attack,
        };
      }
    }

    return t;
  });
}

export default function HexGrid() {
  const [tiles, setTiles] = useState<Tile[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const selectedTile =
    tiles && selected ? tiles.find((t) => `${t.q},${t.r}` === selected) : null;
  const [usedTiles, setUsedTiles] = useState<Set<string>>(new Set());

  function resetGame() {
    localStorage.removeItem("tiles");
    setTiles(generateGrid(5));
    setSelected(null);
  }

  // Load game state after mount (avoids hydration issues with localStorage)
  useEffect(() => {
    const saved = localStorage.getItem("tiles");
    const initial = saved ? JSON.parse(saved) : generateGrid(3);
    setTiles(initial);
  }, []);

  // Persist tiles whenever state changes
  useEffect(() => {
    if (tiles) {
      localStorage.setItem("tiles", JSON.stringify(tiles));
    }
  }, [tiles]);

  // Run a single tick (manual or automated)
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

  // Auto-tick loop (runs every 3 seconds)
  useEffect(() => {
    const interval = setInterval(runTick, 3000);
    return () => clearInterval(interval);
  }, [tiles]);

  // Prevent rendering until tiles are loaded
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
        style={{
          marginLeft: "10px",
        }}
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
                  // Water tiles are not interactable
                  if (terrain === "water") return;

                  // No selection yet → only allow selecting owned tiles
                  if (!selected) {
                    if (owner === 1) setSelected(key);
                    return;
                  }

                  // Clicking same tile deselects
                  if (selected === key) {
                    setSelected(null);
                    return;
                  }

                  if (usedTiles.has(selected)) return;

                  // Move if valid
                  if (validMoves.has(key)) {
                    const [fromQ, fromR] = selected.split(",").map(Number);

                    const source = tiles.find(
                      (t) => t.q === fromQ && t.r === fromR,
                    );
                    const target = tiles.find((t) => t.q === q && t.r === r);

                    if (!source || !target) return;

                    // Rule 1: must have enough units to move
                    if (source.units <= 1) return;

                    // Rule 2: destination must not be full
                    if (target.units >= STORAGE_CAP) return;

                    const movableUnits = source.units - 1;
                    const spaceAvailable = STORAGE_CAP - target.units;

                    const amountToMove = Math.min(movableUnits, spaceAvailable);

                    if (amountToMove > 0) {
                      setTiles((prev) =>
                        prev
                          ? applyMove(prev, selected, key, amountToMove)
                          : prev,
                      );
                      setUsedTiles((prev) => {
                        const next = new Set(prev);
                        next.add(selected); // source
                        next.add(key); // destination
                        return next;
                      });
                    }

                    setSelected(null);
                    return;
                  }

                  // Otherwise allow switching selection only to owned tiles
                  if (owner === 1) setSelected(key);
                }}
                style={{ cursor: "pointer" }}
              />
              {/* Only render units for land tiles */}
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
        <div
          style={{
            marginBottom: "10px",
            padding: "8px",
            border: "1px solid gray",
            maxWidth: "300px",
          }}
        >
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
