import type {
  EquipmentCollection,
  EquipmentCombatEffect,
  EquipmentInstance,
  EquipmentPending,
  EquipmentTrace,
  EffectInstance,
  ResolutionContext,
  EquipmentPayload,
} from '@kadat/contracts';
import { resolveEffects } from './context.js';
import { resolutionLog } from './log.js';
import { compareIds, integer, uniqueIds } from './validation.js';

export function equipmentEffectId(effect: EquipmentCombatEffect): string {
  return `equipment:${effect.sourceItemId}:${effect.id}`;
}
function numeric(payload: EquipmentPayload): number {
  return 'value' in payload ? payload.value : 0;
}
function scopeTags(scope: string): readonly string[] {
  return scope === 'ranged' ? ['ranged'] : [`check:${scope}`];
}
function translated(
  effect: EquipmentCombatEffect,
  actor: ResolutionContext['actor'],
): EffectInstance {
  const p = effect.payload;
  const target: EffectInstance['definition']['target'] =
    p.kind === 'CHARACTERISTIC_ADD'
      ? { kind: 'characteristic', characteristic: p.characteristic, field: 'value' }
      : p.kind === 'CHARACTERISTIC_CAP'
        ? { kind: 'characteristic-cap', characteristic: p.characteristic }
        : p.kind === 'CHECK_MODIFIER' || p.kind === 'SENSORY_CHECK_MODIFIER'
          ? { kind: 'check' }
          : { kind: 'combat-modifier', key: `equipment:${p.kind}` };
  return {
    id: equipmentEffectId(effect),
    source: effect.provenance.source,
    targetActor: actor,
    provenance: effect.provenance,
    definition: {
      id: effect.id,
      target,
      operation: 'add',
      value: numeric(p),
      stage: 'equipment',
      stackingGroup:
        effect.stacking?.group ??
        `equipment:${p.kind}:${'characteristic' in p ? p.characteristic : 'scope' in p ? p.scope : effect.id}`,
      stackingRule: 'largest',
      tags: ['equipment', p.kind],
      provenance: effect.provenance,
      condition: {
        requiresTags: [
          ...effect.requiredTags,
          ...(p.kind === 'MOVEMENT_MODIFIER' && p.action ? [`action:${p.action}`] : []),
          ...(p.kind === 'CHECK_MODIFIER' || p.kind === 'SENSORY_CHECK_MODIFIER'
            ? scopeTags(p.scope)
            : []),
        ],
      },
    },
  };
}
function conflictKey(p: EquipmentPayload): string | null {
  if (p.kind === 'CHECK_MODIFIER' || p.kind === 'SENSORY_CHECK_MODIFIER') return `check:${p.scope}`;
  if (p.kind === 'CHARACTERISTIC_CAP') return `cap:${p.characteristic}`;
  if (p.kind === 'MOVEMENT_MODIFIER') return `movement:${p.field}`;
  if (p.kind === 'SIZE_MODIFIER') return 'size';
  return null;
}
/** Source collection is pure. Unknown relations block execution rather than flatten sources. */
export function collectEquipmentEffects(
  equipment: readonly EquipmentInstance[],
  context: ResolutionContext,
): EquipmentCollection {
  uniqueIds(
    equipment.map((i) => i.id),
    'equipment item IDs',
  );
  const pending: EquipmentPending[] = [],
    traces: EquipmentTrace[] = [],
    active: EquipmentCombatEffect[] = [];
  for (const item of equipment) {
    if (
      !['POWERED', 'UNPOWERED', 'DISABLED', 'EMP_DISABLED', 'SYSTEM_DISABLED'].includes(
        item.powerState,
      )
    )
      throw new Error('Invalid equipment power state');
    uniqueIds(
      item.effects.map((e) => e.id),
      'equipment effect IDs',
    );
    for (const e of item.effects) {
      if (e.sourceItemId !== item.id || e.targetScope !== 'wearer')
        throw new Error('Invalid equipment source/scope');
      if (![true, false, 'UNKNOWN'].includes(e.requiresPower))
        throw new Error('Explicit equipment power dependency required');
      if (
        ![
          'CHARACTERISTIC_ADD',
          'CHARACTERISTIC_CAP',
          'CHECK_MODIFIER',
          'CHECK_IMMUNITY',
          'SUPPRESSION_IMMUNITY',
          'ACTION_PERMISSION',
          'ACTION_RESTRICTION',
          'MOVEMENT_MODIFIER',
          'SIZE_MODIFIER',
          'SENSORY_MODE',
          'SENSORY_CHECK_MODIFIER',
          'CONDITION_IMMUNITY',
          'CONDITION_REMOVAL_TRIGGER',
          'RECOIL_OR_STABILIZATION_EFFECT',
          'PROTECTION_ADJUSTMENT_INTENT',
          'FIELD_SOURCE',
        ].includes(e.payload.kind)
      )
        throw new Error('Unsupported equipment effect kind');
      integer(numeric(e.payload), 'equipment contribution');
      if (e.payload.kind === 'CHARACTERISTIC_CAP')
        integer(e.payload.value, 'characteristic cap', 0);
      if (e.stacking && !e.stacking.group.trim())
        throw new Error('Equipment stacking group required');
      let reason: EquipmentTrace['reason'] = 'active';
      if (
        item.wearer.actorId !== context.actor.actorId ||
        !item.equipped ||
        !e.active ||
        item.powerState === 'DISABLED'
      )
        reason = 'inactive';
      else if (e.sourceSystemId && item.disabledSystemIds.includes(e.sourceSystemId))
        reason = 'system';
      else if (!e.requiredTags.every((t) => context.tags.includes(t))) reason = 'tags';
      else if (e.requiresPower === 'UNKNOWN') {
        reason = 'pending';
        pending.push({
          type: 'PowerDependencyMappingPending',
          effectIds: [equipmentEffectId(e)],
          provenance: [e.provenance],
        });
      } else if (e.requiresPower && item.powerState !== 'POWERED') reason = 'power';
      const included = reason === 'active';
      traces.push({
        effect: e,
        powerState: item.powerState,
        included,
        reason,
        contribution: included ? e.payload : null,
      });
      if (included) active.push(e);
    }
  }
  const effects = active.map((e) => translated(e, context.actor));
  const merged = { ...context, effects: [...context.effects, ...effects] };
  const resolved = resolveEffects(merged);
  const extras: ResolutionContext['overrides'][number][] = [];
  for (const trace of traces) {
    const t = resolved.find((r) => r.id === equipmentEffectId(trace.effect));
    if (!t) continue;
    if (t.override?.operation === 'MODIFY' && !('value' in trace.effect.payload))
      throw new Error('Typed equipment capability cannot be numerically modified');
    if (t.override)
      Object.assign(trace, {
        included: t.included,
        reason: 'override',
        contribution: t.included
          ? 'value' in trace.effect.payload
            ? { ...trace.effect.payload, value: t.value }
            : trace.effect.payload
          : null,
      });
    else if (!t.included)
      Object.assign(trace, { included: false, reason: 'tags', contribution: null });
  }
  const groups = new Map<string, EquipmentTrace[]>();
  for (const t of traces) {
    const key = conflictKey(t.effect.payload);
    if (key && t.included) groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const first = group[0]!;
    const explicit =
      first.effect.stacking &&
      group.every(
        (t) =>
          t.effect.stacking?.group === first.effect.stacking!.group &&
          t.effect.stacking?.rule === first.effect.stacking!.rule,
      );
    // Caps agree only when explicitly selected; an arbitrary lowest-cap policy is not canonical.
    if (
      !explicit ||
      (first.effect.payload.kind === 'CHARACTERISTIC_CAP' &&
        new Set(group.map((t) => numeric(t.contribution!))).size > 1)
    ) {
      pending.push({
        type: 'EquipmentStackingPending',
        effectIds: group.map((t) => equipmentEffectId(t.effect)),
        provenance: group.map((t) => t.effect.provenance),
      });
      for (const t of group)
        Object.assign(t, { included: false, reason: 'pending', contribution: null });
    } else if (first.effect.stacking!.rule === 'LARGEST') {
      const winner = [...group].sort(
        (a, b) =>
          numeric(b.contribution!) - numeric(a.contribution!) ||
          compareIds(equipmentEffectId(a.effect), equipmentEffectId(b.effect)),
      )[0]!;
      for (const t of group)
        if (t !== winner) {
          Object.assign(t, { included: false, reason: 'stacking', contribution: null });
          extras.push({
            subject: 'effect',
            id: equipmentEffectId(t.effect),
            operation: 'EXCLUDE',
            origin: 'canonical',
            reason: 'Explicit equipment largest stacking relation',
          });
        }
    }
  }
  for (const t of traces)
    if (
      t.included &&
      t.effect.payload.kind === 'PROTECTION_ADJUSTMENT_INTENT' &&
      t.effect.payload.adjustment.type === 'UNRESOLVED'
    ) {
      pending.push({
        type: 'ProtectionOrderingPending',
        effectIds: [equipmentEffectId(t.effect)],
        provenance: [t.effect.provenance],
      });
    }
  const capabilities = traces.filter(
    (t) =>
      t.included &&
      ![
        'CHARACTERISTIC_ADD',
        'CHARACTERISTIC_CAP',
        'CHECK_MODIFIER',
        'SENSORY_CHECK_MODIFIER',
      ].includes(t.effect.payload.kind),
  );
  const collectedContext = {
    ...merged,
    overrides: [
      ...merged.overrides.filter(
        (o) => !extras.some((e) => e.subject === o.subject && e.id === o.id),
      ),
      ...extras,
    ],
  };
  const log = resolutionLog('equipment-collection', collectedContext, {
    equipment: { traces, pending },
    overrides: [...merged.overrides, ...extras],
    modifiers: resolved.filter((t) => effects.some((e) => e.id === t.id)),
  });
  return {
    status: pending.length ? 'PENDING' : 'RESOLVED',
    context: pending.length
      ? {
          ...context,
          overrides: context.overrides.filter(
            (o) =>
              o.subject !== 'effect' || !traces.some((t) => equipmentEffectId(t.effect) === o.id),
          ),
        }
      : collectedContext,
    effects: pending.length ? [] : effects,
    capabilities: pending.length ? [] : capabilities,
    fields: (pending.length ? [] : capabilities).flatMap((t) =>
      t.effect.payload.kind === 'FIELD_SOURCE' ? [t.effect.payload.field] : [],
    ),
    protectionIntents: (pending.length ? [] : capabilities).filter(
      (t) => t.effect.payload.kind === 'PROTECTION_ADJUSTMENT_INTENT',
    ),
    traces,
    pending,
    log,
  };
}

/** Absence is an absent effect, never a zero cap. No catalog/name inference. */
export function characteristicCapPayload(
  characteristic: import('@kadat/contracts').CharacteristicId,
  value: number | '-' | undefined,
): EquipmentPayload | null {
  if (value === undefined || value === '-') return null;
  integer(value, 'explicit characteristic cap', 0);
  return { kind: 'CHARACTERISTIC_CAP', characteristic, value };
}
