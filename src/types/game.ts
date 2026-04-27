import type { Tile } from "@/types/tile";
import type { Owner, PlayersState } from "@/types/player";

export type PendingMove = {
  from: { q: number; r: number };
  to: { q: number; r: number };
  amount: number;
  owner: Owner;
  resolvesAt: number;
};

export type ScheduledAction = {
  id: string;
  owner: Owner;
  from: { q: number; r: number };
  to: { q: number; r: number };
  amount: number;
  executeAt: number;
};

export type GameState = {
  tiles: Tile[];
  pendingMoves: PendingMove[];
  scheduledActions: ScheduledAction[];
  tick: number;
  status: GameStatus;
};

export type GameStatus =
  | {
      type: "active";
    }
  | {
      type: "won";
      winner: Owner;
    };

export type TickResult = {
  gameState: GameState;
  players: PlayersState;
};
