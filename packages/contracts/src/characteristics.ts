export type CharacteristicId = 'НР' | 'НС' | 'СЛ' | 'ВН' | 'ЛВ' | 'ИН' | 'ВС' | 'СВ' | 'ОЩ';

/** Only base values are authoritative; resolved values are transient results. */
export interface CharacteristicState {
  readonly baseValue: number;
  readonly baseSuper: number;
}

export type Characteristics = Readonly<Record<CharacteristicId, CharacteristicState>>;
export type SuperCharacteristics = Readonly<Record<CharacteristicId, number>>;

export interface CharacteristicResolution {
  readonly characteristic: CharacteristicId;
  readonly baseValue: number;
  readonly baseSuper: number;
  readonly finalValue: number;
  readonly finalSuper: number;
  readonly normalBonus: number;
  readonly finalBonus: number;
  readonly superSuccessDegrees: number;
}
