# Local Combat v0.2 — recovery and integration report

## Status

Repository recovered from existing GitHub repository. Experimental branch:
`experiment/local-combat-kelus-pak-v0.2`, based exactly on accepted Core
`e98837b92abc74ac501b52c5f2ea2e79b86f96b3`. Initial recovery checkpoint:
`e306497` (already pushed). Main and Phase 2 branches are not implementation targets.

**Single-shot pipeline: PASS. Two-sided hit/miss scenario: PASS.
Two-sided damaging scenario: BLOCKED by the
remaining author decision about chain armor-loss timing.** No full combat
acceptance is claimed. The corresponding explicit acceptance test is skipped,
not reported as a successful damaging attack by Pak.

This restores functionality, not the lost files byte for byte. The old fixture
attachment is unavailable; actor data was read again from bounded canonical
ranges, including personal equipment notes. Pak's identity is supplied by the author.

## Architecture and actual reuse

No production implementation, shared contract, existing test, dependency,
workspace definition or lockfile is modified. All changes are inside
`experiments/local-combat`. Browser code imports the existing public Core exports;
there is no copied hit/check/damage/consequence engine and no network combat API.

| Boundary        | Existing accepted API / implementation                                 | Local responsibility                                                                                           |
| --------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Runtime         | `createActionState`, `initializeMeleeState`, `createWoundRuntime`      | Adapt two personal profiles, initial damageTaken 6/0, full block 250 shots                                     |
| Turns           | `beginActionTurn`, `finishActionTurn`, `beginActionRound`              | Explicit manual initial order; no initiative RNG or initiative-rule choice                                     |
| Checks/actions  | `resolveWoundAwareAction`, `resolveRangedAttack`, `resolveMeleeAttack` | Selected weapon, measured continuous distance, explicit GM numeric input, explicit refusal of defense          |
| Hit records     | `damageInputFromHit`                                                   | Retain original Core hit location and provenance                                                               |
| Weapon dice     | `resolveDamageRoll`, `createSequenceDice`, `rollDie`                   | Proven minimum, laser mastery, tearing reroll; raw and effective dice recorded separately                      |
| Protection      | `resolveProtectionDamage`                                              | Personal zone armor, runtime armor loss, personal Gorget context; Core owns BB absorption/bVN/finalDamage      |
| Wounds          | `resolvePostDamage`, `resolveBleedingPulse`                            | Explicit bleeding activity, source-linked weapon bleeding only when its relation to the catalog is unambiguous |
| Wound lifecycle | `resolveWoundTurnStart`, `resolveWoundRoundEnd`                        | Invoke real hooks; preserve clinical intents without inventing minute-to-round conversions                     |
| Replay          | Core dice injection                                                    | Stable command IDs, saved dice prefix, duplicate rejection, version/ruling validation                          |

Equal initiative-schema sentinel entries satisfy the existing typed session
contract; they are not gameplay rolls or a decision on initiative. Manual caller
order is retained. The acrobatics field required by the melee contract has a
clearly marked unavailable-skill sentinel; acrobatics/grapple/opposed actions
are not exposed. It is not a new parameter in either canonical profile.

## Sources and authority

Latest direct author decisions take priority. Native canonical sources:

- Profiles: <https://docs.google.com/spreadsheets/d/1IkaSya9Uq1YX6dgP9ElDyk1B3643soS3CPGsetwSFqA/edit>
- Mechanics: <https://docs.google.com/spreadsheets/d/1SqGX_g9tObCgl2eJWjxgmLoXlDv6KnGMeiujBlX7drg/edit>
- Arsenal: <https://docs.google.com/spreadsheets/d/1PndYkBCwVVyaXriBNQ_tnKoAYVI-0CvInF-j5niaUF8/edit>

Bounded snapshots are stored in `public/canonical-*.json`. No complete spreadsheet
audit or Arsenal import is claimed. Canonical tables are read only.

