# Infantry Protection & Damage — Phase 2.2C-1

Основание: утверждённый пользователем implementation contract
`KADAT_2_INFANTRY_COMBAT_CORE_v0.1_SPEC_C1_PROTECTION_DAMAGE.md`.
Новые числовые значения каталогов не вводятся; тестовые значения явно
обозначены как synthetic fixtures.

## Граница

`DamageInput` получается из surviving ranged/melee HitRecord через
`damageInputFromHit` либо из полного `PrimitiveDamageIntent` через
`damageInputFromPrimitiveIntent`. Сохраняются профиль, BB, location,
weapon reference, context и provenance. Stun duration и использование
предмета имеют отдельные границы и не превращаются в body damage.

`resolveCombatHitDamage` читает текущую ВН и effects цели из combat runtime.
Для прямого вызова `resolveProtectionDamage` caller передаёт authoritative
`CharacteristicState` ВН и текущий ResolutionContext. Combat state,
принятые результаты атак и канонические шаблоны не изменяются.

Последовательность:

1. Проверка входа и ранее разрешённого hit id.
2. Accepted injectable DamageRoll: только d5/d10, каждый die отдельно.
3. Явные damage transformations: выбор количества dice до броска,
   затем flat/multiply в порядке входа; дробный damage округляется вверх.
4. Personal field stage.
5. Сбор и выбор источников физической защиты по location.
6. BB только для источников с `WEAPON_BB`; excess BB не даёт damage.
7. Accepted characteristic resolver вычисляет текущий final bonus ВН.
8. `finalDamage = max(0, fieldAdjustedDamage - effectiveArmor - bVN)`.
9. Structured result/log и атомарный возврат нового protection runtime.

Максимум хотя бы одного d5/d10 даёт critical marker с одним будущим
consequence die. Даже несколько максимумов не увеличивают этот счётчик.
Сам consequence die не бросается и не применяется.

## Поля и источники защиты

Field definitions и runtime instances разделены. Поля возвращают
`PASS_THROUGH`, `CANCEL_HIT`, `REDUCE_DAMAGE`, `ARMOR_LIKE_PROTECTION`,
`REDIRECT_OR_RELOCATE` либо typed `CUSTOM` result. Поведение, числовая
reduction и стоимость использования заданы входными данными.
Caller предоставляет порядок полей; engine не выбирает приоритет каталога.
Cancellation завершает pipeline без расчёта armor и ВН. Redirect и custom
с неизвестным продолжением возвращают `PENDING_FIELD` с typed intent;
перемещение на карте не реализовано.

Защита сохраняет отдельные источники: worn armor, layers, augmetics,
temporary effects, scene cover, armor-like fields и context protection.
`Arms`/`Legs` сопоставляются left/right locations без изменения definition.
Eyes/joints поддерживают explicit OB или unresolved special adjustment;
неизвестный adjustment требует решения и не подменяется обычным OB.

Только взаимные explicit template compatibility references автоматически
разрешают объединить несколько вкладов. Имена предметов не используются.
Другие сочетания возвращают `PENDING_PROTECTION`: candidates и конфликтующие
пары доступны, но selected bundle, effective armor и final damage отсутствуют.
GM может исключить конкурирующий источник или явно INCLUDE каждый выбранный
источник для одного resolution. MODIFY числового вклада сам по себе не
утверждает совместимость остальных источников.

Для выбранного bundle:

```text
effectiveArmor = max(0, sum(WEAPON_BB OB) - weaponBB)
               + sum(IGNORE_WEAPON_BB OB)
```

Cover хранится отдельно как scene instance с current OB и covered zones.
Он не изменяет attack target. Если передан explicit degradation result,
новый current OB возвращается после успешного resolution. При неизвестном
material/damage-type behavior создаётся `CoverDegradationIntent`; числа
не угадываются. Исключённый или не покрывающий location cover не деградирует.

## ResolutionContext и транзакции

Generated modifier ids для INCLUDE/EXCLUDE/MODIFY:

- `field:<instanceId>` — выбор field; activation value равен 1.
- `field:reduction:<instanceId>` — явная числовая reduction.
- `protection:<instanceId>` — вклад OB конкретного источника.

Accepted Effect infrastructure используется для `combat-modifier` targets
`protection:<instanceId>`: `set` заменяет вклад, `add` изменяет его. Effects
сохраняют source, target actor, condition, duration и override trace.
Итоговый GM MODIFY вклада действует только для этого resolution.
Нулевой вклад не образует конкурирующую защиту и не расходует cover degradation.

Полный context/overrides сохраняется в log, даже когда cancellation не
доходит до последующих стадий. Неизвестный override subject в достигнутом
protection stage отклоняется. Canonical definitions остаются неизменными.

`RESOLVED` и `CANCELLED` возвращают новый protection state с объявленными
field/cover mutations и учётом разрешённого hit id. Повторное разрешение того
же hit отклоняется. Pending возвращает исходный state без расходования
field resources и без degradation. Для продолжения caller передаёт исходный
validated `damageRoll` как `preRolled`, новый одноразовый GM context и тот же
hit/state: повторный RNG не нужен. При изменении effective dice expression
несовпадающий pre-rolled результат отклоняется.

Combat Log содержит expression, individual dice, transformations, critical
marker, field results, source candidates, compatibility decisions, effect
traces, overrides, BB, bVN, finalDamage и фактически committed mutations.

## Отложено

Нет Consequence Resolver, применения critical consequence d10, `damageTaken`,
Wound state, Injury, Bleeding, Blood, Agony/Death, каталогов Arsenal/Armor/Fields,
Psykana, vehicles/squads/void, UI или map/pathfinding. Phase 2.2C-2 не начата.
