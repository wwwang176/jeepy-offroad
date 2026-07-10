import type { Vec3 } from "@/shared/types";
import type { VehicleCapabilities } from "@/shared/vehicleCapabilities";
import { cellSize, gridToWorld, idx } from "@/shared/coords";
import { sampleBilinear } from "./heightmap";
import { assignPathHeights, fitPathToHeightmap } from "./path";
import {
  PATH_CUT_CAP_M,
  PATH_FILL_CAP_M,
  PATH_CORE_R_M,
  PATH_OUTER_R_M,
  PATH_SAFETY_FACTOR,
  type LevelData,
} from "./types";
import { validateLevel } from "./validate";

function ribbonHalfWidth(vehicle: VehicleCapabilities): number {
  return (vehicle.trackWidth + 2 * vehicle.pathClearance) / 2;
}

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

/**
 * Recompute path band from immutable base (no stack of nudges).
 * Caller should re-apply streams after this if needed.
 */
export function reconditionFromBase(
  level: LevelData,
  vehicle: VehicleCapabilities,
  attempt: number,
): { heightmap: Float32Array; path: Vec3[]; pathDesign: Vec3[] } {
  const base = level.baseHeightmap ?? level.heightmap;
  const hm = new Float32Array(base);
  const pathDesign = fitPathToHeightmap(
    level.pathPolyline,
    base,
    level.resolution,
    level.worldSize,
    vehicle,
  );
  // Slightly relax lifetime caps on later attempts (still absolute vs base)
  const fillCap = Math.min(2.5, PATH_FILL_CAP_M + Math.max(0, attempt - 1) * 0.35);
  const cutCap = Math.min(3.0, PATH_CUT_CAP_M + Math.max(0, attempt - 1) * 0.35);
  conditionTerrainFromBase(
    hm,
    base,
    level.resolution,
    level.worldSize,
    pathDesign,
    { fillCap, cutCap },
  );
  // Play path tracks conditioned surface (grade-legal + ground match)
  const path = fitPathToHeightmap(
    pathDesign,
    hm,
    level.resolution,
    level.worldSize,
    vehicle,
  );
  return { heightmap: hm, path, pathDesign };
}

/** @deprecated Prefer reconditionFromBase — kept for call-site compatibility. */
export function repairHeightmap(
  level: LevelData,
  vehicle: VehicleCapabilities,
  attempt: number,
): Float32Array {
  return reconditionFromBase(level, vehicle, attempt).heightmap;
}

/**
 * Refresh start/finish/checkpoint Y from the heightmap.
 * Path centerline Y is re-sampled then grade-clamped when `vehicle` is provided
 * (raw bilinear alone reintroduces undrivable slopes and triggers fallback).
 */