| Data/rule                                                      | Exact source                                                                                                                |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Kelus original attributes, talents, armor and personal weapons | Profiles, `Персонажи Вольного торговца!A57:B80`, including B69/B70/B79/B80 notes                                            |
| Pak original attributes, talents, armor and personalized sword | Profiles, `Персонажи Вольного торговца!K31:L54`                                                                             |
| Initial remaining wounds                                       | Profiles, `Игровое поле!F90:F91` and direct author confirmation: 26/32, 33/33                                               |
| Zone order: head/torso/arms/legs                               | Arsenal, `Броня!B1`                                                                                                         |
| Hit location / body damage                                     | Mechanics, `Бой!A17:C27`, `Раны и лечение !A1:A5`                                                                           |
| Laser Master damage bonus                                      | Profiles, `Таланты (обновлены)!K62`; author confirms ownership mapping and floor rounding                                   |
| Proven (5)                                                     | Direct author decision: raw 1–4 become 5, 5–10 stay unchanged                                                               |
| Automatic hit location                                         | Direct author decision: Torso, including Spray; fire actions still have other pending dependencies                          |
| Razor Sharp                                                    | Arsenal, `Свойства оружия!D3`: double BB at 3+ success degrees                                                              |
| Tearing                                                        | Arsenal, `Свойства оружия!D68`: reroll one minimum die once; bleeding strength by replacement die                           |
| Chain                                                          | Arsenal, `Свойства оружия!D88`; author: Pak's +10 already includes all Strength/Chain bonuses; armor loss uses effective BB |
| Fire / ongoing burning boundary                                | Arsenal, `Свойства оружия!D51`, Mechanics, `Раны и лечение !A17:B17`; no automatic interpretation selected                  |
| Faith activation                                               | Profiles, `Таланты (обновлены)!C173` note and `G149`; fate is not spent/activated in the supported scenario                 |

Pak's Void Armor is explicitly matched by name and personal 6/7/6/6 zone values
to `Арсенал / Броня!A33:E33`. Its Ceramite adds +3 OB against energy damage
(`Броня!B115`), without replacing personal base OB. Med-layer and Flak references
are `Броня!A99:B99` and `A109:B109`; environment protection is `A105:B105`.
Bounded evidence is retained in `canonical-armor.json`.

The block's unit is explicitly **shots**, per the author's 250-shot ruling.
One normal shot leaves 249/250. This is not a 250-energy-charge magazine to be
divided by 7. The original profile's `Заряд (7)` and 60-capacity reference remain
in the source snapshot; no personal weapon damage/BB is substituted from Arsenal.
Pak's sword has no invented battery capacity; null ammo is not a claim that it has
an infinite energy supply. Full battery/history simulation is outside this test.

## Reproducible local scenario

Setup positions: Kelus (5,10), Pak (5.75,10), established **before** either attack.
This is a fixture placement, not free movement during a combat turn. No grid snapping.
Targets explicitly decline defenses. No fate/faith activation, terrain, surprise,
power-mode switch, additional target or other Actor is introduced.
Kelus prepares the rifle, Pak prepares his sword; Kelus's inventory sword is not
simultaneously held together with a two-handed rifle.

### Completed hit/miss scenario (AC-LC01)

Kelus uses d100=65 and raw damage die=2 as detailed below. Pak then performs a
real Core simple melee attack with d100=90 against target60 and misses. Both
commands commit, the turn/resource restrictions apply, and the complete sequence
replays deterministically. Final state: Kelus 26/32, Pak 31/33, block 249/250.
No armor-loss-order choice is required for a miss. This test does not substitute
for the separately blocked positive sword-damage acceptance proof.

### Two-hit scenario (AC-LC02, blocked)

1. Kelus single shot: d100=65 at point blank. Core target=82, 2 degrees,
   reversed roll=56 → Torso. Raw damage die=2 → Proven=5; laser mastery +1.
   Raw damage=10; Pak torso OB7 + Ceramite3 = 10, BB6 → armor4;
   bVN4 → finalDamage2. Secondary VN roll20 succeeds against VN40.
   Remaining wounds=31/33; block=249/250. Real C-2 Injury is retained.
2. Accepted turn boundary and wound hook start Pak's turn.
3. Pak d100=25 → hit. His original `1d10+10`, base BB4 and Razor Sharp are
   retained; effective BB8 at 3+ degrees. **Resolution pauses here** until the
   author specifies whether armor loss occurs before or after this hit's damage.
   That d100 is saved; no wounds, ammo or armor loss from the pending command commit.

The ordinary initial map remains (5,10)/(15,10). Its default single-shot test is
`100:45,10:2,100:20`: target62, 2 degrees, Torso, finalDamage2, the same wound/ammo result.

## Open boundaries — never silently resolved

- **Author decision required for AC-LC02:** chain armor loss before or after
  current-hit damage. Loss amount is already settled: current effective BB,
  including Razor Sharp. This is not a repeated question about the +10 damage.
- Single shots with 3+ degrees expose the real Core suppression trigger and stay
  pending in this adapter. The accepted suppression subsystem already exists;
  local composition/lifecycle and personal-talent context are not claimed implemented.
