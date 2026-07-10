import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { getBiome } from "@/biome/registry";
import type { InputActions } from "@/input/types";
import { TERRAIN_COLLIDER_GROUPS } from "@/physics/collisionGroups";
import { PhysicsWorld } from "@/physics/PhysicsWorld";
import { VehicleController } from "@/physics/vehicle/VehicleController";
import { DEFAULT_DRIVE_RANGE } from "@/shared/driveTrain";
import { chassisSpawnY } from "@/shared/vehicleConfig";
import { createJeepMesh, syncJeepMesh } from "./JeepMesh";
import {
  OffroadFx,
  SANDBOX_DUST_COLOR,
} from "./particles/OffroadFx";
import { TireTrackSystem } from "./TireTrackSystem";

function hexToNumber(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}

export type MenuBackdropHandles = {
  dispose: () => void;
};

const FIXED_DT = 1 / 60;

/**
 * Front-right three-quarter.
 * Low cam + left bias so the jeep sits lower and more to the right (UI left 40%).
 */
const CAM_YAW_OFFSET = (40 * Math.PI) / 180;
const CAM_DIST = 4.35 * 1.3; // +30% pull-back from jeep
const CAM_HEIGHT = 0.68;
const LOOK_AHEAD = 0.5;
const LOOK_HEIGHT = 0.48;
/** Shift camera toward vehicle's left → jeep frames further right. */
const CAM_LEFT_BIAS = 2.3;
/** Nudge look target left of chassis so body sits in the right half. */
const LOOK_LEFT_BIAS = 1.15;

/**
 * Endless-runner chunks along +Z (scheme 2).
 * Menu camera sits in FRONT of the jeep looking back → driven terrain
 * (lower Z) is the visible background. Keep a long trail behind the jeep
 * and only recycle after it has fully dissolved into fog.
 */
const CHUNK_LEN = 56;
const CHUNK_WIDTH = 36;
const CHUNK_RES = 49;
const NUM_CHUNKS = 8;
/**
 * Min distance from vehicle back to rear-chunk front edge before recycle.
 * Camera looks rearward; this must exceed fog visibility.
 */
const RECYCLE_BEHIND_M = 130;
const LANE_HALF = 5.5;

const IDLE_DRIVE: InputActions = {
  throttle: 0,
  steer: 0,
  brake: 0,
  driveRange: DEFAULT_DRIVE_RANGE,
  cameraToggle: false,
  respawn: false,
  lookDeltaX: 0,
  lookDeltaY: 0,
};

// —— Continuous world-space height ——

function hash2(ix: number, iz: number, seed: number): number {
  let n = Math.imul(
    ix * 374761393 + iz * 668265263 + seed * 1274126177,
    0x27d4eb2d,
  );
  n = Math.imul(n ^ (n >>> 15), 1 | n);
  n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
  return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
}

function smoothNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const n00 = hash2(x0, z0, seed);
  const n10 = hash2(x0 + 1, z0, seed);
  const n01 = hash2(x0, z0 + 1, seed);
  const n11 = hash2(x0 + 1, z0 + 1, seed);
  const a = n00 * (1 - sx) + n10 * sx;
  const b = n01 * (1 - sx) + n11 * sx;
  return a * (1 - sz) + b * sz;
}

function fbm(x: number, z: number, seed: number): number {
  let v = 0;
  let a = 1;
  let f = 1;
  let sum = 0;
  for (let o = 0; o < 5; o++) {
    v += smoothNoise(x * f, z * f, seed + o * 19) * a;
    sum += a;
    a *= 0.5;
    f *= 2;
  }
  return v / sum;
}

function heightAt(x: number, z: number, seed: number): number {
  let h =
    (fbm(x * 0.07, z * 0.07, seed) - 0.5) * 2.6 +
    (fbm(x * 0.16 + 8, z * 0.14, seed + 3) - 0.5) * 1.15 +
    (fbm(x * 0.32, z * 0.3, seed + 9) - 0.5) * 0.42;

  h += Math.sin(z * 0.11 + x * 0.08) * 0.2;
  h += Math.sin(z * 0.29 + x * 0.2) * 0.07;

  const edge = Math.max(0, (Math.abs(x) - LANE_HALF) / (CHUNK_WIDTH * 0.4));
  const laneFlatten = 1 - Math.exp(-edge * edge * 4);
  h *= 0.38 + 0.62 * laneFlatten;
  h -= edge * edge * 1.15;
  h += 2.4;
  return h;
}

