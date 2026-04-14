import { seededRandom } from "./random";

export function generateGrid(radius: number): Tile[] {
  const tiles: Tile[] = [];

  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.abs(q + r) <= radius) {
        const seed = q * 1000 + r;
        const isWater = seededRandom(seed) < 0.2;

        tiles.push({
          q,
          r,
          terrain: isWater ? "water" : "land",
          owner: isWater ? null : seededRandom(seed) > 0.7 ? 1 : null,
          units: isWater ? 0 : Math.floor(seededRandom(seed + 1) * 10),
        });
      }
    }
  }

  return tiles;
}
