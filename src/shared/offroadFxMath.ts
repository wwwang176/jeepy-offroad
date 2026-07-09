import { clamp } from "./math";

export type Rgb = { r: number; g: number; b: number };

export type StreamSegmentInput = {
  polyline: { x: number; z: number }[];
  width: number;
};

/** Chassis-forward (+Z when yaw=0) and right (+X) from yaw. */
export function yawBasis(yaw: number): {
  forward: { x: number; z: number };
  right: { x: number; z: number };
} {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return {
    forward: { x: s, z: c },
    right: { x: c, z: -s },
  };
}

/** Ground-plane speed along chassis forward (m/s, signed). */
export function longitudinalSpeedMps(
  vx: number,
  vz: number,
  yaw: number,
): number {
  const { forward } = yawBasis(yaw);
  return vx * forward.x + vz * forward.z;
}

/** Ground-plane speed along chassis right (m/s, signed). */
export function lateralSpeedMps(vx: number, vz: number, yaw: number): number {
  const { right } = yawBasis(yaw);
  return vx * right.x + vz * right.z;
}

/**
 * Continuous dust spawn intensity for one grounded wheel (particles/sec scale).
 * Combines throttle, brake, speed, and |lateral| slip — capped so idle crawl
 * does not fill the screen.
 */
export function dustEmitRate(opts: {
  grounded: boolean;
  throttle: number;
  brake: number;
  speedMps: number;
  lateralAbsMps: number;
  /** 4L multiplies drive-related dust. */
  rangeBoost?: number;
}): number {
  if (!opts.grounded) return 0;
  const speed = Math.abs(opts.speedMps);
  const th = clamp(Math.abs(opts.throttle), 0, 1);
  const br = clamp(opts.brake, 0, 1);
  const lat = Math.abs(opts.lateralAbsMps);
  const boost = opts.rangeBoost ?? 1;

  // Crawl / park: almost nothing
  const speedGate = clamp((speed - 0.6) / 8, 0, 1);
  // Higher rates → many small puffs (sizes tuned down in OffroadFx)
  const drive = th * 56 * boost * (0.35 + 0.65 * speedGate);
  const braking = br * 40 * speedGate;
  // Rolling dust scales with speed once past crawl
  const roll = speedGate * speed * 2.3;
  // Side-slip plume (powerslide / crab)
  const slip = clamp((lat - 1.2) / 6, 0, 1) * 68 * (0.4 + 0.6 * speedGate);

  return clamp(drive + braking + roll + slip, 0, 144);
}

/**
 * Burst count when a wheel transitions air → ground with downward velocity.
 */
export function landingBurstCount(
  wasGrounded: boolean,
  isGrounded: boolean,
  vy: number,
): number {
  if (wasGrounded || !isGrounded) return 0;
  // vy negative = falling
  if (vy > -1.2) return 0;
  const impact = clamp((-vy - 1.2) / 8, 0, 1);
  return Math.round(20 + impact * 56);
}

/**
 * Continuous dust rate (particles/sec) for chassis/cabin scrapes.
 * Scales with contact count, horizontal scrape speed, and downward impact.
 */
export function bodyContactEmitRate(opts: {
  contactCount: number;
  speedMps: number;
  vy: number;
}): number {
  if (opts.contactCount <= 0) return 0;
  const scrape = Math.abs(opts.speedMps);
  const impact = Math.max(0, -opts.vy);
  // Nearly static rest on a rock: still a little grit if pressing
  if (scrape < 0.25 && impact < 0.5) {
    return opts.contactCount * 2.5;
  }
  const per =
    scrape * 18 +
    impact * 28 +
    clamp(scrape * scrape * 1.2, 0, 40);
  return clamp(per * Math.min(opts.contactCount, 8), 0, 200);
}

/**
 * One-shot burst when body first gains terrain contacts (belly slam / tip-over).
 */
