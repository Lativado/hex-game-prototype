"use client";

import { useState } from "react";

type Hex = {
  q: number;
  r: number;
};

const HEX_SIZE = 30;

// Convert axial coords → pixel
function hexToPixel(q: number, r: number) {
  const x = HEX_SIZE * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r);
  const y = HEX_SIZE * (3 / 2) * r;
  return { x, y };
}

// Generate hex corners
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

export default function HexGrid() {
  const [selected, setSelected] = useState<string | null>(null);

  // Generate a small grid
  const hexes: Hex[] = [];
  const radius = 3;

  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.abs(q + r) <= radius) {
        hexes.push({ q, r });
      }
    }
  }

  return (
    <svg width={600} height={600} style={{ border: "1px solid gray" }}>
      {hexes.map(({ q, r }) => {
        const { x, y } = hexToPixel(q, r);
        const key = `${q},${r}`;
        const isSelected = selected === key;

        return (
          <polygon
            key={key}
            points={getHexPoints(x + 300, y + 300)}
            fill={isSelected ? "orange" : "lightblue"}
            stroke="black"
            onClick={() => setSelected(key)}
            style={{ cursor: "pointer" }}
          />
        );
      })}
    </svg>
  );
}