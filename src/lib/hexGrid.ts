import { seededRandom } from "./random";
const baseSeed = 12345;

export function generateGrid(radius: number): Tile[] {
  const tiles: Tile[] = [];

  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.abs(q + r) <= radius) {
        const seed = baseSeed + q * 1000 + r;
        const randA = seededRandom(seed);
        const randB = seededRandom(seed + 1);
        const randC = seededRandom(seed + 2);

        const isWater = randA < 0.2;

        tiles.push({
          q,
          r,
          terrain: isWater ? "water" : "land",
          owner: isWater ? null : randB > 0.7 ? 1 : randC > 0.8 ? 2 : null,
          troops: isWater ? 0 : Math.floor(randB * 10),
          civilians: isWater ? 0 : 5,
          capacity: isWater ? 0 : 10,
          growthRate: isWater ? 0 : 1,
        });
      }
    }
  }

  return tiles;
}
