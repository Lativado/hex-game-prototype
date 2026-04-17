export type Tile = {
  q: number;
  r: number;
  owner: number | null;
  troops: number;
  overflowTroops: number;
  draftProgress: number;
  civilians: number;
  civilianCapacity: number;
  growthRate: number;
  terrain: "land" | "water";
};
