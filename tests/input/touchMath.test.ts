import { describe, expect, it } from "vitest";
import {
  prefersTouchUi,
  stickSteerFromOffset,
  TOUCH_UI_MAX_WIDTH_PX,
} from "@/input/touchMath";

describe("stickSteerFromOffset", () => {
  it("returns 0 inside deadzone", () => {
    expect(stickSteerFromOffset(0, 56)).toBe(0);
    expect(stickSteerFromOffset(4, 56)).toBe(0);
  });

  it("maps full radius to ±1 after deadzone rescale", () => {
    expect(stickSteerFromOffset(56, 56)).toBeCloseTo(1, 5);
    expect(stickSteerFromOffset(-56, 56)).toBeCloseTo(-1, 5);
  });

  it("clamps beyond radius", () => {
    expect(stickSteerFromOffset(200, 56)).toBeCloseTo(1, 5);
  });

  it("returns 0 for degenerate radius", () => {
    expect(stickSteerFromOffset(10, 0)).toBe(0);
  });
});

describe("prefersTouchUi (RWD max-width)", () => {
  it("true when viewport is at or below breakpoint", () => {
    expect(
      prefersTouchUi((q) => ({
        matches: q.includes(`max-width: ${TOUCH_UI_MAX_WIDTH_PX}px`),
      })),
    ).toBe(true);
  });

  it("false when viewport is wider than breakpoint", () => {
    expect(prefersTouchUi(() => ({ matches: false }))).toBe(false);
  });

  it("false when matchMedia throws", () => {
    expect(
      prefersTouchUi(() => {
        throw new Error("no mq");
      }),
    ).toBe(false);
  });
});
