# Infantry Melee Actions — Phase 2.2B-2

Расширение принято пользователем для реализации поверх checkpoint
`cbfd92fdd94529a4e37987bbd8900997b30c7ace`. Источник правил — приложенный
`KADAT_2_INFANTRY_COMBAT_CORE_v0.1_SPEC_B2_MELEE.md` и последующие прямые
решения пользователя о Wide Sweep, Cautious и Counterattack. Канонические
каталоги оружия не импортировались. Числа в тестовых профилях — синтетические
входные данные, не новые записи канона.

## Границы и композиция

`packages/contracts/src/melee.ts` разделяет шаблон оружия, экземпляр с
held/readied/dropped состоянием, производный профиль, runtime стойку/хват,
возможность Counterattack, Grapple relation и неразрешённый Melee HitRecord.
Новая часть состояния находится в необязательном `CombatActionState.melee`.
Прежние ranged profiles, CombatSession и приложения сохраняют свои границы.

Атака собирается из base + technique + stance + grip + weapon contributions

- Effects/ResolutionContext. Паттерн и модификации — явно заданные изменения
  профиля и определения эффектов, а не догадки о числах Арсенала. Хваты сохраняют
  изменения урона как intents/transforms. Mordhau требует явной ссылки на
  канонический профиль одноручной булавы и сохраняет пометку двуручного
  использования; новые значения оружия не выбираются.

Основные функции:

- `initializeMeleeState`, `composeMeleeProfile`, `changeMeleeStanceGrip`;
- `resolveMeleeAttack` для NR атаки, `resolveKnockdown` для opposed Athletics;
- `resolveParry`, `resolveMeleeDodge`;
- `resolvePalisadeInterrupts`;
- `resolveMeleeOpposedAction` для Feint/Pressure, `resolveBreakthrough`;
- `resolveGrappleAction` для действий контроллера/жертвы.

НР и СЛ разрешаются через принятый characteristic resolver, проверки — через
Check Engine. Dodge и hit location используют прежние resolvers. Randomness
поступает исключительно через `DiceSource`. Нет singleton combat state,
скрытого RNG или зависимостей от Client/Server.

## Действия, защита и триггеры

Normal атаки используют прежние OD и лимит одной атаки. Triggered атаки имеют
явный origin и соответствующий проверяемый trigger/opportunity. Counterattack
использует base NR +0, не Simple +10; он одноразовый, не допускает Dodge/Parry
и не создаёт новый Counterattack. Возможность связана с уникальным id своей
Parry resolution; несколько эффектов одного Parry не создают несколько
Counterattacks. Close Grip добавляет +10 NR за степень
успешного Parry. Defensive разрешает выбранный удар для Parry-generated
Counterattack без обычных OD.

Cautious создаёт временные +10 эффекты для eligible Dodge/Parry. Они действуют
с момента действия до начала следующего собственного хода. Повторное
применение обновляет тот же бонус +10. Reckless создаёт запрет Dodge на этот
же период, сохраняя Parry. Это runtime effects с provenance и явной
next-own-turn длительностью, без изменения постоянных НР/ЛВ. Общая политика
stacking других Effects не менялась.

Defensive имеет отдельный melee-only пул дополнительной Reaction. Его
расходование не увеличивает и не расходует normal/ranged Reaction pool.
Контекст Parry/Dodge применяет исходные эффекты и одноразовые GM overrides.

Free Attack проверяет заявленный engaged-enemy-leaves trigger. Palisade
проверяет профиль, более короткую досягаемость врага и caller-supplied
base-contact контекст; доступность восстанавливается на следующем собственном
ходе. `resolvePalisadeInterrupts` принимает уже упорядоченные interruptions,
проверяет их до начала, затем повторно проверяет текущее состояние перед каждой
атакой. Недоступная после предыдущей атаки interruption пропускается с журналом,
без расхода ресурсов. Triggering resolver получает итоговое состояние.
Новая процедура сортировки одновременных Palisade не придумывается.

## Wide Sweep — прямое решение пользователя

Один shared raw melee d100 используется для всей атаки. Каждая цель получает
свой final target, outcome и degrees через тот же Check Engine. Каждая цель
может выбрать один Parry или Dodge: +10 к Parry, −10 к Dodge. Выживший hit
получает half-damage transform с округлением вверх. Hit location всех целей
выводится из одного raw roll. OD/attack slot оплачиваются один раз; 96–100
создаёт одно изменение dropped state оружия.

Журнал сохраняет общий бросок, per-target проверки, выбранную защиту и её
результат, а также каждый surviving HitRecord. Damage/protection здесь не
разрешаются.

## Специальные техники и Grapple

Stun подавляет обычный damage hit и выдаёт `StunDurationIntent`: исходное
выражение, grip transforms, полный ResolutionContext/provenance и half/ceil
преобразование длительности. Реальное применение Stunned требует разрешения
сырого technique damage в последующем подходящем resolver. B-2 не выбирает
неизвестные свойства/значения оружия и не запускает Damage/Wounds pipeline.

Knockdown использует Athletics +0. NR-only base/grip modifiers не меняют
Athletics. При победе создаётся prone state; на 5+ степенях — Fatigue +1 и
primitive intent `1d5+bSL`.

Feint — одноразовая связь attacker→target без придуманного срока окончания.
Следующая melee атака этого attacker расходует её, включая промах; защита
против этой атаки не допускается. Pressure возвращает movement intent,
ограниченный SKR цели. Breakthrough стоит 2 OD как самостоятельное действие;
caller выбирает Charge/Run allowance и задаёт упорядоченных противников.
Первый проигранный opposed Athletics останавливает обработку; `stoppedBefore`
обозначает границу перед противником, не координату коллизии.

Grapple хранит controller/victim relation. Участники не используют Reactions
или non-Grapple действия; атаки извне против них получают +20. Size-category
bonus хранится отдельно от исходных CheckResults. Равные opposed результаты
не дают победителя; дополнительный tie-break не вводится.

Контроллер поддерживает Continue, Deal Damage, Throw, Push, Prepare, Stand Up,
Use Prepared Item и Free release. Damage и item use выдают intents. Push
возвращает совместное перемещение двух участников, не карту. Prepare предмета
жертвы требует явного GM INCLUDE для `grapple:take-victim-item` в контексте
одной резолюции.

Жертва поддерживает Escape, Slip Free и Reverse Control. После Escape/Slip
оставшиеся OD нельзя потратить на атаку. Reverse меняет роли и создаёт ровно
один immediate controller-action grant: follow-up с его id не требует обычных
OD. Повторное использование запрещено; до завершения grant нельзя окончить
ход. Другие действия поддерживают Grapple без отдельной платы за Continue.

## Транзакции и журнал

Resolvers проверяют участников, window, стоимость, attack allowance, оружие,
reach, defense choice и triggers до commit. Возвращается новое состояние;
входные runtime snapshots, шаблоны и Effect definitions не изменяются.
Отказ не возвращает частично изменённое состояние.

Structured logs содержат session/round/turn, action/resource deltas, base/grip/
stance/technique, оружие и reach context, checks/modifier sources и GM decisions,
Parry/Counterattack grant, Grapple изменения, movement и unresolved intents.

## Отложено

Protection, итоговый Damage/Wounds, Consequences, Injury, Bleeding, Psykana,
vehicles/squads/void, natural-weapon normalization, полный Arsenal/Profile
import, dual-wield subsystem, UI и map/pathfinding отсутствуют. Phase 2.2C не
начинается этим checkpoint.
