export type Tile = {
  q: number;
  r: number;
  owner: number | null;
  troops: number;
  civilians: number;
  capacity: number;
  growthRate: number;
  terrain: "land" | "water";
};
