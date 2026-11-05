import { describe, expect, it } from 'vitest';
import { actor, createBattle, deepFreeze, fixture, move } from './model';
import {
  attack,
  cancelUnstarted,
  getEngine,
  nextTurn,
  resumeAttack,
  selectManualOrder,
  type AttackCommand,
} from './engine';
import { fixedDice, seededDice } from './dice';
import { rulings } from './rulings';
const shot = (id = 'shot', modifier?: number): AttackCommand => ({
  id,
  actor: 'kelus-drakar',
  target: 'pak',
  weapon: 'hotshot',
  targetActivity: 'REST',
  defense: 'DECLINE',
  ...(modifier === undefined ? {} : { modifier }),
});

describe('Real accepted Core → personal effects → C-1 → C-2', () => {
  it.each([1, 4, 5, 9])('uses raw damage die %i with the author-approved Proven minimum', (raw) => {
    const b = createBattle();
    expect(attack(b, shot(), fixedDice(`100:45,10:${raw},100:10`)).status).toBe('RESOLVED');
    expect(b.hp.pak).toBe(33 - (Math.max(5, raw) - 3));
  });
  it('retains the normal damage maximum and exactly one critical consequence roll', () => {
    const b = createBattle();
    expect(attack(b, shot(), fixedDice('100:45,10:10,10:1')).status).toBe('RESOLVED');
    const target = getEngine(b).wounds.actors.pak!;
    expect(target.damageTaken).toBe(7);
    expect(target.injuries[0]!.severity).toBe(8);
    expect(target.blood.currentBlood).toBe(5);
  });
  it('keeps the accepted Core weapon/Actor templates and canonical fixture immutable', () => {
    const b = createBattle(),
      initial = getEngine(b),
      before = JSON.stringify(initial.wounds.combat.weapons.hotshot!.template);
    deepFreeze(initial.wounds.combat.weapons.hotshot!.template);
    deepFreeze(initial.wounds.combat.actors['kelus-drakar']!.characteristics);
    attack(b, shot(), fixedDice('100:45,10:2,100:20'));
    expect(JSON.stringify(getEngine(b).wounds.combat.weapons.hotshot!.template)).toBe(before);
    expect(actor('kelus-drakar').characteristics.НС.value).toBe(42);
  });
  it('resolves one real shot with reversed location, Proven floor, laser mastery and exact armor absorption', () => {
    const b = createBattle(),
      original = JSON.stringify(fixture);
    const result = attack(b, shot(), fixedDice('100:45,10:2,100:20'));
    expect(result.status).toBe('RESOLVED');
    expect(b.hp.pak).toBe(31); // raw 5+4+1=10; armor(7+Ceramite3)-BB6=4; bVN4 → 2
    expect(b.ammo.hotshot).toBe(249);
    const state = getEngine(b);
    expect(state.wounds.actors.pak!.damageTaken).toBe(2);
    expect(state.wounds.actors.pak!.injuries[0]).toMatchObject({
      location: 'Torso',
      finalDamage: 2,
      severity: 2,
    });
    expect(state.wounds.combat.session.turn!.od).toBe(1);
    expect(JSON.stringify(fixture)).toBe(original);
    expect(actor('pak').characteristics.СЛ.value).toBe(50);
    expect(JSON.stringify(b.log)).toContain('rawDamageDice');
  });
  it('spends ammunition on a real miss, with no fabricated damage roll', () => {
    const b = createBattle();
    expect(attack(b, shot(), fixedDice('100:90')).status).toBe('RESOLVED');
    expect(b.hp.pak).toBe(33);
    expect(b.ammo.hotshot).toBe(249);
  });
  it('preserves the accepted one-attack-per-turn limit', () => {
    const b = createBattle();
    attack(b, shot('one'), fixedDice('100:90'));
    expect(() => attack(b, shot('two'), fixedDice('100:90'))).toThrow('Second attack');
    expect(b.ammo.hotshot).toBe(249);
  });
  it('rejects a duplicate command without rolling or consuming ammo twice', () => {
    const b = createBattle();
    attack(b, shot(), fixedDice('100:90'));
    expect(() =>
      attack(b, shot(), {
        roll() {
          throw new Error('must not roll');
        },
      }),
    ).toThrow('уже исполнена');
    expect(b.ammo.hotshot).toBe(249);
  });
  it('saves a real d100 pending an absent damage die, then continues without rerolling it', () => {
    const b = createBattle();
    expect(attack(b, shot(), fixedDice('100:45')).status).toBe('CONTEXT_REQUIRED');
    expect(getEngine(b).pending!.prefix).toEqual([{ sides: 100, value: 45 }]);
    expect(b.ammo.hotshot).toBe(250);
    expect(b.hp.pak).toBe(33);
    expect(resumeAttack(b, fixedDice('10:2,100:20')).status).toBe('RESOLVED');
    expect(b.hp.pak).toBe(31);
    expect(b.ammo.hotshot).toBe(249);
  });
  it('does not silently ignore the 3+ success suppression trigger', () => {
    const b = createBattle();
    const result = attack(b, shot(), fixedDice('100:35'));
    expect(result.status).toBe('CONTEXT_REQUIRED');
    expect(getEngine(b).pending!.reason).toContain('подавления');
    expect(b.hp.pak).toBe(33);
    expect(b.ammo.hotshot).toBe(250);
  });
  it('uses the accepted target above 100 without clamping it, even at a pending boundary', () => {
    const b = createBattle();
    attack(b, shot('cap', 100), fixedDice('100:45'));
    const serialized = JSON.stringify(b.log);
    expect(serialized).toContain('"rawModifierSum":120');
    expect(serialized).toContain('"finalModifier":60');
    expect(serialized).toContain('"target":102');
  });
  it('does not roll initiative, permits manual initial order and preserves normal turn advancement', () => {
    const b = createBattle();
    selectManualOrder(b, 'pak');
    expect(getEngine(b).wounds.combat.session.initiativeOrder[0]!.actor.actorId).toBe('pak');
    nextTurn(b, fixedDice(''));
    expect(b.active).toBe('kelus-drakar');
  });
  it('allows a shot, then the real C-2 wound-aware next turn', () => {
    const b = createBattle();
    attack(b, shot(), fixedDice('100:45,10:9,100:20'));
    expect(nextTurn(b, fixedDice('100:20')).status).toBe('RESOLVED');
    expect(b.active).toBe('pak');
    expect(getEngine(b).wounds.combat.actors.pak!.effects.length).toBeGreaterThan(0);
  });
  it('keeps special locations pending instead of guessing helmet/eye protection', () => {
    const b = createBattle();
    attack(b, shot(), fixedDice('100:10'));
    expect(getEngine(b).pending!.reason).toMatch(/подавления|Eyes/);
    expect(b.hp.pak).toBe(33);
  });
  it('preserves the accepted source critical marker: one consequence d10 and no d10 added to damageTaken', () => {
    const b = createBattle();
    const resolved = attack(b, shot('critical', -100), fixedDice('100:4,10:10,10:4'));
    expect(resolved.status).toBe('RESOLVED');
    expect(getEngine(b).wounds.actors.pak!.damageTaken).toBe(6);
    expect(getEngine(b).wounds.actors.pak!.injuries[0]!.severity).toBe(10);
  });
  it('isolates unsupported fire effects; automatic Spray location is still explicitly Torso', () => {
    const b = createBattle();
    selectManualOrder(b, 'pak');
    expect(
      attack(
        b,
        {
          id: 'fire',
          actor: 'pak',
          target: 'kelus-drakar',
          weapon: 'bracer',
          targetActivity: 'REST',
          defense: 'DECLINE',
        },
        fixedDice(''),
      ).status,
    ).toBe('CONTEXT_REQUIRED');
    expect(b.ammo.bracer).toBe(10);
    expect(getEngine(b).pending!.reason).toContain('Torso');
    cancelUnstarted(b);
    expect(getEngine(b).pending).toBeUndefined();
  });
  it('does not permit cancelling saved attack dice for a free reroll', () => {
    const b = createBattle();
    attack(b, shot(), fixedDice('100:45'));
    expect(() => cancelUnstarted(b)).toThrow('Броски уже сохранены');
  });
  it('does not allow a different command to reuse a saved pending roll', () => {
    const b = createBattle();
    attack(b, shot('saved'), fixedDice('100:45'));
    expect(() =>
      attack(b, { ...shot('changed'), modifier: 60 }, fixedDice('10:2,100:20'), true),
    ).toThrow('Pending command differs');
    expect(b.hp.pak).toBe(33);
    expect(getEngine(b).pending!.prefix).toEqual([{ sides: 100, value: 45 }]);
  });
  it('retains the Pak sword personal damage, never adds Strength again, and checks real melee reach', () => {
    const b = createBattle();
    selectManualOrder(b, 'pak');
    expect(
      getEngine(b).wounds.combat.melee!.weapons['pak-chain']!.template.profile.damage.expression
        .modifier,
    ).toBe(10);
    const command: AttackCommand = {
      id: 'sword',
      actor: 'pak',
      target: 'kelus-drakar',
      weapon: 'pak-chain',
      targetActivity: 'REST',
      defense: 'DECLINE',
    };
    expect(() => attack(b, command, fixedDice(''))).toThrow('reach');
    move(b, 'pak', 5.75, 10);
    if (rulings.chainTiming === null) {
      expect(attack(b, command, fixedDice('100:25')).status).toBe('CONTEXT_REQUIRED');
      expect(getEngine(b).pending!.reason).toContain('порядок');
      expect(getEngine(b).pending!.prefix).toEqual([{ sides: 100, value: 25 }]);
      return;
    }
    const replacement = rulings.chainTiming === 'after' ? 5 : 4;
    const result = attack(b, command, fixedDice(`100:25,10:3,10:${replacement},100:20`));
    expect(result.status).toBe('RESOLVED');
    expect(b.hp['kelus-drakar']).toBe(16);
    expect(getEngine(b).armorLoss['kelus-drakar:Torso']).toBe(8);
    expect(getEngine(b).wounds.actors['kelus-drakar']!.bleeding[0]!.severity).toBe(
      replacement === 5 ? 'MEDIUM' : 'LIGHT',
    );
  });
  it('resolves Pak actual melee miss independently of chain armor timing', () => {
    const b = createBattle();
    selectManualOrder(b, 'pak');
    move(b, 'pak', 5.75, 10);
    expect(
      attack(
        b,
        {
          id: 'pak-miss',
          actor: 'pak',
          target: 'kelus-drakar',
          weapon: 'pak-chain',
          targetActivity: 'REST',
          defense: 'DECLINE',
        },
        fixedDice('100:90'),
      ).status,
    ).toBe('RESOLVED');
    expect(b.hp['kelus-drakar']).toBe(26);
    expect(getEngine(b).pending).toBeUndefined();
    expect(getEngine(b).wounds.combat.session.turn!.od).toBe(1);
  });
  it('resets the experiment by creating a fresh runtime, not by overwriting canonical actor data', () => {
    const b = createBattle();
    attack(b, shot(), fixedDice('100:45,10:2,100:20'));
    const reset = createBattle();
    expect(reset.hp.pak).toBe(33);
    expect(reset.ammo.hotshot).toBe(250);
    expect(getEngine(reset).committed).toEqual([]);
  });
});
describe('Explicit dice injection', () => {
  it('requires exact die kinds and never falls back to randomness', () => {
    expect(() => fixedDice('10:0')).toThrow();
    expect(() => fixedDice('100:45').roll(10)).toThrow();
  });
  it('repeats a seed deterministically and keeps every supported die within bounds', () => {
    const a = seededDice(12345),
      b = seededDice(12345);
    for (let i = 0; i < 300; i++) {
      const sides = [100, 10, 5][i % 3]!,
        v = a.roll(sides);
      expect(v).toBe(b.roll(sides));
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(sides);
    }
  });
});
