import type {
  ActionRequest,
  ActionResolution,
  CombatActionState,
  WeaponInstance,
} from '@kadat/contracts';
import { scopedContext } from './action-context.js';
import { actionLog, definition, spendResources } from './action-resources.js';
import { integer } from './validation.js';

/** Any movement of the owner takes a heavy weapon off its support (author ruling 41). */
export function clearBraces(state: CombatActionState, actorId: string): CombatActionState {
  const braced = Object.values(state.weapons).filter(
    (w) => w.owner.actorId === actorId && w.braced,
  );
  if (!braced.length) return state;
  return {
    ...state,
    weapons: {
      ...state.weapons,
      ...Object.fromEntries(braced.map((w) => [w.id, { ...w, braced: false }])),
    },
  };
}

function ownWeapon(state: CombatActionState, request: ActionRequest, weaponId: string) {
  const weapon = state.weapons[weaponId];
  if (!weapon || weapon.owner.actorId !== request.actor.actorId || !weapon.readied)
    throw new Error('Invalid actor/selected weapon');
  return weapon;
}

export interface BraceWeaponRequest extends ActionRequest {
  readonly type: 'brace-weapon';
  readonly weaponId: string;
  /** Mounted (СТ) weapon on a wheeled carriage: 2 ОД instead of 1. */
  readonly wheeledCarriage?: boolean;
}
/** «Бой» A55: set a heavy weapon on a support — 1 ОД, a wheeled carriage 2 ОД. */
export function braceWeapon(
  state: CombatActionState,
  request: BraceWeaponRequest,
): ActionResolution<{ readonly braced: true }> {
  if (request.type !== 'brace-weapon') throw new Error('Invalid brace request');
  const weapon = ownWeapon(state, request, request.weaponId);
  if (weapon.braced) throw new Error('Weapon is already braced');
  const context = scopedContext(state, request.actor, request.context, [], ['action:brace-weapon']);
  const action = definition('brace-weapon', request.wheeledCarriage ? 2 : 1);
  const spent = spendResources(state, request, action, context, 'own-turn');
  const next = {
    ...spent.state,
    weapons: { ...spent.state.weapons, [weapon.id]: { ...weapon, braced: true } },
  };
  const execution = {
    ...spent.execution,
    mutations: [
      ...spent.execution.mutations,
      { type: 'brace', path: `weapons.${weapon.id}.braced`, before: false, after: true },
    ],
  };
  return {
    state: next,
    execution,
    result: { braced: true },
    logs: [actionLog(state, execution)],
  };
}

/** Talents (author ruling 81, «Таланты (обновлены)» стр. 27–28). */
export const QUICK_DRAW_TALENT = 'Быстрое выхватывание';
export const RAPID_RELOAD_TALENT = 'Быстрая перезарядка';
const hasTalent = (state: CombatActionState, actorId: string, name: string) =>
  (state.actors[actorId]?.talents ?? []).includes(name);

export interface ReadyWeaponRequest extends ActionRequest {
  readonly type: 'ready-weapon';
  readonly weaponId: string;
}
/**
 * Change weapons (ruling 81): put away what is in hand and take `weaponId` — 1 ОД, or the turn's
 * Free Action with «Быстрое выхватывание». Ranged and melee weapons of the owner are both
 * covered; only the chosen one is in hand afterwards.
 */
