import type { Owner } from "@/types/player";

export type Tile = {
  q: number;
  r: number;
  owner: Owner | null;
  troops: number;
  overflowTroops: number;
  draftProgress: number;
  civilians: number;
  civilianCapacity: number; //Largely obsolete, leaving for now though
  populationCapacity: number;
  growthRate: number;
  terrain: "land" | "water";
};
