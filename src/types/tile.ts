export type Tile = {
  q: number;
  r: number;
  owner: number | null;
  troops: number;
  terrain: "land" | "water";
};
