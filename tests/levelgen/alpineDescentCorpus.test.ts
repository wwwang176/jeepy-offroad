import { describe, expect, it } from "vitest";
import { alpineBiome } from "@/biome/profiles/alpine";
import { sandBiome } from "@/biome/profiles/sand";
import { generateLevel } from "@/levelgen/generateLevel";
import { PATH_SAFETY_FACTOR } from "@/levelgen/types";
import { VEHICLE_CAPABILITIES } from "@/shared/vehicleCapabilities";

/** Fixed corpus — CI floors per plan (product goal is higher; tighten after playtest). */
const ALPINE_CORPUS = [
  1, 2, 3, 7, 11, 42, 99, 100, 256, 777, 1024, 2026, 5000, 9999, 12345, 44444,
  88888, 100000, 314159, 929210958,
];

/** Continuous-grade budget used by assignPathHeights (includes 0.88 headroom). */
function pathGradeBudget(): number {
  return (
    Math.tan(VEHICLE_CAPABILITIES.maxSlopeRad) * PATH_SAFETY_FACTOR * 0.88
  );
}

function pathNetDrop(path: { y: number }[]): number {
  if (path.length < 2) return 0;
  return path[0]!.y - path[path.length - 1]!.y;
}

/**
 * Max |grade| on path segments away from start/finish pads.
 * Pad flatten can rewrite endpoint Y and create steeper edge segments.
 */
function maxMidPathGrade(
  path: { x: number; y: number; z: number }[],
  padSkipM = 8,
): number {
  if (path.length < 3) return 0;
  const s = path[0]!;
  const e = path[path.length - 1]!;
  let maxG = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const midX = (a.x + b.x) * 0.5;
    const midZ = (a.z + b.z) * 0.5;
    if (Math.hypot(midX - s.x, midZ - s.z) < padSkipM) continue;
    if (Math.hypot(midX - e.x, midZ - e.z) < padSkipM) continue;
    const horiz = Math.hypot(b.x - a.x, b.z - a.z) || 1e-6;
    const g = Math.abs(b.y - a.y) / horiz;
    if (g > maxG) maxG = g;
  }
  return maxG;
}

describe("alpine descent corpus", () => {
  it("CI floors: mean netDrop ≥ 12, ≥70% seeds ≥ 10, mid-path grade within budget", () => {
    const budget = pathGradeBudget();
    const drops: number[] = [];
    for (const seed of ALPINE_CORPUS) {
      const level = generateLevel({
        seed,
        biome: alpineBiome,
        vehicle: VEHICLE_CAPABILITIES,
      });
      const path = level.pathPolyline;
      const drop = pathNetDrop(path);
      drops.push(drop);
      expect(
        maxMidPathGrade(path),
        `mid-path grade seed ${seed}`,
      ).toBeLessThanOrEqual(budget + 1e-3);
      expect(path.length).toBeGreaterThan(10);
    }
    const mean = drops.reduce((a, b) => a + b, 0) / drops.length;
    const ge10 = drops.filter((d) => d >= 10).length;
    expect(
      mean,
      `mean netDrop=${mean.toFixed(2)} drops=${drops.map((d) => d.toFixed(1)).join(",")}`,
    ).toBeGreaterThanOrEqual(12);
    expect(ge10 / drops.length).toBeGreaterThanOrEqual(0.7);
  });

  it("sand mean netDrop is not alpine-class (baseline observation)", () => {
    const alpineDrops: number[] = [];
    const sandDrops: number[] = [];
    for (const seed of ALPINE_CORPUS.slice(0, 10)) {
      alpineDrops.push(
        pathNetDrop(
          generateLevel({
            seed,
            biome: alpineBiome,
            vehicle: VEHICLE_CAPABILITIES,
          }).pathPolyline,
        ),
      );
      sandDrops.push(
        pathNetDrop(
          generateLevel({
            seed,
            biome: sandBiome,
            vehicle: VEHICLE_CAPABILITIES,
          }).pathPolyline,
        ),
      );
    }
    const aMean = alpineDrops.reduce((a, b) => a + b, 0) / alpineDrops.length;
    const sMean = sandDrops.reduce((a, b) => a + b, 0) / sandDrops.length;
    expect(aMean).toBeGreaterThan(sMean + 5);
  });

  it("reproduces alpine layout for a fixed seed", () => {
    const input = {
      seed: 42,
      biome: alpineBiome,
      vehicle: VEHICLE_CAPABILITIES,
    };
    const a = generateLevel(input);
    const b = generateLevel(input);
    expect(a.pathPolyline).toEqual(b.pathPolyline);
    expect(a.start).toEqual(b.start);
    expect(a.finish).toEqual(b.finish);
  });
});