export function resyncPathHeights(
  level: LevelData,
  vehicle?: VehicleCapabilities,
): LevelData {
  const { heightmap, resolution, worldSize } = level;
  // Play path follows the *current* drive surface (conditioned + streams / fallback)
  let syncedPath = level.pathPolyline.map((p) => {
    const y = sampleBilinear(heightmap, resolution, worldSize, p.x, p.z);
    return {
      x: p.x,
      z: p.z,
      y: Number.isFinite(y) ? y : p.y,
    };
  });
  if (vehicle) {
    syncedPath = fitPathToHeightmap(
      syncedPath,
      heightmap,
      resolution,
      worldSize,
      vehicle,
    );
  }

  const startY = syncedPath[0]?.y ??
    sampleBilinear(
      heightmap,
      resolution,
      worldSize,
      level.start.position.x,
      level.start.position.z,
    );
  const finishY = syncedPath[syncedPath.length - 1]?.y ??
    sampleBilinear(
      heightmap,
      resolution,
      worldSize,
      level.finish.position.x,
      level.finish.position.z,
    );

  // Place checkpoints on the graded path polyline (XZ + Y), not a raw HM sample
  // that can drift off the meander or break grade.
  const totalLen = (() => {
    let len = 0;
    for (let i = 1; i < syncedPath.length; i++) {
      len += Math.hypot(
        syncedPath[i].x - syncedPath[i - 1].x,
        syncedPath[i].z - syncedPath[i - 1].z,
      );
    }
    return len;
  })();
  const cpCount = level.checkpoints.length;
  const checkpoints = level.checkpoints.map((cp, i) => {
    // Keep relative arc spacing: evenly re-sample along graded path if possible
    const t = cpCount <= 1 ? 0.5 : (i + 1) / (cpCount + 1);
    const dist = t * totalLen;
    let remain = dist;
    let pos = syncedPath[0] ?? cp.position;
    let yaw = 0;
    for (let j = 1; j < syncedPath.length; j++) {
      const a = syncedPath[j - 1];
      const b = syncedPath[j];
      const seg = Math.hypot(b.x - a.x, b.z - a.z) || 1e-6;
      if (remain <= seg) {
        const u = remain / seg;
        pos = {
          x: a.x + (b.x - a.x) * u,
          y: a.y + (b.y - a.y) * u,
          z: a.z + (b.z - a.z) * u,
        };
        yaw = Math.atan2(b.x - a.x, b.z - a.z);
        break;
      }
      remain -= seg;
      pos = b;
      yaw = Math.atan2(b.x - a.x, b.z - a.z);
    }
    return {
      ...cp,
      position: pos,
      yaw,
    };
  });

  let minH = Infinity;
  for (let i = 0; i < heightmap.length; i++) {
    if (heightmap[i] < minH) minH = heightmap[i];
  }

  return {
    ...level,
    pathPolyline: syncedPath,
    start: {
      ...level.start,
      position: {
        x: syncedPath[0]?.x ?? level.start.position.x,
        y: startY,
        z: syncedPath[0]?.z ?? level.start.position.z,
      },
    },
    finish: {
      ...level.finish,
      position: {
        x: syncedPath[syncedPath.length - 1]?.x ?? level.finish.position.x,
        y: finishY,
        z: syncedPath[syncedPath.length - 1]?.z ?? level.finish.position.z,
      },
    },
    checkpoints,
    killY: minH - 20,
  };
}

function isTestEnv(): boolean {
  try {
    // Vitest / Node test runners
    const env = (globalThis as { process?: { env?: Record<string, string> } })
      .process?.env;
    return !!(env && (env.VITEST || env.NODE_ENV === "test"));
  } catch {
    return false;
  }
}

/**
 * Extreme deterministic corridor: entire map is path-grade ribbon (smooth
 * constrained heights) with flat/low off-path shoulders, no streams.
 * Prefer always returning a valid level over throwing.
 */
