import { seededRandom } from "./random";

export function generateGrid(radius: number): Tile[] {
  const tiles: Tile[] = [];

  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.abs(q + r) <= radius) {
        const seed = q * 1000 + r;

        tiles.push({
          q,
          r,
          owner: seededRandom(seed) > 0.7 ? 1 : null,
          units: Math.floor(seededRandom(seed + 1) * 10),
        });
      }
    }
  }

  return tiles;
}
