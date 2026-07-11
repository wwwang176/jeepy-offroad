import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { LevelData } from "@/levelgen/types";
import type { BiomeProfile, PropSpawnRule } from "@/biome/types";
import { mulberry32 } from "@/levelgen/rng";
import { idx, worldToGrid } from "@/shared/coords";
import { clamp, lerp } from "@/shared/math";
import { FINISH_COLUMN_HEIGHT_M } from "@/shared/finishMarker";
import { createTerrainMesh } from "./TerrainMesh";
import { createJeepMesh, syncJeepMesh } from "./JeepMesh";
import {
  createFollowShadows,
  setShadowFlags,
  type FollowShadowHandles,
} from "./followShadows";
import { rainImpactHeight } from "@/shared/offroadFxMath";
import { RainVFX } from "./RainVFX";

export type GameSceneHandles = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  jeepMesh: THREE.Group;
  terrainMesh: THREE.Mesh;
  finishMesh: THREE.Object3D;
  /** Recenters local shadow map around camera / vehicle. */
  updateShadows: (follow: { x: number; y: number; z: number }) => void;
  /** Vegetation wind clock (palms + grass). Seconds. No-op if none. */
  updatePalmSway: (elapsedSec: number) => void;
  /** Light rain + ground splash (rainforest). No-op if none. */
  updateRain: (
    dt: number,
    camPos: { x: number; y: number; z: number },
  ) => void;
  dispose: () => void;
};

function hexToNumber(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}

/**
 * Horizontal rectangular frame (outer square with inner hole), lying on XZ.
 * Sized to sit inside the flattened start pad.
 */
