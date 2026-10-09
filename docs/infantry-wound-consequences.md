# Infantry Wound Consequences — Phase 2.2C-2

## Источник и границы

Implementation contract: `KADAT_2_INFANTRY_COMBAT_CORE_v0.1_SPEC_C2_CONSEQUENCES_WOUNDS.md`,
включая Appendix A–C, и последующие прямые решения автора о **получении** Fatigue
и нормализации термина кровотечения Head 13.
Внешние RPG не используются. Повторный аудит XLSX и импорт всего арсенала
не выполнялись.

C-2 принимает готовый `DamageResolutionResult` из C-1. Поля, armor, cover,
BB и поглощение bVN не вычисляются повторно. Неразрешённый или отменённый
C-1 hit не передаётся как surviving hit. Исходный C-1 result сохраняется
в `PostDamageResolutionResult` для provenance.

## Канонический каталог

`consequence-catalog.ts` хранит 60 неизменяемых записей Head / Arm / Torso / Leg.
Диапазоны, названия и полные тексты сохранены из Appendix A. Provenance указывает
на `Механика к100.xlsx`, лист `Раны и лечение ` и исходные блоки
`A35:F51`, `A54:F70`, `A73:F89`, `A92:F108`. Адреса отдельных строк не выдумываются.

В Head 13 оригинальный текст `Кровотечение (Серьёзное)` сохранён без изменения.
По прямому решению автора executable bleeding type — `HEAVY`, обычное сильное
кровотечение. Нормализация имеет отдельную author-ruling provenance; четвёртая
категория не вводится.

Типизированные операции записей отделены в `consequence-operations.ts`.
Каталог проверяется на пробелы, пересечения, дубликаты и отсутствие конечного
открытого диапазона. Canonical release/version не придумывается: источник
содержит ссылку на принятый контракт, а не фиктивный номер релиза Excel.

## Runtime и основной resolver

`WoundRuntimeState` содержит ссылку на принятый `CombatActionState` и отдельный
wound runtime каждого участвующего Actor: `maxWounds`, `damageTaken`, Injury,
bleeding sources, Blood, source-linked Conditions/intents и LifeState.
Авторитетный счётчик Fatigue остаётся в существующем combat runtime.
Крупный монолитный Actor/template интерфейс не создаётся.

`createWoundRuntime` требует явные maxWounds/damageTaken и текущую ВН.
`resolvePostDamage` выполняет:

1. Проверку C-1 границы и уникальности hit id.
2. Накопление только `finalDamage` этого попадания.
3. Classification `Critical Wounded` при `damageTaken > maxWounds`.
4. Severity этого попадания; critical добавляет ровно один injected d10.
5. Выбор канонической строки с сохранением конкретной стороны тела.
6. Построение Injury/Condition/Effect/Fatigue/bleeding/life mutation plan.
7. Немедленный blood pulse только новых bleeding sources.
8. Атомарный возврат нового состояния и структурированного лога.

Critical d10 не увеличивает damageTaken и не возвращается в C-1 pipeline.
Некритический нулевой damage не создаёт последствия; critical zero damage
сохраняет consequence d10. Накопленный damage не становится severity.

Все Injury сосуществуют, включая несколько повреждений одной зоны.
Триггеры Arm/Leg 17–19 привязаны к конкретной стороне; дальнейший положительный
damage в эту конечность выбирает её 20+ строку. История и первоначальная
per-hit severity сохраняются. Повторная Deafness после Head 8 фиксирует
permanent hearing loss через новую Injury и provenance исходного триггера.

## Fatigue и check-only projection

Для **GAIN Fatigue** действует прямое решение автора:

- `rawFatigueGain = d10 - bVN`;
- `appliedFatigueGain = max(0, rawFatigueGain)`;
- `fatigueAfter = fatigueBefore + appliedFatigueGain`.

Бросок, bVN и оба результата сохраняются. Отрицательный gain не снимает
накопленную Fatigue. Clamp не распространяется на другие выражения.
Порог обморока остаётся `fatigue > bVN + bSV`; длительность — буквальные
`1d10 - bSV` минут. Дальнейшее восстановление bVN/час представлено intent,
без campaign-time recovery subsystem.

`projectWoundCheck` / `resolveWoundCheck` собирают source-linked penalties и
check-only halving Blood/Fatigue; деление округляется вверх. Они не меняют
baseValue/baseSuper или bonus, используемый в C-1 absorption / Blood reserve.
Два источника одинакового characteristic-halving вида не суммируются,
согласно принятому правилу одинаковых characteristic effects.

