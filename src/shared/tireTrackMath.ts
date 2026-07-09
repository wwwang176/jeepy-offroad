import { clamp, lerp } from "./math";
import type { Rgb } from "./offroadFxMath";

export type TrackSurface = "path" | "mud" | "wet";

/**
 * Surface under a tire for track look:
 * wet ≫ path ≫ off-path mud (darker, stickier marks).
 */
export function classifyTrackSurface(
  pathProximity: number,
  wetness: number,
): TrackSurface {
  if (wetness > 0.4) return "wet";
  if (pathProximity > 0.35) return "path";
  return "mud";
}

/**
 * How strongly to leave a mark this frame (0 = skip, 1 = max).
 * Side-slip and hard brake go deep; gentle roll is faint; wet nearly none.
 */
export function trackDepositStrength(opts: {
  grounded: boolean;
  speedMps: number;
  throttle: number;
  brake: number;
  lateralAbsMps: number;
  surface: TrackSurface;
}): number {
  if (!opts.grounded) return 0;
  if (opts.surface === "wet") return 0;

  const speed = Math.abs(opts.speedMps);
  // Need a little motion so idle park doesn't stamp a blob
  if (speed < 0.35) return 0;

  const th = clamp(Math.abs(opts.throttle), 0, 1);
  const br = clamp(opts.brake, 0, 1);
  const lat = Math.abs(opts.lateralAbsMps);

  const roll = clamp((speed - 0.35) / 10, 0, 0.35);
  const drive = th * 0.45 * clamp(speed / 6, 0.25, 1);
  const brakeMark = br * 0.85 * clamp(speed / 5, 0.2, 1);
  const slip = clamp((lat - 0.9) / 5, 0, 1) * 1.0;

  let s = clamp(roll + drive + brakeMark + slip, 0, 1);
  // Packed path: lighter tread; soft mud: stronger imprint
  if (opts.surface === "path") s *= 0.55;
  else s *= 1.15; // mud

  return clamp(s, 0, 1);
}

/** Half-width of the mark ribbon (m). Wider on mud / slip. */
export function trackHalfWidth(opts: {
  strength: number;
  surface: TrackSurface;
  lateralAbsMps: number;
  baseTireHalfW?: number;
}): number {
  const base = opts.baseTireHalfW ?? 0.14;
  const lat = clamp(Math.abs(opts.lateralAbsMps) / 6, 0, 1);
  const mudBoost = opts.surface === "mud" ? 1.25 : opts.surface === "path" ? 0.9 : 0.5;
  return base * mudBoost * (0.75 + opts.strength * 0.55 + lat * 0.35);
}

/**
 * Mark color: dark coffee scrape of local ground; mud darker, path greyer.
 * strength deepens alpha contribution (caller multiplies into vertex a).
 */
export function trackMarkColor(
  surface: TrackSurface,
  groundAlbedo: Rgb,
  strength: number,
): Rgb {
  // Mid depth: between original near-black and the too-pale pass
  const dark = { r: 0.18, g: 0.14, b: 0.11 };
  const pathGrey = { r: 0.3, g: 0.26, b: 0.21 };
  const mudDark = { r: 0.16, g: 0.12, b: 0.09 };

  let target: Rgb;
  if (surface === "path") {
    target = {
      r: lerp(groundAlbedo.r * 0.48, pathGrey.r, 0.45),
      g: lerp(groundAlbedo.g * 0.48, pathGrey.g, 0.45),
      b: lerp(groundAlbedo.b * 0.48, pathGrey.b, 0.45),
    };
  } else {
    target = {
      r: lerp(groundAlbedo.r * 0.4, mudDark.r, 0.55),
      g: lerp(groundAlbedo.g * 0.4, mudDark.g, 0.55),
      b: lerp(groundAlbedo.b * 0.4, mudDark.b, 0.55),
    };
  }

  // Stronger slip/brake → darker
  const t = 0.42 + strength * 0.5;
  const deep = {
    r: clamp(lerp(dark.r, target.r, t), 0, 1),
    g: clamp(lerp(dark.g, target.g, t), 0, 1),
    b: clamp(lerp(dark.b, target.b, t), 0, 1),
  };
  // Keep a little ground warmth (~25% toward ground, not 50%)
  return {
    r: clamp(lerp(groundAlbedo.r, deep.r, 0.75), 0, 1),
    g: clamp(lerp(groundAlbedo.g, deep.g, 0.75), 0, 1),
    b: clamp(lerp(groundAlbedo.b, deep.b, 0.75), 0, 1),
  };
}

/** Vertex alpha at spawn (fades over segment life). */
export function trackSpawnAlpha(
  strength: number,
  surface: TrackSurface,
): number {
  // Between original (~0.72/0.48) and the too-faint half
  const base = surface === "mud" ? 0.55 : 0.38;
  return clamp(base * (0.35 + strength * 0.75), 0.1, 0.65);
}

/** Life seconds for a segment. Mud lasts longer. */
export function trackSegmentLife(surface: TrackSurface, strength: number): number {
  const base = surface === "mud" ? 14 : 9;
  return base * (0.75 + strength * 0.4);
}

/** Min travel (m) before laying another ribbon sample. */
export function trackMinSpacing(speedMps: number): number {
  // denser at low speed for brake marks, looser when flying
  return clamp(0.18 + Math.abs(speedMps) * 0.02, 0.14, 0.45);
}
