import type { Vec3 } from "@/shared/types";
import { gridToWorld, idx } from "@/shared/coords";
import {
  PATH_CUT_CAP_M,
  PATH_FILL_CAP_M,
  PATH_CORE_R_M,
  PATH_OUTER_R_M,
} from "./types";

function distToPathXZ(x: number, z: number, path: Vec3[]): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    let t = 0;
    if (len2 > 1e-12) {
      t = ((x - a.x) * abx + (z - a.z) * abz) / len2;
      t = Math.max(0, Math.min(1, t));
    }
    const cx = a.x + abx * t;
    const cz = a.z + abz * t;
    const d = Math.hypot(x - cx, z - cz);
    if (d < best) best = d;
  }
  return best;
}

function closestPathY(x: number, z: number, path: Vec3[]): number {
  let best = Infinity;
  let y = path[0]?.y ?? 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    let t = 0;
    if (len2 > 1e-12) {
      t = ((x - a.x) * abx + (z - a.z) * abz) / len2;
      t = Math.max(0, Math.min(1, t));
    }
    const cx = a.x + abx * t;
    const cz = a.z + abz * t;
    const d = Math.hypot(x - cx, z - cz);
    if (d < best) {
      best = d;
      y = a.y + (b.y - a.y) * t;
    }
  }
  return y;
}

function smoothstep01(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

export type ConditionFromBaseOpts = {
  fillCap?: number;
  cutCap?: number;
  coreR?: number;
  outerR?: number;
  /** Bounded Laplacian on Δ only; still clamped vs base. */
  smoothIters?: number;
};

export type StampPathRibbonOpts = {
  coreR?: number;
  outerR?: number;
};

/**
 * Blend heightmap toward path polyline Y (no lifetime cap vs base).
 * Prefer passing a **short corridor** (start/finish approach), not the whole
 * route — full-path stamps flatten mid-track drama into a grade highway.
 */
export function stampPathRibbon(
  heightmap: Float32Array,
  resolution: number,
  worldSize: number,
  path: Vec3[],
  opts?: StampPathRibbonOpts,
): void {
  if (!path || path.length < 2) return;
  const coreR = opts?.coreR ?? PATH_CORE_R_M;
  const outerR = opts?.outerR ?? PATH_OUTER_R_M;
  if (outerR <= 1e-6) return;
  const span = Math.max(1e-6, outerR - coreR);
  const res = resolution;

  for (let r = 0; r < res; r++) {
    for (let c = 0; c < res; c++) {
      const { x, z } = gridToWorld(c, r, worldSize, res);
      const d = distToPathXZ(x, z, path);
      if (d >= outerR) continue;
      let fall = 1;
      if (d > coreR) {
        fall = smoothstep01(1 - (d - coreR) / span);
      }
      if (fall <= 1e-6) continue;
      const pathY = closestPathY(x, z, path);
      const i = idx(res, c, r);
      heightmap[i] = heightmap[i]! * (1 - fall) + pathY * fall;
    }
  }
}

/**
 * Absolute path-band conditioning against immutable base terrain.
 *
 *   hm[i] = base[i] + clamp(pathY − base[i], −cutCap, +fillCap) × falloff(d)
 *
 * Lifetime-capped vs base (no multi-pass ratchet). Outside outerR unchanged.
 */
export function conditionTerrainFromBase(
  heightmap: Float32Array,
  base: Float32Array,
  resolution: number,
  worldSize: number,
  path: Vec3[],
  opts?: ConditionFromBaseOpts,
): void {
  if (!path || path.length < 2) return;
  if (base.length !== heightmap.length) return;

  const fillCap = opts?.fillCap ?? PATH_FILL_CAP_M;
  const cutCap = opts?.cutCap ?? PATH_CUT_CAP_M;
  const coreR = opts?.coreR ?? PATH_CORE_R_M;
  const outerR = opts?.outerR ?? PATH_OUTER_R_M;
  const smoothIters = opts?.smoothIters ?? 2;
  if (outerR <= 1e-6 || (fillCap <= 0 && cutCap <= 0)) return;

  const res = resolution;
  const n = res * res;
  const delta = new Float32Array(n);
  const next = new Float32Array(n);
  const band = new Uint8Array(n);
  const span = Math.max(1e-6, outerR - coreR);

  for (let r = 0; r < res; r++) {
    for (let c = 0; c < res; c++) {
      const { x, z } = gridToWorld(c, r, worldSize, res);
      const d = distToPathXZ(x, z, path);
      if (d >= outerR) continue;
      const i = idx(res, c, r);
      band[i] = 1;
      let fall = 1;
      if (d > coreR) {
        fall = smoothstep01(1 - (d - coreR) / span);
      }
      const pathY = closestPathY(x, z, path);
      let want = pathY - base[i];
      if (want > fillCap) want = fillCap;
      if (want < -cutCap) want = -cutCap;
      delta[i] = want * fall;
    }
  }

  // Light neighbor coupling on Δ (drag shoulders); re-clamp after
  const blend = 0.45;
  for (let iter = 0; iter < smoothIters; iter++) {
    for (let r = 0; r < res; r++) {
      for (let c = 0; c < res; c++) {
        const i = idx(res, c, r);
        if (!band[i]) {
          next[i] = 0;
          continue;
        }
        let sum = 0;
        let cnt = 0;
        if (c > 0) {
          sum += delta[i - 1];
          cnt++;
        }
        if (c < res - 1) {
          sum += delta[i + 1];
          cnt++;
        }
        if (r > 0) {
          sum += delta[i - res];
          cnt++;
        }
        if (r < res - 1) {
          sum += delta[i + res];
          cnt++;
        }
        const avg = cnt > 0 ? sum / cnt : delta[i];
        next[i] = delta[i] * (1 - blend) + avg * blend;
      }
    }
    delta.set(next);
  }

  for (let i = 0; i < n; i++) {
    if (!band[i]) continue;
    let dlt = delta[i];
    if (dlt > fillCap) dlt = fillCap;
    if (dlt < -cutCap) dlt = -cutCap;
    heightmap[i] = base[i] + dlt;
  }
}

export function pathDistXZ(x: number, z: number, path: Vec3[]): number {
  return distToPathXZ(x, z, path);
}

export function pathClosestY(x: number, z: number, path: Vec3[]): number {
  return closestPathY(x, z, path);
}