export function readyWeapon(
  state: CombatActionState,
  request: ReadyWeaponRequest,
): ActionResolution<{ readonly weaponId: string; readonly free: boolean }> {
  if (request.type !== 'ready-weapon') throw new Error('Invalid ready-weapon request');
  const actorId = request.actor.actorId;
  const ranged = state.weapons[request.weaponId];
  const melee = state.melee?.weapons[request.weaponId];
  if ((!ranged && !melee) || (ranged ?? melee)!.owner.actorId !== actorId)
    throw new Error('Invalid actor/selected weapon');
  if (melee?.template.profile.family === 'natural')
    throw new Error('Invalid actor/selected weapon');
  const free = hasTalent(state, actorId, QUICK_DRAW_TALENT);
  const context = scopedContext(state, request.actor, request.context, [], ['action:ready-weapon']);
  const action = free ? definition('free-action', 0) : definition('ready-weapon', 1);
  const spent = spendResources(state, request, action, context, 'own-turn');
  const next = putInHand(spent.state, actorId, request.weaponId);
  const execution = {
    ...spent.execution,
    mutations: [
      ...spent.execution.mutations,
      {
        type: 'ready-weapon',
        path: `actors.${actorId}.inHand`,
        before: null,
        after: request.weaponId,
      },
    ],
  };
  return {
    state: next,
    execution,
    result: { weaponId: request.weaponId, free },
    logs: [actionLog(state, execution)],
  };
}
/** The owner holds only `weaponId` (null — empty hands); used by actions and before the fight. */
export function putInHand(
  state: CombatActionState,
  actorId: string,
  weaponId: string | null,
): CombatActionState {
  const weapons = Object.fromEntries(
    Object.values(state.weapons)
      .filter((w) => w.owner.actorId === actorId)
      .map((w) => [w.id, { ...w, readied: w.id === weaponId, braced: false }]),
  );
  const melee = state.melee;
  if (!melee) return { ...state, weapons: { ...state.weapons, ...weapons } };
  const meleeWeapons = Object.fromEntries(
    Object.values(melee.weapons)
      .filter((w) => w.owner.actorId === actorId && w.template.profile.family !== 'natural')
      .map((w) => [
        w.id,
        {
          ...w,
          held: w.id === weaponId,
          readied: w.id === weaponId,
          dropped: w.id === weaponId ? false : w.dropped,
        },
      ]),
  );
  const actor = melee.actors[actorId];
  return {
    ...state,
    weapons: { ...state.weapons, ...weapons },
    melee: {
      ...melee,
      weapons: { ...melee.weapons, ...meleeWeapons },
      actors:
        actor && weaponId && meleeWeapons[weaponId]
          ? { ...melee.actors, [actorId]: { ...actor, weaponId } }
          : melee.actors,
    },
  };
}

export interface DropWeaponRequest extends ActionRequest {
  readonly type: 'drop-weapon';
  readonly weaponId: string;
}
/** Drop the weapon in hand on the floor — the turn's Free Action, not putting it away (81). */
export function dropWeapon(
  state: CombatActionState,
  request: DropWeaponRequest,
): ActionResolution<{ readonly weaponId: string }> {
  if (request.type !== 'drop-weapon') throw new Error('Invalid drop-weapon request');
  const actorId = request.actor.actorId;
  const ranged = state.weapons[request.weaponId];
  const melee = state.melee?.weapons[request.weaponId];
  const inHand = ranged ? ranged.readied : melee ? melee.held : false;
  if ((!ranged && !melee) || (ranged ?? melee)!.owner.actorId !== actorId || !inHand)
    throw new Error('Weapon is not in hand');
  const context = scopedContext(state, request.actor, request.context, [], ['action:drop-weapon']);
  const spent = spendResources(state, request, definition('free-action', 0), context, 'own-turn');
  let next = spent.state;
  if (ranged)
    next = {
      ...next,
      weapons: { ...next.weapons, [ranged.id]: { ...ranged, readied: false, braced: false } },
    };
  if (melee && next.melee)
    next = {
      ...next,
      melee: {
        ...next.melee,
        weapons: {
          ...next.melee.weapons,
          [melee.id]: { ...melee, held: false, readied: false, dropped: true },
        },
      },
    };
  const execution = {
    ...spent.execution,
    mutations: [
      ...spent.execution.mutations,
      { type: 'drop-weapon', path: `weapons.${request.weaponId}`, before: true, after: false },
    ],
  };
  return {
    state: next,
    execution,
    result: { weaponId: request.weaponId },
    logs: [actionLog(state, execution)],
  };
}

export interface ReloadRequest extends ActionRequest {
  readonly type: 'reload';
  readonly weaponId: string;
  readonly containerId: string;
}
export interface ReloadResult {
  readonly odSpent: number;
  readonly odRequired: number;
  readonly progress: number;
  readonly loaded: boolean;
}
/**
 * «Бой» A55: reload — the OD cost comes from the weapon profile. A reload longer than the OD
 * left this turn spends what is left and continues on a later turn with the same container.
 */
