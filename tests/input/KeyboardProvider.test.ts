import { describe, expect, it } from "vitest";
import { KeyboardProvider } from "@/input/KeyboardProvider";

/** Minimal EventTarget-like window stub for node tests. */
function createFakeWindow() {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    addEventListener(type: string, fn: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type: string, event: Partial<KeyboardEvent>) {
      const e = {
        code: "",
        repeat: false,
        ...event,
      } as KeyboardEvent;
      for (const fn of listeners.get(type) ?? []) {
        fn(e);
      }
    },
  };
}

describe("KeyboardProvider", () => {
  it("ignores keydown auto-repeat for camera and respawn edges", () => {
    const win = createFakeWindow();
    const provider = new KeyboardProvider(win as unknown as Window);

    win.dispatch("keydown", { code: "KeyC", repeat: false });
    expect(provider.sample().cameraToggle).toBe(true);
    expect(provider.sample().cameraToggle).toBe(false);

    win.dispatch("keydown", { code: "KeyC", repeat: true });
    expect(provider.sample().cameraToggle).toBe(false);

    win.dispatch("keydown", { code: "KeyR", repeat: false });
    expect(provider.sample().respawn).toBe(true);
    win.dispatch("keydown", { code: "KeyR", repeat: true });
    expect(provider.sample().respawn).toBe(false);

    provider.dispose();
  });

  it("maps W+S to brake and S alone to reverse", () => {
    const win = createFakeWindow();
    const provider = new KeyboardProvider(win as unknown as Window);

    win.dispatch("keydown", { code: "KeyW", repeat: false });
    win.dispatch("keydown", { code: "KeyS", repeat: false });
    let a = provider.sample();
    expect(a.throttle).toBe(0);
    expect(a.brake).toBe(1);

    win.dispatch("keyup", { code: "KeyW" });
    a = provider.sample();
    expect(a.throttle).toBe(-1);
    expect(a.brake).toBe(0);

    provider.dispose();
  });
});
