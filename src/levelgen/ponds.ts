/**
 * Pond-only hydrology (no rivers for now).
 *
 * Pipeline per pond:
 *  1. Pick sites from (a) coarse local-minima scan — includes hillside
 *     relative lows, not just map valleys — and (b) random scatter so
 *     shallow puddles can appear on flats/gentle slopes after soft dig.
 *  2. Choose horizontal free surface surfaceY from local rim samples.
 *  3. Soft-carve basin below surfaceY (depth class: puddle → deep).
 *  4. Raise rim slightly above surfaceY.
 *  5. Extract irregular wet shore polygon (radial rays after carve).
 *
 * Render consumes pond.surfaceY + pond.polygon only.
 */
import type { Vec3 } from "@/shared/types";
import { cellSize, gridToWorld, idx, worldToGrid } from "@/shared/coords";
import { pathDistXZ } from "./repair";
import {
  POND_DEEP_DEPTH_MAX_M,
  POND_DEFAULT_RADIUS_M,
  POND_MAX_CUT_M,
  POND_PUDDLE_DEPTH_MAX_M,
  POND_PUDDLE_DEPTH_MIN_M,
  POND_PUDDLE_RADIUS_MAX_M,
  POND_PUDDLE_RADIUS_MIN_M,
  POND_RIM_CLEARANCE_M,
  POND_TARGET_DEPTH_M,
  STREAM_BANK_BLEND_WIDTH_M,
  type PondBody,
  type StreamReach,
} from "./types";

/** Depth / size class for variety: shallow 水灘 → deep pool. */
export type PondClass = "puddle" | "mid" | "deep";

type PondSite = {
  x: number;
  z: number;
  radius: number;
  targetDepth: number;
  pondClass: PondClass;
};

function rollDepthAndRadius(
  pondClass: PondClass,
  rng: () => number,
): { targetDepth: number; radius: number } {
  if (pondClass === "puddle") {
    const targetDepth =
      POND_PUDDLE_DEPTH_MIN_M +
      rng() * (POND_PUDDLE_DEPTH_MAX_M - POND_PUDDLE_DEPTH_MIN_M);
    // Bias toward tiny spots: many sub-1 m, fewer mid-size puddles
    const u = rng();
    const t = u * u; // skew small
    const radius =
      POND_PUDDLE_RADIUS_MIN_M +
      t * (POND_PUDDLE_RADIUS_MAX_M - POND_PUDDLE_RADIUS_MIN_M);
    return { targetDepth, radius };
  }
  if (pondClass === "deep") {
    const targetDepth =
      POND_TARGET_DEPTH_M +
      rng() * (POND_DEEP_DEPTH_MAX_M - POND_TARGET_DEPTH_M);
    const radius = POND_DEFAULT_RADIUS_M * (0.95 + rng() * 0.55);
    return { targetDepth, radius };
  }
  // mid
  const targetDepth = 0.22 + rng() * (POND_TARGET_DEPTH_M - 0.18);
  const radius = POND_DEFAULT_RADIUS_M * (0.7 + rng() * 0.45);
  return { targetDepth, radius };
}

export type PlacedHydrology = {
  streams: StreamReach[];
  ponds: PondBody[];
};

/** Shore epsilon: cell is "wet" when ground is this far below surface. */
const SHORE_EPS_M = 0.04;
/** Radial rays for irregular shore polygon. */
const SHORE_RAYS = 36;
/** Rim ring sample count for surfaceY. */
const RIM_SAMPLES = 48;

function sampleHm(
  hm: Float32Array,
  resolution: number,
  worldSize: number,
  x: number,
  z: number,
): number {
  const { col, row, fx, fz } = worldToGrid(x, z, worldSize, resolution);
  const c0 = Math.max(0, Math.min(resolution - 2, col));
  const r0 = Math.max(0, Math.min(resolution - 2, row));
  const i00 = idx(resolution, c0, r0);
  const i10 = idx(resolution, c0 + 1, r0);
  const i01 = idx(resolution, c0, r0 + 1);
  const i11 = idx(resolution, c0 + 1, r0 + 1);
  const a = hm[i00] * (1 - fx) + hm[i10] * fx;
  const b = hm[i01] * (1 - fx) + hm[i11] * fx;
  return a * (1 - fz) + b * fz;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const t = Math.max(0, Math.min(1, p)) * (sortedAsc.length - 1);
  const i = Math.floor(t);
  const f = t - i;
  if (i >= sortedAsc.length - 1) return sortedAsc[sortedAsc.length - 1];
  return sortedAsc[i] * (1 - f) + sortedAsc[i + 1] * f;
}

