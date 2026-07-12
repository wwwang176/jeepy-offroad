import { describe, expect, it } from "vitest";
import {
  BIOME_SLOTS,
  biomeFromSeed,
  biomeSeedIndex,
  embedBiomeInSeed,
  getBiome,
  listBiomes,
  listBiomeSeedOrder,
  RANDOM_BIOME_ID,
  resolveBiomeId,
  resolveStart,
} from "@/biome/registry";

describe("biome registry", () => {
  it("lists sand, rainforest, and alpine", () => {
    const ids = listBiomes().map((b) => b.id).sort();
    expect(ids).toEqual(["alpine", "rainforest", "sand"]);
  });

  it("seed order is stable and slots are fixed", () => {
    expect(BIOME_SLOTS).toBe(16);
    expect([...listBiomeSeedOrder()]).toEqual([
      "sand",
      "rainforest",
      "alpine",
    ]);
    expect(biomeSeedIndex("sand")).toBe(0);
    expect(biomeSeedIndex("rainforest")).toBe(1);
    expect(biomeSeedIndex("alpine")).toBe(2);
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
    expect(a.weather?.kind).toBe("snow");
    expect(a.lighting?.sunColor.toLowerCase()).toMatch(/eef4ff|#eef4ff/i);
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

  it("rainforest weather is rain; sand has no weather", () => {
    expect(getBiome("rainforest").weather?.kind).toBe("rain");
    expect(getBiome("sand").weather).toBeUndefined();
  });

  it("embed/decode round-trips biome in seed residue", () => {
    for (const id of listBiomeSeedOrder()) {
      const packed = embedBiomeInSeed(123456789, id);
      expect(packed % BIOME_SLOTS).toBe(biomeSeedIndex(id));
      expect(biomeFromSeed(packed)).toBe(id);
      // High bits preserved
      expect(Math.floor(packed / BIOME_SLOTS)).toBe(
        Math.floor(123456789 / BIOME_SLOTS),
      );
    }
  });

  it("reserved slots fall back to sand until claimed", () => {
    // residue 5 is unassigned (only 0..2 claimed)
    expect(5 % BIOME_SLOTS).toBe(5);
    expect(biomeFromSeed(5)).toBe("sand");
  });

  it("resolveStart packs explicit biome into seed", () => {
    const { biomeId, seed } = resolveStart("alpine", 100);
    expect(biomeId).toBe("alpine");
    expect(biomeFromSeed(seed)).toBe("alpine");
    expect(seed % BIOME_SLOTS).toBe(2);
  });

  it("resolveStart random + empty picks fairly and embeds", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const { biomeId, seed } = resolveStart(RANDOM_BIOME_ID, i * 17 + 3, {
        seedWasEmpty: true,
      });
      seen.add(biomeId);
      expect(biomeFromSeed(seed)).toBe(biomeId);
    }
    expect(seen.size).toBe(listBiomeSeedOrder().length);
  });

  it("resolveStart random + typed seed decodes biome from number", () => {
    const alpineSeed = embedBiomeInSeed(999, "alpine");
    const { biomeId, seed } = resolveStart(RANDOM_BIOME_ID, alpineSeed, {
      seedWasEmpty: false,
    });
    expect(biomeId).toBe("alpine");
    expect(biomeFromSeed(seed)).toBe("alpine");
  });

  it("resolveBiomeId random is deterministic via BIOME_SLOTS", () => {
    const a = resolveBiomeId(RANDOM_BIOME_ID, 42);
    const b = resolveBiomeId(RANDOM_BIOME_ID, 42);
    expect(a).toBe(b);
    expect(a).toBe(biomeFromSeed(42));
  });

  it("resolveBiomeId keeps explicit selection", () => {
    expect(resolveBiomeId("rainforest", 999)).toBe("rainforest");
    expect(resolveBiomeId("sand", 0)).toBe("sand");
    expect(resolveBiomeId("alpine", 1)).toBe("alpine");
  });
});
