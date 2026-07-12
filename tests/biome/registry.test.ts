import { describe, expect, it } from "vitest";
import {
  getBiome,
  listBiomes,
  RANDOM_BIOME_ID,
  resolveBiomeId,
} from "@/biome/registry";

describe("biome registry", () => {
  it("lists sand, rainforest, and alpine", () => {
    const ids = listBiomes().map((b) => b.id).sort();
    expect(ids).toEqual(["alpine", "rainforest", "sand"]);
  });

  it("sand is Sand with arid palette", () => {
    const sand = getBiome("sand");
    expect(sand.displayName).toBe("Sand");
    expect(sand.groundPalette.mid.toLowerCase()).toMatch(/a89880|#a89880/i);
  });

  it("sand traction is icy; rainforest uses baseline grip", () => {
    const sand = getBiome("sand");
    expect(sand.traction?.frictionSlipScale ?? 1).toBeLessThan(0.6);
    expect(sand.traction?.sideFrictionScale ?? 1).toBeLessThan(0.55);
    const rf = getBiome("rainforest");
    expect(rf.traction).toBeUndefined();
  });

  it("rainforest has green palette, palms, and ground cover", () => {
    const rf = getBiome("rainforest");
    expect(rf.displayName).toBe("Rainforest");
    expect(rf.propCountScale ?? 1).toBeGreaterThan(1);
    expect(rf.groundCoverCountScale ?? 0).toBeGreaterThan(0);
    expect(
      rf.propTable.some((p) => p.meshKey === "coconut_palm"),
    ).toBe(true);
    // Mid green should be greener than sand mid
    expect(rf.groundPalette.mid).not.toBe(getBiome("sand").groundPalette.mid);
  });

  it("alpine is cold rock with macro descent and no warm vegetation", () => {
    const a = getBiome("alpine");
    expect(a.displayName).toBe("Alpine");
    expect(a.macroRelief?.startToFinishDropM).toBeGreaterThanOrEqual(100);
    expect(a.snowCover).toBeDefined();
    expect(a.snowCover!.peakThicknessM).toBeGreaterThan(0);
    expect(a.snowCover!.thickCount).toBeGreaterThan(0);
    expect(a.streamDensity).toBeLessThanOrEqual(0.15);
    expect(a.traction?.frictionSlipScale ?? 1).toBeLessThan(0.6);
    expect(
      a.propTable.every(
        (p) => p.meshKey === "rock_pile" || p.meshKey === "pillar_rock",
      ),
    ).toBe(true);
    expect(a.propTable.some((p) => p.meshKey === "cactus")).toBe(false);
    expect(a.propTable.some((p) => p.meshKey === "coconut_palm")).toBe(false);
  });

  it("resolveBiomeId random is deterministic and covers all biomes", () => {
    const a = resolveBiomeId(RANDOM_BIOME_ID, 42);
    const b = resolveBiomeId(RANDOM_BIOME_ID, 42);
    expect(a).toBe(b);
    const ids = listBiomes().map((b) => b.id);
    expect(ids).toContain(a);
    // seed % n covers every registered id
    const set = new Set(
      ids.map((_, i) => resolveBiomeId(RANDOM_BIOME_ID, i)),
    );
    expect(set.size).toBe(ids.length);
    for (const id of ids) expect(set.has(id)).toBe(true);
  });

  it("resolveBiomeId keeps explicit selection", () => {
    expect(resolveBiomeId("rainforest", 999)).toBe("rainforest");
    expect(resolveBiomeId("sand", 0)).toBe("sand");
    expect(resolveBiomeId("alpine", 1)).toBe("alpine");
  });
});