function sampleRingHeights(
  hm: Float32Array,
  resolution: number,
  worldSize: number,
  cx: number,
  cz: number,
  radius: number,
  count: number,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const x = cx + Math.cos(a) * radius;
    const z = cz + Math.sin(a) * radius;
    out.push(sampleHm(hm, resolution, worldSize, x, z));
  }
  return out;
}

/**
 * surfaceY from local rim: sit slightly below a low percentile of the ring
 * so the free surface meets surrounding ground instead of floating.
 */
function chooseSurfaceY(
  hm: Float32Array,
  resolution: number,
  worldSize: number,
  cx: number,
  cz: number,
  radius: number,
  targetDepth: number,
): { surfaceY: number; rimY: number; centerG0: number } {
  const rim = sampleRingHeights(
    hm,
    resolution,
    worldSize,
    cx,
    cz,
    radius,
    RIM_SAMPLES,
  );
  const sorted = rim.slice().sort((a, b) => a - b);
  // P25: stable low rim — absolute min is too noisy
  const rimLow = percentile(sorted, 0.25);
  const rimMed = percentile(sorted, 0.5);
  const centerG0 = sampleHm(hm, resolution, worldSize, cx, cz);

  // Free surface below low rim; also not above center (need room to dig)
  const clearance = Math.min(
    POND_RIM_CLEARANCE_M,
    Math.max(0.03, targetDepth * 0.35),
  );
  let surfaceY = rimLow - clearance;
  // Cap: cannot sit above median rim (would float over most shore)
  surfaceY = Math.min(surfaceY, rimMed - clearance * 0.5);
  // Need dig room proportional to intended depth (puddles only need a few cm)
  const minColumn = Math.max(0.03, Math.min(0.12, targetDepth * 0.85));
  const maxSurfaceFromCenter = centerG0 - minColumn;
  surfaceY = Math.min(surfaceY, maxSurfaceFromCenter);
  // Force a little drop from rim so flat pads still wet
  const forced = rimMed - Math.max(targetDepth * 0.45, minColumn);
  surfaceY = Math.min(surfaceY, forced);

  const rimY = Math.max(rimLow, surfaceY + clearance);
  return { surfaceY, rimY, centerG0 };
}

function carvePondBasin(
  hm: Float32Array,
  resolution: number,
  worldSize: number,
  cx: number,
  cz: number,
  radius: number,
  surfaceY: number,
  targetDepth: number,
  preCarve: Float32Array,
): void {
  // Puddles: tighter soft blend so they stay local water spots
  const blend =
    targetDepth <= POND_PUDDLE_DEPTH_MAX_M
      ? STREAM_BANK_BLEND_WIDTH_M * 0.55
      : STREAM_BANK_BLEND_WIDTH_M * 1.1;
  const rMax = radius + blend;
  // Cap cut by intended depth (puddles must not dig full POND_MAX_CUT)
  const maxCut = Math.min(
    POND_MAX_CUT_M,
    Math.max(targetDepth * 1.35, targetDepth + 0.08),
  );
  const rimClear = Math.min(
    POND_RIM_CLEARANCE_M,
    Math.max(0.03, targetDepth * 0.4),
  );

  for (let r = 0; r < resolution; r++) {
    for (let c = 0; c < resolution; c++) {
      const { x, z } = gridToWorld(c, r, worldSize, resolution);
      const dist = Math.hypot(x - cx, z - cz);
      if (dist > rMax) continue;

      const t = dist / radius;
      let profile = 0;
      if (t <= 0.5) profile = 1;
      else if (t <= 1) {
        const u = (t - 0.5) / 0.5;
        // smoothstep 1 → 0
        profile = 1 - u * u * (3 - 2 * u);
      } else {
        const u = Math.min(1, (dist - radius) / blend);
        profile = (1 - u) * (1 - u) * 0.2;
      }
      if (profile <= 1e-4) continue;

      const i = idx(resolution, c, r);
      const g0 = preCarve[i];
      const desiredBed = surfaceY - targetDepth * profile;
      const maxBed = g0 - maxCut * Math.max(profile, 0.15);
      const target = Math.max(desiredBed, maxBed);
      if (hm[i] > target) hm[i] = target;

      // Soft rim raise outside wet core so shore sits above free surface
      // (very shallow puddles only need a light lip)
      if (dist > radius * 0.85 && dist < rMax) {
        const bankTarget = surfaceY + rimClear;
        const u = Math.min(
          1,
          Math.max(0, (dist - radius * 0.85) / (rMax - radius * 0.85)),
        );
        const raiseAmt =
          targetDepth <= POND_PUDDLE_DEPTH_MAX_M
            ? 0.15 + 0.45 * u
            : 0.25 + 0.75 * u;
        if (hm[i] < bankTarget) {
          hm[i] = hm[i] + (bankTarget - hm[i]) * raiseAmt;
        }
      }
    }
  }
}

