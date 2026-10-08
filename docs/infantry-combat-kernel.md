# Infantry Combat Rules Kernel — Phase 2.2A

Implementation contract: согласованная пользователем и автором KADAT 2
`KADAT_2_INFANTRY_COMBAT_CORE_v0.1_SPEC.md`, приложенная к задаче.
Объём этого прохода ограничен kernel A–J из задания пользователя,
а не полной реализацией Infantry Combat Core v0.1. XLSX повторно не аудировались.

## Границы

- `packages/contracts` содержит readonly типы, разделённые по ответственности:
  identity/provenance, characteristics, effects/context, checks, dice,
  combat/conditions и log. Canonical reference отделён от runtime identity.
- `packages/rules-engine` содержит небольшие функции. Единственная локальная
  зависимость — type-only `@kadat/contracts`; runtime dependencies отсутствуют.
  Client и Server не подключены к игровому ядру в этом проходе.
- Результаты вычислений возвращаются вместе со структурированным log.
  Входные данные не изменяются, хранилище и глобальное состояние не создаются.
  Canonical Release передаётся явно; автоматического обновления шаблонов нет.

## Resolution

`CharacteristicState` хранит только `baseValue` и `baseSuper`. Разрешение
эффектов идёт permanent → implant → equipment → temporary. Для одной
характеристики, поля и `stackingGroup` применяется наибольшее значение;
остальные источники остаются в trace как исключённые stacking.
Это правило не применяется автоматически к checks или conditions.
Неоднозначные операции одного characteristic kind отклоняются.

ResolutionContext содержит потенциальные effects, modifiers, tags,
раунд/ход и одноразовые GM overrides INCLUDE / EXCLUDE / MODIFY.
Контекстные условия представлены требуемыми tags; неизвестное сложное
условие нельзя считать автоматически реализованным. Source и provenance
сохраняются отдельно для каждого вклада. Overrides отражаются в trace и log.

Check Engine принимает уже разрешённое базовое значение и Super;
он не знает оружия, режимов огня или приёмов. Target не ограничен 100.
Критические диапазоны определяют outcome независимо от сравнения с target.
Формулы степеней используют полный target без добавленного clamping:
успех `1 + floor((target - roll) / 10)`, провал симметрично
`1 + floor((roll - target) / 10)`. У критического outcome при необычном
target арифметическое значение может быть знаковым; ядро не придумывает
исключение или минимальное число степеней. Super добавляется только при успехе.

## Dice и damage

DiceSource передаётся явно. `createSequenceDice` — локальный deterministic
источник для тестов; он проверяет вид ожидаемого кубика и исчерпание очереди.
Никакого RNG по умолчанию нет. Общая DiceExpression допускает NdM,
но weapon damage v0.1 валидируется только для d5/d10.
Каждый результат сохраняется отдельно. Один или несколько максимумов дают
ровно один critical trigger. Consequence +1d10 здесь не бросается.

## CombatSession и conditions

Initiative = injected d10 + переданный разрешённый bЛВ. Очередь убывает.
Равные значения сохраняют переданный порядок участников; это техническое
сохранение порядка, а не утверждение нового игрового tie-break.
Если требуется отдельное игровое правило равенства, его должен определить автор.

Переходы: ready → turn-active → between-turns → … → round-ended.
Только после последнего участника разрешён startNextRound.
TurnState получает 2 OD, flags и переданный ReactionPool. Правила расходования
и восстановления реакций относятся к будущему Action Engine и не придуманы.
Reroll/rebuild бросает initiative всем участникам, включая новых, на границе
раунда. Перестановка уже идущего раунда отклоняется; политика вступления
посреди раунда не добавлена без отдельного согласованного правила.

Round conditions действуют с appliedRound, включая этот раунд:
`expiresAfterRound = appliedRound + durationRounds - 1`.
Удаление происходит в конце соответствующего раунда.
Stunned складывает длительность и сохраняет все источники; другие conditions
не наследуют это stacking автоматически. Запрет action/reaction представлен
Effect data. Число бонуса атак против Stunned не выдумано: такие эффекты
передаются как данные источника, их attack resolution отложен.

## Проверки и отложенный объём

`pnpm --filter @kadat/rules-engine test` проверяет acceptance-сценарии kernel,
GM overrides, неизменность исходных данных и invalid transitions.
Typecheck отдельно проверяет source и test без включения тестов в dist.

Ranged/Melee Attack Resolver, protection, consequences, injuries/wounds,
ammunition, bleeding, Psykana и другие модули полного Core не реализованы.
UI, importer, новые canonical datasets, persistence и networking не добавлены.
