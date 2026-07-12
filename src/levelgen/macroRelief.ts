import type { BiomeMacroRelief } from "@/biome/types";
import type { Vec3 } from "@/shared/types";
import { gridToWorld, idx } from "@/shared/coords";
import { clamp } from "@/shared/math";

/**
 * Macro height sample along start→finish chord.
 * u=0 at start → +dropM/2; u=1 at finish → −dropM/2.
 */
export function macroHeightAt(
  x: number,
  z: number,
  start: Pick<Vec3, "x" | "z">,
  end: Pick<Vec3, "x" | "z">,
  dropM: number,
): number {
  if (!(dropM > 0) || !Number.isFinite(dropM)) return 0;
  const cx = end.x - start.x;
  const cz = end.z - start.z;
  const len2 = cx * cx + cz * cz;
  if (len2 < 1e-8) return 0;
  const u = clamp(
    ((x - start.x) * cx + (z - start.z) * cz) / len2,
    0,
    1,
  );
  return dropM * (0.5 - u);
}

/**
 * Add planar high→low ramp to heightmap (mutates `hm`).
 * Deterministic; does not consume RNG.
 */
export function applyMacroRelief(
  hm: Float32Array,
  resolution: number,
  mapSize: number,
  start: Pick<Vec3, "x" | "z">,
  end: Pick<Vec3, "x" | "z">,
  relief: BiomeMacroRelief,
): void {
  const dropM = relief.startToFinishDropM;
  if (!(dropM > 0) || !Number.isFinite(dropM)) return;

  for (let r = 0; r < resolution; r++) {
    for (let c = 0; c < resolution; c++) {
      const { x, z } = gridToWorld(c, r, mapSize, resolution);
      const i = idx(resolution, c, r);
      hm[i] += macroHeightAt(x, z, start, end, dropM);
    }
  }
}
