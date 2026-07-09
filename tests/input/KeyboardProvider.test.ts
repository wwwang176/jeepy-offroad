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
    dispatch(type: string, event: Record<string, unknown>) {
      const e = {
        code: "",
        repeat: false,
        button: 0,
        pointerId: 1,
        movementX: 0,
        movementY: 0,
        preventDefault() {},
        ...event,
      };
      for (const fn of listeners.get(type) ?? []) {
        fn(e as unknown as Event);
      }
    },
  };
}

function createFakeCanvas() {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    tagName: "CANVAS",
    classList: { contains: () => false },
    closest: () => null,
    setPointerCapture() {},
    addEventListener(type: string, fn: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type: string, event: Record<string, unknown>) {
      const e = {
        button: 0,
        pointerId: 1,
        movementX: 0,
        movementY: 0,
        preventDefault() {},
        target: null as unknown,
        ...event,
      };
      e.target = e.target ?? this;
      for (const fn of listeners.get(type) ?? []) {
        fn(e as unknown as Event);
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

  it("defaults to 4H and toggles transfer case on Shift (no auto-repeat)", () => {
    const win = createFakeWindow();
    const provider = new KeyboardProvider(win as unknown as Window);

    expect(provider.sample().driveRange).toBe("H");

    win.dispatch("keydown", { code: "ShiftLeft", repeat: false });
    expect(provider.sample().driveRange).toBe("L");

    win.dispatch("keydown", { code: "ShiftLeft", repeat: true });
    expect(provider.sample().driveRange).toBe("L");

    win.dispatch("keydown", { code: "ShiftRight", repeat: false });
    expect(provider.sample().driveRange).toBe("H");

    provider.dispose();
  });

  it("accumulates left-drag look deltas from the canvas and clears on sample", () => {
    const win = createFakeWindow();
    const canvas = createFakeCanvas();
    const provider = new KeyboardProvider(
      win as unknown as Window,
      canvas as unknown as EventTarget,
    );

    canvas.dispatch("pointerdown", { button: 0, pointerId: 1 });
    win.dispatch("pointermove", {
      pointerId: 1,
      movementX: 12,
      movementY: -4,
    });
    win.dispatch("pointermove", {
      pointerId: 1,
      movementX: 3,
      movementY: 1,
    });

    const a = provider.sample();
    expect(a.lookDeltaX).toBe(15);
    expect(a.lookDeltaY).toBe(-3);

    const b = provider.sample();
    expect(b.lookDeltaX).toBe(0);
    expect(b.lookDeltaY).toBe(0);

    provider.dispose();
  });

  it("ignores look drag that starts on non-canvas targets", () => {
    const win = createFakeWindow();
    const provider = new KeyboardProvider(win as unknown as Window);

    win.dispatch("pointerdown", {
      button: 0,
      pointerId: 1,
      target: { tagName: "BUTTON", classList: { contains: () => false } },
    });
    win.dispatch("pointermove", {
      pointerId: 1,
      movementX: 40,
      movementY: 10,
    });

    const a = provider.sample();
    expect(a.lookDeltaX).toBe(0);
    expect(a.lookDeltaY).toBe(0);

    provider.dispose();
  });
});
