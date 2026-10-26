import { describe, it, expect } from 'vitest';
import { createInteriorLightActivation } from './interiorLightActivation';

function harness() {
  let time = 0, id = 0;
  const queue = new Map();
  const controller = createInteriorLightActivation({ now: () => time,
    request: cb => { queue.set(++id, cb); return id; }, cancel: key => queue.delete(key) });
  return { controller, queue, advance(ms) { time += ms; const pending = [...queue.values()]; queue.clear(); pending.forEach(cb => cb(time)); } };
}
const environment = (nightMode, fullNight = nightMode, reducedMotion = false) => ({ nightMode, fullNight, reducedMotion });

describe('full-night interior activation', () => {
  it('waits for full night and all GPU contexts, then uses a 1.2-second smooth ramp', () => {
    const h = harness(), a = { ready: true }, b = { ready: false };
    h.controller.register(a); h.controller.register(b);
    h.controller.setEnvironment(environment(true, false)); h.advance(8000);
    expect(h.controller.getGain()).toBe(0);
    h.controller.setEnvironment(environment(true)); h.advance(4000);
    expect(h.controller.getGain()).toBe(0);
    b.ready = true; h.controller.resourceChanged();
    h.advance(600); expect(h.controller.getGain()).toBeCloseTo(.5);
    h.advance(600); expect(h.controller.getGain()).toBe(1); expect(h.queue.size).toBe(0);
  });
  it('reverses during activation without a jump and resumes from the current intensity', () => {
    const h = harness(); h.controller.register({ ready: true }); h.controller.setEnvironment(environment(true));
    h.advance(600); const gain = h.controller.getGain();
    h.controller.setEnvironment(environment(false)); expect(h.controller.getGain()).toBe(gain);
    h.advance(120); expect(h.controller.getGain()).toBeCloseTo(.352);
    h.controller.setEnvironment(environment(true)); expect(h.controller.getGain()).toBeCloseTo(.352);
    h.advance(720); expect(h.controller.getGain()).toBe(1);
    h.controller.setEnvironment(environment(false)); h.advance(1200); expect(h.controller.getGain()).toBe(0);
  });
  it('preserves lit panels on floor changes and does not restart on equivalent state updates', () => {
    const h = harness(); h.controller.register({ ready: true }); h.controller.setEnvironment(environment(true));
    h.advance(600); h.controller.setEnvironment(environment(true)); h.advance(600);
    expect(h.controller.getGain()).toBe(1);
    const remove = h.controller.register({ ready: false }); expect(h.controller.getGain()).toBe(1);
    remove(); expect(h.queue.size).toBe(0);
  });
  it('handles rapid toggles with one RAF; unsubscribes and disposes cleanly', () => {
    const h = harness(); h.controller.register({ ready: true }); let frames = 0;
    const unsubscribe = h.controller.subscribe(() => frames++);
    for (let i = 0; i < 20; i++) { h.controller.setEnvironment(environment(Boolean(i % 2))); h.advance(37); expect(h.queue.size).toBeLessThanOrEqual(1); }
    unsubscribe(); const previous = frames; h.advance(100); expect(frames).toBe(previous);
    h.controller.dispose(); h.advance(2000); h.controller.resourceChanged();
    expect(h.queue.size).toBe(0); expect(h.controller.getGain()).toBe(0);
    // React StrictMode may reconnect effects on the same controller.
    h.controller.register({ ready: true }); h.controller.setEnvironment(environment(true, true, true));
    expect(h.controller.getGain()).toBe(1);
  });
  it('reduced motion still waits for resources, then settles without scheduling animation', () => {
    const h = harness(), resource = { ready: false }; h.controller.register(resource);
    h.controller.setEnvironment(environment(true, true, true)); expect(h.controller.getGain()).toBe(0);
    resource.ready = true; h.controller.resourceChanged(); expect(h.controller.getGain()).toBe(1);
    h.controller.setEnvironment(environment(false, false, true)); expect(h.controller.getGain()).toBe(0);
    expect(h.queue.size).toBe(0);
  });
  it('does not flash lights when delayed resources finish after a Day request', () => {
    const h = harness(), resource = { ready: false }; h.controller.register(resource);
    h.controller.setEnvironment(environment(true)); h.advance(2000);
    h.controller.setEnvironment(environment(false)); resource.ready = true; h.controller.resourceChanged();
    h.advance(2000); expect(h.controller.getGain()).toBe(0); expect(h.queue.size).toBe(0);
    h.controller.setEnvironment(environment(true, false)); h.advance(8000); expect(h.controller.getGain()).toBe(0);
    h.controller.setEnvironment(environment(true)); h.advance(1200); expect(h.controller.getGain()).toBe(1);
  });
});
