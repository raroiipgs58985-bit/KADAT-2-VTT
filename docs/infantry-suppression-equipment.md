# Infantry Suppression & Combat Equipment — Phase 2.2D

Источник implementation contract: `KADAT_2_INFANTRY_COMBAT_CORE_v0.1_SPEC_D_SUPPRESSION_EQUIPMENT.md`.
Нормализованный блок suppression: `Механика к100.xlsx`, `Бой`, A10:A15.
Equipment examples: `Арсенал Кадата.xlsx`, `Силовая броня ` и `Серво-костюмы`.
Таблицы не импортированы; числовые equipment fixtures не являются каталогом канона.

## Suppression boundary

`suppressionEventFromRanged` принимает уже
разрешённый attack result. Single использует success degrees; burst — фактические
`shotsFired`, независимо от hits. Ammo повторно не расходуется. Caller явно
передаёт class mapping PISTOL/BASIC/HEAVY; display names не определяют класс.
Area events содержат отдельные property/radius sources; выбирается maximum radius.

`resolveSuppression` получает candidates с расстояниями и cover facts от caller.
Single затрагивает primary target; burst включает границу 10 m; area включает
maximum radius +10 m. SW (`СВ`) проверяется принятым Check Engine. Single penalty
равен −5 × degrees, burst penalty — отрицательной scaled shot quantity, area —
−5 × radius. Есть optional `WoundRuntimeState` для принятого C-2 check-only
Fatigue/Blood projection; snapshots должны совпадать.

План всех targets строится до commit. Любой required pending возвращает весь
исходный state; logs содержат preview check/results и нулевые mutations.
Неопределённый источник сохраняется в result, caller может повторить resolution
после получения facts с тем же injected dice. Успешно committed attack id
нельзя обработать повторно. Caller сохраняет logs и pending result отдельно.

Failed SW создаёт source-linked round Condition. Cover YES даёт
`SeekNearestCoverIntent` с текущим equipment-adjusted SKR; NO — `DropProneIntent`.
Это intents, не автоматическое движение или mutation posture. UNKNOWN блокирует
commit. Pathfinding отсутствует.

## Lifecycle

`SuppressionEquipmentState` держит combat snapshot, equipment sources, suppression
metadata и processed event ids. After other accepted actions caller обновляет
`state.combat` их возвращённым snapshot. Runtime metadata отдельно от templates.

Caller использует `beginSuppressionEquipmentTurn`, либо accepted `beginActionTurn`
и затем `resolveSuppressionTurnStart`, до выполнения действий нового own turn.
First affected turn сохраняется явно и не делает removal check. Later turns
делают SW+0 без OD cost и без первоначального attack penalty. Success снимает
condition; failure сохраняет normal expiry. Unresolved equipment rolls back
весь begin-turn facade. Duplicate processing одного affected turn запрещён.

Во время affected own turns OD ограничен до 1 и check NS получает −20 через
condition Effect; применение в уже начатом turn не меняет его retroactively.
NS penalty не применяется к SW, Dodge или out-of-turn attacks. Base OD/NS не
изменяются. Application round считается первым; accepted global round-end
expiry удаляет condition. Metadata очищается при следующем turn-start facade.

## Equipment boundary

`EquipmentCombatEffect` хранит item/system source, activity, power dependency,
required tags, wearer scope, typed payload, explicit stacking relation и provenance.
`collectEquipmentEffects` переводит применимые numeric contributions в существующие
Effect instances / ResolutionContext; capabilities остаются раздельными typed data.

Power states: POWERED, UNPOWERED, DISABLED, EMP_DISABLED, SYSTEM_DISABLED.
DISABLED/unequipped/inactive source выключен; disabled subsystem выключает только
свои effects. Потеря power отключает только `requiresPower=true`; физические
не зависимые от power contributions остаются. Unknown mapping блокирует
публикацию executable contributions. Ни battery simulation, ни item-name rules нет.

