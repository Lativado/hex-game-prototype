"use client";

import { useEffect, useState } from "react";
import { generateGrid } from "../lib/hexGrid";
import { Tile } from "@/types/tile";

const HEX_SIZE = 30;

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

// Color tiles based on terrain + ownership
function getColor(owner: number | null, terrain: string) {
  if (terrain === "water") return "#1e3a8a"; // water is non-playable
  if (owner === 1) return "#f87171"; // player owned
  return "#ffffff"; // neutral land
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
    if (t.owner === 1 && t.terrain !== "water" && t.units < 20) {
      return { ...t, units: t.units + 1 };
    }
    return t;
  });
}

// Apply movement from one tile to another
function applyMove(tiles: Tile[], from: string, to: string): Tile[] {
  const [fromQ, fromR] = from.split(",").map(Number);
  const [toQ, toR] = to.split(",").map(Number);

  return tiles.map((t) => {
    // Require at least 2 units so tiles cannot be drained to zero
    if (t.q === fromQ && t.r === fromR && t.units > 1) {
      return { ...t, units: t.units - 1 };
    }

    // Destination tile gains unit and may be claimed if neutral
    if (t.q === toQ && t.r === toR) {
      return {
        ...t,
        units: t.units + 1,
        owner: t.owner ?? 1,
      };
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

  function resetGame() {
    localStorage.removeItem("tiles");
    setTiles(generateGrid(3));
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
    if (!tiles) return;
    setTiles((prev) => (prev ? applyTick(prev) : prev));
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

          return (
            <g key={key}>
              <polygon
                points={getHexPoints(x + 300, y + 300)}
                fill={
                  isSelected
                    ? "orange"
                    : isValidMove
                      ? "#fde68a"
                      : getColor(owner, terrain)
                }
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

                  // Move if valid
                  if (validMoves.has(key)) {
                    setTiles((prev) =>
                      prev ? applyMove(prev, selected, key) : prev,
                    );
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
