import { describe, it, expect } from 'vitest';
import { createBus } from '../../src/core/events/bus';

describe('event bus', () => {
  it('delivers events to subscribers', () => {
    const bus = createBus();
    const seen: string[] = [];
    bus.subscribe((e) => seen.push(e.type));
    bus.emit({ type: 'x', state: null as never });
    expect(seen).toEqual(['x']);
  });

  it('unsubscribes', () => {
    const bus = createBus();
    let count = 0;
    const off = bus.subscribe(() => count++);
    off();
    bus.emit({ type: 'x', state: null as never });
    expect(count).toBe(0);
  });
});
