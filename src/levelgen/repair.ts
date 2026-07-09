import type { Vec3 } from "@/shared/types";
import type { VehicleCapabilities } from "@/shared/vehicleCapabilities";
import { cellSize, gridToWorld, idx } from "@/shared/coords";
import { sampleBilinear } from "./heightmap";
import { assignPathHeights } from "./path";
import { PATH_SAFETY_FACTOR, type LevelData } from "./types";
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

/** Flatten peaks, raise troughs, widen ribbon, damp off-path near path. */
export function repairHeightmap(
  level: LevelData,
  vehicle: VehicleCapabilities,
  attempt: number,
): Float32Array {
  const hm = new Float32Array(level.heightmap);
  const res = level.resolution;
  const worldSize = level.worldSize;
  const path = level.pathPolyline;
  const half = ribbonHalfWidth(vehicle);
  // Widen by ~1 cell per attempt
  const cell = cellSize(worldSize, res);
  const widen = half + cell * attempt;
  const maxStep = vehicle.maxStepHeight * PATH_SAFETY_FACTOR;

  for (let r = 0; r < res; r++) {
    for (let c = 0; c < res; c++) {
      const { x, z } = gridToWorld(c, r, worldSize, res);
      const d = distToPathXZ(x, z, path);
      const i = idx(res, c, r);
      if (d <= widen) {
        const target = closestPathY(x, z, path);
        // Blend toward path height (stronger with more attempts)
        const t = Math.min(1, 0.55 + attempt * 0.08);
        hm[i] = hm[i] * (1 - t) + target * t;
        // Clamp residual deviation
        const maxDev = maxStep * (1.1 - attempt * 0.05);
        if (hm[i] > target + maxDev) hm[i] = target + maxDev;
        if (hm[i] < target - maxDev) hm[i] = target - maxDev;
      } else if (d <= widen + 8) {
        // Damp off-path noise near path
        const target = closestPathY(x, z, path);
        const fall = 1 - (d - widen) / 8;
        const damp = 0.35 * fall * Math.min(1, attempt / 3);
        hm[i] = hm[i] * (1 - damp) + target * damp;
      }
    }
  }
  return hm;
}

/** Set path/start/checkpoint/finish Y from bilinear sample of heightmap. */
export function resyncPathHeights(level: LevelData): LevelData {
  const { heightmap, resolution, worldSize } = level;
  const syncedPath = level.pathPolyline.map((p) => {
    const y = sampleBilinear(heightmap, resolution, worldSize, p.x, p.z);
    return {
      x: p.x,
      z: p.z,
      y: Number.isFinite(y) ? y : p.y,
    };
  });

  const startY = sampleBilinear(
    heightmap,
    resolution,
    worldSize,
    level.start.position.x,
    level.start.position.z,
  );
  const finishY = sampleBilinear(
    heightmap,
    resolution,
    worldSize,
    level.finish.position.x,
    level.finish.position.z,
  );

  const checkpoints = level.checkpoints.map((cp) => ({
    ...cp,
    position: {
      ...cp.position,
      y: sampleBilinear(
        heightmap,
        resolution,
        worldSize,
        cp.position.x,
        cp.position.z,
      ),
    },
  }));

  let minH = Infinity;
  for (let i = 0; i < heightmap.length; i++) {
    if (heightmap[i] < minH) minH = heightmap[i];
  }

  return {
    ...level,
    pathPolyline: syncedPath,
    start: {
      ...level.start,
      position: { ...level.start.position, y: startY },
    },
    finish: {
      ...level.finish,
      position: { ...level.finish.position, y: finishY },
    },
    checkpoints,
    killY: minH - 20,
  };
}

/**
 * Force path ribbon cells to smooth constrained heights until validateLevel.ok.
 * Deterministic; pure.
 */
export function flattenFallbackUntilValid(
  level: LevelData,
  vehicle: VehicleCapabilities,
  maxIters = 12,
): LevelData {
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
            polyline: s.polyline.map((p) => ({
              ...p,
              y: closestPathY(p.x, p.z, path),
            })),
          }))
        : current.streams;

    // On later iters drop streams entirely (still valid LevelData)
    const finalStreams = iter >= 5 ? [] : streams;

    current = resyncPathHeights({
      ...current,
      heightmap: hm,
      pathPolyline: path,
      streams: finalStreams,
      meta: {
        usedFallback: true,
        repairAttempts: current.meta.repairAttempts + 1,
      },
    });
  }

  // Absolute last resort: perfectly flat ribbon corridor
  const path = assignPathHeights(
    current.pathPolyline.map((p) => ({ x: p.x, y: 10, z: p.z })),
    vehicle,
  );
  const hm = new Float32Array(res * res);
  hm.fill(8);
  const widen = half + cellSize(worldSize, res) * 3;
  for (let r = 0; r < res; r++) {
    for (let c = 0; c < res; c++) {
      const { x, z } = gridToWorld(c, r, worldSize, res);
      const d = distToPathXZ(x, z, path);
      if (d <= widen) {
        hm[idx(res, c, r)] = closestPathY(x, z, path);
      } else {
        // mild hills far away
        hm[idx(res, c, r)] = 8 + Math.sin(x * 0.05) * 2 + Math.cos(z * 0.05) * 2;
      }
    }
  }

  return resyncPathHeights({
    ...current,
    heightmap: hm,
    pathPolyline: path,
    streams: [],
    meta: {
      usedFallback: true,
      repairAttempts: current.meta.repairAttempts + 1,
    },
  });
}

/** Utility used by generate/carve to stamp a path ribbon into a heightmap. */
export function stampPathRibbon(
  heightmap: Float32Array,
  resolution: number,
  worldSize: number,
  path: Vec3[],
  halfWidth: number,
  blendOuter = 2,
): void {
  const res = resolution;
  for (let r = 0; r < res; r++) {
    for (let c = 0; c < res; c++) {
      const { x, z } = gridToWorld(c, r, worldSize, res);
      const d = distToPathXZ(x, z, path);
      const i = idx(res, c, r);
      if (d <= halfWidth) {
        heightmap[i] = closestPathY(x, z, path);
      } else if (d <= halfWidth + blendOuter) {
        const t = 1 - (d - halfWidth) / blendOuter;
        const target = closestPathY(x, z, path);
        heightmap[i] = heightmap[i] * (1 - t) + target * t;
      }
    }
  }
}

export function pathDistXZ(x: number, z: number, path: Vec3[]): number {
  return distToPathXZ(x, z, path);
}

export function pathClosestY(x: number, z: number, path: Vec3[]): number {
  return closestPathY(x, z, path);
}
