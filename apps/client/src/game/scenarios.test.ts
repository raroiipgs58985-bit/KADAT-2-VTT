import { describe, expect, it } from 'vitest';
import { mapProblems } from './map';
import { stage3Stand, stage3StandMap } from './scenarios';
import {
  attack,
  attackLineProblem,
  moveActor,
  nextTurn,
  RuleDecisionRequired,
  setDoorOpen,
  startCombat,
  turnInfo,
} from './engine';
import { exportReplay, importReplay } from './replay';
import { fixedDice } from './dice';

describe('Stage 3 test stand', () => {
  it('is a valid map with a closed door, crates and mud, tokens in setup', () => {
    expect(mapProblems(stage3StandMap())).toEqual([]);
    const b = stage3Stand();
    expect(turnInfo(b).started).toBe(false);
    expect(b.doors).toEqual({ 'west-door': false });
    expect(b.positions['kelus-drakar']).toEqual({ x: 6.5, y: 10.5 });
  });

  it('supports the manual checklist: closed door refuses, open door lets through', () => {
    const closed = stage3Stand();
    startCombat(closed, fixedDice('10:9,10:2'));
    expect(() =>
      moveActor(closed, {
        id: 'a',
        actor: 'kelus-drakar',
        mode: 'half-move',
        to: { x: 9.5, y: 10.5 },
      }),
    ).toThrow(/закрытая дверь/);
    expect(turnInfo(closed).od).toBe(2);

    const open = stage3Stand();
    setDoorOpen(open, 'west-door', true);
    startCombat(open, fixedDice('10:9,10:2'));
    moveActor(open, { id: 'b', actor: 'kelus-drakar', mode: 'half-move', to: { x: 9.5, y: 10.5 } });
    expect(turnInfo(open).od).toBe(1);
    expect(importReplay(JSON.parse(JSON.stringify(exportReplay(open)))).positions).toEqual(
      open.positions,
    );
  });
});

describe('Attacks and the stage 3 stand walls', () => {
  it('an attack through the closed room stops for the author before any dice', () => {
    const b = stage3Stand();
    startCombat(b, fixedDice('10:9,10:2'));
    const active = turnInfo(b).active;
    const target = active === 'kelus-drakar' ? 'pak' : 'kelus-drakar';
    expect(attackLineProblem(b, active, target)).toMatch(/стена|закрытая дверь/);
    const before = b.log.length;
    expect(() =>
      attack(
        b,
        {
          id: 'shot',
          actor: active,
          target,
          weapon: active === 'kelus-drakar' ? 'hotshot' : 'pak-chain',
          targetActivity: 'REST',
          modifier: 0,
          defense: 'DECLINE',
        },
        fixedDice(''),
      ),
    ).toThrow(RuleDecisionRequired);
    expect(b.log.length).toBe(before + 1);
    expect(b.log.at(-1)!.detail).toMatchObject({ committed: false, authorDecisionRequired: true });
    expect(turnInfo(b).od).toBe(2);
    // The refusal is a journal step: the replay still converges.
    expect(importReplay(JSON.parse(JSON.stringify(exportReplay(b)))).log.length).toBe(b.log.length);
  });

  it('crates do not block the line; open door with a clear line does not stop', () => {
    const b = stage3Stand();
    expect(attackLineProblem(b, 'kelus-drakar', 'pak')).not.toBeNull();
    b.positions.pak = { x: 6.5, y: 4.5 }; // north of Kelus, outside the room
    expect(attackLineProblem(b, 'kelus-drakar', 'pak')).toBeNull();
  });

  it('a point out of reach is refused as too far, not as an author question', () => {
    const b = stage3Stand();
    startCombat(b, fixedDice('10:9,10:2'));
    if (turnInfo(b).active !== 'kelus-drakar') nextTurn(b, fixedDice(''));
    expect(() =>
      moveActor(b, {
        id: 'far',
        actor: 'kelus-drakar',
        mode: 'full-move',
        to: { x: 4.5, y: 18.5 },
      }),
    ).toThrow(/больше допустимой/);
  });
});