/**
 * Irregular shore: along each ray, walk out from center until ground rises
 * to surfaceY (or max radius). That intersection is a shore vertex.
 */
function extractShorePolygon(
  hm: Float32Array,
  resolution: number,
  worldSize: number,
  cx: number,
  cz: number,
  maxRadius: number,
  surfaceY: number,
): Array<{ x: number; z: number }> {
  const cell = cellSize(worldSize, resolution);
  const step = Math.max(0.35, cell * 0.45);
  const polygon: Array<{ x: number; z: number }> = [];

  for (let i = 0; i < SHORE_RAYS; i++) {
    const ang = (i / SHORE_RAYS) * Math.PI * 2;
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    let lastWetX = cx;
    let lastWetZ = cz;
    let found = false;

    for (let d = step; d <= maxRadius + step; d += step) {
      const x = cx + dx * d;
      const z = cz + dz * d;
      const g = sampleHm(hm, resolution, worldSize, x, z);
      if (g > surfaceY - SHORE_EPS_M) {
        // Crossed shore: place vertex slightly inside wet side
        const back = Math.max(0, d - step * 0.5);
        lastWetX = cx + dx * back;
        lastWetZ = cz + dz * back;
        found = true;
        break;
      }
      lastWetX = x;
      lastWetZ = z;
    }
    if (!found) {
      // Escaped basin — clamp to max radius (wet all the way)
      lastWetX = cx + dx * maxRadius;
      lastWetZ = cz + dz * maxRadius;
    }
    polygon.push({ x: lastWetX, z: lastWetZ });
  }
  return polygon;
}

function inMap(
  x: number,
  z: number,
  worldSize: number,
  radius: number,
): boolean {
  const half = worldSize / 2;
  // Micro-puddles only need a small edge margin
  const margin = Math.max(4, radius + 3);
  return Math.abs(x) <= half - margin && Math.abs(z) <= half - margin;
}

/**
 * Dense scan: every relative depression (concave cell). Absolute elevation
 * is never used — a dimple on a ridge scores the same as one in a valley.
 */
function findAllDepressions(
  hm: Float32Array,
  resolution: number,
  worldSize: number,
  path: Vec3[],
  pathHalf: number,
): Array<{ x: number; z: number; bowl: number }> {
  const out: Array<{ x: number; z: number; bowl: number }> = [];
  // ~3–4 m stride on default map — catches hillside micro-dips
  const stride = Math.max(2, Math.floor(resolution / 72));
  const edge = Math.max(3, Math.floor(resolution * 0.04));
  /** Weakest concavity still counted (cm-scale OK). */
  const minBowl = 0.025;

  for (let r = edge; r < resolution - edge; r += stride) {
    for (let c = edge; c < resolution - edge; c += stride) {
      const h = hm[idx(resolution, c, r)];
      // 8-neighbor mean − center = relative concavity (m)
      let sum = 0;
      let n = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const rr = r + dr * stride;
          const cc = c + dc * stride;
          if (rr < 0 || rr >= resolution || cc < 0 || cc >= resolution) continue;
          sum += hm[idx(resolution, cc, rr)];
          n++;
        }
      }
      if (n < 6) continue;
      const bowl = sum / n - h;
      if (bowl < minBowl) continue;

      const { x, z } = gridToWorld(c, r, worldSize, resolution);
      // Only skip path core so the ribbon stays drivable
      if (pathDistXZ(x, z, path) < pathHalf * 0.45) continue;
      out.push({ x, z, bowl });
    }
  }
  return out;
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

