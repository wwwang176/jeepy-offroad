import { clamp } from "./math";

export type Rgb = { r: number; g: number; b: number };

export type StreamSegmentInput = {
  polyline: { x: number; z: number }[];
  width: number;
};

/** Pond wetness input (levelgen-emitted shore + free surface). */
export type PondWetnessInput = {
  center: { x: number; z: number };
  radius: number;
  /** Horizontal free-surface Y — body points above this are dry. */
  surfaceY: number;
  polygon?: readonly { x: number; z: number }[];
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

  // ×2 particle count budget
  return clamp((drive + braking + roll + slip) * 2, 0, 288);
}

/**
 * Normalized 0..1 strength for a single wheel air→ground landing.
 * Shared by dust FX and first-person camera impact shake.
 * vy negative = falling; soft landings below threshold return 0.
 */
export function wheelLandingImpact01(
  wasGrounded: boolean,
  isGrounded: boolean,
  vy: number,
): number {
  if (wasGrounded || !isGrounded) return 0;
  if (vy > -1.2) return 0;
  return clamp((-vy - 1.2) / 8, 0, 1);
}

/**
 * Burst count when a wheel transitions air → ground with downward velocity.
 */
export function landingBurstCount(
  wasGrounded: boolean,
  isGrounded: boolean,
  vy: number,
): number {
  const impact = wheelLandingImpact01(wasGrounded, isGrounded, vy);
  if (impact <= 0) return 0;
  // ×2 particle count
  return Math.round((20 + impact * 56) * 2);
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
 * Normalized 0..1 strength when chassis/cabin first gains terrain contacts.
 * Soft first touch returns a small non-zero value; hard slams scale with |vy|.
 * Shared by dust FX burst sizing intent and first-person camera impact shake.
 */
export function bodySlamImpact01(
  prevContacts: number,
  contactCount: number,
  vy: number,
): number {
  if (contactCount <= 0 || prevContacts > 0) return 0;
  const impact = Math.max(0, -vy);
  if (impact < 0.8 && Math.abs(vy) < 0.8) {
    // Soft first touch — small kick for cam / mild dust path
    return 0.12;
  }
  return clamp((impact - 0.8) / 8, 0, 1);
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

/** Ray-cast point-in-polygon on XZ (winding-agnostic even-odd). */
export function pointInPolygonXZ(
  x: number,
  z: number,
  poly: readonly { x: number; z: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const zi = poly[i].z;
    const xj = poly[j].x;
    const zj = poly[j].z;
    const denom = zj - zi;
    const intersect =
      zi > z !== zj > z &&
      x < ((xj - xi) * (z - zi)) / (Math.abs(denom) > 1e-12 ? denom : 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Wetness 0..1 inside a pond (any altitude). Uses shore polygon when present,
 * else circular radius. Optional `y` must be at/below free surface.
 */
export function pondWetness(
  x: number,
  z: number,
  ponds: readonly PondWetnessInput[],
  y?: number,
  margin = 0.45,
): number {
  if (!ponds.length) return 0;
  let best = 0;
  for (const pond of ponds) {
    // Body/wheel above free surface is dry
    if (y != null && y > pond.surfaceY + 0.22) continue;

    const dx = x - pond.center.x;
    const dz = z - pond.center.z;
    const dist = Math.hypot(dx, dz);
    // Broad reject
    if (dist > pond.radius + margin + 1.5) continue;

    let w = 0;
    if (pond.polygon && pond.polygon.length >= 3) {
      if (pointInPolygonXZ(x, z, pond.polygon)) {
        w = 1;
      } else {
        // Near-shore fade: distance to center past nominal radius
        if (dist < pond.radius + margin) {
          w = 1 - (dist - pond.radius * 0.85) / Math.max(margin + pond.radius * 0.15, 1e-6);
          w = clamp(w, 0, 0.55);
        }
      }
    } else {
      if (dist <= pond.radius) w = 1;
      else if (dist < pond.radius + margin) {
        w = 1 - (dist - pond.radius) / margin;
      }
    }
    // Deeper under surface only boosts weak near-shore wetness (never reduces)
    if (y != null && w > 0 && w < 1 && y < pond.surfaceY) {
      const sub = clamp((pond.surfaceY - y) / 0.4, 0, 1);
      w = Math.min(1, w + sub * 0.25);
    }
    if (w > best) best = w;
  }
  return clamp(best, 0, 1);
}

/**
 * Combined water wetness: streams (legacy) + ponds (current hydrology).
 */
export function waterWetness(
  x: number,
  z: number,
  streams: readonly StreamSegmentInput[],
  ponds: readonly PondWetnessInput[],
  y?: number,
): number {
  return Math.max(
    streamWetness(x, z, streams),
    pondWetness(x, z, ponds, y),
  );
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
  // ×2 particle count
  return (
    opts.wetness *
    (speedGate * speed * 10.4 + th * 32 * speedGate + speedGate * 16) *
    2
  );
}

/**
 * How far a body sample sits under free surface (m). 0 if above water.
 * `eps` ignores hairline grazing so we don't spray on floating error.
 */
export function immersionDepthM(
  surfaceY: number,
  worldY: number,
  eps = 0.02,
): number {
  return Math.max(0, surfaceY - worldY - eps);
}

/**
 * Per-sample weight for body drainage: XZ wetness × immersion depth ×
 * roll/pitch bias (low side / nose-down get more).
 *
 * `rollLean` = chassisRight.y (right lower ⇒ negative).
 * `pitchLean` = chassisFwd.y (nose lower ⇒ negative).
 * `localX` / `localZ` are chassis-local sample coords.
 */
export function bodyImmersionWeight(opts: {
  wetnessXZ: number;
  depthM: number;
  localX: number;
  localZ: number;
  rollLean: number;
  pitchLean: number;
}): number {
  if (opts.wetnessXZ < 0.08 || opts.depthM < 0.012) return 0;
  // Normalize depth: ~0.35 m full weight, allow over-immerse boost
  const depthN = clamp(opts.depthM / 0.35, 0, 1.6);
  // Right lower (rollLean < 0) boosts localX > 0 samples
  const rollBias =
    1 -
    clamp(opts.rollLean * Math.sign(opts.localX || 1) * 1.25, -0.6, 0.6);
  // Nose lower (pitchLean < 0) boosts localZ > 0 (front)
  const pitchBias =
    1 -
    clamp(opts.pitchLean * Math.sign(opts.localZ || 1) * 1.0, -0.5, 0.5);
  return opts.wetnessXZ * depthN * rollBias * pitchBias;
}

/** Below this ground speed (m/s), body drainage is fully off (parked in puddle). */
export const BODY_WATER_SPEED_DEADZONE_MPS = 0.55;
/** Full drainage strength by this speed (m/s); ramp between deadzone and here. */
export const BODY_WATER_SPEED_FULL_MPS = 2.2;

/**
 * Continuous body drainage rate from immersion-weighted samples.
 * Strength ∝ depth × wetness × speed. Nearly stationary (idle / tiny slide)
 * emits nothing so sitting in a puddle does not keep spraying.
 */
export function bodyWaterSprayEmitRate(opts: {
  /** Mean immersion depth among wet samples (m). */
  meanDepthM: number;
  /** Mean XZ wetness 0..1 among wet samples. */
  meanWetness: number;
  speedMps: number;
  wetSampleCount: number;
  /** Sum of bodyImmersionWeight (pose-biased). */
  totalWeight: number;
}): number {
  if (
    opts.meanWetness <= 0.08 ||
    opts.wetSampleCount <= 0 ||
    opts.meanDepthM < 0.012 ||
    opts.totalWeight <= 0
  ) {
    return 0;
  }
  const speed = Math.abs(opts.speedMps);
  // Parked / micro-slide: no body drainage (tires may still splash if spinning)
  if (speed < BODY_WATER_SPEED_DEADZONE_MPS) return 0;
  const speedGate = clamp(
    (speed - BODY_WATER_SPEED_DEADZONE_MPS) /
      Math.max(1e-3, BODY_WATER_SPEED_FULL_MPS - BODY_WATER_SPEED_DEADZONE_MPS),
    0,
    1,
  );
  // Smoothstep so light creep is very soft
  const speedEase = speedGate * speedGate * (3 - 2 * speedGate);

  const depthFactor = clamp(opts.meanDepthM / 0.28, 0.35, 1.8);
  const weightFactor = clamp(opts.totalWeight / 2.2, 0.45, 2.8);
  // Motion-driven only — no idle base rate; ×1.5 visual volume
  const motion = (12 + speed * 7.5) * speedEase * 1.5;
  return opts.meanWetness * depthFactor * weightFactor * motion;
}

/** Best matching pond free-surface Y at XZ, or null if dry. */
export function pondSurfaceYAt(
  x: number,
  z: number,
  ponds: readonly PondWetnessInput[],
): number | null {
  let bestY: number | null = null;
  let bestW = 0;
  for (const pond of ponds) {
    const w = pondWetness(x, z, [pond], undefined, 0.6);
    if (w > bestW) {
      bestW = w;
      bestY = pond.surfaceY;
    }
  }
  return bestW > 0.08 ? bestY : null;
}

/**
 * Height where rain hits: terrain bed, or pond free surface when over water
 * (so drops/splashes stop on the lake, not under it).
 */
export function rainImpactHeight(
  x: number,
  z: number,
  terrainY: number,
  ponds: readonly PondWetnessInput[],
): number {
  if (!ponds.length) return terrainY;
  const surf = pondSurfaceYAt(x, z, ponds);
  if (surf == null) return terrainY;
  return Math.max(terrainY, surf);
}

/**
 * Resolve free-surface Y for immersion: pond surface if wet, else null.
 * Streams have no surfaceY in wetness input — caller may fall back.
 */
export function resolveWaterSurfaceY(
  x: number,
  z: number,
  ponds: readonly PondWetnessInput[],
): number | null {
  return pondSurfaceYAt(x, z, ponds);
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
