import { describe, it, expect } from 'vitest';
import type { CombatActionState, MeleeAttackRequest, ParryRequest } from '@kadat/contracts';
import {
  resolveMeleeAttack,
  resolveParry,
  resolveMeleeDodge,
  resolveBreakthrough,
  resolveGrappleAction,
  changeMeleeStanceGrip,
  emptyActionContext,
  finishActionTurn,
  resolveCombatAction,
} from '../src/index.js';
import {
  meleeState,
  meleeAttack,
  meleeWeapon,
  setWeapon,
  editMelee,
  rolls,
  action,
  grappleState,
  grappleRequest,
  onBTurn,
  fixtureSource,
} from './b2-fixtures.js';
import { deepFreeze } from './fixtures.js';
import { extraEffect } from './b1-fixtures.js';
function unchanged(s: CombatActionState, operation: (frozen: CombatActionState) => unknown) {
  const frozen = deepFreeze(s),
    before = JSON.stringify(s);
  expect(() => operation(frozen)).toThrow();
  expect(JSON.stringify(s)).toBe(before);
}
const attacks: readonly [
  string,
  (s: CombatActionState) => CombatActionState,
  Partial<MeleeAttackRequest>,
][] = [
  [
    'insufficient OD',
    (s) => ({ ...s, session: { ...s.session, turn: { ...s.session.turn!, od: 0 } } }),
    {},
  ],
  ['attack after turn ended', (s) => finishActionTurn(s).state, {}],
  [
    'second ordinary attack',
    (s) => ({
      ...s,
      session: { ...s.session, turn: { ...s.session.turn!, flags: ['attack:previous'] } },
    }),
    {},
  ],
  ['unreadied weapon', (s) => setWeapon(s, 'blade:A', { ...meleeWeapon('A'), readied: false }), {}],
  ['dropped weapon', (s) => setWeapon(s, 'blade:A', { ...meleeWeapon('A'), dropped: true }), {}],
  ['missing weapon', (s) => s, { weaponId: 'gun:A' }],
  [
    'natural weapon deferred',
    (s) => setWeapon(s, 'blade:A', meleeWeapon('A', { family: 'natural' })),
    {},
  ],
  ['negative reach', (s) => s, { targets: [{ actor: { actorId: 'B' }, distance: -1 }] }],
  ['NaN reach', (s) => s, { targets: [{ actor: { actorId: 'B' }, distance: NaN }] }],
  ['beyond reach', (s) => s, { targets: [{ actor: { actorId: 'B' }, distance: 4 }] }],
  ['Charge exceeds SKR*3', (s) => s, { base: 'charge', movementDistance: 25 }],
  ['negative Charge movement', (s) => s, { base: 'charge', movementDistance: -1 }],
  [
    'Charge not end in melee',
    (s) => s,
    { base: 'charge', movementDistance: 20, targets: [{ actor: { actorId: 'B' }, distance: 5 }] },
  ],
  ['non-Charge movement', (s) => s, { movementDistance: 1 }],
  ['defensive own attack', (s) => editMelee(s, 'A', { stance: 'defensive' }), {}],
  [
    'defensive shield Charge',
    (s) =>
      setWeapon(editMelee(s, 'A', { stance: 'defensive' }), 'shield:A', {
        ...meleeWeapon('A', { family: 'shield' }),
        id: 'shield:A',
      }),
    { base: 'charge' },
  ],
  ['invalid fist family', (s) => editMelee(s, 'A', { grip: 'fist' }), {}],
  ['Mordhau missing numeric source', (s) => editMelee(s, 'A', { grip: 'mordhau' }), {}],
  [
    'unsupported grip',
    (s) =>
      setWeapon(
        editMelee(s, 'A', { grip: 'two-handed' }),
        'blade:A',
        meleeWeapon('A', { validGrips: ['one-handed'] }),
      ),
    {},
  ],
  [
    'called wide sweep',
    (s) => s,
    { base: 'called', calledLocation: 'Head', technique: 'wide-sweep' },
  ],
  ['called missing location', (s) => s, { base: 'called' }],
  ['selected zone on ordinary strike', (s) => s, { calledLocation: 'Head' }],
  ['free without trigger', (s) => s, { base: 'free' }],
  [
    'opportunity missing engagement',
    (s) => s,
    {
      base: 'free',
      origin: 'OPPORTUNITY',
      trigger: {
        id: 'x',
        type: 'leaves-melee',
        attacker: { actorId: 'B' },
        target: { actorId: 'A' },
        engaged: false,
      },
    },
  ],
  [
    'Counterattack missing opportunity',
    (s) => s,
    { base: 'free', origin: 'COUNTERATTACK', opportunityId: 'none' },
  ],
  [
    'Counterattack cannot recursively use technique',
    (s) => s,
    { base: 'free', origin: 'COUNTERATTACK', technique: 'wide-sweep' },
  ],
  ['invalid origin', (s) => s, { origin: 'REACTION' }],
  ['empty targets', (s) => s, { targets: [] }],
  [
    'repeated target',
    (s) => s,
    {
      technique: 'wide-sweep',
      targets: [
        { actor: { actorId: 'B' }, distance: 1 },
        { actor: { actorId: 'B' }, distance: 1 },
      ],
    },
  ],
  ['unknown target', (s) => s, { targets: [{ actor: { actorId: 'unknown' }, distance: 1 }] }],
  ['self target', (s) => s, { targets: [{ actor: { actorId: 'A' }, distance: 1 }] }],
  [
    'unavailable defender Reaction',
    (s) => ({
      ...s,
      session: {
        ...s.session,
        initiativeOrder: s.session.initiativeOrder.map((e) =>
          e.actor.actorId === 'B' ? { ...e, reactions: { ...e.reactions, remaining: 0 } } : e,
        ),
      },
    }),
    {
      targets: [
        {
          actor: { actorId: 'B' },
          distance: 1,
          avoidance: {
            id: 'D',
            type: 'dodge',
            context: emptyActionContext({ actorId: 'B' }),
            pool: 'normal',
          },
        },
      ],
    },
  ],
  [
    'extra Reaction not in Defensive',
    (s) => s,
    {
      targets: [
        {
          actor: { actorId: 'B' },
          distance: 1,
          avoidance: {
            id: 'D',
            type: 'dodge',
            context: emptyActionContext({ actorId: 'B' }),
            pool: 'melee-only',
          },
        },
      ],
    },
  ],
];
describe('B2 negative atomic validation', () => {
  it.each(attacks)('%s before RNG/resources', (_name, modify, changes) => {
    unchanged(modify(meleeState()), (s) =>
      resolveMeleeAttack(s, meleeAttack(changes), rolls(31, 31, 31, 31)),
    );
  });
  it('second ordinary attack permitted only by explicit effect', () => {
    let s = meleeState();
    s = {
      ...s,
      actors: {
        ...s.actors,
        A: {
          ...s.actors.A!,
          effects: [
            extraEffect('extra', 1, {
              target: { kind: 'permission', permission: 'attack' },
              operation: 'grant',
            }),
          ],
        },
      },
    };
    const one = resolveMeleeAttack(s, meleeAttack(), rolls(31));
    const two = resolveMeleeAttack(one.state, meleeAttack({ id: 'second' }), rolls(31));
    expect(two.state.session.turn!.flags).toHaveLength(2);
  });
  it('Parry without eligible weapon/effect rejected, effect grant permits weaponless', () => {
    const request: ParryRequest = {
      ...action('p', 'parry', 'B'),
      type: 'parry',
      pool: 'normal',
      incomingOrigin: 'NORMAL',
      triggeringResolutionId: 'incoming',
      target: { actorId: 'A' },
    };
    unchanged(meleeState(), (s) => resolveParry(s, request, 1, rolls(31, 31, 31, 31)));
    let s = meleeState();
    s = {
      ...s,
      actors: {
        ...s.actors,
        B: {
          ...s.actors.B!,
          effects: [
            extraEffect(
              'eligible',
              1,
              { target: { kind: 'permission', permission: 'parry' }, operation: 'grant' },
              'B',
            ),
          ],
        },
      },
    };
    expect(resolveParry(s, request, 1, rolls(31)).result.cancelledHits).toBe(1);
  });
  it('same trigger cannot grant second Counterattack', () => {
    const req: ParryRequest = {
      ...action('p', 'parry', 'B'),
      type: 'parry',
      pool: 'normal',
      incomingOrigin: 'NORMAL',
      triggeringResolutionId: 'incoming',
      target: { actorId: 'A' },
      weaponId: 'blade:B',
    };
    const r = resolveParry(
      editMelee(meleeState(), 'B', { stance: 'defensive' }),
      req,
      1,
      rolls(20),
    );
    unchanged(r.state, (s) =>
      resolveParry(s, { ...req, id: 'again', pool: 'melee-only' }, 1, rolls(20)),
    );
  });
  it('invalid extra Reaction cannot increment ranged pool', () => {
    const s = editMelee(meleeState(), 'B', { stance: 'defensive', meleeOnlyReactionRemaining: 0 });
    unchanged(s, (st) =>
      resolveMeleeDodge(st, action('d', 'dodge', 'B'), 'melee-only', rolls(31, 31, 31, 31)),
    );
  });
  it('Palisade ineligible weapon or shorter/equal reach relation rejected', () => {
    const req = meleeAttack({
      origin: 'PALISADE_TRIGGER',
      base: 'free',
      trigger: {
        id: 't',
        type: 'palisade',
        attacker: { actorId: 'B' },
        target: { actorId: 'A' },
        incomingReach: 3,
      },
    });
    const s = editMelee(
      setWeapon(meleeState(), 'blade:A', meleeWeapon('A', { family: 'spear' })),
      'A',
      { stance: 'palisade' },
    );
    unchanged(s, (st) => resolveMeleeAttack(st, req, rolls(31, 31, 31, 31)));
    unchanged(editMelee(meleeState(), 'A', { stance: 'palisade' }), (st) =>
      resolveMeleeAttack(
        st,
        { ...req, trigger: { ...req.trigger!, incomingReach: 1 } },
        rolls(31, 31, 31, 31),
      ),
    );
  });
  it('invalid simultaneous stance/grip change cannot partially change stance', () => {
    unchanged(meleeState(), (s) =>
      changeMeleeStanceGrip(s, {
        ...action('change', 'change-stance-grip'),
        type: 'change-stance-grip',
        stance: 'palisade',
        grip: 'two-handed',
      }),
    );
  });
  it('invalid Breakthrough negative/NaN or unordered path rejected', () => {
    for (const distance of [-1, NaN, 100])
      unchanged(meleeState(), (s) =>
        resolveBreakthrough(
          s,
          {
            ...action('break', 'breakthrough'),
            type: 'breakthrough',
            movementMode: 'charge',
            distance,
            pathSource: fixtureSource,
            opponents: [],
          },
          rolls(31, 31, 31, 31),
        ),
      );
  });
  it('Grappled participant cannot use Parry, Reaction, stance/grip or non-Grapple actions', () => {
    const s = grappleState();
    unchanged(s, (st) =>
      resolveCombatAction(st, action('move', 'half-move'), rolls(31, 31, 31, 31)),
    );
    unchanged(s, (st) =>
      changeMeleeStanceGrip(st, {
        ...action('change', 'change-stance-grip'),
        type: 'change-stance-grip',
        stance: 'defensive',
      }),
    );
    unchanged(s, (st) =>
      resolveMeleeDodge(st, action('d', 'dodge', 'B'), 'normal', rolls(31, 31, 31, 31)),
    );
  });
  it('Reverse follow-up cannot choose ordinary attack or victim-only action', () => {
    const r = resolveGrappleAction(
      onBTurn(grappleState()),
      grappleRequest('grapple-reverse', 'B'),
      rolls(20, 70),
    );
    unchanged(r.state, (s) =>
      resolveGrappleAction(
        s,
        grappleRequest('grapple-escape', 'B', { followupId: r.result.followupId! }),
        rolls(31, 31, 31, 31),
      ),
    );
  });
});
it('a triggering Parry resolution cannot grant a second Counterattack under another actor id', () => {
  const request: ParryRequest = {
    ...action('p', 'parry', 'B'),
    type: 'parry',
    pool: 'normal',
    incomingOrigin: 'NORMAL',
    triggeringResolutionId: 'Parry-resolution',
    target: { actorId: 'A' },
    weaponId: 'blade:B',
  };
  const first = resolveParry(meleeState(55), request, 1, rolls(31));
  unchanged(first.state, (s) =>
    resolveParry(
      s,
      { ...request, ...action('p2', 'parry', 'C'), weaponId: 'blade:C' },
      1,
      rolls(31),
    ),
  );
});