/**
 * Independent random roll per depression. Stronger bowl → higher chance;
 * weak hillside dips still get a base chance (×2 density vs initial).
 */
function depressionSpawnChance(bowl: number, rng: () => number): boolean {
  // Was 0.22 + bowl*1.1 (cap 0.9); ×2 → more water without guaranteeing every dip
  const p = Math.min(0.98, (0.22 + bowl * 1.1) * 2);
  return rng() < p;
}

function classFromBowl(bowl: number, rng: () => number): PondClass {
  if (bowl >= 0.5) return rng() < 0.5 ? "deep" : "mid";
  if (bowl >= 0.18) return rng() < 0.4 ? "mid" : "puddle";
  return "puddle";
}

function canPlace(
  sites: PondSite[],
  x: number,
  z: number,
  radius: number,
  pondClass: PondClass,
): boolean {
  for (const s of sites) {
    // Micro-puddles pack very tight; only avoid true overlap
    const bothPuddle =
      pondClass === "puddle" && s.pondClass === "puddle";
    const sepPad = bothPuddle ? 0.35 : pondClass === "puddle" || s.pondClass === "puddle" ? 0.8 : 3.0;
    const minSep = s.radius + radius + sepPad;
    if (Math.hypot(s.x - x, s.z - z) < minSep) return false;
  }
  return true;
}

/**
 * Enumerate every relative dip (any altitude), shuffle, each rolls a die.
 * Soft cap from biome `count` prevents unlimited micro-puddles.
 */
function pickPondSites(
  hm: Float32Array,
  resolution: number,
  worldSize: number,
  path: Vec3[],
  pathHalf: number,
  count: number,
  rng: () => number,
): PondSite[] {
  const sites: PondSite[] = [];
  if (count <= 0) return sites;

  // Headroom so depression rolls aren't hard-capped at target
  const softMax = Math.max(count, Math.floor(count * 1.5));

  const dips = findAllDepressions(
    hm,
    resolution,
    worldSize,
    path,
    pathHalf,
  );
  // Random order — weak hillside dips aren't always after deep valleys
  shuffleInPlace(dips, rng);

  for (const d of dips) {
    if (sites.length >= softMax) break;
    if (!depressionSpawnChance(d.bowl, rng)) continue;

    const pondClass = classFromBowl(d.bowl, rng);
    const { targetDepth, radius } = rollDepthAndRadius(pondClass, rng);
    const j = Math.min(1.5, radius * 0.2);
    const x = d.x + (rng() - 0.5) * j * 2;
    const z = d.z + (rng() - 0.5) * j * 2;
    if (!inMap(x, z, worldSize, radius)) continue;
    if (pathDistXZ(x, z, path) < pathHalf * 0.45) continue;
    if (!canPlace(sites, x, z, radius, pondClass)) continue;

    sites.push({ x, z, radius, targetDepth, pondClass });
  }

  // Second pass if unlucky rolls left us short of target
  if (sites.length < count) {
    shuffleInPlace(dips, rng);
    for (const d of dips) {
      if (sites.length >= count) break;
      // Second pass also ×2-ish accept rate when under target
      if (rng() > 0.78 + Math.min(0.2, d.bowl)) continue;
      const pondClass = classFromBowl(d.bowl, rng);
      const { targetDepth, radius } = rollDepthAndRadius(pondClass, rng);
      const x = d.x + (rng() - 0.5);
      const z = d.z + (rng() - 0.5);
      if (!inMap(x, z, worldSize, radius)) continue;
      if (pathDistXZ(x, z, path) < pathHalf * 0.45) continue;
      if (!canPlace(sites, x, z, radius, pondClass)) continue;
      sites.push({ x, z, radius, targetDepth, pondClass });
    }
  }

  return sites;
}

/**
 * Place ponds only. Streams array always empty in pond-only mode.
 */