- Spray/Flame/Trail: original personal profiles and Torso auto-hit ruling are
  preserved, but area escape, fire/burning and special protection dependencies
  are not bypassed by pretending these are ordinary NS single shots.
- Tearing and catalog bleeding on the same Injury: no automatic merge, addition
  or stronger-source selection. A confirmed relation is needed for such a case.
- A critical maximum on the discarded Tearing die stays pending if its replacement
  is not a maximum; neither retaining nor discarding that trigger is invented.
- Eyes/armor-joint protection and consequence mapping require explicit context.
- Kelus's Steel Jaw / Adamantine Skeleton: affected Stunned/limb-consequence cases
  stay pending rather than silently ignoring his personal protection.
- Pak's Med-layer amputation/automatic-tourniquet composition stays pending;
  injections and their activation program are not fabricated. The normal torso
  scenario does not trigger it. Gorget (7) is retained for both armor profiles.
- Kelus chain-sword bonus/power composition, nonstandard power modes, optional
  talent rerolls, defenses/counterattacks and other weapons are not exposed as
  completed actions. Unmapped properties remain visible without invented numbers.
- Canonical minute/hour/day clinical intents and long-term healing remain typed;
  no conversion to rounds or auto-healing is invented.

These boundaries do not disable loading, setup, ordinary supported shots, runtime
logging, replay or reset. A preflight operation with no dice may be cancelled.
Saved dice cannot be cancelled to obtain a free reroll.

## State and transaction safety

Static profiles are cloned and deep frozen. Mutable position, wounds, ammo,
condition state and armor loss are separate. Production resolvers remain pure and
unchanged. This local command envelope stages a complete action on a private
snapshot; a required pending result commits no runtime changes from that command.
Core stage logs are preserved as previews with the outer `committed:false` flag.
This local envelope does not redefine accepted Core resolver transaction boundaries.

The saved RNG prefix and command ID permit exact continuation for missing dice.
Replay stores actual rolls, not only a seed or human-readable text. Replays with
different author rulings are rejected; there is no silent migration. Rejected
invalid commands remain in the raw journal, but are not re-executed as gameplay.

## Validation

Root `pnpm test` runs rules-engine once and server once; experiments are deliberately
outside the production workspace and have separate test/typecheck/build commands.

Environment: Node.js 24.19.0, Corepack pnpm 11.19.0. Frozen install succeeded;
dependencies and lockfile were not updated.

| Actual check                                                   | Result                                                                                                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `corepack pnpm install --frozen-lockfile`                      | PASS                                                                                                                                     |
| `corepack pnpm format:check`                                   | PASS; changed experiment files rechecked after report completion                                                                         |
| `corepack pnpm lint`                                           | PASS; final experiment source rechecked separately                                                                                       |
| `corepack pnpm typecheck`                                      | PASS                                                                                                                                     |
| `corepack pnpm build`                                          | PASS, existing four workspace packages/apps                                                                                              |
| `corepack pnpm test`                                           | PASS: rules-engine 741/741, server 1/1; no production test repeated after successful regression                                          |
| `corepack pnpm --dir experiments/local-combat typecheck`       | PASS                                                                                                                                     |
| `corepack pnpm --dir experiments/local-combat test`            | 33 PASS, 0 FAIL, 1 SKIPPED (AC-LC02 author decision)                                                                                     |
| `corepack pnpm --dir experiments/local-combat build`           | PASS                                                                                                                                     |
| `node experiments/local-combat/scripts/browser-smoke.mjs`      | PASS: Chromium 390×844, touch drag, real shot, exact armor/damage/ammo/log, completed hit/miss scenario, two-hit pending boundary, reset |
| Replay unit checks                                             | PASS: exact runtime replay, saved-dice continuation, author-ruling mismatch and prefix-tamper rejection                                  |
| `git diff --check`                                             | PASS                                                                                                                                     |
| Diff outside `experiments/local-combat` from accepted baseline | Empty                                                                                                                                    |

Combined executable test results: **775 passed, 0 failed, 1 skipped**.
The skip is the positive two-damaging-hit acceptance case; it is not hidden inside
a PASS claim. Chromium mobile emulation was used, not a physical phone.

The live canonical torso-2 consequence was checked at Mechanics,
`Раны и лечение !A76:F76`: VN+0 or knocked down. It agrees with the accepted
Core and is retained in `canonical-consequences.json`.

Main remains `7e7bbd8fdc534289cc791f54331bacb09b0513b6`. Final checkpoint SHA,
push outcome, CLEAN state and origin synchronization are returned in the final
session report. No merge, deployment, production integration or next phase is performed.
