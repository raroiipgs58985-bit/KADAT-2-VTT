import { describe, expect, it } from 'vitest';
import type { EffectInstance } from '@kadat/contracts';
// Test-only use of Core internals: the effects below are built exactly as Core builds them
// for wound consequences, so the client boundary is checked against the real shape.
import { woundEffect } from '../../../../packages/rules-engine/src/wound-state.js';
import { createBattle, type ActorId, type Battle } from './model';
import { getEngine, moveActor, movementOptions, standUp, startCombat, turnInfo } from './engine';
import { exportReplay, importReplay } from './replay';
import { fixedDice } from './dice';
import { commandFeedback } from '../ui/feedback';

const provenance = {
  source: { kind: 'test', id: 'wound consequence fixture' },
  reason: 'Synthetic consequence effect with the Core shape',
};
const started = () => {
  const b = createBattle();
  startCombat(b, fixedDice('10:9,10:2'));
  return b;
};
/** Mutates the adapter runtime the same way Core's addWoundEffects / Prone condition do. */
function patchActor(
  b: Battle,
  id: ActorId,
  patch: { effects?: EffectInstance[]; posture?: 'prone' | 'kneeling' },
) {
  const engine = getEngine(b);
  const runtime = engine.wounds.combat.actors[id]!;
  engine.wounds = {
    ...engine.wounds,
    combat: {
      ...engine.wounds.combat,
      actors: {
        ...engine.wounds.combat.actors,
        [id]: {
          ...runtime,
          effects: [...runtime.effects, ...(patch.effects ?? [])],
          posture: patch.posture ?? runtime.posture,
        },
      },
    },
  };
}
const ref = { actorId: 'kelus-drakar' };
let n = 0;
const go = (b: Battle, mode: 'half-move' | 'free-move', x: number) =>
  moveActor(b, { id: `m${++n}`, actor: 'kelus-drakar', mode, to: { x: x + 0.5, y: 10.5 } });

describe('Wound consequences now read by the Core movement (rulings 4, 15)', () => {
  it('a СКР penalty reduces the distance: СКР 4 − 1 → Полудвижение 3 м', () => {
    const b = started();
    patchActor(b, 'kelus-drakar', {
      effects: [woundEffect('leg2', ref, 'movement', -1, provenance)],
    });
    expect(
      movementOptions(b, 'kelus-drakar').find((o) => o.mode === 'half-move')?.maxDistance,
    ).toBe(3);
    expect(() => go(b, 'half-move', 9)).toThrow(/больше допустимой 3 м/);
    expect(turnInfo(b).od).toBe(2);
    expect(go(b, 'half-move', 8).status).toBe('RESOLVED');
  });

  it('an unusable leg means crawling: СКР / 2, no Run or Sprint', () => {
    const b = started();
    const marker = woundEffect('leg:limb', ref, 'unusable-limb', 1, provenance);
    patchActor(b, 'kelus-drakar', {
      effects: [
        {
          ...marker,
          definition: {
            ...marker.definition,
            target: { kind: 'permission', permission: 'action' },
            operation: 'restrict',
            condition: { requiresTags: ['uses-limb:Left Leg'] },
          },
        },
      ],
    });
    const options = movementOptions(b, 'kelus-drakar');
    expect(options.find((o) => o.mode === 'half-move')?.maxDistance).toBe(2);
    expect(options.find((o) => o.mode === 'run')?.available).toBe(false);
    expect(go(b, 'half-move', 7).status).toBe('RESOLVED');
  });

  it('an unrelated arm restriction does not change movement', () => {
    const b = started();
    const marker = woundEffect('arm:limb', ref, 'unusable-limb', 1, provenance);
    patchActor(b, 'kelus-drakar', {
      effects: [
        {
          ...marker,
          definition: {
            ...marker.definition,
            target: { kind: 'permission', permission: 'action' },
            operation: 'restrict',
            condition: { requiresTags: ['uses-limb:Right Arm'] },
          },
        },
      ],
    });
    expect(go(b, 'half-move', 9).status).toBe('RESOLVED');
  });
});

describe('Prone and «Встать» through the Core', () => {
  it('a prone actor crawls at СКР / 2, stands up for 1 OD, then moves', () => {
    const b = started();
    patchActor(b, 'kelus-drakar', { posture: 'prone' });
    expect(() => go(b, 'half-move', 8)).toThrow(/больше допустимой 2 м/);
    expect(turnInfo(b).od).toBe(2);
    standUp(b, { id: 'stand-1', actor: 'kelus-drakar' });
    expect(getEngine(b).wounds.combat.actors['kelus-drakar']!.posture).toBe('standing');
    expect(turnInfo(b).od).toBe(1);
    expect(b.log.at(-1)).toMatchObject({ type: 'posture', detail: { odBefore: 2, odAfter: 1 } });
    expect(go(b, 'half-move', 8).status).toBe('RESOLVED');
    expect(turnInfo(b).od).toBe(0);
  });

  it('standing up while standing is rejected without spending OD', () => {
    const b = started();
    expect(() => standUp(b, { id: 'stand-2', actor: 'kelus-drakar' })).toThrow(/уже стоит/);
    expect(turnInfo(b).od).toBe(2);
    expect(b.log.at(-1)?.type).toBe('posture-rejected');
  });
});

describe('Replay integrity', () => {
  it('rejects a placement step injected after the combat started', () => {
    const b = started();
    const replay = exportReplay(b);
    replay.steps.push({ type: 'placement', actor: 'pak', x: 6, y: 10 });
    expect(() => importReplay(JSON.parse(JSON.stringify(replay)))).toThrow(/только до начала боя/);
  });
});

describe('Command feedback', () => {
  it('never reports an older journal entry for an error thrown before logging', () => {
    const b = started();
    expect(() => go(b, 'half-move', 30)).toThrow();
    const before = b.log.length; // last entry is now the earlier move-rejected
    const feedback = commandFeedback(before, b.log, new Error('Команда уже исполнена'));
    expect(feedback).toEqual({ text: 'Команда уже исполнена', tone: 'error' });
  });

  it('reports the entry appended by the current command', () => {
    const b = started();
    const before = b.log.length;
    go(b, 'half-move', 8);
    expect(commandFeedback(before, b.log).text).toMatch(/Полудвижение/);
  });
});