export function bodyImpactBurstCount(
  prevContacts: number,
  contactCount: number,
  vy: number,
): number {
  if (contactCount <= 0 || prevContacts > 0) return 0;
  const impact = Math.max(0, -vy);
  if (impact < 0.8 && Math.abs(vy) < 0.8) {
    // Soft first touch — small puff
    return Math.round(6 + contactCount * 2);
  }
  const t = clamp((impact - 0.8) / 8, 0, 1);
  return Math.round(12 + t * 40 + contactCount * 3);
}

/** Distance from point to segment in XZ (m). */
export function distPointSegmentXZ(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const abx = bx - ax;
  const abz = bz - az;
  const apx = px - ax;
  const apz = pz - az;
  const ab2 = abx * abx + abz * abz;
  if (ab2 < 1e-12) return Math.hypot(apx, apz);
  let t = (apx * abx + apz * abz) / ab2;
  t = clamp(t, 0, 1);
  const qx = ax + abx * t;
  const qz = az + abz * t;
  return Math.hypot(px - qx, pz - qz);
}

/**
 * Wetness 0..1 under a wheel: 1 when inside stream half-width, fades outside.
 */
export function streamWetness(
  x: number,
  z: number,
  streams: readonly StreamSegmentInput[],
  margin = 0.6,
): number {
  if (!streams.length) return 0;
  let best = 0;
  for (const stream of streams) {
    const half = stream.width * 0.5;
    const poly = stream.polyline;
    if (poly.length < 2) continue;
    let dMin = Infinity;
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i];
      const b = poly[i + 1];
      const d = distPointSegmentXZ(x, z, a.x, a.z, b.x, b.z);
      if (d < dMin) dMin = d;
    }
    if (dMin >= half + margin) continue;
    const w =
      dMin <= half ? 1 : 1 - (dMin - half) / Math.max(margin, 1e-6);
    if (w > best) best = w;
  }
  return clamp(best, 0, 1);
}

/**
 * Splash particles/sec for a grounded wheel in water.
 */
export function splashEmitRate(opts: {
  grounded: boolean;
  wetness: number;
  speedMps: number;
  throttle: number;
}): number {
  if (!opts.grounded || opts.wetness <= 0.05) return 0;
  const speed = Math.abs(opts.speedMps);
  const speedGate = clamp((speed - 0.4) / 5, 0, 1);
  const th = clamp(Math.abs(opts.throttle), 0, 1);
  return (
    opts.wetness *
    (speedGate * speed * 10.4 + th * 32 * speedGate + speedGate * 16)
  );
}

/** Parse #rgb / #rrggbb to 0..1 RGB. */
export function parseHexRgb(hex: string): Rgb {
  let h = hex.trim().replace("#", "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const n = parseInt(h, 16);
  if (!Number.isFinite(n)) return { r: 0.55, g: 0.48, b: 0.38 };
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}

/** Dust tint from biome ground palette (biased toward mid/path). */
export function dustColorFromPalette(palette: {
  high: string;
  mid: string;
  low: string;
  path: string;
}): Rgb {
  const mid = parseHexRgb(palette.mid);
  const path = parseHexRgb(palette.path);
  const low = parseHexRgb(palette.low);
  return {
    r: mid.r * 0.45 + path.r * 0.35 + low.r * 0.2,
    g: mid.g * 0.45 + path.g * 0.35 + low.g * 0.2,
    b: mid.b * 0.45 + path.b * 0.35 + low.b * 0.2,
  };
}

export function waterSplashColor(waterHex: string): Rgb {
  const w = parseHexRgb(waterHex);
  // Brighten toward foam
  return {
    r: clamp(w.r * 0.55 + 0.45, 0, 1),
    g: clamp(w.g * 0.55 + 0.5, 0, 1),
    b: clamp(w.b * 0.55 + 0.55, 0, 1),
  };
}

/**
 * Subtle exhaust puff rate (particles/sec) from rear — low so it stays tasteful.
 */
export function exhaustEmitRate(opts: {
  throttle: number;
  speedMps: number;
}): number {
  const th = clamp(Math.abs(opts.throttle), 0, 1);
  if (th < 0.12) return 0;
  const speed = Math.abs(opts.speedMps);
  // Idle rev + light load (still subtle vs dust)
  return th * 7 + clamp(th * speed * 0.24, 0, 5);
}