function createStartRectRing(
  outerHalf = 2.7,
  innerHalf = 2.15,
): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-outerHalf, -outerHalf);
  shape.lineTo(outerHalf, -outerHalf);
  shape.lineTo(outerHalf, outerHalf);
  shape.lineTo(-outerHalf, outerHalf);
  shape.closePath();

  const hole = new THREE.Path();
  hole.moveTo(-innerHalf, -innerHalf);
  hole.lineTo(-innerHalf, innerHalf);
  hole.lineTo(innerHalf, innerHalf);
  hole.lineTo(innerHalf, -innerHalf);
  hole.closePath();
  shape.holes.push(hole);

  const geo = new THREE.ShapeGeometry(shape);
  // Shape is in XY → lay flat on ground (XZ)
  geo.rotateX(-Math.PI / 2);

  return new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({
      color: 0x66aaff,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
}

/** Bilinear sample of heightmap at world XZ. */
function sampleHeight(level: LevelData, x: number, z: number): number {
  const { resolution: res, worldSize, heightmap } = level;
  const { col, row, fx, fz } = worldToGrid(x, z, worldSize, res);
  const c0 = clamp(col, 0, res - 2);
  const r0 = clamp(row, 0, res - 2);
  const h00 = heightmap[idx(res, c0, r0)];
  const h10 = heightmap[idx(res, c0 + 1, r0)];
  const h01 = heightmap[idx(res, c0, r0 + 1)];
  const h11 = heightmap[idx(res, c0 + 1, r0 + 1)];
  const hx0 = lerp(h00, h10, fx);
  const hx1 = lerp(h01, h11, fx);
  return lerp(hx0, hx1, fz);
}

/** Super-tall soft green finish column (XZ from level, Y from FINISH_COLUMN_HEIGHT_M). */
function createFinishMarker(finish: LevelData["finish"]): THREE.Group {
  const group = new THREE.Group();
  group.name = "finish-marker";

  const volGeo = new THREE.BoxGeometry(
    finish.halfExtents.x * 2,
    FINISH_COLUMN_HEIGHT_M,
    finish.halfExtents.z * 2,
  );
  const volMat = new THREE.MeshLambertMaterial({
    color: 0x44ff88,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  const volume = new THREE.Mesh(volGeo, volMat);
  volume.name = "finish-volume";
  // Centered on finish.position so it matches FinishSystem AABB
  volume.position.set(0, 0, 0);
  group.add(volume);

  group.position.set(finish.position.x, finish.position.y, finish.position.z);
  group.rotation.y = finish.yaw;

  return group;
}

/**
 * Pond water meshes from levelgen only (pond-only hydrology).
 * Flat fan at pond.surfaceY over irregular shore polygon — no heightmap drape.
 */
function createStreamMeshes(
  level: LevelData,
  waterColor: string,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "water";
  const color = hexToNumber(waterColor);

  const waterMat = () =>
    new THREE.MeshLambertMaterial({
      color,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      flatShading: true,
      side: THREE.DoubleSide,
    });

  for (const pond of level.ponds ?? []) {
    const poly = pond.polygon;
    if (!poly || poly.length < 3) continue;
    const y = pond.surfaceY;
    // Fan from centroid of polygon (more stable than pond.center for irregular)
    let cx = 0;
    let cz = 0;
    for (const p of poly) {
      cx += p.x;
      cz += p.z;
    }
    cx /= poly.length;
    cz /= poly.length;

    const positions: number[] = [cx, y, cz];
    const indices: number[] = [];
    for (const p of poly) {
      positions.push(p.x, y, p.z);
    }
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      indices.push(0, 1 + i, 1 + ((i + 1) % n));
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, waterMat());
    mesh.name = pond.id ?? "pond";
    group.add(mesh);
  }

  return group;
}

function pickProp(table: PropSpawnRule[], rng: () => number): PropSpawnRule | null {
  if (table.length === 0) return null;
  const total = table.reduce((s, r) => s + r.weight, 0);
  if (total <= 0) return null;
  let t = rng() * total;
  for (const rule of table) {
    t -= rule.weight;
    if (t <= 0) return rule;
  }
  return table[table.length - 1];
}

function createPropMesh(
  meshKey: string,
  rng: () => number = Math.random,
): THREE.Object3D {
  switch (meshKey) {
    case "rock_pile": {
      const g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({
        color: 0x7a756c,
        flatShading: true,
      });
      const sizes = [0.7, 0.5, 0.4];
      const offsets = [
        [0, 0.25, 0],
        [0.35, 0.18, 0.15],
        [-0.3, 0.15, 0.2],
      ];
      for (let i = 0; i < 3; i++) {
        const geo = new THREE.DodecahedronGeometry(sizes[i], 0);
        const m = new THREE.Mesh(geo, mat);
        m.position.set(offsets[i][0], offsets[i][1], offsets[i][2]);
        m.rotation.set(0.2 * i, 0.5 * i, 0.1 * i);
        g.add(m);
      }
      return g;
    }
    case "pillar_rock": {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.55, 2.2, 6),
        new THREE.MeshLambertMaterial({ color: 0x8a8680, flatShading: true }),
      );
      m.position.y = 1.1;
      return m;
    }
    case "cactus": {
      // Single-plant path (rare); decorative spawn merges instead.
      const parts = buildCactusParts(rng);
      const g = new THREE.Group();
      g.name = "cactus";
      const bodyMat = new THREE.MeshLambertMaterial({
        color: 0x3d7a3a,
        flatShading: true,
      });
      const tipMat = new THREE.MeshLambertMaterial({
        color: 0x4a8f42,
        flatShading: true,
      });
      for (const geo of parts.bodies) g.add(new THREE.Mesh(geo, bodyMat));
      for (const geo of parts.tips) g.add(new THREE.Mesh(geo, tipMat));
      return g;
    }
    case "coconut_palm": {
      // Single-tree path (tests / rare); decorative spawn merges instead.
      const parts = buildCoconutPalmParts(rng);
      const g = new THREE.Group();
      g.name = "coconut_palm";
      g.add(
        new THREE.Mesh(
          parts.trunk,
          new THREE.MeshLambertMaterial({ color: 0x8b6508, flatShading: true }),
        ),
      );
      const frondMat = new THREE.MeshLambertMaterial({
        color: 0x2d8a2d,
        side: THREE.DoubleSide,
        flatShading: true,
      });
      for (const f of parts.fronds) g.add(new THREE.Mesh(f, frondMat));
      return g;
    }
    case "jungle_bush": {
      const g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({
        color: 0x2a6a28,
        flatShading: true,
      });
      for (let i = 0; i < 3; i++) {
        const leaf = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.45 + i * 0.08, 0),
          mat,
        );
        leaf.position.set(
          (i - 1) * 0.28,
          0.35 + i * 0.08,
          (i % 2) * 0.15 - 0.05,
        );
        leaf.scale.set(1, 0.65, 1);
        g.add(leaf);
      }
      return g;
    }
    default: {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.6, 0.6),
        new THREE.MeshLambertMaterial({ color: 0x666666, flatShading: true }),
      );
      m.position.y = 0.3;
      return m;
    }
  }
}

