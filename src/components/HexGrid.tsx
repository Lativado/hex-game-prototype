"use client";

import { useEffect, useState } from "react";
import { generateGrid } from "../lib/hexGrid";
import { Tile } from "@/types/tile";
import { getMaxTransferAmount } from "@/lib/gameEngine";
import {
  processTick,
  tryCreateMove,
  applyMoveCost,
  GameState,
} from "../lib/gameEngine";

const HEX_SIZE = 30;

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

function getColor(owner: number | null, terrain: string, troops: number) {
  if (terrain === "water") return "#1e3a8a";

  if (owner === 1) return "green";
  if (owner === 2) return "red";

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

export default function HexGrid() {
  const [state, setState] = useState<GameState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  function resetGame() {
    const tiles = generateGrid(5);

    setState({
      tiles,
      pendingMoves: [],
      scheduledActions: [],
      tick: 0,
      playerSupply: 0,
      botSupply: 0,
      automationEnabled: false,
    });

    setSelected(null);
  }

  useEffect(() => {
    resetGame();
  }, []);

  useEffect(() => {
    if (!state) return;

    const interval = setInterval(() => {
      setState((prev) => (prev ? processTick(prev) : prev));
    }, 3000);

    return () => clearInterval(interval);
  }, [state]);

  if (!state) return null;

  const {
    tiles,
    pendingMoves,
    tick,
    playerSupply,
    botSupply,
    automationEnabled,
  } = state;

  const validMoves = getValidMoves(tiles, selected);

  return (
    <div style={{ position: "relative" }}>
      <div style={{ marginBottom: 10 }}>
        <button
          className={BTN}
          onClick={() => setState((s) => (s ? processTick(s) : s))}
        >
          Run Tick
        </button>
        <button className={BTN} onClick={resetGame} style={{ marginLeft: 10 }}>
          Reset Game
        </button>
      </div>
      <button
        className={BTN}
        onClick={() =>
          setState((s) =>
            s ? { ...s, automationEnabled: !s.automationEnabled } : s,
          )
        }
        style={{ marginLeft: 10 }}
      >
        Auto: {automationEnabled ? "ON" : "OFF"}
      </button>

      <div style={{ marginBottom: 10 }}>
        Player Supply: {playerSupply} | Bot Supply: {botSupply}
      </div>

      <svg width={600} height={600} style={{ border: "1px solid gray" }}>
        {tiles.map((tile) => {
          const { q, r, owner, troops, terrain, civilians } = tile;
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
                      ? "yellow"
                      : getColor(owner, terrain, troops)
                }
                stroke="black"
                onClick={() => {
                  if (terrain === "water") return;

                  if (selected === key) {
                    setSelected(null);
                    return;
                  }

                  if (!selected) {
                    if (owner === 1) setSelected(key);
                    return;
                  }

                  if (isValidMove) {
                    const [fromQ, fromR] = selected.split(",").map(Number);

                    const source = tiles.find(
                      (t) => t.q === fromQ && t.r === fromR,
                    );
                    if (!source || source.troops <= 1) return;

                    const amount = getMaxTransferAmount(
                      tiles,
                      { q: source.q, r: source.r },
                      { q, r },
                    );

                    if (amount <= 0) return;

                    const move = tryCreateMove(
                      {
                        from: { q: source.q, r: source.r },
                        to: { q, r },
                        amount,
                        owner: 1,
                        resolvesAt: tick,
                      },
                      playerSupply,
                      botSupply,
                    );

                    if (!move) return;

                    const supplies = applyMoveCost(
                      1,
                      amount,
                      playerSupply,
                      botSupply,
                    );

                    setState((prev) => {
                      if (!prev) return prev;

                      return {
                        ...prev,
                        playerSupply: supplies.playerSupply,
                        botSupply: supplies.botSupply,
                        tiles: prev.tiles.map((t) =>
                          t.q === source.q && t.r === source.r
                            ? { ...t, troops: t.troops - amount }
                            : t,
                        ),
                        pendingMoves: [...prev.pendingMoves, move],
                      };
                    });

                    setSelected(null);
                    return;
                  }

                  if (owner === 1) setSelected(key);
                }}
              />
              {terrain !== "water" && (
                <text
                  x={x + 300}
                  y={y + 305}
                  textAnchor="middle"
                  fontSize="12"
                  pointerEvents="none"
                >
                  T:{troops} C:{Math.floor(civilians)}
                </text>
              )}
            </g>
          );
        })}

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
              stroke={move.owner === 1 ? "lime" : "red"}
              strokeWidth={2}
              opacity={0.9}
              pointerEvents="none"
            />
          );
        })}
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
          pointerEvents: "none",
        }}
      >
        <div>Tick: {tick}</div>
        <div>Pending: {pendingMoves.length}</div>
        {pendingMoves.map((m, i) => (
          <div key={i}>
            {m.owner === 1 ? "P" : "B"} → ({m.from.q},{m.from.r}) → ({m.to.q},
            {m.to.r}) @ {m.resolvesAt}
          </div>
        ))}
      </div>
    </div>
  );
}
