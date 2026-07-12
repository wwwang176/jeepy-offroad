import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { LevelData } from "@/levelgen/types";
import { sampleBilinear } from "@/levelgen/heightmap";
import { mulberry32 } from "@/levelgen/rng";
import {
  placeSnowMounds,
  snowDomeFalloff,
  SNOW_MOUND_SEED_XOR,
  type SnowCoverConfig,
  type SnowMound,
} from "@/shared/snowCover";

const RADIAL_SEGMENTS = 24;
const RINGS = 6;

/**
 * Build one soft snow dome: rounded mound sitting on the rock.
 * Center thick, rim feathers to terrain — not a heightfield grid drape.
 */
export function buildSnowMoundGeometry(
  mound: SnowMound,
  sampleY: (x: number, z: number) => number,
): THREE.BufferGeometry {
  const { x: cx, z: cz, radius, peakThickness, phase } = mound;
  const positions: number[] = [];
  const indices: number[] = [];

  // Center vertex
  const y0 = sampleY(cx, cz) + peakThickness + 0.03;
  positions.push(cx, y0, cz);

  for (let ring = 1; ring <= RINGS; ring++) {
    const u = ring / RINGS;
    const falloff = snowDomeFalloff(u);
    for (let s = 0; s < RADIAL_SEGMENTS; s++) {
      const ang = (s / RADIAL_SEGMENTS) * Math.PI * 2;
      // Slight lobe so patches aren't perfect circles
      const lob =
        1 +
        0.1 * Math.sin(ang * 2 + phase) +
        0.06 * Math.cos(ang * 3 - phase * 0.7);
      const r = radius * u * lob;
      const x = cx + Math.cos(ang) * r;
      const z = cz + Math.sin(ang) * r;
      const ground = sampleY(x, z);
      // Rounded volume above rock; edge ~ flush with terrain
      const y = ground + peakThickness * falloff + 0.02;
      positions.push(x, y, z);
    }
  }

  // Center → first ring. Winding must face +Y (CCW from above).
  // Order 0,a,b with a=+X then b=+Z yields normal −Y — flip to 0,b,a.
  for (let s = 0; s < RADIAL_SEGMENTS; s++) {
    const a = 1 + s;
    const b = 1 + ((s + 1) % RADIAL_SEGMENTS);
    indices.push(0, b, a);
  }
  // Ring quads (same flip so outer rings also face sky)
  for (let ring = 1; ring < RINGS; ring++) {
    const ringStart = 1 + (ring - 1) * RADIAL_SEGMENTS;
    const nextStart = 1 + ring * RADIAL_SEGMENTS;
    for (let s = 0; s < RADIAL_SEGMENTS; s++) {
      const s1 = (s + 1) % RADIAL_SEGMENTS;
      const a = ringStart + s;
      const b = ringStart + s1;
      const c = nextStart + s;
      const d = nextStart + s1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(new Float32Array(positions), 3),
  );
  geo.setIndex(indices);
  // Smooth normals for round read (not flat terrain facets)
  geo.computeVertexNormals();
  return geo;
}

/**
 * Pond-like decorative snow: many soft rounded mounds, no collider.
 * Merged into one mesh for a single draw call.
 */
export function createSnowCoverMesh(
  level: LevelData,
  cfg: SnowCoverConfig,
  pathWidth?: number,
): THREE.Mesh | null {
  const pathHalf = (pathWidth ?? 4) * 0.75;
  const sampleY = (x: number, z: number) =>
    sampleBilinear(
      level.heightmap,
      level.resolution,
      level.worldSize,
      x,
      z,
    );

  const rng = mulberry32((level.seed ^ SNOW_MOUND_SEED_XOR) >>> 0);
  const mounds = placeSnowMounds({
    heightmap: level.heightmap,
    resolution: level.resolution,
    worldSize: level.worldSize,
    pathPolyline: level.pathPolyline,
    pathHalfWidth: pathHalf,
    cfg,
    rng,
    sampleY,
  });

  if (mounds.length === 0) return null;

  const geos = mounds.map((m) => buildSnowMoundGeometry(m, sampleY));
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) return null;

  merged.computeVertexNormals();

  const color = new THREE.Color(cfg.color);
  const opacity = cfg.opacity ?? 0.97;
  const mat = new THREE.MeshLambertMaterial({
    color,
    // Smooth shading — soft snow, not low-poly rock facets
    flatShading: false,
    transparent: opacity < 0.999,
    opacity,
    depthWrite: opacity >= 0.9,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    side: THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(merged, mat);
  mesh.name = "snow-cover";
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = true;
  mesh.userData.noCollision = true;
  mesh.userData.moundCount = mounds.length;
  return mesh;
}
