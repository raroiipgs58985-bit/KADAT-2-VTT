import type {
  ConsequenceOperation,
  ConsequenceRow,
  DiceSource,
  InjuryRecord,
  ResolutionContext,
  WoundFacts,
  WoundRuntimeState,
  ActorReference,
  CalledLocation,
  FatigueGainResult,
  CheckResult,
  WoundIntent,
  WoundCheckProjection,
} from '@kadat/contracts';
import { planWoundCondition, addWoundEffects } from './wound-conditions.js';
import { planFatigueGain } from './wound-fatigue.js';
import { planDeath } from './wound-life.js';
import { resolveWoundCheck } from './wound-checks.js';
import { woundEffect, woundIntent } from './wound-state.js';
import { rollDie } from './dice.js';
import { integer } from './validation.js';

export function planConsequence(
  state: WoundRuntimeState,
  actor: ActorReference,
  row: ConsequenceRow,
  location: CalledLocation,
  injuryId: string,
  bVN: number,
  context: ResolutionContext,
  facts: WoundFacts | undefined,
  source: DiceSource,
) {
  let next = state,
    blocked = false,
    counter = 0;
  const features: InjuryRecord['features'][number][] = [],
    triggers: InjuryRecord['triggers'][number][] = [],
    fatigue: FatigueGainResult[] = [],
    checks: CheckResult[] = [],
    projections: WoundCheckProjection[] = [],
    pending: WoundIntent[] = [],
    bleeding: InjuryRecord['bleedingSourceIds'][number][] = [];
  let secondarySide: 'Left' | 'Right' | undefined;
  const addIntent = (
    type: WoundIntent['type'],
    reason: string,
    extra: Partial<WoundIntent> = {},
  ) => {
    const intent = woundIntent(
      `${injuryId}:intent:${counter++}`,
      type,
      actor,
      row.provenance,
      reason,
      { injuryId, location, ...extra },
    );
    pending.push(intent);
    const a = next.actors[actor.actorId]!;
    next = {
      ...next,
      actors: { ...next.actors, [actor.actorId]: { ...a, intents: [...a.intents, intent] } },
    };
  };
  const execute = (operations: readonly ConsequenceOperation[]): void => {
    for (const operation of operations) {
      const id = `${injuryId}:op:${counter++}`,
        provenance = { ...row.provenance, record: `${row.provenance.record}; ${id}` };
      switch (operation.kind) {
        case 'condition': {
          next = planWoundCondition(
            next,
            actor,
            id,
            operation.condition,
            provenance,
            operation.duration,
          ).state;
          if (operation.condition === 'Deaf') {
            const prior = next.actors[actor.actorId]!.injuries.filter((i) =>
              i.triggers.some((t) => t.kind === 'repeated-deafness' && !t.consumed),
            );
            if (prior.length) {
              features.push({ type: 'permanent-hearing-loss' });
              const a = next.actors[actor.actorId]!;
              next = {
                ...next,
                actors: {
                  ...next.actors,
                  [actor.actorId]: {
                    ...a,
                    injuries: a.injuries.map((i) =>
                      prior.includes(i)
                        ? {
                            ...i,
                            triggers: i.triggers.map((t) =>
                              t.kind === 'repeated-deafness' ? { ...t, consumed: true } : t,
                            ),
                          }
                        : i,
                    ),
                  },
                },
              };
            }
          }
          break;
        }
        case 'bleeding': {
          const a = next.actors[actor.actorId]!;
          const entry = {
            id: `${injuryId}:bleed:${bleeding.length}`,
            injuryId,
            consequence: row,
            severity: operation.severity,
            ...(operation.normalization ? { normalization: operation.normalization } : {}),
            location,
            active: true,
            appliedRound: state.combat.session.roundNumber,
            appliedTurn: state.combat.session.turn?.turnNumber ?? state.combat.session.turnsStarted,
            provenance,
          };
          bleeding.push(entry.id);
          next = {
            ...next,
            actors: { ...next.actors, [actor.actorId]: { ...a, bleeding: [...a.bleeding, entry] } },
          };
          break;
        }
        case 'injury': {
          if (operation.feature === 'limb-unusable') {
            const marker = woundEffect(`${id}:limb`, actor, 'unusable-limb', 1, provenance);
            next = addWoundEffects(next, actor, [
              {
                ...marker,
                definition: {
                  ...marker.definition,
                  target: { kind: 'permission', permission: 'action' },
                  operation: 'restrict',
                  condition: { requiresTags: [`uses-limb:${location}`] },
                },
              },
            ]);
          }
          features.push({
            type: operation.feature,
            ...(operation.severity ? { severity: operation.severity } : {}),
            ...(secondarySide ? { side: secondarySide } : {}),
          });
          break;
        }
        case 'modifier': {
          const effect = woundEffect(id, actor, operation.key, operation.value, {
            ...provenance,
            record: injuryId,
          });
          next = addWoundEffects(next, actor, [effect]);
          if (operation.duration)
            addIntent(
              'TimedConditionIntent',
              'Expire this source-linked modifier using canonical duration; no rounds conversion',
              { duration: operation.duration, effects: [effect] },
            );
          break;
        }
        case 'check': {
          const checked = resolveWoundCheck(next, 'ВН', context, source, {
            id: `${id}:VN`,
            value: operation.modifier,
            provenance,
          });
          checks.push(checked.result);
          projections.push(checked.projection);
          execute(
            checked.result.outcome === 'success'
              ? (operation.onSuccess ?? [])
              : operation.onFailure,
          );
          break;
        }
        case 'roll': {
          if (operation.purpose === 'fatigue') {
            const planned = planFatigueGain(next, actor, bVN, source, context, id, provenance);
            next = planned.state;
            fatigue.push(planned.gain);
            if (planned.blocked) {
              blocked = true;
              pending.push(
                ...next.actors[actor.actorId]!.intents.filter(
                  (i) => i.type === 'DurationInterpretationRequired',
                ),
              );
            }
            break;
          }
          const rolled = rollDie(operation.sides, source),
            value = rolled.value + operation.modifier;
          if (operation.purpose === 'clavicle-side') {
            secondarySide = rolled.value === 1 ? 'Left' : 'Right';
            features.push({ type: 'clavicle-side', side: secondarySide });
          } else if (operation.purpose === 'persistent-fatigue-days') {
            next = planWoundCondition(next, actor, id, 'PersistentFatigue', provenance, {
              unit: 'day',
              amount: value,
            }).state;
            addIntent(
              'CanonicalEffectIntent',
              'Rest does not remove this Fatigue; unspecified quantity is not added to the counter',
              { duration: { unit: 'day', amount: value }, details: { restHelps: false } },
            );
          } else if (operation.purpose === 'fingers' && value < 0) {
            blocked = true;
            addIntent(
              'FeatureContextRequired',
              'Canonical finger/toe expression yields a negative count; no clamp or amputation count is invented',
              { details: { rawCount: value, roll: rolled.value, modifier: operation.modifier } },
            );
          } else if (operation.purpose === 'finger') {
            features.push({ type: 'finger-index', count: rolled.value });
          } else if (value > 0)
            features.push({
              type:
                operation.purpose === 'teeth'
                  ? 'teeth-amputation'
                  : location.includes('Leg')
                    ? 'toes-amputation'
                    : 'fingers-amputation',
              count: value,
            });
          break;
        }
        case 'drop':
          addIntent(
            'DropHeldItemIntent',
            'Drop item held in the affected hand; inventory selection stays external',
            {
              details: {
                side:
                  secondarySide ??
                  (location.startsWith('Left')
                    ? 'Left'
                    : location.startsWith('Right')
                      ? 'Right'
                      : 'context-required'),
              },
            },
          );
          break;
        case 'trigger':
          triggers.push({ kind: operation.trigger, location, consumed: false, provenance });
          break;
        case 'death': {
          const death = planDeath(next, actor, bVN, provenance, operation.destroyed);
          next = death.state;
          blocked ||= death.blocked;
          if (death.blocked)
            pending.push(
              ...next.actors[actor.actorId]!.intents.filter(
                (i) => i.type === 'DurationInterpretationRequired',
              ),
            );
          break;
        }
        case 'eye-check':
          if (facts?.eyeCountBefore === undefined) {
            blocked = true;
            addIntent(
              'FeatureContextRequired',
              'Canonical blindness depends on eye count before injury; this contextual fact is required',
            );
          } else {
            integer(facts.eyeCountBefore, 'eye count before', 1);
            if (facts.eyeCountBefore === 1)
              next = planWoundCondition(next, actor, `${id}:blind`, 'Blind', provenance).state;
          }
          break;
        case 'pending':
          addIntent(
            operation.intent.startsWith('Delayed')
              ? 'DelayedInjuryIntent'
              : 'CanonicalEffectIntent',
            operation.reason,
            { details: { canonicalIntent: operation.intent } },
          );
          break;
      }
    }
  };
  execute(row.operations);
  return {
    state: next,
    blocked,
    features,
    triggers,
    fatigue,
    checks,
    projections,
    pending,
    bleeding,
  };
}
