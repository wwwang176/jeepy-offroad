import { clamp } from "./math";
import { pathProximity } from "./terrainColor";

/**
 * Rounded snow mounds (visual only — no collider).
 * Shape: soft dome on rock — thick center, feathered edge — NOT terrain-grid drape.
 *
 *       ___thick___
 * -----/-----------\---- rock ----
 */
export type SnowCoverConfig = {
  /** Snow albedo hex. */
  color: string;
  /** Peak thickness of a high-ground "thick" mound (m). */
  peakThicknessM: number;
  /** Peak thickness of residual mid-slope patches (m). */
  patchThicknessM: number;
  /** Min/max radius for thick mounds (m). */
  thickRadiusMinM: number;
  thickRadiusMaxM: number;
  /** Min/max radius for residual patches (m). */
  patchRadiusMinM: number;
  patchRadiusMaxM: number;
  /** Target count of thick high-ground mounds. */
  thickCount: number;
  /** Target count of residual patches. */
  patchCount: number;
  /**
   * Height fraction t=(h-min)/(max-min) preferred for thick mounds.
   */
  thickLineT: number;
  /** Residual patches prefer t above this. */
  patchMinT: number;
  /**
   * Soft path avoid: prefer off-road, but still allow some snow on the ribbon.
   * When true (default), candidates on the path are accepted with
   * {@link pathSnowChance} only.
   */
  clearPath?: boolean;
  /**
   * Chance to keep a mound whose center sits on the drive ribbon (0..1).
   * Default 0.12 — mostly clear, occasional road snow.
   */
  pathSnowChance?: number;
  /**
   * pathProximity above this counts as "on road" for soft avoid. Default 0.35.
   */
  pathAvoidProximity?: number;
  opacity?: number;
  /**
   * @deprecated Prefer peakThicknessM — kept so old profiles/tests don't break.
   */
  liftM?: number;
};

export type SnowMound = {
  x: number;
  z: number;
  radius: number;
  /** Center thickness above terrain (m). */
  peakThickness: number;
  /** Angular phase for slight radial irregularity. */
  phase: number;
};

/** Mix into level seed so mesh + dust VFX share the same mound layout. */
export const SNOW_MOUND_SEED_XOR = 0x50e411;

/**
 * Angular rim scale for irregular blob outline (noise-warped, not a circle).
 * Shared by mesh build + tire-dust coverage.
 * Typical range ~0.55–1.45 around base radius.
 */
export function snowRimRadiusScale(ang: number, phase: number): number {
  // Multi-frequency angular “noise” — deterministic, no grid artifacts
  const n =
    0.5 * Math.sin(ang * 2 + phase) +
    0.38 * Math.sin(ang * 3 - phase * 1.4) +
    0.3 * Math.cos(ang * 5 + phase * 0.75) +
    0.22 * Math.sin(ang * 7 - phase * 2.2) +
    0.16 * Math.cos(ang * 4 + phase * 1.85) +
    0.1 * Math.sin(ang * 9 + phase * 0.4);
  return clamp(1 + 0.38 * n, 0.52, 1.5);
}

/** Max rim scale — for broad-phase culling in coverage queries. */
export const SNOW_RIM_SCALE_MAX = 1.5;

/**
 * Soft coverage 0..1 under snow mounds (same warped rim as the mesh).
 * Used for tire dust tint when driving on snow.
 */
export function snowCoverageAt(
  x: number,
  z: number,
  mounds: readonly SnowMound[],
): number {
  let best = 0;
  for (let i = 0; i < mounds.length; i++) {
    const m = mounds[i]!;
    const dx = x - m.x;
    const dz = z - m.z;
    const dist = Math.hypot(dx, dz);
    if (dist > m.radius * SNOW_RIM_SCALE_MAX) continue;
    const ang = Math.atan2(dz, dx);
    const rEff = m.radius * snowRimRadiusScale(ang, m.phase);
    if (dist >= rEff || rEff < 1e-4) continue;
    const c = snowDomeFalloff(dist / rEff);
    if (c > best) best = c;
  }
  return best;
}

/** Bright dust for unlit particles on snow (not darkened rock dust). */
export function snowDustColor(snowHex?: string): { r: number; g: number; b: number } {
  // Near-white puffs; mild cool bias so they read as snow not grey rock
  if (snowHex && snowHex.length >= 7) {
    // Soften pure hex toward white for sprite read
    return { r: 0.93, g: 0.95, b: 0.98 };
  }
  return { r: 0.93, g: 0.95, b: 0.98 };
}

/** Deterministic 0..1 noise (placement bias / tests). */
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

