import type {
  ProtectionBundle,
  ProtectionCandidate,
  ResolutionContext,
  ResolutionModifier,
} from '@kadat/contracts';
import { resolveEffects, resolveModifiers } from './context.js';
import { protectionContext } from './protection-context.js';
import { integer } from './validation.js';

export function resolveProtectionBundle(
  candidates: readonly ProtectionCandidate[],
  context: ResolutionContext,
  targetId: string,
): ProtectionBundle {
  const modifiers: ResolutionModifier[] = candidates.map((c) => ({
    id: `protection:${c.instanceId}`,
    value: c.baseOB,
    source: c.definition.source,
    provenance: c.definition.provenance,
    condition: { requiresTags: [`protection-applicable:${c.instanceId}`] },
  }));
  const stage = protectionContext(
    {
      ...context,
      tags: [
        ...context.tags.filter((tag) => !tag.startsWith('protection-applicable:')),
        ...candidates
          .filter((c) => c.applicable)
          .map((c) => `protection-applicable:${c.instanceId}`),
      ],
    },
    [],
    modifiers,
  );
  const traces = resolveModifiers(stage),
    effectTraces = resolveEffects(stage);
  const contributions = candidates.map((candidate) => {
    const trace = traces.find((t) => t.id === `protection:${candidate.instanceId}`)!;
    integer(trace.value, 'selected protection OB', 0);
    let ob = trace.value;
    const selectedEffects = context.effects.flatMap((e, i) => {
      const t = e.definition.target,
        contribution = effectTraces[i];
      return t.kind === 'combat-modifier' &&
        t.key === `protection:${candidate.instanceId}` &&
        e.targetActor.actorId === targetId &&
        contribution?.included
        ? [{ effect: e, trace: contribution }]
        : [];
    });
    const sets = selectedEffects.filter((e) => e.effect.definition.operation === 'set');
    if (sets.length > 1) throw new Error('Ambiguous protection replacement effects');
    if (sets[0]) ob = sets[0].trace.value;
    for (const e of selectedEffects) {
      if (e.effect.definition.operation === 'add') ob += e.trace.value;
      else if (e.effect.definition.operation !== 'set')
        throw new Error('Unsupported protection effect operation');
    }
    // The GM contribution is final for this one resolution, after source effects.
    if (trace.override?.operation === 'MODIFY') ob = trace.value;
    ob = Math.max(0, ob);
    integer(ob, 'effective protection contribution', 0);
    return {
      candidate,
      trace,
      ob,
      included: trace.included,
      reason: trace.override
        ? ('override' as const)
        : trace.included
          ? ('selected' as const)
          : candidate.applicabilityReason === 'applicable'
            ? ('override' as const)
            : candidate.applicabilityReason,
    };
  });
  const included = contributions.filter((c) => c.included);
  const selected = included.filter((c) => c.ob > 0);
  const incompatiblePairs: (readonly [string, string])[] = [];
  for (let i = 0; i < selected.length; i++)
    for (let j = i + 1; j < selected.length; j++) {
      const a = selected[i]!,
        b = selected[j]!;
      const explicit =
        a.candidate.definition.compatibleWithTemplateIds.includes(b.candidate.definition.id) &&
        b.candidate.definition.compatibleWithTemplateIds.includes(a.candidate.definition.id);
      const gmSelected = [a, b].every(
        (c) =>
          c.trace.override?.origin !== 'canonical' && c.trace.override?.operation === 'INCLUDE',
      );
      if (!explicit && !gmSelected)
        incompatiblePairs.push([a.candidate.instanceId, b.candidate.instanceId]);
    }
  const unresolvedAdjustments = included.flatMap((c) =>
    c.candidate.specialAdjustment?.type === 'UNRESOLVED' && c.trace.override?.operation !== 'MODIFY'
      ? [{ sourceId: c.candidate.instanceId, adjustment: c.candidate.specialAdjustment }]
      : [],
  );
  const penetrableOB = selected
    .filter((c) => c.candidate.definition.penetrationMode === 'WEAPON_BB')
    .reduce((sum, c) => sum + c.ob, 0);
  const bbImmuneOB = selected
    .filter((c) => c.candidate.definition.penetrationMode === 'IGNORE_WEAPON_BB')
    .reduce((sum, c) => sum + c.ob, 0);
  integer(penetrableOB, 'penetrable bundle OB', 0);
  integer(bbImmuneOB, 'BB-immune bundle OB', 0);
  const ready = incompatiblePairs.length === 0 && unresolvedAdjustments.length === 0;
  return {
    effectTraces,
    contributions: ready
      ? contributions
      : contributions.map((c) => (c.included ? { ...c, reason: 'pending' as const } : c)),
    selectedIds: ready ? selected.map((c) => c.candidate.instanceId) : [],
    armorOB: ready ? penetrableOB + bbImmuneOB : 0,
    penetrableOB: ready ? penetrableOB : 0,
    bbImmuneOB: ready ? bbImmuneOB : 0,
    incompatiblePairs,
    unresolvedAdjustments,
  };
}
export function resolvePenetration(bundle: ProtectionBundle, weaponBB: number): number {
  if (bundle.incompatiblePairs.length || bundle.unresolvedAdjustments.length)
    throw new Error('Protection bundle requires a decision before penetration');
  integer(weaponBB, 'weapon BB', 0);
  return Math.max(0, bundle.penetrableOB - weaponBB) + bundle.bbImmuneOB;
}