type PalmParts = {
  trunk: THREE.BufferGeometry;
  fronds: THREE.BufferGeometry[];
};

/**
 * Local-space palm parts (ground at y=0), matched to island-conquest
 * `Island._generateVegetation`: trunk bend + 6 fronds with sway + bob.
 */
function buildCoconutPalmParts(rng: () => number): PalmParts {
  const trunkH = 6 + Math.abs(rng()) * 4.5;
  const bendX = (rng() * 2 - 1) * 0.8;
  const bendZ = (rng() * 2 - 1) * 0.8;
  const treePhase = rng() * Math.PI * 2;

  const trunk = new THREE.CylinderGeometry(0.08, 0.18, trunkH, 5, 4);
  const trunkPos = trunk.attributes.position;
  const trunkSf = new Float32Array(trunkPos.count);
  const trunkSp = new Float32Array(trunkPos.count);
  for (let j = 0; j < trunkPos.count; j++) {
    const ty = (trunkPos.getY(j) + trunkH / 2) / trunkH;
    trunkPos.setX(j, trunkPos.getX(j) + bendX * ty * ty);
    trunkPos.setZ(j, trunkPos.getZ(j) + bendZ * ty * ty);
    // Tip sways more (reference: swayFactor = ty²)
    trunkSf[j] = ty * ty;
    trunkSp[j] = treePhase;
  }
  trunk.setAttribute("swayFactor", new THREE.BufferAttribute(trunkSf, 1));
  trunk.setAttribute("swayPhase", new THREE.BufferAttribute(trunkSp, 1));
  trunk.computeVertexNormals();
  trunk.translate(0, trunkH / 2, 0);

  const topX = bendX;
  const topZ = bendZ;
  const topY = trunkH;
  const fronds: THREE.BufferGeometry[] = [];
  for (let f = 0; f < 6; f++) {
    const angle = (f / 6) * Math.PI * 2 + rng() * 0.4;
    const len = 2 + rng();
    const frondGeo = new THREE.BufferGeometry();
    frondGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([
          0,
          0,
          0,
          Math.cos(angle) * len,
          -0.5,
          Math.sin(angle) * len,
          Math.cos(angle + 0.3) * len * 0.7,
          0.1,
          Math.sin(angle + 0.3) * len * 0.7,
          Math.cos(angle - 0.3) * len * 0.7,
          0.1,
          Math.sin(angle - 0.3) * len * 0.7,
        ]),
        3,
      ),
    );
    frondGeo.setIndex([0, 1, 2, 0, 3, 1]);
    // Full sway on fronds (reference fill 1.0)
    frondGeo.setAttribute(
      "swayFactor",
      new THREE.BufferAttribute(new Float32Array(4).fill(1), 1),
    );
    frondGeo.setAttribute(
      "swayPhase",
      new THREE.BufferAttribute(new Float32Array(4).fill(treePhase), 1),
    );
    // Per-frond bob phase (~60° apart) — island-conquest
    frondGeo.setAttribute(
      "bobPhase",
      new THREE.BufferAttribute(
        new Float32Array(4).fill(treePhase + f * 1.047),
        1,
      ),
    );
    // Anchor = frond base (tree tip) before world bake; bakePalmWorld transforms it
    frondGeo.setAttribute(
      "anchor",
      new THREE.BufferAttribute(
        new Float32Array([
          topX,
          topY,
          topZ,
          topX,
          topY,
          topZ,
          topX,
          topY,
          topZ,
          topX,
          topY,
          topZ,
        ]),
        3,
      ),
    );
    frondGeo.translate(topX, topY, topZ);
    frondGeo.computeVertexNormals();
    fronds.push(frondGeo);
  }

  return { trunk, fronds };
}

/** GLSL vertex injection shared by color + depth palm materials. */
function palmSwayBeginVertexGlsl(withBob: boolean): string {
  if (withBob) {
    // island-conquest frond path: rotate about tip, then XZ wind
    return /* glsl */ `#include <begin_vertex>
vec3 off = transformed - anchor;
float rAx = sin(uSwayTime * 2.0 + bobPhase * 2.3) * 0.08;
float crx = cos(rAx), srx = sin(rAx);
vec3 r1 = vec3(off.x, off.y * crx - off.z * srx, off.y * srx + off.z * crx);
float rAz = sin(uSwayTime * 1.7 + bobPhase * 1.9) * 0.08;
float crz = cos(rAz), srz = sin(rAz);
transformed = anchor + vec3(r1.x * crz - r1.y * srz, r1.x * srz + r1.y * crz, r1.z);
transformed.x += sin(uSwayTime * 1.5 + swayPhase) * 0.2 * swayFactor;
transformed.z += sin(uSwayTime * 1.1 + swayPhase * 1.7) * 0.15 * swayFactor;
`;
  }
  return /* glsl */ `#include <begin_vertex>
transformed.x += sin(uSwayTime * 1.5 + swayPhase) * 0.2 * swayFactor;
transformed.z += sin(uSwayTime * 1.1 + swayPhase * 1.7) * 0.15 * swayFactor;
`;
}

