import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/levelgen/rng";

describe("mulberry32", () => {
  it("is deterministic for same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("differs for different seeds", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});