// —— Sand decorations (visual only, no prop colliders) ——

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function makeRockPile(): THREE.Group {
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
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(sizes[i], 0), mat);
    m.position.set(offsets[i]![0]!, offsets[i]![1]!, offsets[i]![2]!);
    m.rotation.set(0.2 * i, 0.5 * i, 0.1 * i);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

function makePillarRock(): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.55, 2.2, 6),
    new THREE.MeshLambertMaterial({ color: 0x8a8680, flatShading: true }),
  );
  m.position.y = 1.1;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function makeCactus(rng: () => number): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({
    color: 0x3d7a3a,
    flatShading: true,
  });
  const tipMat = new THREE.MeshLambertMaterial({
    color: 0x4a8f42,
    flatShading: true,
  });
  const h = 1.4 + rng() * 1.1;
  const r = 0.16 + rng() * 0.06;

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.92, r, h, 6),
    bodyMat,
  );
  trunk.position.y = h * 0.5;
  trunk.castShadow = true;
  g.add(trunk);

  const tip = new THREE.Mesh(new THREE.SphereGeometry(r * 0.95, 5, 4), tipMat);
  tip.scale.set(1, 0.7, 1);
  tip.position.y = h;
  g.add(tip);

  const arms = rng() < 0.35 ? 0 : rng() < 0.55 ? 1 : 2;
  for (let a = 0; a < arms; a++) {
    const side = a === 0 ? 1 : -1;
    const armH = 0.45 + rng() * 0.45;
    const attachY = h * (0.4 + rng() * 0.25);
    const out = r + 0.12 + rng() * 0.08;
    const zJ = (rng() - 0.5) * 0.08;

    const stub = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.55, r * 0.6, out, 5),
      bodyMat,
    );
    stub.rotation.z = (side * Math.PI) / 2;
    stub.position.set((side * out) * 0.5, attachY, zJ);
    stub.castShadow = true;
    g.add(stub);

    const arm = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.5, r * 0.55, armH, 5),
      bodyMat,
    );
    arm.position.set(side * out, attachY + armH * 0.5, zJ);
    arm.castShadow = true;
    g.add(arm);

    const armTip = new THREE.Mesh(
      new THREE.SphereGeometry(r * 0.52, 5, 4),
      tipMat,
    );
    armTip.scale.set(1, 0.65, 1);
    armTip.position.set(side * out, attachY + armH, zJ);
    g.add(armTip);
  }
  return g;
}

function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    const mat = m.material;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) (mat as THREE.Material).dispose();
  });
}

/**
 * Scatter sand props off the drive lane for one chunk (deterministic from seed+z).
 */
function buildChunkProps(
  centerZ: number,
  seed: number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = `menu-props-${centerZ.toFixed(0)}`;
  const rng = mulberry(seed ^ Math.imul(Math.floor(centerZ * 10), 0x9e3779b9));

  const halfL = CHUNK_LEN * 0.5;
  const halfW = CHUNK_WIDTH * 0.5;
  const minX = LANE_HALF + 1.6;
  const maxX = halfW - 1.2;

  const place = (kind: "cactus" | "rock" | "pillar"): void => {
    const side = rng() < 0.5 ? -1 : 1;
    const x = side * (minX + rng() * (maxX - minX));
    const z = centerZ - halfL + 2 + rng() * (CHUNK_LEN - 4);
    // keep out of exact center corridor
    if (Math.abs(x) < LANE_HALF + 1.2) return;
    const y = heightAt(x, z, seed);
    const yaw = rng() * Math.PI * 2;
    const s = 0.75 + rng() * 0.55;

    let obj: THREE.Object3D;
    if (kind === "cactus") {
      obj = makeCactus(rng);
      obj.rotation.x = (rng() - 0.5) * 0.12;
      obj.rotation.z = (rng() - 0.5) * 0.12;
    } else if (kind === "pillar") {
      obj = makePillarRock();
    } else {
      obj = makeRockPile();
    }
    obj.position.set(x, y, z);
    obj.rotation.y = yaw;
    obj.scale.setScalar(s);
    group.add(obj);
  };

  // Density tuned for menu (lighter than full sand ensureProps)
  for (let i = 0; i < 9; i++) place("cactus");
  for (let i = 0; i < 7; i++) place("rock");
  for (let i = 0; i < 3; i++) place("pillar");

  return group;
}

// —— Chunk terrain ——

type TerrainChunk = {
  centerZ: number;
  mesh: THREE.Mesh;
  props: THREE.Group;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
};

