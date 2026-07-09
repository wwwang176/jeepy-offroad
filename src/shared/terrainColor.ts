import { clamp, lerp } from "./math";
import { parseHexRgb, type Rgb } from "./offroadFxMath";

export type GroundPalette = {
  high: string;
  mid: string;
  low: string;
  path: string;
};

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

/**
 * Ground albedo at a point — same blend as TerrainMesh vertex colors:
 * height-based low→mid→high, then path ribbon lerp to path color.
 */
export function terrainAlbedoAt(
  x: number,
  z: number,
  height: number,
  ctx: TerrainColorContext,
): Rgb {
  const hRange = Math.max(1e-3, ctx.maxH - ctx.minH);
  const t = clamp((height - ctx.minH) / hRange, 0, 1);
  const { low, mid, high, path } = ctx.palette;

  let r: number;
  let g: number;
  let b: number;
  if (t < 0.45) {
    const u = t / 0.45;
    r = lerp(low.r, mid.r, u);
    g = lerp(low.g, mid.g, u);
    b = lerp(low.b, mid.b, u);
  } else {
    const u = (t - 0.45) / 0.55;
    r = lerp(mid.r, high.r, u);
    g = lerp(mid.g, high.g, u);
    b = lerp(mid.b, high.b, u);
  }

  const pathW = pathProximity(x, z, ctx.pathPolyline, ctx.pathHalfWidth);
  if (pathW > 0) {
    const w = Math.min(1, pathW * 1.2);
    r = lerp(r, path.r, w);
    g = lerp(g, path.g, w);
    b = lerp(b, path.b, w);
  }

  return { r, g, b };
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
  };
}
