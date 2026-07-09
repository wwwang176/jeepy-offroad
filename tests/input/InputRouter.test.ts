import { describe, expect, it } from "vitest";
import { InputRouter } from "@/input/InputRouter";
import type { InputProvider } from "@/input/types";

describe("InputRouter", () => {
  it("forwards provider sample", () => {
    const provider: InputProvider = {
      sample: () => ({
        throttle: 1,
        steer: -0.5,
        brake: 0,
        driveRange: "H" as const,
        cameraToggle: false,
        respawn: false,
        lookDeltaX: 0,
        lookDeltaY: 0,
      }),
      dispose: () => {},
    };
    const router = new InputRouter(provider);
    expect(router.sample().throttle).toBe(1);
    expect(router.sample().steer).toBe(-0.5);
  });
});
