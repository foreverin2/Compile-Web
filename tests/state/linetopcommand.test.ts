import { describe, it, expect } from 'vitest';
import { lineTopCommandActive } from '../../src/core/state/create';
import { makeCard, draftFireP1 } from '../helpers';

describe('lineTopCommandActive (darkness-2 line-wide top command condition)', () => {
  it('true when a face-up darkness-2 sits in P1 stack of the line', () => {
    const s = draftFireP1();
    s.players[0].stacks[0] = [makeCard('darkness-2', 0, 'field', true, 0, 0)];
    expect(lineTopCommandActive(s, 0, 'darkness-2')).toBe(true);
  });

  it('true when a face-up darkness-2 sits in P2 stack of the line', () => {
    const s = draftFireP1();
    s.players[1].stacks[0] = [makeCard('darkness-2', 1, 'field', true, 0, 0)];
    expect(lineTopCommandActive(s, 0, 'darkness-2')).toBe(true);
  });

  it('true while the face-up darkness-2 is covered (top command persists under cover)', () => {
    const s = draftFireP1();
    s.players[0].stacks[0] = [
      makeCard('darkness-2', 0, 'field', true, 0, 0),
      makeCard('fire-5', 0, 'field', true, 0, 1),
    ];
    expect(lineTopCommandActive(s, 0, 'darkness-2')).toBe(true);
  });

  it('false when only a face-down darkness-2 exists (face-down cards have no effects)', () => {
    const s = draftFireP1();
    s.players[0].stacks[0] = [makeCard('darkness-2', 0, 'field', false, 0, 0)];
    expect(lineTopCommandActive(s, 0, 'darkness-2')).toBe(false);
  });

  it('false when the line has no darkness-2 at all', () => {
    const s = draftFireP1();
    s.players[0].stacks[0] = [makeCard('fire-5', 0, 'field', true, 0, 0)];
    expect(lineTopCommandActive(s, 0, 'darkness-2')).toBe(false);
  });

  it('false on other lines even when line 0 is active', () => {
    const s = draftFireP1();
    s.players[0].stacks[0] = [makeCard('darkness-2', 0, 'field', true, 0, 0)];
    expect(lineTopCommandActive(s, 1, 'darkness-2')).toBe(false);
    expect(lineTopCommandActive(s, 2, 'darkness-2')).toBe(false);
  });
});
