"use client";

import { useMemo, useState } from "react";
import { generateGrid } from "../lib/hexGrid";

const HEX_SIZE = 30;

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

function getColor(owner: number | null, terrain: string) {
  if (terrain === "water") return "#1e3a8a"; // deep blue
  if (owner === 1) return "#f87171"; // red
  return "#ffffff"; // neutral = white
}

export default function HexGrid() {
  const [selected, setSelected] = useState<string | null>(null);

  const [tiles, setTiles] = useState(() => generateGrid(3));

  const selectedCoords = selected ? selected.split(",").map(Number) : null;

  const validMoves = new Set<string>();

  if (selectedCoords) {
    const [q, r] = selectedCoords;

    directions.forEach(([dq, dr]) => {
      const nq = q + dq;
      const nr = r + dr;

      const tile = tiles.find((t) => t.q === nq && t.r === nr);

      if (tile && tile.terrain !== "water") {
        validMoves.add(`${nq},${nr}`);
      }
    });
  }

  return (
    <svg width={600} height={600} style={{ border: "1px solid gray" }}>
      {tiles.map((tile) => {
        const { q, r, owner, units } = tile;
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
                    : getColor(owner, tile.terrain)
              }
              stroke="black"
              onClick={() => {
                if (!selected) {
                  // nothing selected → select this tile
                  setSelected(key);
                  return;
                }

                if (selected === key) {
                  // clicking same tile → deselect
                  setSelected(null);
                  return;
                }

                const [fromQ, fromR] = selected.split(",").map(Number);

                const sourceTile = tiles.find(
                  (t) => t.q === fromQ && t.r === fromR,
                );

                if (!sourceTile || sourceTile.owner !== 1) {
                  setSelected(key);
                  return;
                }

                if (validMoves.has(key)) {
                  const [fromQ, fromR] = selected.split(",").map(Number);

                  const targetTile = tiles.find((t) => t.q === q && t.r === r);

                  if (!targetTile || targetTile.terrain === "water") {
                    return; // block movement
                  }

                  setTiles((prev) =>
                    prev.map((t) => {
                      // source tile
                      if (t.q === fromQ && t.r === fromR && t.units > 0) {
                        return { ...t, units: t.units - 1 };
                      }

                      // destination tile
                      if (t.q === q && t.r === r) {
                        return {
                          ...t,
                          units: t.units + 1,
                          owner: t.owner ?? 1, // claim if neutral
                        };
                      }

                      return t;
                    }),
                  );

                  setSelected(null);
                  return;
                }

                // clicked non-valid move → just switch selection
                setSelected(key);
              }}
              style={{ cursor: "pointer" }}
            />
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
          </g>
        );
      })}
    </svg>
  );
}