export function placePonds(
  hm: Float32Array,
  resolution: number,
  worldSize: number,
  path: Vec3[],
  pathHalf: number,
  pondCount: number,
  rng: () => number,
): PlacedHydrology {
  const ponds: PondBody[] = [];
  if (pondCount <= 0) return { streams: [], ponds };

  const preCarve = new Float32Array(hm);
  const sites = pickPondSites(
    hm,
    resolution,
    worldSize,
    path,
    pathHalf,
    pondCount,
    rng,
  );

  for (let i = 0; i < sites.length; i++) {
    const { x: cx, z: cz, radius, targetDepth, pondClass } = sites[i];
    const minColumn = Math.max(0.03, Math.min(0.12, targetDepth * 0.85));
    const { surfaceY, rimY, centerG0 } = chooseSurfaceY(
      hm,
      resolution,
      worldSize,
      cx,
      cz,
      radius,
      targetDepth,
    );

    carvePondBasin(
      hm,
      resolution,
      worldSize,
      cx,
      cz,
      radius,
      surfaceY,
      targetDepth,
      preCarve,
    );

    // Shore from final carved heightfield
    const blendPad =
      pondClass === "puddle"
        ? STREAM_BANK_BLEND_WIDTH_M * 0.5
        : STREAM_BANK_BLEND_WIDTH_M * 0.9;
    const maxShoreR = radius + blendPad;
    const polygon = extractShorePolygon(
      hm,
      resolution,
      worldSize,
      cx,
      cz,
      maxShoreR,
      surfaceY,
    );

    // If polygon collapsed, skip (failed basin)
    if (polygon.length < 5) continue;
    let areaApprox = 0;
    for (let k = 0; k < polygon.length; k++) {
      const a = polygon[k];
      const b = polygon[(k + 1) % polygon.length];
      areaApprox += a.x * b.z - b.x * a.z;
    }
    areaApprox = Math.abs(areaApprox) * 0.5;
    // Allow sub-1 m wet patches (tiny radial shore is fine)
    const minArea =
      pondClass === "puddle" ? Math.PI * 0.25 * 0.25 : Math.PI * 1.2 * 1.2;
    if (areaApprox < minArea) continue;

    const bedY = sampleHm(hm, resolution, worldSize, cx, cz);
    // Ensure we actually have a water column (puddles allow a few cm)
    let finalSurface = surfaceY;
    if (finalSurface < bedY + minColumn) {
      finalSurface = bedY + minColumn;
    }
    // Re-check: surface must not sit above most rim after carve
    const rimAfter = sampleRingHeights(
      hm,
      resolution,
      worldSize,
      cx,
      cz,
      radius * 0.95,
      24,
    );
    const rimSorted = rimAfter.slice().sort((a, b) => a - b);
    const rimP20 = percentile(rimSorted, 0.2);
    const rimClear = Math.min(
      POND_RIM_CLEARANCE_M,
      Math.max(0.03, targetDepth * 0.35),
    );
    finalSurface = Math.min(finalSurface, rimP20 - rimClear * 0.5);
    if (finalSurface < bedY + minColumn * 0.85) {
      finalSurface = bedY + minColumn * 0.85;
    }

    // Re-extract shore at final surface (cheap, keeps polygon flush)
    const shore = extractShorePolygon(
      hm,
      resolution,
      worldSize,
      cx,
      cz,
      maxShoreR,
      finalSurface,
    );

    void centerG0;
    ponds.push({
      id: `pond_${i}`,
      kind: "pond",
      center: { x: cx, z: cz },
      radius,
      polygon: shore.length >= 5 ? shore : polygon,
      surfaceY: finalSurface,
      bedY,
      rimY: Math.max(rimY, finalSurface + rimClear),
      connections: [],
    });
  }

  return { streams: [], ponds };
}

/** @deprecated alias — pond-only mode; ignores stream path half except clearance. */
export function placeStreams(
  hm: Float32Array,
  resolution: number,
  worldSize: number,
  path: Vec3[],
  pathHalf: number,
  count: number,
  rng: () => number,
): PlacedHydrology {
  // Map old "stream count" to pond count (same density signal)
  return placePonds(hm, resolution, worldSize, path, pathHalf, count, rng);
}
