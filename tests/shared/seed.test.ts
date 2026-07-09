import { describe, expect, it } from "vitest";
import { normalizeSeed, parseSeedInput } from "@/shared/seed";

describe("seed", () => {
  it("normalizeSeed forces uint32", () => {
    expect(normalizeSeed(-1)).toBe(0xffffffff);
    expect(normalizeSeed(42.9)).toBe(42);
  });

  it("parseSeedInput empty => random uint32 in range", () => {
    const s = parseSeedInput("");
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(0xffffffff);
  });

  it("parseSeedInput parses valid integer", () => {
    expect(parseSeedInput("42")).toBe(42);
  });

  it("parseSeedInput rejects non-integer string", () => {
    expect(() => parseSeedInput("abc")).toThrow();
  });
});
