import { clamp } from "./math";
import { pathProximity } from "./terrainColor";

/** Decorative snow blanket (visual only — no collider). */
export type SnowCoverConfig = {
  /** Snow albedo hex. */
  color: string;
  /** Lift above terrain so the blanket reads as a layer (m). */
  liftM: number;
  /**
   * Height fraction t=(h-min)/(max-min) above which snow is solid (thick cover).
   * 0..1 of the map height range.
   */
  thickLineT: number;
  /** Below thick line, residual patches may appear above this t. */
  patchMinT: number;
  /** Noise must exceed this (0..1) for a mid-slope patch. Higher = sparser. */
  patchNoiseThreshold: number;
  /** Soften thick-line edge (t units). */
  thickBlend?: number;
  /** Clear snow on the drive ribbon so the rock path reads. Default true. */
  clearPath?: boolean;
  opacity?: number;
};

/**
 * Deterministic 0..1 value noise for residual snow patches.
 * Same family as former alpineSnow vertex mode — stable for a seed's heightmap.
 */
export function snowPatchNoise(x: number, z: number): number {
  const n1 = hash2(x * 0.07, z * 0.07);
  const n2 = hash2(x * 0.19 + 17.1, z * 0.19 - 9.3);
  return n1 * 0.65 + n2 * 0.35;
}

function hash2(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash1(xi, zi);
  const b = hash1(xi + 1, zi);
  const c = hash1(xi, zi + 1);
  const d = hash1(xi + 1, zi + 1);
  const u = a * (1 - sx) + b * sx;
  const v = c * (1 - sx) + d * sx;
  return u * (1 - sz) + v * sz;
}

function hash1(ix: number, iz: number): number {
  let n = Math.imul(ix * 374761393 + iz * 668265263, 0x27d4eb2d);
  n = Math.imul(n ^ (n >>> 15), 2246822519);
  n = Math.imul(n ^ (n >>> 13), 3266489917);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Snow amount 0..1 at world XZ / height fraction t.
 * ≥0.5 is treated as "has snow" for mesh mask.
 */
export function snowCoverAmount(
  x: number,
  z: number,
  heightT: number,
  cfg: SnowCoverConfig,
): number {
  const blend = cfg.thickBlend ?? 0.1;
  const thick = smoothstep(cfg.thickLineT, cfg.thickLineT + blend, heightT);

  const n = snowPatchNoise(x, z);
  const patchGate = smoothstep(cfg.patchMinT, cfg.patchMinT + 0.12, heightT);
  const patch =
    patchGate *
    smoothstep(cfg.patchNoiseThreshold - 0.08, cfg.patchNoiseThreshold + 0.12, n) *
    (1 - thick * 0.9);

  return clamp(thick + patch * 0.95, 0, 1);
}

export type SnowMaskInput = {
  heightmap: Float32Array;
  resolution: number;
  worldSize: number;
  pathPolyline: readonly { x: number; z: number }[];
  pathHalfWidth: number;
  cfg: SnowCoverConfig;
  /** Sample world XZ for cell (col,row). */
  gridToWorld: (
    col: number,
    row: number,
    worldSize: number,
    resolution: number,
  ) => { x: number; z: number };
};

/**
 * Per-cell snow mask (1 = snow). Used by draped snow mesh builder.
 */
export function buildSnowCoverMask(input: SnowMaskInput): Uint8Array {
  const { heightmap, resolution, worldSize, pathPolyline, pathHalfWidth, cfg } =
    input;
  let minH = Infinity;
  let maxH = -Infinity;
  for (let i = 0; i < heightmap.length; i++) {
    const h = heightmap[i]!;
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }
  const hRange = Math.max(1e-3, maxH - minH);
  const clearPath = cfg.clearPath !== false;
  const mask = new Uint8Array(resolution * resolution);

  for (let row = 0; row < resolution; row++) {
    for (let col = 0; col < resolution; col++) {
      const i = row * resolution + col;
      const h = heightmap[i]!;
      const t = (h - minH) / hRange;
      const { x, z } = input.gridToWorld(col, row, worldSize, resolution);
      if (clearPath && pathProximity(x, z, pathPolyline, pathHalfWidth) > 0.35) {
        mask[i] = 0;
        continue;
      }
      mask[i] = snowCoverAmount(x, z, t, cfg) >= 0.5 ? 1 : 0;
    }
  }
  return mask;
}