/**
 * Radial dome falloff: 1 at center, 0 at rim.
 * Smooth rounded profile (not a flat slab).
 */
export function snowDomeFalloff(u: number): number {
  // u = r / radius in [0,1]
  const t = clamp(u, 0, 1);
  // (1 - t^2)^2 — soft mound; derivative 0 at center
  const s = 1 - t * t;
  return s * s;
}

function heightRange(heightmap: Float32Array): { minH: number; maxH: number } {
  let minH = Infinity;
  let maxH = -Infinity;
  for (let i = 0; i < heightmap.length; i++) {
    const h = heightmap[i]!;
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }
  if (!Number.isFinite(minH)) {
    minH = 0;
    maxH = 1;
  }
  return { minH, maxH: Math.max(maxH, minH + 1e-3) };
}

function sampleHeightT(
  x: number,
  z: number,
  minH: number,
  maxH: number,
  sampleY: (x: number, z: number) => number,
): number {
  const y = sampleY(x, z);
  return clamp((y - minH) / (maxH - minH), 0, 1);
}

export type PlaceSnowMoundsInput = {
  heightmap: Float32Array;
  resolution: number;
  worldSize: number;
  pathPolyline: readonly { x: number; z: number }[];
  pathHalfWidth: number;
  cfg: SnowCoverConfig;
  rng: () => number;
  /** Terrain Y at world XZ (usually bilinear sample). */
  sampleY: (x: number, z: number) => number;
};

/**
 * Place soft snow mounds: large thick ones on high rock, smaller residual patches mid-slope.
 * Pond-like sites (no carving); pure decoration list for the renderer.
 */
export function placeSnowMounds(input: PlaceSnowMoundsInput): SnowMound[] {
  const {
    heightmap,
    worldSize,
    pathPolyline,
    pathHalfWidth,
    cfg,
    rng,
    sampleY,
  } = input;
  const { minH, maxH } = heightRange(heightmap);
  const softAvoidPath = cfg.clearPath !== false;
  const pathSnowChance = clamp(cfg.pathSnowChance ?? 0.12, 0, 1);
  const pathAvoidProx = cfg.pathAvoidProximity ?? 0.35;
  const half = worldSize * 0.5 - 8;
  const mounds: SnowMound[] = [];

  const tooClose = (x: number, z: number, r: number): boolean => {
    for (const m of mounds) {
      const d = Math.hypot(x - m.x, z - m.z);
      if (d < (r + m.radius) * 0.55) return true;
    }
    return false;
  };

  const tryPlace = (
    preferTMin: number,
    preferTMax: number,
    rMin: number,
    rMax: number,
    peak: number,
    attempts: number,
  ): void => {
    for (let a = 0; a < attempts; a++) {
      const x = (rng() * 2 - 1) * half;
      const z = (rng() * 2 - 1) * half;
      const onPath =
        pathProximity(x, z, pathPolyline, pathHalfWidth) > pathAvoidProx;
      // Mostly skip the road; rare accept so snow can spill onto the track.
      if (softAvoidPath && onPath && rng() > pathSnowChance) {
        continue;
      }
      const t = sampleHeightT(x, z, minH, maxH, sampleY);
      if (t < preferTMin || t > preferTMax) continue;
      // Prefer higher t within band
      if (rng() > 0.35 + t * 0.65) continue;
      let radius = rMin + rng() * Math.max(0.01, rMax - rMin);
      // Road snow: smaller so the track stays mostly readable
      if (onPath) radius *= 0.55 + rng() * 0.25;
      if (tooClose(x, z, radius)) continue;
      let peakUse = peak * (0.85 + rng() * 0.3);
      if (onPath) peakUse *= 0.65;
      mounds.push({
        x,
        z,
        radius,
        peakThickness: peakUse,
        phase: rng() * Math.PI * 2,
      });
      return;
    }
  };

  const thickPeak = cfg.peakThicknessM || cfg.liftM || 0.5;
  const patchPeak = cfg.patchThicknessM || thickPeak * 0.45;

  for (let i = 0; i < cfg.thickCount; i++) {
    tryPlace(
      cfg.thickLineT,
      1.01,
      cfg.thickRadiusMinM,
      cfg.thickRadiusMaxM,
      thickPeak,
      80,
    );
  }
  for (let i = 0; i < cfg.patchCount; i++) {
    tryPlace(
      cfg.patchMinT,
      cfg.thickLineT + 0.08,
      cfg.patchRadiusMinM,
      cfg.patchRadiusMaxM,
      patchPeak,
      60,
    );
  }

  return mounds;
}