function palmSwayCommonGlsl(withBob: boolean): string {
  return (
    /* glsl */ `#include <common>
attribute float swayFactor;
attribute float swayPhase;
uniform float uSwayTime;
` + (withBob ? /* glsl */ `attribute float bobPhase;
attribute vec3 anchor;
` : "")
  );
}

/**
 * Palm wind via onBeforeCompile — matched to island-conquest Island.js.
 * Trunk: XZ sway only. Fronds (withBob): tip rotation bob + XZ sway.
 */
function createPalmSwayMaterial(
  params: THREE.MeshLambertMaterialParameters,
  swayTime: { value: number },
  cacheKey: string,
  withBob = false,
): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial(params);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSwayTime = swayTime;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      palmSwayCommonGlsl(withBob),
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      palmSwayBeginVertexGlsl(withBob),
    );
  };
  mat.customProgramCacheKey = () => cacheKey;
  return mat;
}

function createPalmSwayDepthMaterial(
  swayTime: { value: number },
  withBob = false,
): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSwayTime = swayTime;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      palmSwayCommonGlsl(withBob),
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      palmSwayBeginVertexGlsl(withBob),
    );
  };
  mat.customProgramCacheKey = () =>
    withBob ? "palm-sway-depth-bob-v2" : "palm-sway-depth-v2";
  return mat;
}

/** Bake local palm geo into world pose (position / yaw / uniform scale). */
function bakePalmWorld(
  geo: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  yaw: number,
  scale: number,
): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(scale, scale, scale),
  );
  geo.applyMatrix4(m);
  // applyMatrix4 only moves position/normal — keep frond tip anchor in world space
  const anchor = geo.getAttribute("anchor");
  if (anchor && "isBufferAttribute" in anchor) {
    const v = new THREE.Vector3();
    for (let i = 0; i < anchor.count; i++) {
      v.fromBufferAttribute(anchor as THREE.BufferAttribute, i);
      v.applyMatrix4(m);
      (anchor as THREE.BufferAttribute).setXYZ(i, v.x, v.y, v.z);
    }
    anchor.needsUpdate = true;
  }
  return geo;
}

/** Bake local prop geo with full Euler (YXZ) + uniform scale — cactus tilt. */
function bakePropWorld(
  geo: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  rotX: number,
  rotY: number,
  rotZ: number,
  scale: number,
): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rotX, rotY, rotZ, "YXZ"),
    ),
    new THREE.Vector3(scale, scale, scale),
  );
  geo.applyMatrix4(m);
  return geo;
}

type CactusParts = {
  bodies: THREE.BufferGeometry[];
  tips: THREE.BufferGeometry[];
};

/**
 * Low-poly saguaro parts in plant-local space (ground at y=0).
 * Bodies = green flesh; tips = slightly lighter caps.
 */
function buildCactusParts(rng: () => number): CactusParts {
  const bodies: THREE.BufferGeometry[] = [];
  const tips: THREE.BufferGeometry[] = [];
  const h = 1.4 + rng() * 1.1;
  const r = 0.16 + rng() * 0.06;

  const trunk = new THREE.CylinderGeometry(r * 0.92, r, h, 6);
  trunk.translate(0, h * 0.5, 0);
  bodies.push(trunk);

  const tip = new THREE.SphereGeometry(r * 0.95, 5, 4);
  tip.scale(1, 0.7, 1);
  tip.translate(0, h, 0);
  tips.push(tip);

  const arms = rng() < 0.35 ? 0 : rng() < 0.55 ? 1 : 2;
  for (let a = 0; a < arms; a++) {
    const side = a === 0 ? 1 : -1;
    const armH = 0.45 + rng() * 0.45;
    const attachY = h * (0.4 + rng() * 0.25);
    const out = r + 0.12 + rng() * 0.08;
    const zJ = (rng() - 0.5) * 0.08;

    const stub = new THREE.CylinderGeometry(r * 0.55, r * 0.6, out, 5);
    stub.rotateZ((side * Math.PI) / 2);
    stub.translate((side * out) * 0.5, attachY, zJ);
    bodies.push(stub);

    const arm = new THREE.CylinderGeometry(r * 0.5, r * 0.55, armH, 5);
    arm.translate(side * out, attachY + armH * 0.5, zJ);
    bodies.push(arm);

    const armTip = new THREE.SphereGeometry(r * 0.52, 5, 4);
    armTip.scale(1, 0.65, 1);
    armTip.translate(side * out, attachY + armH, zJ);
    tips.push(armTip);
  }
  return { bodies, tips };
}

