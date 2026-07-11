import { describe, expect, it } from "vitest";
import { InputRouter, maxAbs, mergeProviderSamples } from "@/input/InputRouter";
import type { InputProvider, ProviderSample } from "@/input/types";

function stub(partial: Partial<ProviderSample>): InputProvider {
  const base: ProviderSample = {
    throttle: 0,
    steer: 0,
    brake: 0,
    rangeToggle: false,
    cameraToggle: false,
    respawn: false,
    lookDeltaX: 0,
    lookDeltaY: 0,
  };
  return {
    sample: () => ({ ...base, ...partial }),
    dispose: () => {},
  };
}

describe("mergeProviderSamples / maxAbs", () => {
  it("maxAbs prefers larger magnitude while keeping sign", () => {
    expect(maxAbs(0.2, -0.8)).toBe(-0.8);
    expect(maxAbs(-0.3, 0.3)).toBe(-0.3);
    expect(maxAbs(0, 0.5)).toBe(0.5);
  });

  it("merges axes with max-abs and ORs edges", () => {
    const m = mergeProviderSamples([
      {
        throttle: 0.4,
        steer: -0.2,
        brake: 0.1,
        rangeToggle: false,
        cameraToggle: true,
        respawn: false,
        lookDeltaX: 2,
        lookDeltaY: 0,
      },
      {
        throttle: -0.9,
        steer: 0.5,
        brake: 0,
        rangeToggle: true,
        cameraToggle: false,
        respawn: true,
        lookDeltaX: 1,
        lookDeltaY: -3,
      },
    ]);
    expect(m.throttle).toBe(-0.9);
    expect(m.steer).toBe(0.5);
    expect(m.brake).toBe(0.1);
    expect(m.rangeToggle).toBe(true);
    expect(m.cameraToggle).toBe(true);
    expect(m.respawn).toBe(true);
    expect(m.lookDeltaX).toBe(3);
    expect(m.lookDeltaY).toBe(-3);
  });
});

describe("InputRouter", () => {
  it("forwards a single provider and owns driveRange state", () => {
    const router = new InputRouter(
      stub({ throttle: 1, steer: -0.5, rangeToggle: false }),
    );
    expect(router.getDriveRange()).toBe("H");
    const a = router.sample();
    expect(a.throttle).toBe(1);
    expect(a.steer).toBe(-0.5);
    expect(a.driveRange).toBe("H");
  });

  it("toggles transfer case from any provider edge once", () => {
    let toggle = false;
    const kb: InputProvider = {
      sample: () => ({
        throttle: 0,
        steer: 0,
        brake: 0,
        rangeToggle: toggle,
        cameraToggle: false,
        respawn: false,
        lookDeltaX: 0,
        lookDeltaY: 0,
      }),
      dispose: () => {},
    };
    const touch = stub({});
    const router = new InputRouter([kb, touch]);

    expect(router.sample().driveRange).toBe("H");
    toggle = true;
    expect(router.sample().driveRange).toBe("L");
    toggle = false;
    expect(router.sample().driveRange).toBe("L");
    toggle = true;
    expect(router.sample().driveRange).toBe("H");
  });

  it("max-abs merges keyboard + touch axes", () => {
    const router = new InputRouter([
      stub({ throttle: 0.2, steer: -1 }),
      stub({ throttle: 1, steer: 0.3 }),
    ]);
    const a = router.sample();
    expect(a.throttle).toBe(1);
    expect(a.steer).toBe(-1);
  });

  it("ORs rangeToggle so two edges in one frame only flip once", () => {
    const router = new InputRouter([
      stub({ rangeToggle: true }),
      stub({ rangeToggle: true }),
    ]);
    // Both true → OR → single toggle (not double flip back to H)
    expect(router.sample().driveRange).toBe("L");
  });

  it("dispose calls every provider", () => {
    let n = 0;
    const p = (): InputProvider => ({
      sample: () => ({
        throttle: 0,
        steer: 0,
        brake: 0,
        rangeToggle: false,
        cameraToggle: false,
        respawn: false,
        lookDeltaX: 0,
        lookDeltaY: 0,
      }),
      dispose: () => {
        n++;
      },
    });
    new InputRouter([p(), p()]).dispose();
    expect(n).toBe(2);
  });
});