function extremeFlattenCorridor(
  level: LevelData,
  vehicle: VehicleCapabilities,
  pass: number,
): LevelData {
  const res = level.resolution;
  const worldSize = level.worldSize;
  const half = ribbonHalfWidth(vehicle);
  const cell = cellSize(worldSize, res);
  // Expand ribbon each pass; later passes flatten more off-path toward path grade
  const widen = half + cell * (3 + pass * 2);
  const baseY = 10;
  let path = assignPathHeights(
    level.pathPolyline.map((p) => ({ x: p.x, y: baseY, z: p.z })),
    vehicle,
  );
  // Extra clamp for pass > 0: force near-flat path
  if (pass >= 1) {
    const maxGrade = Math.tan(vehicle.maxSlopeRad) * PATH_SAFETY_FACTOR * 0.5;
    const maxStep = vehicle.maxStepHeight * PATH_SAFETY_FACTOR * 0.5;
    for (let pi = 1; pi < path.length; pi++) {
      const a = path[pi - 1];
      const b = path[pi];
      const horiz = Math.hypot(b.x - a.x, b.z - a.z) || 1e-6;
      const maxDh = Math.min(maxStep, maxGrade * horiz);
      if (Math.abs(b.y - a.y) > maxDh) {
        b.y = a.y + Math.sign(b.y - a.y) * maxDh;
      }
    }
    path = assignPathHeights(path, vehicle);
  }
  if (pass >= 3) {
    // Perfectly flat path grade
    path = path.map((p) => ({ x: p.x, y: baseY, z: p.z }));
  }

  const hm = new Float32Array(res * res);
  for (let r = 0; r < res; r++) {
    for (let c = 0; c < res; c++) {
      const { x, z } = gridToWorld(c, r, worldSize, res);
      const d = distToPathXZ(x, z, path);
      const i = idx(res, c, r);
      const py = closestPathY(x, z, path);
      if (d <= widen) {
        hm[i] = py;
      } else if (pass >= 4) {
        // Hard max pass: entire map path-grade (full-map corridor)
        hm[i] = py;
      } else if (d <= widen + 20) {
        const t = 1 - (d - widen) / 20;
        const off = pass >= 2 ? py : py + Math.sin(x * 0.03) * (1 - t);
        hm[i] = py * t + off * (1 - t);
      } else {
        // Reduce off-path amplitude each pass
        const amp = Math.max(0, 2 - pass * 0.5);
        hm[i] = py * 0.3 + 8 * 0.7 + Math.sin(x * 0.05) * amp + Math.cos(z * 0.05) * amp;
      }
    }
  }

  return resyncPathHeights(
    {
      ...level,
      heightmap: hm,
      pathPolyline: path,
      streams: [],
      meta: {
        usedFallback: true,
        repairAttempts: level.meta.repairAttempts + 1,
      },
    },
    vehicle,
  );
}

/**
 * Force path ribbon cells to smooth constrained heights until validateLevel.ok.
 *
 * Contract:
 * - After the soft iterative loop, always re-validates.
 * - If still invalid, keeps flattening deterministically (raise path ribbon to
 *   smooth heights, reduce off-path) up to HARD_MAX_EXTREME (5) passes.
 * - Prefer always returning a valid level via extreme full-map path-grade
 *   ribbon corridor rather than throwing.
 * - Throws only in test env if still invalid after the ultimate corridor
 *   (should be unreachable if extreme flatten is correct).
 * Deterministic; pure (aside from test-env throw).
 */