function mergeOrNull(
  geos: THREE.BufferGeometry[],
): THREE.BufferGeometry | null {
  if (geos.length === 0) return null;
  if (geos.length === 1) return geos[0]!;
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return merged;
}

/**
 * One low grass clump (several thin blades) — local origin on ground.
 * Used as InstancedMesh prototype for rainforest ground cover.
 */
function createJungleGrassClumpGeometry(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  // 7 thin blades, slightly splayed (height ×3 vs original short clump)
  for (let i = 0; i < 7; i++) {
    const ang = (i / 7) * Math.PI * 2 + i * 0.15;
    const h = (0.35 + (i % 3) * 0.08) * 3;
    const blade = new THREE.ConeGeometry(0.05, h, 3);
    blade.translate(0, h * 0.5, 0);
    // Lean outward
    const m = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(0.35 + (i % 2) * 0.15, ang, 0.08, "YXZ"),
    );
    m.setPosition(
      Math.cos(ang) * 0.1,
      0,
      Math.sin(ang) * 0.1,
    );
    blade.applyMatrix4(m);
    blades.push(blade);
  }
  const merged = mergeGeometries(blades, false);
  for (const b of blades) b.dispose();
  if (!merged) {
    // Fallback single blade
    const g = new THREE.ConeGeometry(0.06, 1.2, 3);
    g.translate(0, 0.6, 0);
    return g;
  }
  merged.computeVertexNormals();
  return merged;
}

/**
 * Instanced grass wind — tip-heavy sway; phase from instance world XZ
 * (same clock as palms via shared swayTime uniform).
 */
function createGrassSwayMaterial(
  swayTime: { value: number },
): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({
    color: 0x3a7a2a,
    flatShading: true,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSwayTime = swayTime;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      /* glsl */ `#include <common>
uniform float uSwayTime;
`,
    );
    // Sway in local space before project/instance so blades bend from base
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      /* glsl */ `#include <begin_vertex>
float grassSway = clamp(position.y * 0.75, 0.0, 1.0);
float phase = 0.0;
#ifdef USE_INSTANCING
  phase = instanceMatrix[3].x * 0.45 + instanceMatrix[3].z * 0.31;
#endif
transformed.x += sin(uSwayTime * 2.4 + phase) * 0.14 * grassSway;
transformed.z += sin(uSwayTime * 1.9 + phase * 1.4) * 0.11 * grassSway;
`,
    );
  };
  mat.customProgramCacheKey = () => "grass-sway-instanced-v1";
  return mat;
}

