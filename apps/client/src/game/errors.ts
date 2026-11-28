/**
 * User-facing Russian text for errors of the rules engine. The original core message is kept
 * separately as `diagnostic` (journal data, GM view) and is never lost. Presentation only.
 */
export interface EngineErrorText {
  /** Russian text for the user. */
  text: string;
  /** Original message of the rules engine, when it was not Russian. */
  diagnostic?: string;
}

const CORE: [RegExp, string][] = [
  [/Insufficient OD/, 'Недостаточно ОД в этом ходу'],
  [/Unavailable melee-only Avoidance Reaction/, 'Уклонение в ближнем бою недоступно'],
  [/Unavailable Reaction/, 'Реакция уже потрачена'],
  [/Action requires active own turn/, 'Сейчас не ход этого персонажа'],
  [/Action prohibited by effect/, 'Действие запрещено активным эффектом'],
  [/Reaction prohibited by effect/, 'Реакция запрещена активным эффектом'],
  [/Empty or repeated action ID|Repeated action\/defense ID/, 'Команда с таким ID уже исполнена'],
  [/Second attack requires/, 'В этом ходу атака уже была: разрешена одна атака за ход'],
  [/Wait cannot attack after an earlier attack/, 'Ожидание невозможно после атаки в этом ходу'],
  [/Free Action already used/, 'Свободное действие (СД) в этом ходу уже использовано'],
  [/unavailable while crawling/, 'Ползком Бег и Спринт недоступны'],
  [
    /Unbraced heavy weapon cannot fire bursts/,
    'Тяжёлое оружие без опоры стреляет только одиночными (−30). Сначала «Установить на опору» (1 ОД, «Бой» A55)',
  ],
  [/Weapon is already braced/, 'Оружие уже установлено на опору'],
  [/not in an appropriate jammed state/, 'Оружие не заклинило'],
  [
    /Invalid actor\/target\/selected weapon|Melee weapon is not owned\/held\/readied|Invalid actor\/selected weapon/,
    'Оружие не в руках: сначала «Взять в руки» (1 ОД, решение 81)',
  ],
  [/The kept weapon is not in hand/, 'Оставляемое оружие не в руках'],
  [/Weapon is not in hand/, 'Это оружие не в руках'],
  [
    /Weapon must be picked up/,
    'Оружие на полу или на ремне: его поднимают («Поднять», решение 82)',
  ],
  [/Weapon is not dropped or hanging/, 'Оружие не на полу и не на ремне'],
  [/Weapon has no fire modes/, 'У оружия нет режимов огня'],
  [/Parry requires an eligible weapon/, 'Этим оружием нельзя парировать'],
  [/Incoming action is not dodgeable/, 'От этой атаки нельзя уклониться'],
  [/Dodge prohibited by effect/, 'Уклонение запрещено состоянием цели'],
  [/Parry prohibited by effect/, 'Парирование запрещено состоянием цели'],
  [/Insufficient ammunition/, 'Не хватает боезапаса в магазине'],
  [/No loaded ammunition container/, 'Оружие не заряжено'],
  [/Jammed weapon cannot fire/, 'Оружие заклинило: сначала исправить осечку'],
  [/Target outside effective melee reach/, 'Цель дальше досягаемости оружия ближнего боя'],
  [/Two-handed weapon cannot be one of two weapons/, 'Двуручное оружие нельзя взять вторым'],
  [/Wide arc and two weapons do not combine/, 'Широкая дуга и два оружия не сочетаются'],
  [/Wide arc requires a burst/, 'Широкая дуга — только очередью'],
  [/Wide arc requires a rate of fire above 3/, 'Широкая дуга требует темпа выше 3'],
  [/Unwieldy weapon cannot make swift attacks/, 'Неудобным оружием нельзя бить стремительно'],
  [/Selected location requires Called base/, 'Выбор зоны — только для прицельной атаки'],
  [
    /Tactical advance cannot be a follow-up shot/,
    'Тактическое продвижение не может быть добивающим выстрелом',
  ],
  [/Participant already Grappled/, 'Участник уже в захвате'],
  [
    /Defensive stance prohibits ordinary melee attack/,
    'В защитной стойке атака — только со щитом в другой руке (2 ОД), натиск запрещён',
  ],
  [/Invalid grip\/technique/, 'Этот хват не подходит оружию — смените хват (СД)'],
  [/Ineligible Palisade profile/, 'Частокол — только копьём, глефой или штыком'],
  [/Fist grip requires/, 'Хват «кулак» — только топором, киркой или молотом'],
  [/Missing stance\/grip change/, 'Стойка и хват не изменились'],
  [/Only one Counterattack/, 'Контратака — только одна на атаку'],
  [/Overwatch expired or unavailable/, 'Наблюдение закончилось или недоступно'],
  [/Stabilization requires med kit/, 'Для стабилизации нужна аптечка'],
  [/Stabilization requires Agony/, 'Стабилизировать можно только персонажа в агонии'],
  [/Untrained skill: the GM must choose a penalty/, 'Навык не изучен: ведущий выбирает штраф'],
  [/Resolve the immediate Grapple follow-up/, 'Сначала завершите действие захвата'],
  [
    /Thermal state requires authored item handling/,
    'Тепловое состояние оружия требует решения ведущего',
  ],
];

const CYRILLIC = /[А-Яа-яЁё]/;

/** Russian text plus the untouched core message. */
export function describeEngineError(error: unknown): EngineErrorText {
  const message = error instanceof Error ? error.message : String(error);
  const known = CORE.find(([pattern]) => pattern.test(message));
  if (known) return { text: known[1], diagnostic: message };
  if (CYRILLIC.test(message)) return { text: message };
  return {
    text: 'Ядро правил отклонило команду. Исходное сообщение — в данных движка (вид ГМа).',
    diagnostic: message,
  };
}

/** Fields of a rejected journal entry: Russian `reason` and, if any, the core `diagnostic`. */
export function engineReason(error: unknown): { reason: string; diagnostic?: string } {
  const { text, diagnostic } = describeEngineError(error);
  return diagnostic ? { reason: text, diagnostic } : { reason: text };
}
