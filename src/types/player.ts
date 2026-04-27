export type Owner = 1 | 2;

export type PlayerState = {
  id: Owner;
  supply: number;
  targetMilitaryRatio: number;
  automationEnabled: boolean;
};

export type PlayersState = Record<Owner, PlayerState>;