/** Scatter short grass clumps (1 InstancedMesh draw call + wind). */
function addJungleGrassCover(
  group: THREE.Group,
  level: LevelData,
  biome: BiomeProfile,
  rng: () => number,
  swayTime: { value: number },
): void {
  const coverScale = biome.groundCoverCountScale ?? 0;
  if (coverScale <= 0) return;

  const density = clamp(biome.propDensity, 0, 1);
  const tries = Math.floor((20 + density * 40) * coverScale);
  const half = level.worldSize * 0.5 - 8;
  // Grass may sit closer to the path than trees
  const pathHalf = (biome.pathWidth ?? 4) * 0.85;

  const nearPath = (x: number, z: number): boolean => {
    for (const p of level.pathPolyline) {
      if (Math.hypot(x - p.x, z - p.z) < pathHalf) return true;
    }
    return false;
  };

  type Pose = { x: number; y: number; z: number; yaw: number; s: number };
  const poses: Pose[] = [];
  for (let i = 0; i < tries; i++) {
    const x = (rng() * 2 - 1) * half;
    const z = (rng() * 2 - 1) * half;
    if (nearPath(x, z)) continue;
    if (
      Math.hypot(x - level.start.position.x, z - level.start.position.z) < 8
    ) {
      continue;
    }
    if (
      Math.hypot(x - level.finish.position.x, z - level.finish.position.z) < 10
    ) {
      continue;
    }
    if (rng() > 0.88) continue;
    const y = sampleHeight(level, x, z);
    poses.push({
      x,
      y,
      z,
      yaw: rng() * Math.PI * 2,
      // Wide size variety: short tufts ~0.35× → tall clumps ~2.6×
      s: 0.35 + rng() * 2.25,
    });
  }
  if (poses.length === 0) return;

  const geo = createJungleGrassClumpGeometry();
  const mat = createGrassSwayMaterial(swayTime);
  const mesh = new THREE.InstancedMesh(geo, mat, poses.length);
  mesh.name = "jungle-grass";
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;

  const mat4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < poses.length; i++) {
    const p = poses[i]!;
    pos.set(p.x, p.y, p.z);
    quat.setFromAxisAngle(up, p.yaw);
    scl.set(p.s, p.s * (0.85 + (i % 5) * 0.04), p.s);
    mat4.compose(pos, quat, scl);
    mesh.setMatrixAt(i, mat4);
  }
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
}

function disposeObject3D(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose();
      const mat = child.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    }
  });
}

/**
 * Decorative props from biome.propTable. Non-colliding, seeded.
 * Coconut palms + cacti are merged into few draw calls; rocks stay individual.
 */
