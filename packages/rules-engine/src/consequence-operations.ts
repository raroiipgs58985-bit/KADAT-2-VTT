import type { ConsequenceOperation, CanonicalDuration } from '@kadat/contracts';
const c = (
  condition: string,
  amount?: number,
  unit: CanonicalDuration['unit'] = 'round',
): ConsequenceOperation => ({
  kind: 'condition',
  condition,
  ...(amount !== undefined ? { duration: { unit, amount } } : {}),
});
const b = (severity: 'LIGHT' | 'MEDIUM' | 'HEAVY'): ConsequenceOperation => ({
  kind: 'bleeding',
  severity,
});
const i = (feature: string, severity?: 'minor' | 'serious'): ConsequenceOperation => ({
  kind: 'injury',
  feature,
  ...(severity ? { severity } : {}),
});
const m = (
  key: string,
  value: number,
  amount?: number,
  unit: CanonicalDuration['unit'] = 'round',
): ConsequenceOperation => ({
  kind: 'modifier',
  key,
  value,
  ...(amount !== undefined ? { duration: { unit, amount } } : {}),
});
const check = (
  modifier: 0 | -10,
  onFailure: readonly ConsequenceOperation[],
  onSuccess?: readonly ConsequenceOperation[],
): ConsequenceOperation => ({
  kind: 'check',
  modifier,
  onFailure,
  ...(onSuccess ? { onSuccess } : {}),
});
const drop: ConsequenceOperation = { kind: 'drop' };
const roll = (
  purpose: Extract<ConsequenceOperation, { kind: 'roll' }>['purpose'],
  sides: 5 | 10 | 2 = 10,
  modifier = 0,
): ConsequenceOperation => ({ kind: 'roll', purpose, sides, modifier });
const trigger = (
  trigger: Extract<ConsequenceOperation, { kind: 'trigger' }>['trigger'],
): ConsequenceOperation => ({ kind: 'trigger', trigger });
const pending = (intent: string, reason: string): ConsequenceOperation => ({
  kind: 'pending',
  intent,
  reason,
});
const eye: ConsequenceOperation = { kind: 'eye-check' };
const death = (destroyed: 'HEAD' | 'TORSO' | null): ConsequenceOperation => ({
  kind: 'death',
  destroyed,
});
const bleedDays = [roll('fatigue'), roll('persistent-fatigue-days')] as const;
/** Structured extraction of Appendix A; unsupported descriptive semantics stay explicit intents. */
export const consequenceOperations: Readonly<Record<string, readonly ConsequenceOperation[]>> = {
  'HEAD:1': [m('checks:vision', -10, 1, 'hour')],
  'HEAD:2': [c('Stunned', 1)],
  'HEAD:3': [b('LIGHT')],
  'HEAD:4': [b('LIGHT'), c('Stunned', 1)],
  'HEAD:5': [c('Stunned', 1), m('checks:speech:ОЩ', -20), i('jaw-fracture', 'minor')],
  'HEAD:6': [b('LIGHT'), c('Blind')],
  'HEAD:7': [
    b('LIGHT'),
    m('checks:injured-eye:ВС', -10),
    m('checks:injured-eye:НС', -10),
    eye,
    i('eye-region-fracture', 'minor'),
  ],
  'HEAD:8': [c('Deaf'), trigger('repeated-deafness'), b('LIGHT')],
  'HEAD:9': [b('MEDIUM'), check(0, [c('Prone')]), roll('teeth'), i('teeth-amputation')],
  'HEAD:10': [
    b('HEAVY'),
    c('Blind', 2),
    check(0, [c('Stunned', 1)]),
    i('nose-fracture', 'serious'),
  ],
  'HEAD:11': [b('HEAVY'), c('Deaf'), check(0, [c('Stunned', 1)]), i('ear-amputation')],
  'HEAD:12': [
    b('MEDIUM'),
    c('Deaf'),
    c('Stunned', 12),
    roll('persistent-fatigue-days'),
    i('concussion'),
  ],
  'HEAD:13': [
    {
      kind: 'bleeding',
      severity: 'HEAVY',
      normalization: {
        source: { kind: 'author-ruling', id: 'C-2 Head 13 bleeding terminology' },
        record: 'Head 13 — Потеря глаза',
        reason:
          'Original Кровотечение (Серьёзное) means Кровотечение (Сильное), HEAVY; not a fourth category',
      },
    },
    m('checks:vision-vigilance', -20),
    eye,
    i('eye-amputation'),
  ],
  'HEAD:14': [
    b('HEAVY'),
    check(0, [c('Prone'), c('Helpless', 2)], [c('Stunned', 2)]),
    roll('teeth'),
    i('teeth-amputation'),
    i('jaw-fracture', 'serious'),
    i('tongue-loss'),
  ],
  'HEAD:15+': [death('HEAD')],
  'ARM:1': [drop],
  'ARM:2': [m('checks:affected-limb', -15, 1, 'minute')],
  'ARM:3': [b('LIGHT')],
  'ARM:4': [b('LIGHT'), drop],
  'ARM:5': [
    i('limb-unusable'),
    trigger('turn-start-VN'),
    pending('DislocationTreatment', 'Limb remains unusable until shoulder is reset'),
  ],
  'ARM:6': [b('LIGHT'), roll('finger', 5), i('finger-amputation')],
  'ARM:7': [
    drop,
    i('limb-unusable'),
    check(0, [c('Stunned', 1, 'minute')]),
    i('arm-fracture', 'minor'),
  ],
  'ARM:8': [b('HEAVY'), m('checks:affected-limb', -20)],
  'ARM:9': [b('HEAVY'), drop, i('hand-fracture', 'serious'), roll('fingers', 10, -5)],
  'ARM:10': [
    drop,
    i('limb-unusable'),
    check(-10, [c('Stunned', 1, 'minute')]),
    i('arm-fracture', 'serious'),
  ],
  'ARM:11-12': [
    b('HEAVY'),
    drop,
    check(-10, [c('Stunned', 1, 'minute')]),
    i('finger-amputation'),
    pending(
      'DelayedFingerLoss',
      'Lose another finger each untreated minute; eventual hand amputation remains a delayed intent',
    ),
  ],
  'ARM:13-14': [drop, b('HEAVY'), ...bleedDays, i('limb-unusable')],
  'ARM:15-16': [b('HEAVY'), c('Stunned', 1, 'hour'), i('hand-amputation')],
  'ARM:17-19': [
    drop,
    i('limb-unusable'),
    c('Stunned', 1, 'hour'),
    b('HEAVY'),
    trigger('same-limb-damage'),
    i('arm-amputation'),
  ],
  'ARM:20+': [death(null)],
  'TORSO:1': [c('Stunned', 1)],
  'TORSO:2': [check(0, [c('Prone')])],
  'TORSO:3': [b('LIGHT')],
  'TORSO:4': [b('LIGHT'), c('Prone')],
  'TORSO:5': [
    m('checks:СЛ', -10),
    m('checks:ЛВ', -10),
    m('movement', -1),
    i('rib-fracture', 'minor'),
  ],
  'TORSO:6': [
    b('MEDIUM'),
    c('Stunned', 1, 'minute'),
    pending('Knockback', 'Canonical text has no executable displacement distance'),
  ],
  'TORSO:7': [
    roll('clavicle-side', 2),
    drop,
    m('checks:affected-limb', -15),
    check(0, [c('Stunned', 1, 'minute')]),
    i('clavicle-fracture', 'minor'),
  ],
  'TORSO:8': [b('HEAVY'), m('movement', -2)],
  'TORSO:9': [
    c('Prone'),
    m('checks:mobility', -20),
    m('movement', -2),
    check(0, [c('Stunned', 1, 'minute')]),
    i('hip-fracture', 'minor'),
  ],
  'TORSO:10': [m('checks:physical', -20), m('movement', -3), i('torso-fracture', 'serious')],
  'TORSO:11-12': [b('HEAVY'), roll('fatigue'), i('lung-organ-damage')],
  'TORSO:13-14': [
    c('Prone'),
    b('HEAVY'),
    ...bleedDays,
    m('movement', -1),
    m('checks:mobility', -20),
  ],
  'TORSO:15-16': [c('Prone'), b('HEAVY'), c('Stunned', 1, 'hour'), i('torso-tissue-loss')],
  'TORSO:17-19': [c('Prone'), b('HEAVY'), i('spinal-damage'), i('torso-fracture', 'serious')],
  'TORSO:20+': [death('TORSO')],
  'LEG:1': [c('Prone')],
  'LEG:2': [m('movement', -1, 1, 'minute')],
  'LEG:3': [b('LIGHT')],
  'LEG:4': [b('LIGHT'), c('Prone')],
  'LEG:5': [
    m('checks:mobility', -15),
    m('movement', -1),
    trigger('turn-start-VN'),
    pending(
      'DislocationTreatment',
      'Knee remains dislocated until reset; failed turn-start VN stuns until next own turn',
    ),
  ],
  'LEG:6': [b('MEDIUM'), i('toe-amputation')],
  'LEG:7': [
    i('limb-unusable'),
    c('Prone'),
    m('checks:mobility', -20),
    m('movement', -2),
    check(0, [c('Stunned', 1, 'minute')]),
    i('leg-fracture', 'minor'),
  ],
  'LEG:8': [b('HEAVY'), m('checks:affected-limb', -30)],
  'LEG:9': [
    b('HEAVY'),
    c('Prone'),
    m('movement', -2),
    i('foot-fracture', 'serious'),
    roll('fingers', 10, -5),
  ],
  'LEG:10': [
    i('limb-unusable'),
    c('Prone'),
    m('checks:mobility', -30),
    m('movement', -3),
    check(-10, [c('Stunned', 1, 'minute')]),
    i('leg-fracture', 'serious'),
  ],
  'LEG:11-12': [
    b('HEAVY'),
    c('Prone'),
    check(-10, [c('Stunned', 1, 'minute')]),
    i('toe-amputation'),
    pending(
      'DelayedToeLoss',
      'Lose another toe each untreated minute; eventual foot amputation remains a delayed intent',
    ),
  ],
  'LEG:13-14': [c('Prone'), b('HEAVY'), ...bleedDays, m('movement', -2), m('checks:mobility', -20)],
  'LEG:15-16': [c('Prone'), b('HEAVY'), c('Stunned', 1, 'hour'), i('foot-amputation')],
  'LEG:17-19': [
    i('limb-unusable'),
    c('Prone'),
    m('movement', -3),
    m('checks:mobility', -30),
    c('Stunned', 1, 'hour'),
    b('HEAVY'),
    trigger('same-limb-damage'),
    i('leg-amputation'),
  ],
  'LEG:20+': [death(null)],
};
