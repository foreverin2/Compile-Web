import { describe, it, expect, vi } from 'vitest';
import { gameBus } from '../../src/core/events/bus';

describe('gameBus singleton', () => {
  it('delivers emitted events to subscribers and unsubscribes', () => {
    const fn = vi.fn();
    const off = gameBus.subscribe(fn);
    gameBus.emit({ type: 'card:discarded', state: null as never, payload: { uid: 'x' } });
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ type: 'card:discarded' }));
    off();
    gameBus.emit({ type: 'card:discarded', state: null as never, payload: { uid: 'y' } });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
