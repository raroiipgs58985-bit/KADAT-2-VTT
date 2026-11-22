import { describe, expect, it } from 'vitest';
import { mapProblems } from './map';
import { stage3Stand, stage3StandMap } from './scenarios';
import { moveActor, setDoorOpen, startCombat, turnInfo } from './engine';
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
    startCombat(closed, fixedDice(''));
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
    startCombat(open, fixedDice(''));
    moveActor(open, { id: 'b', actor: 'kelus-drakar', mode: 'half-move', to: { x: 9.5, y: 10.5 } });
    expect(turnInfo(open).od).toBe(1);
    expect(importReplay(JSON.parse(JSON.stringify(exportReplay(open)))).positions).toEqual(
      open.positions,
    );
  });
});
