import * as THREE from "three";
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

export type GameSceneHandles = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  jeepMesh: THREE.Group;
  terrainMesh: THREE.Mesh;
  finishMesh: THREE.Object3D;
  /** Recenters local shadow map around camera / vehicle. */
  updateShadows: (follow: { x: number; y: number; z: number }) => void;
  dispose: () => void;
};

function hexToNumber(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
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

function createStreamMeshes(
  level: LevelData,
  waterColor: string,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "streams";
  const color = hexToNumber(waterColor);

  for (const stream of level.streams) {
    const pts = stream.polyline;
    if (pts.length < 2) continue;
    const halfW = stream.width * 0.5;
    const positions: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(pts.length - 1, i + 1)];
      let dx = next.x - prev.x;
      let dz = next.z - prev.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      // Perpendicular in XZ
      const px = -dz * halfW;
      const pz = dx * halfW;
      const y = sampleHeight(level, p.x, p.z) + 0.08;
      positions.push(p.x + px, y, p.z + pz, p.x - px, y, p.z - pz);
      if (i > 0) {
        const a = (i - 1) * 2;
        const b = a + 1;
        const c = i * 2;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({
      color,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "stream";
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

function createPropMesh(meshKey: string): THREE.Object3D {
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
    case "scrub": {
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.1, 0.5, 5),
        new THREE.MeshLambertMaterial({ color: 0x5a4030, flatShading: true }),
      );
      trunk.position.y = 0.25;
      const bush = new THREE.Mesh(
        new THREE.ConeGeometry(0.55, 0.9, 5),
        new THREE.MeshLambertMaterial({ color: 0x4a6a3a, flatShading: true }),
      );
      bush.position.y = 0.85;
      g.add(trunk, bush);
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
 * Sparse decorative props from biome.propTable. Non-colliding, seeded.
 * Skips near path centerline and start/finish pads.
 */
function createDecorativeProps(
  level: LevelData,
  biome: BiomeProfile,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "props";
  const rng = mulberry32((level.seed ^ 0x9e3779b9) >>> 0);
  const density = clamp(biome.propDensity, 0, 1);
  // Sparse: ~density * 40 candidates across the map.
  const count = Math.floor(12 + density * 36);
  const half = level.worldSize * 0.5 - 8;
  const pathHalf = (biome.pathWidth ?? 4) * 1.1;
  const table = biome.propTable.filter((p) => !p.collides);

  const nearPath = (x: number, z: number): boolean => {
    for (const p of level.pathPolyline) {
      if (Math.hypot(x - p.x, z - p.z) < pathHalf) return true;
    }
    return false;
  };

  for (let i = 0; i < count; i++) {
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
    // Keep some sparsity beyond density
    if (rng() > density * 0.85 + 0.15) continue;

    const rule = pickProp(table, rng);
    if (!rule) continue;
    const prop = createPropMesh(rule.meshKey);
    const y = sampleHeight(level, x, z);
    prop.position.set(x, y, z);
    prop.rotation.y = rng() * Math.PI * 2;
    const s = 0.85 + rng() * 0.5;
    prop.scale.setScalar(s);
    group.add(prop);
  }

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

  // Soft fill light (no shadows) + camera-following sun with local shadow map
  const hemi = new THREE.HemisphereLight(0xffffff, 0x445544, 0.75);
  scene.add(hemi);
  const shadows: FollowShadowHandles = createFollowShadows(scene, renderer, {
    radius: 52,
    mapSize: 1024,
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

  // Simple path markers (start pad)
  const startPad = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 2.5, 0.15, 16),
    new THREE.MeshLambertMaterial({ color: 0x66aaff }),
  );
  startPad.position.set(
    level.start.position.x,
    level.start.position.y + 0.05,
    level.start.position.z,
  );
  startPad.receiveShadow = true;
  scene.add(startPad);

  const jeepMesh = createJeepMesh();
  setShadowFlags(jeepMesh, { cast: true, receive: true });
  scene.add(jeepMesh);

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
    dispose: () => {
      window.removeEventListener("resize", onResize);
      shadows.dispose();
      terrainMesh.geometry.dispose();
      (terrainMesh.material as THREE.Material).dispose();
      disposeObject3D(finishMesh);
      disposeObject3D(streamGroup);
      disposeObject3D(propGroup);
      startPad.geometry.dispose();
      (startPad.material as THREE.Material).dispose();
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