function fillChunkHeights(
  out: Float32Array,
  centerX: number,
  centerZ: number,
  seed: number,
): void {
  const res = CHUNK_RES;
  const halfW = CHUNK_WIDTH * 0.5;
  const halfL = CHUNK_LEN * 0.5;
  const cellX = CHUNK_WIDTH / (res - 1);
  const cellZ = CHUNK_LEN / (res - 1);
  for (let row = 0; row < res; row++) {
    const z = centerZ - halfL + row * cellZ;
    for (let col = 0; col < res; col++) {
      const x = centerX - halfW + col * cellX;
      out[row * res + col] = heightAt(x, z, seed);
    }
  }
}

function heightsToRapierColumnMajor(hm: Float32Array, res: number): Float32Array {
  const out = new Float32Array(res * res);
  for (let row = 0; row < res; row++) {
    for (let col = 0; col < res; col++) {
      out[col * res + row] = hm[row * res + col]!;
    }
  }
  return out;
}

function buildChunkMesh(
  hm: Float32Array,
  centerX: number,
  centerZ: number,
): THREE.Mesh {
  const res = CHUNK_RES;
  const halfW = CHUNK_WIDTH * 0.5;
  const halfL = CHUNK_LEN * 0.5;
  const cellX = CHUNK_WIDTH / (res - 1);
  const cellZ = CHUNK_LEN / (res - 1);

  const positions = new Float32Array(res * res * 3);
  const colors = new Float32Array(res * res * 3);
  const indices: number[] = [];

  let minH = Infinity;
  let maxH = -Infinity;
  for (let i = 0; i < hm.length; i++) {
    const h = hm[i]!;
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }
  const range = Math.max(1e-3, maxH - minH);
  const low = new THREE.Color(0x5c5348);
  const mid = new THREE.Color(0xa89880);
  const high = new THREE.Color(0x8a8680);
  const path = new THREE.Color(0xb8a990);
  const tmp = new THREE.Color();

  for (let row = 0; row < res; row++) {
    const z = centerZ - halfL + row * cellZ;
    for (let col = 0; col < res; col++) {
      const x = centerX - halfW + col * cellX;
      const vi = row * res + col;
      const y = hm[vi]!;
      positions[vi * 3] = x;
      positions[vi * 3 + 1] = y;
      positions[vi * 3 + 2] = z;

      const t = (y - minH) / range;
      if (t < 0.45) tmp.copy(low).lerp(mid, t / 0.45);
      else tmp.copy(mid).lerp(high, (t - 0.45) / 0.55);
      const lane = Math.max(0, 1 - Math.abs(x) / (LANE_HALF * 1.4));
      if (lane > 0) tmp.lerp(path, lane * 0.55);
      colors[vi * 3] = tmp.r;
      colors[vi * 3 + 1] = tmp.g;
      colors[vi * 3 + 2] = tmp.b;
    }
  }

  for (let row = 0; row < res - 1; row++) {
    for (let col = 0; col < res - 1; col++) {
      const a = row * res + col;
      const b = a + 1;
      const c = a + res;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  return new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  );
}

function createChunk(
  world: RAPIER.World,
  scene: THREE.Scene,
  centerZ: number,
  seed: number,
): TerrainChunk {
  const hm = new Float32Array(CHUNK_RES * CHUNK_RES);
  fillChunkHeights(hm, 0, centerZ, seed);

  const mesh = buildChunkMesh(hm, 0, centerZ);
  mesh.receiveShadow = true;
  mesh.name = `menu-chunk-${centerZ.toFixed(0)}`;
  scene.add(mesh);

  const props = buildChunkProps(centerZ, seed);
  scene.add(props);

  const rapierH = heightsToRapierColumnMajor(hm, CHUNK_RES);
  const nrows = CHUNK_RES - 1;
  const ncols = CHUNK_RES - 1;
  const desc = RAPIER.ColliderDesc.heightfield(
    nrows,
    ncols,
    rapierH,
    { x: CHUNK_WIDTH, y: 1, z: CHUNK_LEN },
    RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES,
  );
  desc.setTranslation(0, 0, centerZ);
  desc.setFriction(0.9);
  desc.setRestitution(0);
  desc.setCollisionGroups(TERRAIN_COLLIDER_GROUPS);
  desc.setSolverGroups(TERRAIN_COLLIDER_GROUPS);

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const collider = world.createCollider(desc, body);

  return { centerZ, mesh, props, body, collider };
}

function disposeChunk(
  world: RAPIER.World,
  scene: THREE.Scene,
  chunk: TerrainChunk,
): void {
  scene.remove(chunk.mesh);
  chunk.mesh.geometry.dispose();
  (chunk.mesh.material as THREE.Material).dispose();

  scene.remove(chunk.props);
  disposeObject3D(chunk.props);

  world.removeCollider(chunk.collider, true);
  world.removeRigidBody(chunk.body);
}

function recycleRearChunk(
  world: RAPIER.World,
  scene: THREE.Scene,
  chunks: TerrainChunk[],
  seed: number,
): void {
  chunks.sort((a, b) => a.centerZ - b.centerZ);
  const rear = chunks[0]!;
  const front = chunks[chunks.length - 1]!;
  const newCenterZ = front.centerZ + CHUNK_LEN;

  disposeChunk(world, scene, rear);
  chunks[0] = createChunk(world, scene, newCenterZ, seed);
  chunks.sort((a, b) => a.centerZ - b.centerZ);
}

export type MenuBackdropOptions = {
  /** Abort if menu unmounts mid-boot (avoids double WebGL on #game-canvas). */
  signal?: AbortSignal;
};

/**
 * Infinite menu backdrop — chunk relay + sand props + dust/tracks.
 * Returns null if aborted before binding the canvas.
 */
export async function createMenuBackdrop(
  canvas: HTMLCanvasElement,
  opts?: MenuBackdropOptions,
): Promise<MenuBackdropHandles | null> {
  const seed = (Math.random() * 0x7fffffff) | 0;
  const signal = opts?.signal;
  // Same sky/fog contract as GameScene — sand earth haze (rainforest = green)
  const biome = getBiome("sand");

  const physics = await PhysicsWorld.create();
  if (signal?.aborted) {
    physics.destroy();
    return null;
  }
  const world = physics.getWorld();

  // Re-check after await: Start may have already claimed #game-canvas
  if (signal?.aborted) {
    physics.destroy();
    return null;
  }

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Background ≈ fog color so recycled far terrain doesn't flash "sky hole"
  const fogCol = hexToNumber(biome.fogColor);
  renderer.setClearColor(fogCol, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(fogCol);
  // Three.js FogExp2 — sand earth color. Thick enough that terrain past
  // ~RECYCLE_BEHIND_M is nearly solid fog before the strip is removed.
  // opacity ≈ 1 - exp(-d * dist); d=0.028 @ 120m → ~96% fogged.
  const menuFogDensity = 0.028;
  scene.fog = new THREE.FogExp2(fogCol, menuFogDensity);

  const camera = new THREE.PerspectiveCamera(
    56,
    window.innerWidth / window.innerHeight,
    0.08,
    // Don't draw past where fog has already eaten the terrain
    140,
  );

  const hemi = new THREE.HemisphereLight(0xfff8f0, 0x554c40, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.25);
  sun.position.set(12, 22, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 70;
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  scene.add(sun);
  scene.add(sun.target);

  const chunks: TerrainChunk[] = [];
  for (let i = 0; i < NUM_CHUNKS; i++) {
    const centerZ = CHUNK_LEN * 0.5 + i * CHUNK_LEN;
    chunks.push(createChunk(world, scene, centerZ, seed));
  }
  physics.step();

  const spawnZ = CHUNK_LEN * 0.35;
  const groundY = heightAt(0, spawnZ, seed);
  const vehicle = new VehicleController(world, {
    position: { x: 0, y: chassisSpawnY(groundY), z: spawnZ },
    yaw: 0,
  });

  const jeep = createJeepMesh();
  jeep.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  scene.add(jeep);

  // Same systems as gameplay — sand dust + tire marks on continuous height
  const offroadFx = new OffroadFx(scene, {
    fallbackDustColor: SANDBOX_DUST_COLOR,
    capacity: 2200,
  });
  const tireTracks = new TireTrackSystem(scene, {
    sampleGroundY: (x, z) => heightAt(x, z, seed),
    segmentsPerWheel: 64,
  });

  const prevCursor = canvas.style.cursor;
  canvas.style.cursor = "default";

  let disposed = false;
  let raf = 0;
  let lastT = performance.now();
  let acc = 0;
  let elapsed = 0;
  let lastThrottle = 0.72;

  const _camPos = new THREE.Vector3();
  const _look = new THREE.Vector3();

  const onResize = (): void => {
    if (disposed) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  };

  const teardown = (): void => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize);
    canvas.style.cursor = prevCursor;
    offroadFx.dispose();
    tireTracks.dispose();
    vehicle.dispose();
    for (const c of chunks) {
      disposeChunk(world, scene, c);
    }
    chunks.length = 0;
    physics.destroy();
    disposeObject3D(jeep);
    // Keep canvas WebGL-capable for GameScene (no loseContext).
    renderer.dispose();
  };

  if (signal?.aborted) {
    teardown();
    return null;
  }
  window.addEventListener("resize", onResize);

  const placeCamera = (
    pose: ReturnType<VehicleController["getPose"]>,
    t: number,
  ): void => {
    const yaw = pose.yaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    // Front-right 40°
    let ox =
      fx * Math.cos(CAM_YAW_OFFSET) * CAM_DIST +
      rx * Math.sin(CAM_YAW_OFFSET) * CAM_DIST;
    let oz =
      fz * Math.cos(CAM_YAW_OFFSET) * CAM_DIST +
      rz * Math.sin(CAM_YAW_OFFSET) * CAM_DIST;
    // Pull camera left so jeep sits more on the right of the frame
    ox -= rx * CAM_LEFT_BIAS;
    oz -= rz * CAM_LEFT_BIAS;

    const shake = 0.01;
    _camPos.set(
      pose.position.x + ox + Math.sin(t * 17.3) * shake,
      pose.position.y + CAM_HEIGHT + Math.sin(t * 13.1) * shake * 0.5,
      pose.position.z + oz + Math.sin(t * 11.7) * shake * 0.4,
    );
    _look.set(
      pose.position.x + fx * LOOK_AHEAD - rx * LOOK_LEFT_BIAS,
      pose.position.y + LOOK_HEIGHT,
      pose.position.z + fz * LOOK_AHEAD - rz * LOOK_LEFT_BIAS,
    );
    camera.position.copy(_camPos);
    camera.lookAt(_look);
    sun.position.set(
      pose.position.x + 12,
      pose.position.y + 22,
      pose.position.z + 8,
    );
    sun.target.position.set(pose.position.x, pose.position.y, pose.position.z);
    sun.target.updateMatrixWorld();
  };

  const maybeRecycle = (vehicleZ: number): void => {
    // Camera looks back at driven ground — only drop rear after it's deep in fog
    for (let n = 0; n < NUM_CHUNKS; n++) {
      chunks.sort((a, b) => a.centerZ - b.centerZ);
      const rear = chunks[0]!;
      const rearEnd = rear.centerZ + CHUNK_LEN * 0.5; // front edge of rear chunk
      const behindM = vehicleZ - rearEnd;
      if (behindM < RECYCLE_BEHIND_M) break;
      recycleRearChunk(world, scene, chunks, seed);
    }
  };

  {
    const pose0 = vehicle.getPose();
    placeCamera(pose0, 0);
    syncJeepMesh(jeep, pose0, vehicle.getWheelVisuals());
    renderer.render(scene, camera);
  }

  const tick = (now: number): void => {
    if (disposed) return;
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    elapsed += dt;
    acc += dt;

    while (acc >= FIXED_DT) {
      lastThrottle = 0.72;
      const drive: InputActions = {
        ...IDLE_DRIVE,
        throttle: lastThrottle,
        steer: 0,
        driveRange: "H",
      };
      vehicle.update(FIXED_DT, drive, world);
      physics.step();

      const p = vehicle.getPose();
      maybeRecycle(p.position.z);

      const offStrip = Math.abs(p.position.x) > CHUNK_WIDTH * 0.42;
      if (p.position.y < -15 || p.position.y > 45 || offStrip) {
        chunks.sort((a, b) => a.centerZ - b.centerZ);
        const mid = chunks[1] ?? chunks[0]!;
        const rz = mid.centerZ;
        const gy = heightAt(0, rz, seed);
        vehicle.reset({
          position: { x: 0, y: chassisSpawnY(gy), z: rz },
          yaw: 0,
        });
      }
      acc -= FIXED_DT;
    }

    const pose = vehicle.getPose();
    const wheelVisuals = vehicle.getWheelVisuals();
    const contacts = vehicle.getWheelContacts();
    syncJeepMesh(jeep, pose, wheelVisuals);
    placeCamera(pose, elapsed);

    const wheels = wheelVisuals.map((wv, i) => ({
      contact: contacts[i] ?? false,
      suspensionLength: wv.suspensionLength,
      rotation: wv.rotation,
      steering: wv.steering,
    }));
    const linvel = vehicle.getLinvel();

    offroadFx.update(dt, {
      position: pose.position,
      yaw: pose.yaw,
      rotation: pose.rotation,
      linvel,
      throttle: lastThrottle,
      brake: 0,
      driveRange: vehicle.getDriveRange(),
      wheels,
      bodyContacts: vehicle.getBodyContactPoints(),
    });
    tireTracks.update(dt, {
      position: pose.position,
      yaw: pose.yaw,
      rotation: pose.rotation,
      linvel,
      throttle: lastThrottle,
      brake: 0,
      wheels: wheels.map((w) => ({
        contact: w.contact,
        suspensionLength: w.suspensionLength,
      })),
    });

    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    dispose: teardown,
  };
}
