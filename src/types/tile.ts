export type Tile = {
  q: number;
  r: number;
  owner: number | null;
  units: number;
  terrain: "land" | "water";
};
