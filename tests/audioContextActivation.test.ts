import assert from "node:assert/strict";
import test from "node:test";

import {
  getAudioContextActivationState,
  registerAudioContext,
  resumeRegisteredAudioContexts,
  subscribeToAudioContextActivation,
} from "../src/utils/audioContextActivation.ts";

class FakeAudioContext {
  state: AudioContextState = "suspended";
  allowResume = false;
  resumeCalls = 0;
  private readonly stateListeners = new Set<EventListener>();

  addEventListener(_type: string, listener: EventListener): void {
    this.stateListeners.add(listener);
  }

  removeEventListener(_type: string, listener: EventListener): void {
    this.stateListeners.delete(listener);
  }

  async resume(): Promise<void> {
    this.resumeCalls += 1;
    if (!this.allowResume) throw new Error("User gesture required");
    this.state = "running";
    this.stateListeners.forEach((listener) => listener(new Event("statechange")));
  }
}

test("resumes every registered audio context from an explicit activation", async () => {
  const first = new FakeAudioContext();
  const second = new FakeAudioContext();
  let notifications = 0;
  const unsubscribe = subscribeToAudioContextActivation(() => {
    notifications += 1;
  });
  const unregisterFirst = registerAudioContext(first as unknown as AudioContext);
  const unregisterSecond = registerAudioContext(second as unknown as AudioContext);

  await Promise.resolve();
  assert.equal(getAudioContextActivationState(), "suspended");
  assert.equal(first.resumeCalls, 1);
  assert.equal(second.resumeCalls, 1);

  first.allowResume = true;
  second.allowResume = true;
  resumeRegisteredAudioContexts();
  await Promise.resolve();

  assert.equal(getAudioContextActivationState(), "running");
  assert.equal(first.resumeCalls, 2);
  assert.equal(second.resumeCalls, 2);
  assert.ok(notifications >= 4);

  unregisterFirst();
  unregisterSecond();
  unsubscribe();
  assert.equal(getAudioContextActivationState(), "idle");
});