`resolveWoundAwareAction` — one-resolution адаптер для принятых ranged/melee
resolvers. Caller передаёт полный выбранный контекст характеристик, включая
weapon/ammo effects, и вызывает существующий resolver через callback.
Для выбранных weapon/ammo effects используются приватные одноразовые source
views: effects не начисляются повторно при внутреннем сборе принятым resolver.
В выходном runtime восстановлены исходные template/contribution definitions;
ammo/Reaction и другие фактические изменения resolver сохраняются.
Проекция не сохраняется как новая характеристика; временный effect удаляется
из возвращаемого runtime, исходные effects восстанавливаются. Projection и
её provenance доступны отдельно в `projectionLog` для лога.

Контекстные injury modifiers применяются по тегам `vision`, `vision-vigilance`,
`physical`, `mobility`, `speech`, `injured-eye` или `injury:<injuryId>`.
Unusable limb создаёт permission restriction для явно заявленного
`uses-limb:<location>` (например, `uses-limb:Right Arm`). Caller сообщает
используемую конечность; автоматическая интерпретация хватов/инвентаря не добавлена.
Числа неизвестных amputation/property effects не придумываются.

## Bleeding / Blood и события времени

Каждый bleeding source связан со своей Injury. Light/Medium требуют ВН:
REST −10, PHYSICAL_ACTION −30, HOLDING_WOUND +20. Caller определяет canonical
activity с provenance, учитывая исключение Pistol-class shooting.
Heavy: REST/HOLDING_WOUND теряет 3, PHYSICAL_ACTION — 3 + injected d5.
Источники не объединяются; их потери суммируются одним атомарным Blood update.

`maxBlood = 4 + current resolved bVN`; `currentBlood = max(0, maxBlood - bloodLost)`.
Доли проверяются точными integer comparisons через BigInt. Quarter создаёт
check-only halving effect, half — persistent Stunned с removal rule
`blood-replacement`, three-quarter — Unconscious и typed bVN-minute death intent.
Ordinary drugs/Willpower не снимают blood-loss Stunned.

`resolveBleedingPulse` вызывается с уникальным идентификатором события.
`resolveWoundTurnStart` вызывается один раз после существующего
`beginActionTurn`: обрабатывает subsequent bleeding и turn-start ВН триггеры
Arm/Leg 5. Arm failure даёт Stunned на один раунд; Leg failure — до следующего
own-turn start. Caller не должен дополнительно делать второй pulse для
того же turn event. Immediate pulse нового повреждения — отдельное событие.
При отсутствии activity весь wound-turn hook возвращает исходное состояние.

Round Stunned использует принятый ADD duration resolver. Другие conditions
не получают автоматическое ADD. Минуты, часы и дни остаются каноническими
единицами в typed timed intents; перевод в раунды не добавлен.

`resolveWoundRoundEnd` вызывается после полного initiative-chain round end.
Обычная Death consequence создаёт Agony на 2×bVN раундов, считая текущий первым.
После последнего такого раунда LifeState переходит в DEAD. Head 15+ / Torso 20+
сразу DEAD. Arm/Leg 20+ не обходят Agony.

`resolveStabilization` требует med kit и использует существующий Check Engine
для Medica −30. Успех хранит `successDegrees` часов, исходную Agony и typed
follow-up intent. Неуспех не отменяет Agony; один action id нельзя повторно
использовать. OD/item consumption, не указанные для этой процедуры в контракте,
не выдумываются.

## Typed unresolved данные и безопасность

Если необходимый контекст отсутствует, статус — `CONTEXT_REQUIRED`, mutations
пусты и возвращается **исходное** состояние. Уже выполненные броски остаются
в result/log; `resumeDice` повторно использует этот префикс при продолжении,
не перебрасывая critical d10. Несоответствующий replay prefix отклоняется.

Следующие значения сохраняются явно, без самостоятельного решения правил:

- Отрицательное количество `1d10 - 5` пальцев и неположительная длительность
  `1d10 - bSV` / нулевая Agony возвращают intent с буквальным результатом.
- Eyes / Armor Joints требуют явную coarse-table mapping с provenance;
  обычную Head/Arm/Torso/Leg mapping менять нельзя.
- Количество глаз до ранения требуется для условной слепоты.
- Неуказанная knockback distance, treatment, delayed finger/toe loss,
  неизвестная численная permanent Fatigue и aftermath stabilization остаются
  source-linked typed intents, как допускает контракт.

Templates, canonical rows и входные runtime snapshots не изменяются.
План валидируется целиком до возврата нового состояния. GM может предоставить
контекстные факты; override явного канонического правила отклоняется.

## Не реализовано

Long-term healing, infection, полноценная transfusion/Medicine, Psykana,
vehicles/squads/void, UI, map/pathfinding и persistence redesign.
Ranged, melee, Overwatch, Check Engine и Protection C-1 не переписаны.
