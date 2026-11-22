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
  const required = (weapon.pattern?.profile.reload ?? weapon.template.profile.reload).odCost;
  integer(required, 'reload OD cost', 1);
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