export function reloadWeapon(
  state: CombatActionState,
  request: ReloadRequest,
): ActionResolution<ReloadResult> {
  if (request.type !== 'reload') throw new Error('Invalid reload request');
  const weapon = ownWeapon(state, request, request.weaponId);
  const container = state.containers[request.containerId];
  if (
    !container ||
    container.state !== 'ready' ||
    container.currentRounds <= 0 ||
    !container.compatibleWeaponTemplateIds.includes(weapon.template.id)
  )
    throw new Error('Incompatible or empty ammunition container');
  if (weapon.loadedContainerId === container.id) throw new Error('Container is already loaded');
  const base = (weapon.pattern?.profile.reload ?? weapon.template.profile.reload).odCost;
  integer(base, 'reload OD cost', 1);
  // «Быстрая перезарядка»: 1 ОД faster; a 1-ОД reload becomes the Free Action (ruling 81).
  const required = hasTalent(state, request.actor.actorId, RAPID_RELOAD_TALENT) ? base - 1 : base;
  if (required === 0) {
    const context = scopedContext(state, request.actor, request.context, [], ['action:reload']);
    const spent = spendResources(state, request, definition('free-action', 0), context, 'own-turn');
    const loaded = { ...weapon, loadedContainerId: container.id };
    delete (loaded as { reloadProgress?: unknown }).reloadProgress;
    const next = { ...spent.state, weapons: { ...spent.state.weapons, [weapon.id]: loaded } };
    const execution = {
      ...spent.execution,
      mutations: [
        ...spent.execution.mutations,
        { type: 'reload', path: `weapons.${weapon.id}`, before: weapon, after: loaded },
      ],
    };
    return {
      state: next,
      execution,
      result: { odSpent: 0, odRequired: 0, progress: 0, loaded: true },
      logs: [actionLog(state, execution)],
    };
  }
  const progress =
    weapon.reloadProgress?.containerId === container.id ? weapon.reloadProgress.odSpent : 0;
  const available = state.session.turn?.od ?? 0;
  const spend = Math.min(required - progress, available);
  if (spend <= 0) throw new Error('Insufficient OD');
  const context = scopedContext(state, request.actor, request.context, [], ['action:reload']);
  const spent = spendResources(state, request, definition('reload', spend), context, 'own-turn');
  const done = progress + spend >= required;
  let nextWeapon: WeaponInstance;
  if (done) {
    const loaded = { ...weapon, loadedContainerId: container.id };
    delete (loaded as { reloadProgress?: unknown }).reloadProgress;
    nextWeapon = loaded;
  } else
    nextWeapon = {
      ...weapon,
      reloadProgress: { containerId: container.id, odSpent: progress + spend },
    };
  const next = { ...spent.state, weapons: { ...spent.state.weapons, [weapon.id]: nextWeapon } };
  const execution = {
    ...spent.execution,
    mutations: [
      ...spent.execution.mutations,
      { type: 'reload', path: `weapons.${weapon.id}`, before: weapon, after: nextWeapon },
    ],
  };
  return {
    state: next,
    execution,
    result: { odSpent: spend, odRequired: required, progress: progress + spend, loaded: done },
    logs: [actionLog(state, execution)],
  };
}

/**
 * Overpenetration («Раны и лечение» A2–A3, author ruling 38, as the sheet example): on entry the
 * armour is lowered by ББ; exit damage = damage − max(0, entry ОБ − ББ) − бВН − exit ОБ; the ББ
 * left after entry, max(0, ББ − entry ОБ), carries on. Example: 12 − 0 − 3 − 2 = 7, ББ 0.
 */
export function resolveOverpenetration(input: {
  readonly damage: number;
  readonly penetration: number;
  readonly entryArmor: number;
  readonly exitArmor: number;
  readonly bVN: number;
}): { readonly exitDamage: number; readonly remainingPenetration: number } {
  for (const [key, value] of Object.entries(input)) integer(value, `overpenetration ${key}`, 0);
  return {
    exitDamage: Math.max(
      0,
      input.damage -
        Math.max(0, input.entryArmor - input.penetration) -
        input.bVN -
        input.exitArmor,
    ),
    remainingPenetration: Math.max(0, input.penetration - input.entryArmor),
  };
}
