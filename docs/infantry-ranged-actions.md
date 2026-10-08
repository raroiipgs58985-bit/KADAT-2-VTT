# Infantry Ranged Action / Reaction Engine — Phase 2.2B-1

Implementation contract:
`KADAT_2_INFANTRY_COMBAT_CORE_v0.1_SPEC_B1_RESOLVED.md`, полностью прочитанная
спецификация с прямыми решениями пользователя и автора. Таблицы повторно
не аудировались; каталог Арсенала не импортирован. Тестовые профили синтетические
и не являются каноническими записями.

## Границы и состояние

`packages/contracts` расширен readonly контрактами actions, weapons/ammunition
и ranged results. `WeaponTemplate` хранит каноническую ссылку;
`WeaponInstance` — владельца, готовность, ссылку на контейнер и runtime jam.
Effective profile строится отдельно из base, pattern, modifications и ammo;
только явно переданные замены параметров применяются последовательно.
Шаблоны и authored contributions содержат EffectDefinitions без runtime
Actor target. Только при разрешении создаются scoped EffectInstances для
владельца конкретного оружия; канонические definitions не изменяются.
Fire mode и context effects разрешаются для конкретной атаки. Вычисленный
профиль не записывается в шаблон. У каждой составляющей сохраняется provenance.

`CombatActionState` объединяет принятый `CombatSession` с небольшим combat
subset участников, оружием, контейнерами и завершёнными action IDs. Он
не заменяет полный Actor. Старые session/initiative/round/condition resolvers
не переписаны. `beginActionTurn`, `finishActionTurn`, `beginActionRound`
делегируют переходы ядру. Wait и Overwatch истекают в начале следующего
собственного хода; этот переход отражён в log. ReactionPool передаётся явно:
неуказанное правило его автоматического восстановления не добавлено.

## Действия и транзакции

Небольшие функции проверяют участника, окно действия, OD, Reaction, ограничения
Effects, attack limit, оружие, боеприпасы и context до расходования ресурсов.
Успех возвращает новый snapshot; ошибка оставляет исходные данные неизменными.
Action IDs предотвращают повторное выполнение. Источник RNG передаётся явно,
но rollback внешнего RNG не предоставляется: откат относится к runtime state.

Обычный ход даёт 2 OD; attack flags ограничивают его одной атакой, пока
явный permission Effect не предоставит дополнительные атаки. Reaction
применяется вне собственного хода; Run/Sprint отдельно расходуют её на своём
ходу по прямому правилу. Movement вычисляет расстояние без карты; Sprint
добавляет только 2 Fatigue, без реализации остальной системы усталости.
Free Movement использует общее правило округления деления вверх и предел 5 м.

Wait расходует 1 OD, завершает ход и сохраняет 1 OD для действия до следующего
собственного хода. Сохранённый OD удаляется после расходования. Если участник
уже атаковал в исходном ходу, Wait не разрешает ещё одну атаку.

Aim хранится как подготовка следующей атаки с +10/+20 NS/NR; характеристика
Actor не изменяется. В этом ranged проходе используется NS, не реализуется
melee. Careful Aim исключает только отрицательные источники с явно каноническими
tags `careful-aim:target-speed`, `careful-aim:height`, `careful-aim:running`,
`careful-aim:charge`. Источник остаётся в trace, а GM override имеет приоритет.
Новая политика отмены Aim при перемещении или ожидании не придумана.

## Resolution и дистанционная атака

`resolveRangedAttack` использует принятые characteristic/Check resolvers.
Единственное уточнение Check Engine — critical-success rescue: 01–05 при
`roll > target` даёт ровно одну степень без добавления Super.

Потенциальные Actor/weapon/ammo/condition Effects собираются в существующий
ResolutionContext. Numeric hooks `ranged:range`, `ranged:mode`, `ranged:attack`
и `attacks-against-Stunned` преобразуются в обычные ResolutionModifiers.
`set` для range/mode исключает generic вклад и сохраняет заменяющий источник.
Противоречащие замены отклоняются. INCLUDE / EXCLUDE / MODIFY действуют только
на одну проверку; источники остаются неизменными.

Для optimal range 100 м верхние границы остаются в ближнем диапазоне:
3 — Point Blank; 50 — Short; 200 — Optimal; 400 — Long.
Следующий диапазон начинается строго выше границы; ниже 0.5 м правила этого
resolver не определены и запрос отклоняется.

Single / Short Burst / Full Auto используют согласованные modifiers и формулы
попаданий. Called Attack допускается только для Single, стоит 2 OD и сохраняет
источник штрафа выбранной зоны. Ammo валидируется как полный запрошенный залп:
если не хватает патронов или превышена скорострельность, запрос отклоняется
целиком, без автоматического уменьшения. Shots и ammo учитываются отдельно
от попаданий. Generic malfunction 96–100 создаёт jam и ноль попаданий;
в этой generic модели подтверждённый залп учитывается в shots/ammo.
Clear Malfunction стоит 2 OD, использует NS +0 и снимает jam только при успехе.
Reliable/Unreliable/Overheat имеют типизированные hooks, без выдуманной
реализации: профили с внешним malfunction/thermal handling отклоняются.

Dodge проверяется как Reaction по LV. Его степени отменяют попадания,
не меняя исходную проверку и ammo. Если атака не дала попаданий, Dodge не
исполняется. После реакции первый surviving hit получает зону по перевёрнутому
RAW attack d100; следующие идут по канонической последовательности.
Eyes выбирает Head row; hits 2–6 повторяются циклически с hit 7.
Для каждого вторичного Arm/Leg отдельно бросается injected d2:
1 = Left, 2 = Right. Оба результата равновероятны; бросок сохраняется в hit/log.

Каждый surviving hit становится `HitRecord` с отдельным ID, атакующим,
целью, weapon/ammo references, ordinal, raw attack roll, degrees, зоной,
вторичным side roll и unresolved damage/penetration references.
Protection, final damage и последствия не вычисляются.

## Overwatch

`activateOverwatch` расходует 1 OD, завершает собственный ход и сохраняет
90° sector, trigger и один выбранный ranged attack. Called запрещён.
Сцена передаёт sector membership как данные; геометрия не вычисляется.

`resolveOverwatchInterrupts` проверяет все заявки до исполнения, расходует
Reaction каждого стрелка и возвращает результаты до triggering action.
Каждый стрелок делает одну атаку; его Overwatch удаляется. Само triggering
action выполняет вызывающая сторона на возвращённом snapshot.
Порядок: выше разрешённый LV, затем opposed LV Check при равенстве.
Сравниваются степени успешных проверок. Если opposed results равны,
возвращается `pending-opposed-tie` без расхода ресурсов и без выдуманного
tie-break; дальнейшее правило требует решения пользователя.

## Log, проверки и отложенный объём

Структурированный log сохраняет session/round/turn/action, OD/Reaction,
оружие/режим/aim/range, все источники и overrides, raw dice, target/degrees,
shots/ammo, jam mutations, Dodge, generated/cancelled/surviving hits и HitRecords.
Тесты используют существующий injected RNG; все 61 kernel tests сохранены.

Не реализованы Melee, Parry, Counterattack, Protection, armor/cover/fields,
final body damage, Consequences, Injury, bleeding/blood reserve/agony,
Psykana, vehicles/squads/void combat, полный Арсенал, UI, карта/pathfinding,
новое хранение или транспорт. Phase 2.2B-2 не начат; зависимости и стек
не изменены.