export function flattenFallbackUntilValid(
  level: LevelData,
  vehicle: VehicleCapabilities,
  maxIters = 12,
): LevelData {
  /** Post-loop extreme flatten budget before ultimate full-map corridor. */
  const HARD_MAX_EXTREME = 5;

  let current = level;
  const res = current.resolution;
  const worldSize = current.worldSize;
  const half = ribbonHalfWidth(vehicle);
  const maxGrade = Math.tan(vehicle.maxSlopeRad) * PATH_SAFETY_FACTOR;
  const maxStep = vehicle.maxStepHeight * PATH_SAFETY_FACTOR;

  for (let iter = 0; iter < maxIters; iter++) {
    const v = validateLevel(current, vehicle);
    if (v.ok) return current;

    // Re-assign path heights tightly
    let path = assignPathHeights(
      current.pathPolyline.map((p) => ({ ...p })),
      vehicle,
    );

    // Flatten entire ribbon to constrained path Y; expand width each iter
    const widen = half + cellSize(worldSize, res) * (iter + 2);
    const hm = new Float32Array(current.heightmap);

    // First pass: set ribbon to path
    for (let r = 0; r < res; r++) {
      for (let c = 0; c < res; c++) {
        const { x, z } = gridToWorld(c, r, worldSize, res);
        const d = distToPathXZ(x, z, path);
        if (d <= widen) {
          hm[idx(res, c, r)] = closestPathY(x, z, path);
        } else if (d <= widen + 12) {
          // gentle blend toward flat base
          const base = closestPathY(x, z, path);
          const t = 1 - (d - widen) / 12;
          const i = idx(res, c, r);
          hm[i] = hm[i] * (1 - t * 0.7) + base * (t * 0.7);
        }
      }
    }

    // Smooth ribbon along path to satisfy wheel-track slope
    for (let pi = 1; pi < path.length; pi++) {
      const a = path[pi - 1];
      const b = path[pi];
      const horiz = Math.hypot(b.x - a.x, b.z - a.z) || 1e-6;
      const maxDh = Math.min(maxStep, maxGrade * horiz);
      if (Math.abs(b.y - a.y) > maxDh) {
        b.y = a.y + Math.sign(b.y - a.y) * maxDh;
      }
    }
    path = assignPathHeights(path, vehicle);

    // Re-apply path Y to ribbon after clamp
    for (let r = 0; r < res; r++) {
      for (let c = 0; c < res; c++) {
        const { x, z } = gridToWorld(c, r, worldSize, res);
        const d = distToPathXZ(x, z, path);
        if (d <= widen) {
          hm[idx(res, c, r)] = closestPathY(x, z, path);
        }
      }
    }

    // Remove deep streams on path: clear stream list if still failing stream checks
    const streams =
      iter >= 2
        ? current.streams.map((s) => ({
            ...s,
            width: Math.min(s.width, 2),
            depthOnPath: 0,
            polyline: s.polyline.map((p) => ({
              ...p,
              y: closestPathY(p.x, p.z, path),
            })),
          }))
        : current.streams;

    // On later iters drop streams entirely (still valid LevelData)
    const finalStreams = iter >= 5 ? [] : streams;

    current = resyncPathHeights(
      {
        ...current,
        heightmap: hm,
        pathPolyline: path,
        streams: finalStreams,
        meta: {
          usedFallback: true,
          repairAttempts: current.meta.repairAttempts + 1,
        },
      },
      vehicle,
    );
  }

  // Always re-validate after soft loop (including last soft mutation)
  let v = validateLevel(current, vehicle);
  if (v.ok) return current;

  // Deterministic escalating extreme flatten until ok or HARD_MAX_EXTREME
  for (let hard = 0; hard < HARD_MAX_EXTREME; hard++) {
    current = extremeFlattenCorridor(current, vehicle, hard);
    v = validateLevel(current, vehicle);
    if (v.ok) return current;
  }

  // Ultimate: full-map path-grade ribbon corridor (pass 4 flattens entire map)
  current = extremeFlattenCorridor(current, vehicle, 4);
  v = validateLevel(current, vehicle);
  if (v.ok) return current;

  // Prefer always-valid return; throw only in test env if still broken
  if (isTestEnv()) {
    throw new Error(
      `flattenFallbackUntilValid failed after extreme corridor: ${v.reasons.join("; ")}`,
    );
  }
  return current;
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

/**
 * Absolute path-band conditioning against immutable base terrain.
 *
 *   hm[i] = base[i] + clamp(pathY − base[i], −cutCap, +fillCap) × falloff(d)
 *
 * Lifetime-capped: recomputing always starts from base, so passes cannot
 * ratchet into an elevated embankment. Outside outerR, writes base height
 * (caller should start hm as a base copy, or only band cells are rewritten).
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

/**
 * @deprecated Use conditionTerrainFromBase with an explicit base heightmap.
 * Treats current heightmap as base (single absolute pass — no multi-stack).
 */
export function nudgeTerrainAlongPath(
  heightmap: Float32Array,
  resolution: number,
  worldSize: number,
  path: Vec3[],
  _opts?: unknown,
): void {
  const base = new Float32Array(heightmap);
  conditionTerrainFromBase(heightmap, base, resolution, worldSize, path);
}

/** @deprecated Alias → conditionTerrainFromBase. */
export function stampPathRibbon(
  heightmap: Float32Array,
  resolution: number,
  worldSize: number,
  path: Vec3[],
  _halfWidth: number,
  _blendOuter = 3.5,
): void {
  const base = new Float32Array(heightmap);
  conditionTerrainFromBase(heightmap, base, resolution, worldSize, path);
}

export function pathDistXZ(x: number, z: number, path: Vec3[]): number {
  return distToPathXZ(x, z, path);
}

export function pathClosestY(x: number, z: number, path: Vec3[]): number {
  return closestPathY(x, z, path);
}