Characteristic ADD использует принятый resolver и same-kind-largest policy.
Новый target `characteristic-cap` ограничивает final resolved value перед derived
bonuses; base value/Super не переписываются. Различные конкурирующие caps не
выбираются автоматически. `characteristicCapPayload` переводит отсутствие/`-`
в отсутствие effect, а не zero cap.

Check scopes используют tags `check:<scope>`; ranged scope использует `ranged`.
Visual/hearing modifiers, night/thermal vision, auspex, loud-sound protection,
Dazzling immunity представлены отдельно. Unknown numeric stacking не складывается;
explicit SUM/LARGEST и one-resolution GM exclusion используют имеющийся context.
PENDING collection не публикует executable equipment effects/fields/capabilities.

## Integration hooks

- `resolveEquipmentCheck` соединяет equipment и принятый Check Engine; optional
  C-2 projection поддерживает Blood/Fatigue. CHECK_IMMUNITY действует только на scope.
- `resolveEquipmentCombatAction` передаёт action restrictions, derived speed и
  source-linked movement OD modifiers accepted movement resolver. Runtime SKR
  восстанавливается, result хранит derived distance. OD spending остаётся atomic.
- `resolveEquipmentRangedAttack` проверяет явное heavy one-handed permission и
  передаёт numeric effects в accepted ranged resolver. Handling class/hands
  являются caller facts. Auto-stabilization остаётся отдельной capability;
  неподтверждённый numeric modifier не изобретается.
- `resolveEquipmentSize`, `equipmentConditionAllowed` и capabilities предоставляют
  combat hooks для size, condition immunity, special movement/action permissions.
  Caller передаёт derived size в требуемый combat context; full Flight отсутствует.
- FIELD_SOURCE предоставляет existing C-1 `FieldInstance`; protection adjustment
  выдаётся typed intent для C-1, без выбора нового pipeline position.
- `finishEquipmentTurn` вызывает accepted turn end и active bio-monitor trigger,
  снимающий ordinary round/timed Stunned, не Stupor. Optional C-2 state позволяет
  снять timed condition и его effects/intents; blood-loss Stunned с explicit
  blood-replacement requirement сохраняется. Защищённые ids возвращаются отдельно.

Combat Log расширен structured equipment traces/pending, suppression source/event/
target result и lifecycle checks. Existing action logs сохраняют OD/Reaction,
source modifiers, GM decisions и committed mutations. Templates не мутируются.

## Typed pending

- `SuppressionModifierRoundingPending`: odd Pistol /2 без принятого округления.
- `SuppressionStackingPending`: overlapping suppression без merge policy;
  старый active condition не изменяется, новый source остаётся в result.
- `CoverAvailabilityContextRequired`: caller не определил наличие cover.
- `EquipmentStackingPending`: numeric sensors/movement/size или cap relations
  не определены. Оба источника сохраняются; автоматического сложения нет.
- `PowerDependencyMappingPending`: power mapping source неоднозначен.
- `ProtectionOrderingPending`: special protection adjustment не имеет resolved ordering.
- `SuppressionImmunityRemovalPending`: immunity активирована при уже существующем
  Suppressed; SW не бросается, retroactive removal не изобретается. Требуется
  отдельное ruling о взаимодействии; existing condition сохраняется.
- `SuppressionDurationPending`: accepted Check Engine critical failure при target
  выше raw roll может дать неположительные failure degrees; duration не придумывается,
  Check Engine не переписан. Required AC-SE scenarios этого случая не требуют.

## Scope

Ranged, melee, Overwatch, C-1 и C-2 resolvers не переписаны. Shared extensions
ограничены characteristic-cap, affected-turn context tags и source-linked movement
OD hook. Нет UI, map movement/pathfinding, full Arsenal import, батарей/ремонта,
Psykana, vehicle/squad/void combat, persistence или deployment.