function createDecorativeProps(
  level: LevelData,
  biome: BiomeProfile,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "props";
  const rng = mulberry32((level.seed ^ 0x9e3779b9) >>> 0);
  const density = clamp(biome.propDensity, 0, 1);
  const scale = Math.max(0.25, biome.propCountScale ?? 1);
  // Base ~12–48 × biome scale (rainforest 15 → many palm placement tries).
  const count = Math.floor((12 + density * 36) * scale);
  const half = level.worldSize * 0.5 - 8;
  const pathHalf = (biome.pathWidth ?? 4) * 1.25;
  const table = biome.propTable.filter((p) => !p.collides);

  const palmTrunks: THREE.BufferGeometry[] = [];
  const palmFronds: THREE.BufferGeometry[] = [];
  const cactusBodies: THREE.BufferGeometry[] = [];
  const cactusTips: THREE.BufferGeometry[] = [];
  /** Shared clock for palm wind (seconds); GameApp ticks via updatePalmSway. */
  const palmSwayTime = { value: 0 };
  group.userData.palmSwayTime = palmSwayTime;

  const nearPath = (x: number, z: number): boolean => {
    for (const p of level.pathPolyline) {
      if (Math.hypot(x - p.x, z - p.z) < pathHalf) return true;
    }
    return false;
  };

  const placedCount = new Map<string, number>();
  const bumpPlaced = (key: string): void => {
    placedCount.set(key, (placedCount.get(key) ?? 0) + 1);
  };

  const tryPlaceAt = (
    meshKey: string,
    x: number,
    z: number,
    yaw: number,
  ): boolean => {
    if (nearPath(x, z)) return false;
    if (
      Math.hypot(x - level.start.position.x, z - level.start.position.z) < 10
    ) {
      return false;
    }
    if (
      Math.hypot(x - level.finish.position.x, z - level.finish.position.z) < 12
    ) {
      return false;
    }
    const y = sampleHeight(level, x, z);
    if (meshKey === "coconut_palm") {
      const s = 0.75 + rng() * 0.7;
      const parts = buildCoconutPalmParts(rng);
      palmTrunks.push(bakePalmWorld(parts.trunk, x, y, z, yaw, s));
      for (const f of parts.fronds) {
        palmFronds.push(bakePalmWorld(f, x, y, z, yaw, s));
      }
      bumpPlaced(meshKey);
      return true;
    }
    if (meshKey === "cactus") {
      // Merge path: bake each plant into shared body/tip batches (2 draw calls).
      const s = 0.85 + rng() * 0.5;
      const rotX = (rng() - 0.5) * 0.24;
      const rotZ = (rng() - 0.5) * 0.24;
      const parts = buildCactusParts(rng);
      for (const geo of parts.bodies) {
        cactusBodies.push(bakePropWorld(geo, x, y, z, rotX, yaw, rotZ, s));
      }
      for (const geo of parts.tips) {
        cactusTips.push(bakePropWorld(geo, x, y, z, rotX, yaw, rotZ, s));
      }
      bumpPlaced(meshKey);
      return true;
    }
    const prop = createPropMesh(meshKey, rng);
    prop.position.set(x, y, z);
    // Random facing + tilt so rocks don't look stamped
    prop.rotation.order = "YXZ";
    prop.rotation.y = yaw;
    prop.rotation.x = (rng() - 0.5) * 0.7;
    prop.rotation.z = (rng() - 0.5) * 0.7;
    prop.scale.setScalar(0.85 + rng() * 0.5);
    group.add(prop);
    bumpPlaced(meshKey);
    return true;
  };

  for (let i = 0; i < count; i++) {
    const x = (rng() * 2 - 1) * half;
    const z = (rng() * 2 - 1) * half;
    // High-density biomes accept most candidates; sparse biomes stay sparse
    const accept = density >= 0.95 ? 0.92 : density * 0.85 + 0.15;
    if (rng() > accept) continue;

    const rule = pickProp(table, rng);
    if (!rule) continue;
    tryPlaceAt(rule.meshKey, x, z, rng() * Math.PI * 2);
  }

  // Fill quotas (e.g. sand ≈ 100 cacti) without path/start/finish placements.
  for (const goal of biome.ensureProps ?? []) {
    if (goal.count <= 0) continue;
    let placed = placedCount.get(goal.meshKey) ?? 0;
    let attempts = 0;
    const maxAttempts = goal.count * 40;
    while (placed < goal.count && attempts < maxAttempts) {
      attempts++;
      const x = (rng() * 2 - 1) * half;
      const z = (rng() * 2 - 1) * half;
      if (tryPlaceAt(goal.meshKey, x, z, rng() * Math.PI * 2)) {
        placed++;
      }
    }
  }

  // --- Merged palm batches + wind (trunk XZ sway; fronds bob+sway like island) ---
  const swayDepthTrunk = createPalmSwayDepthMaterial(palmSwayTime, false);
  const swayDepthFrond = createPalmSwayDepthMaterial(palmSwayTime, true);
  const trunkMerged = mergeOrNull(palmTrunks);
  if (trunkMerged) {
    const mesh = new THREE.Mesh(
      trunkMerged,
      createPalmSwayMaterial(
        { color: 0x8b6508, flatShading: true },
        palmSwayTime,
        "palm-sway-trunk-v2",
        false,
      ),
    );
    mesh.name = "palms-trunks";
    mesh.castShadow = true;
    mesh.customDepthMaterial = swayDepthTrunk;
    group.add(mesh);
  }
  const frondMerged = mergeOrNull(palmFronds);
  if (frondMerged) {
    const mesh = new THREE.Mesh(
      frondMerged,
      createPalmSwayMaterial(
        {
          color: 0x2d8a2d,
          side: THREE.DoubleSide,
          flatShading: true,
        },
        palmSwayTime,
        "palm-sway-frond-bob-v2",
        true,
      ),
    );
    mesh.name = "palms-fronds";
    mesh.castShadow = true;
    // Bob on depth too so shadows follow frond motion
    mesh.customDepthMaterial = swayDepthFrond;
    group.add(mesh);
  }

  // --- Merged cactus batches (body + tip = 2 draw calls for all plants) ---
  const cactusBodyMerged = mergeOrNull(cactusBodies);
  if (cactusBodyMerged) {
    const mesh = new THREE.Mesh(
      cactusBodyMerged,
      new THREE.MeshLambertMaterial({ color: 0x3d7a3a, flatShading: true }),
    );
    mesh.name = "cacti-bodies";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const cactusTipMerged = mergeOrNull(cactusTips);
  if (cactusTipMerged) {
    const mesh = new THREE.Mesh(
      cactusTipMerged,
      new THREE.MeshLambertMaterial({ color: 0x4a8f42, flatShading: true }),
    );
    mesh.name = "cacti-tips";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Separate pass: short grass (same wind clock as palms)
  addJungleGrassCover(group, level, biome, rng, palmSwayTime);

  return group;
}

/**
 * Build Three.js scene for a generated level: sky/fog, terrain, finish pillar,
 * streams, sparse props, jeep.
 */
export function createGameScene(
  canvas: HTMLCanvasElement,
  level: LevelData,
  biome: BiomeProfile,
): GameSceneHandles {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(hexToNumber(biome.skyColor), 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(hexToNumber(biome.skyColor));
  scene.fog = new THREE.FogExp2(
    hexToNumber(biome.fogColor),
    biome.fogDensity,
  );

  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    Math.max(800, level.worldSize * 2),
  );
  camera.position.set(
    level.start.position.x,
    level.start.position.y + 5,
    level.start.position.z - 10,
  );

  // Soft fill light (no shadows) + camera-following sun with local shadow map.
  // Sand: mild arid key boost (~half of first pass; keep fog palette).
  const aridSun = biome.id === "sand";
  const hemi = new THREE.HemisphereLight(
    aridSun ? 0xfff8f0 : 0xffffff,
    aridSun ? 0x554c40 : 0x445544,
    aridSun ? 0.85 : 0.75,
  );
  scene.add(hemi);
  const shadows: FollowShadowHandles = createFollowShadows(scene, renderer, {
    radius: 52,
    mapSize: 1024,
    intensity: aridSun ? 1.22 : 1.0,
    color: aridSun ? 0xffefcc : undefined,
    direction: aridSun
      ? new THREE.Vector3(0.4, 1.08, 0.22)
      : undefined,
  });
  shadows.update(level.start.position);

  const terrainMesh = createTerrainMesh(level, biome);
  // Large terrain: receive only (casting whole map is expensive / low value)
  setShadowFlags(terrainMesh, { cast: false, receive: true });
  scene.add(terrainMesh);

  const finishMesh = createFinishMarker(level.finish);
  // Translucent volume only — no shadow casting
  setShadowFlags(finishMesh, { cast: false, receive: false });
  scene.add(finishMesh);

  const streamGroup = createStreamMeshes(level, biome.waterColor);
  setShadowFlags(streamGroup, { cast: false, receive: true });
  scene.add(streamGroup);

  const propGroup = createDecorativeProps(level, biome);
  setShadowFlags(propGroup, { cast: true, receive: false });
  scene.add(propGroup);

  // Start marker: semi-transparent blue rectangular ring on flattened pad
  const startRing = createStartRectRing();
  startRing.position.set(
    level.start.position.x,
    level.start.position.y + 0.08,
    level.start.position.z,
  );
  startRing.rotation.y = level.start.yaw;
  startRing.receiveShadow = true;
  scene.add(startRing);

  const jeepMesh = createJeepMesh();
  setShadowFlags(jeepMesh, { cast: true, receive: true });
  scene.add(jeepMesh);

  // Rainforest: light rain + ground/water splash (½ island-conquest storm density)
  let rain: RainVFX | null = null;
  if (biome.id === "rainforest") {
    const ponds = level.ponds ?? [];
    rain = new RainVFX(scene, {
      // Hit pond free surface when over water so drops don't fall under the lake mesh
      getHeightAt: (x, z) =>
        rainImpactHeight(x, z, sampleHeight(level, x, z), ponds),
    });
  }

  const onResize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  };
  window.addEventListener("resize", onResize);

  return {
    scene,
    camera,
    renderer,
    jeepMesh,
    terrainMesh,
    finishMesh,
    updateShadows: (follow) => {
      shadows.update(follow);
    },
    updatePalmSway: (elapsedSec: number) => {
      const u = propGroup.userData.palmSwayTime as
        | { value: number }
        | undefined;
      if (u) u.value = elapsedSec;
    },
    updateRain: (dt, camPos) => {
      rain?.update(dt, camPos);
    },
    dispose: () => {
      window.removeEventListener("resize", onResize);
      rain?.dispose();
      rain = null;
      shadows.dispose();
      terrainMesh.geometry.dispose();
      (terrainMesh.material as THREE.Material).dispose();
      disposeObject3D(finishMesh);
      disposeObject3D(streamGroup);
      disposeObject3D(propGroup);
      startRing.geometry.dispose();
      (startRing.material as THREE.Material).dispose();
      disposeObject3D(jeepMesh);
      renderer.dispose();
    },
  };
}

export function updateChaseCamera(
  camera: THREE.PerspectiveCamera,
  pose: {
    position: { x: number; y: number; z: number };
    yaw: number;
  },
): void {
  const yaw = pose.yaw;
  camera.position.set(
    pose.position.x - Math.sin(yaw) * 10,
    pose.position.y + 4,
    pose.position.z - Math.cos(yaw) * 10,
  );
  camera.lookAt(
    pose.position.x,
    pose.position.y + 1.2,
    pose.position.z,
  );
}

export { syncJeepMesh };
