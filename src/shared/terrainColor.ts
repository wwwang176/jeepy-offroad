import { clamp, lerp } from "./math";
import { parseHexRgb, type Rgb } from "./offroadFxMath";

export type GroundPalette = {
  high: string;
  mid: string;
  low: string;
  path: string;
};

export type TerrainColorMode = "default" | "alpineSnow";

export type TerrainColorContext = {
  palette: {
    high: Rgb;
    mid: Rgb;
    low: Rgb;
    path: Rgb;
  };
  minH: number;
  maxH: number;
  /** Same half-width scale as TerrainMesh: (pathWidth ?? 4) * 0.75 */
  pathHalfWidth: number;
  pathPolyline: readonly { x: number; z: number }[];
  mode: TerrainColorMode;
};

/** Match TerrainMesh path ribbon falloff (point samples along polyline). */
export function pathProximity(
  x: number,
  z: number,
  path: readonly { x: number; z: number }[],
  halfWidth: number,
): number {
  if (halfWidth <= 0 || path.length === 0) return 0;
  let minD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < minD) minD = d;
  }
  if (minD >= halfWidth) return 0;
  return 1 - minD / halfWidth;
}

/** Deterministic 0..1 value noise for snow patches (no RNG stream). */
function snowPatchNoise(x: number, z: number): number {
  // Two-frequency hash — stable patches, not high-frequency salt.
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
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sz);
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

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: lerp(a.r, b.r, t),
    g: lerp(a.g, b.g, t),
    b: lerp(a.b, b.b, t),
  };
}

/** Default: low→mid→high by height (sand / rainforest). */
function albedoHeightBlend(t: number, palette: TerrainColorContext["palette"]): Rgb {
  const { low, mid, high } = palette;
  if (t < 0.45) {
    const u = t / 0.45;
    return lerpRgb(low, mid, u);
  }
  const u = (t - 0.45) / 0.55;
  return lerpRgb(mid, high, u);
}

/**
 * Alpine: grey schist base (low/mid), thick snow on high ground,
 * patchy residual snow on mid slopes. high = snow, mid/low = rock.
 */
function albedoAlpineSnow(
  x: number,
  z: number,
  t: number,
  palette: TerrainColorContext["palette"],
): Rgb {
  const { low, mid, high } = palette;
  // Rock only: dark schist → mid schist (no white in the rock mix)
  const rockT = clamp(t / 0.72, 0, 1);
  const rock = lerpRgb(low, mid, rockT);

  // Thick snow cap on valley shoulders / peaks
  const thick = smoothstep(0.58, 0.78, t);
  // Residual patches mid-slope (and a few low flecks)
  const n = snowPatchNoise(x, z);
  const patchGate = smoothstep(0.22, 0.55, t); // rare low, common mid
  const patch = patchGate * smoothstep(0.52, 0.72, n) * (1 - thick * 0.85);

  const snowAmt = clamp(thick + patch * 0.9, 0, 1);
  return lerpRgb(rock, high, snowAmt);
}

/**
 * Ground albedo at a point — same blend as TerrainMesh vertex colors.
 */
export function terrainAlbedoAt(
  x: number,
  z: number,
  height: number,
  ctx: TerrainColorContext,
): Rgb {
  const hRange = Math.max(1e-3, ctx.maxH - ctx.minH);
  const t = clamp((height - ctx.minH) / hRange, 0, 1);

  let ground =
    ctx.mode === "alpineSnow"
      ? albedoAlpineSnow(x, z, t, ctx.palette)
      : albedoHeightBlend(t, ctx.palette);

  const pathW = pathProximity(x, z, ctx.pathPolyline, ctx.pathHalfWidth);
  if (pathW > 0) {
    const w = Math.min(1, pathW * 1.2);
    ground = lerpRgb(ground, ctx.palette.path, w);
  }

  return ground;
}

/**
 * Unlit point sprites read brighter than MeshLambert terrain.
 * Darken + mild desaturate so lofted dust matches the lit ground read.
 */
export function dustColorFromTerrainAlbedo(
  albedo: Rgb,
  opts?: { shade?: number; dustLift?: number },
): Rgb {
  // Darker than lit ground so unlit sprites still read as coffee-brown dust.
  // (Lower shade = deeper; less lift = less washed-out.)
  const shade = opts?.shade ?? 0.48;
  const lift = opts?.dustLift ?? 0.04;
  const r = clamp(albedo.r * shade * (1 - lift) + lift * 0.42, 0, 1);
  const g = clamp(albedo.g * shade * (1 - lift) + lift * 0.34, 0, 1);
  const b = clamp(albedo.b * shade * (1 - lift) + lift * 0.26, 0, 1);
  // Keep warm brown; mild desat only so dust stays readable on terrain.
  const avg = (r + g + b) / 3;
  const sat = 0.92;
  return {
    r: lerp(avg, r, sat),
    g: lerp(avg, g, sat),
    b: lerp(avg, b, sat),
  };
}

export function buildTerrainColorContext(opts: {
  groundPalette: GroundPalette;
  heightmap: Float32Array;
  pathPolyline: readonly { x: number; z: number }[];
  pathWidth?: number;
  terrainColorMode?: TerrainColorMode;
}): TerrainColorContext {
  let minH = Infinity;
  let maxH = -Infinity;
  for (let i = 0; i < opts.heightmap.length; i++) {
    const h = opts.heightmap[i];
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }
  if (!Number.isFinite(minH)) {
    minH = 0;
    maxH = 1;
  }
  const gp = opts.groundPalette;
  return {
    palette: {
      high: parseHexRgb(gp.high),
      mid: parseHexRgb(gp.mid),
      low: parseHexRgb(gp.low),
      path: parseHexRgb(gp.path),
    },
    minH,
    maxH,
    pathHalfWidth: (opts.pathWidth ?? 4) * 0.75,
    pathPolyline: opts.pathPolyline,
    mode: opts.terrainColorMode ?? "default",
  };
}
