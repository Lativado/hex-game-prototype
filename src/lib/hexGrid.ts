import { seededRandom } from "./random";
const baseSeed = 12345;

export function generateGrid(radius: number): Tile[] {
  const tiles: Tile[] = [];

  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.abs(q + r) <= radius) {
        const seed = baseSeed + q * 1000 + r;
        const isWater = seededRandom(seed) < 0.2;

        tiles.push({
          q,
          r,
          terrain: isWater ? "water" : "land",
          owner: isWater
            ? null
            : seededRandom(seed) > 0.7
              ? 1
              : seededRandom(seed + 1) > 0.8
                ? 2
                : null,
          units: isWater ? 0 : Math.floor(seededRandom(seed + 1) * 10),
        });
      }
    }
  }

  return tiles;
}
