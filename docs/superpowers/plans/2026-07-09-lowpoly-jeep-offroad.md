# Low-Poly Jeep Off-Road Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a browser low-poly jeep off-road MVP: menu biome select (`cliffs`), seeded path-first terrain with geometric solvability, semi-realistic raycast vehicle, TP/FP camera, minimap + goal guide, checkpoint respawn, finish-to-win.

**Architecture:** Vite + TypeScript app with a game state machine (`Boot → Menu → Loading → Playing → Result | Error`). Pure `levelgen` produces deterministic `LevelData`; Rapier heightfield + custom raycast vehicle simulate; Three.js renders low-poly scene; DOM/canvas HUD overlays. Input is action-based (keyboard first).

**Tech Stack:** TypeScript (strict), Vite, Three.js, `@dimforge/rapier3d-compat`, Vitest, mulberry32 RNG (in-repo).

**Spec:** `docs/superpowers/specs/2026-07-09-lowpoly-jeep-offroad-design.md` (authoritative). If plan and spec disagree, update plan to match spec before coding.

## Global Constraints

- World units: meters; +Y up; XZ horizontal; yaw radians around +Y; yaw 0 faces +Z.
- Heightmap origin: world corner `(-worldSize/2, 0, -worldSize/2)`; `heightmap[row * resolution + col]`; cell size `worldSize / (resolution - 1)`.
- Physics fixed step: `1/60` s; vehicle raycasts use current body pose, apply forces, then `world.step()`.
- MVP solvability: **GeometricSolvability** automated; vehicle playability is manual soft-gate.
- Terrain collider: Rapier **heightfield** only; same samples as visual mesh.
- Biomes are scene themes, not difficulty tiers; MVP ships only `cliffs`.
- Desktop keyboard only; input abstracted for future touch.
- Win: finish box trigger; no timer/damage; respawn via kill-Y or R.
- Success criteria S1–S10 must all pass before calling MVP done.
- Low-poly presentation; no multiplayer, no audio requirement.
- Prefer small focused files; pure logic unit-tested with Vitest.
- Commits: small, conventional messages (`feat:`, `test:`, `chore:`).

---

## File Structure (target)

```
grok-jeep-game/
  package.json
  tsconfig.json
  tsconfig.node.json
  vite.config.ts
  vitest.config.ts
  index.html
  src/
    main.ts
    vite-env.d.ts
    app/GameApp.ts
    app/GameStateMachine.ts
    input/types.ts
    input/InputRouter.ts
    input/KeyboardProvider.ts
    biome/types.ts
    biome/registry.ts
    biome/profiles/cliffs.ts
    levelgen/types.ts
    levelgen/rng.ts
    levelgen/path.ts
    levelgen/heightmap.ts
    levelgen/validate.ts
    levelgen/repair.ts
    levelgen/generateLevel.ts
    physics/PhysicsWorld.ts
    physics/createHeightfield.ts
    physics/vehicle/VehicleConfig.ts
    physics/vehicle/VehicleController.ts
    gameplay/CheckpointSystem.ts
    gameplay/FinishSystem.ts
    gameplay/RespawnSystem.ts
    render/createRenderer.ts
    render/GameScene.ts
    render/TerrainMesh.ts
    render/JeepMesh.ts
    render/CameraRig.ts
    render/materials.ts
    ui/dom.ts
    ui/menu.ts
    ui/hud.ts
    ui/minimap.ts
    ui/result.ts
    ui/error.ts
    ui/styles.css
    shared/math.ts
    shared/types.ts
    shared/vehicleCapabilities.ts
    shared/vehicleConfig.ts
    shared/hash.ts
  tests/
    shared/math.test.ts
    levelgen/rng.test.ts
    levelgen/pathConstraints.test.ts
    levelgen/validate.test.ts
    levelgen/reproducibility.test.ts
    levelgen/seedCorpus.test.ts
    input/InputRouter.test.ts
```

---

### Task 1: Project scaffold (Vite + TS + Three + Rapier + Vitest)

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.ts`, `src/vite-env.d.ts`, `src/ui/styles.css`
- Test: smoke via `npm run build` and `npm test` (empty pass initially)

**Interfaces:**
- Consumes: nothing
- Produces: runnable Vite app that mounts a canvas and logs boot

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "grok-jeep-game",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@dimforge/rapier3d-compat": "^0.14.0",
    "three": "^0.172.0"
  },
  "devDependencies": {
    "@types/three": "^0.172.0",
    "typescript": "^5.7.2",
    "vite": "^6.0.6",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create TypeScript + Vite configs**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src", "tests"]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true
  },
  "include": ["vite.config.ts", "vitest.config.ts"]
}
```

`vite.config.ts`:
```ts
import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: { port: 5173 },
});
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Create `index.html` and entry**

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Low-Poly Jeep Off-Road</title>
    <link rel="stylesheet" href="/src/ui/styles.css" />
  </head>
  <body>
    <div id="app">
      <canvas id="game-canvas"></canvas>
      <div id="ui-root"></div>
    </div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
```

`src/ui/styles.css`:
```css
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #app { width: 100%; height: 100%; overflow: hidden; background: #1a1a1a; }
#game-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
#ui-root { position: absolute; inset: 0; pointer-events: none; font-family: system-ui, sans-serif; color: #f2f2f2; }
#ui-root .panel { pointer-events: auto; }
```

`src/main.ts`:
```ts
const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
if (!canvas) throw new Error("Missing #game-canvas");
console.info("[boot] scaffold ready", canvas.width, canvas.height);
```

- [ ] **Step 4: Install and verify**

```bash
npm install
npm test
npm run build
```

Expected: install succeeds; vitest exits 0 (no tests or empty); build succeeds (or adjust `tsc -b` — if `tsc -b` fails without project references, change build script to `"build": "tsc --noEmit && vite build"`).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.node.json vite.config.ts vitest.config.ts index.html src
git commit -m "chore: scaffold Vite TypeScript Three Rapier project"
```

---

### Task 2: Shared math, types, vehicle caps/config, hash

**Files:**
- Create: `src/shared/types.ts`, `src/shared/math.ts`, `src/shared/vehicleCapabilities.ts`, `src/shared/vehicleConfig.ts`, `src/shared/hash.ts`
- Test: `tests/shared/math.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `Vec3`, `Pose2D` types
  - `VEHICLE_CAPABILITIES`, `VEHICLE_CONFIG`
  - `clamp`, `lerp`, `yawToDir`, `hashFloat32Array`

- [ ] **Step 1: Write failing math test**

`tests/shared/math.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { clamp, yawToDir } from "@/shared/math";

describe("math", () => {
  it("clamps values", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
  });

  it("yaw 0 faces +Z", () => {
    const d = yawToDir(0);
    expect(d.x).toBeCloseTo(0);
    expect(d.z).toBeCloseTo(1);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test
```

Expected: FAIL cannot find module `@/shared/math`

- [ ] **Step 3: Implement shared modules**

`src/shared/types.ts`:
```ts
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Pose2D {
  position: Vec3;
  yaw: number;
}

export type BiomeId = string;
```

`src/shared/math.ts`:
```ts
import type { Vec3 } from "./types";

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** yaw 0 => +Z */
export function yawToDir(yaw: number): Vec3 {
  return { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function length2(x: number, z: number): number {
  return Math.hypot(x, z);
}

export function normalize2(x: number, z: number): { x: number; z: number } {
  const len = Math.hypot(x, z) || 1;
  return { x: x / len, z: z / len };
}
```

`src/shared/vehicleCapabilities.ts`:
```ts
/** Generator-facing caps — keep in sync with VehicleConfig wheel layout. */
export const VEHICLE_CAPABILITIES = {
  maxSlopeRad: (28 * Math.PI) / 180,
  maxStepHeight: 0.45,
  minTurnRadius: 6.0,
  trackWidth: 1.6,
  wheelBase: 2.4,
  pathClearance: 0.8,
} as const;

export type VehicleCapabilities = typeof VEHICLE_CAPABILITIES;
```

`src/shared/vehicleConfig.ts`:
```ts
import { VEHICLE_CAPABILITIES } from "./vehicleCapabilities";

const tw = VEHICLE_CAPABILITIES.trackWidth;
const wb = VEHICLE_CAPABILITIES.wheelBase;
const hx = tw / 2;
const hz = wb / 2;

export const VEHICLE_CONFIG = {
  massKg: 1400,
  chassisHalfExtents: { x: 0.9, y: 0.45, z: 1.3 },
  wheelPositions: [
    { x: -hx, y: 0.1, z: hz },  // FL
    { x: hx, y: 0.1, z: hz },   // FR
    { x: -hx, y: 0.1, z: -hz }, // RL
    { x: hx, y: 0.1, z: -hz },  // RR
  ],
  suspRestLength: 0.55,
  suspMaxTravel: 0.25,
  springStiffness: 42000,
  springDamping: 4500,
  engineForce: 9000,
  brakeForce: 12000,
  maxSteerRad: (32 * Math.PI) / 180,
  tireGripLong: 1.1,
  tireGripLat: 1.0,
} as const;

export type VehicleConfig = typeof VEHICLE_CONFIG;
```

`src/shared/hash.ts`:
```ts
/** FNV-1a 32-bit hex for Float32Array reproducibility checks. */
export function hashFloat32Array(data: Float32Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    const buf = new DataView(new ArrayBuffer(4));
    buf.setFloat32(0, v, true);
    for (let b = 0; b < 4; b++) {
      h ^= buf.getUint8(b);
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/shared tests/shared
git commit -m "feat: add shared math, types, and vehicle constants"
```

---

### Task 3: Seeded RNG + levelgen types skeleton

**Files:**
- Create: `src/levelgen/rng.ts`, `src/levelgen/types.ts`
- Test: `tests/levelgen/rng.test.ts`

**Interfaces:**
- Consumes: `Vec3`, `Pose2D`, `BiomeId` from shared
- Produces: `mulberry32`, `GenerateLevelInput`, `LevelData`, path constants

- [ ] **Step 1: Write failing RNG test**

`tests/levelgen/rng.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/levelgen/rng";

describe("mulberry32", () => {
  it("is deterministic for same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("differs for different seeds", () => {
    const a = mulberry32(1)();
    const b = mulberry32(2)();
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test
```

- [ ] **Step 3: Implement RNG + types**

`src/levelgen/rng.ts`:
```ts
/** Returns PRNG in [0, 1). */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
```

`src/levelgen/types.ts`:
```ts
import type { BiomeId, Pose2D, Vec3 } from "@/shared/types";
import type { VehicleCapabilities } from "@/shared/vehicleCapabilities";
import type { BiomeProfile } from "@/biome/types";

export const PATH_POINT_SPACING_M = 4;
export const PATH_SAFETY_FACTOR = 0.75;
export const STREAM_MAX_DEPTH_ON_PATH_M = 0.35;
export const CHECKPOINT_SPACING_M = 40;
export const START_FINISH_EDGE_MARGIN_M = 16;
export const MAX_REPAIR_ATTEMPTS = 8;
export const DEFAULT_MAP_SIZE = 256;
export const DEFAULT_RESOLUTION = 129;

export interface GenerateLevelInput {
  seed: number;
  biome: BiomeProfile;
  vehicle: VehicleCapabilities;
  mapSize?: number;
  resolution?: number;
}

export interface LevelData {
  seed: number;
  biomeId: BiomeId;
  heightmap: Float32Array;
  resolution: number;
  worldSize: number;
  pathPolyline: Vec3[];
  start: Pose2D;
  finish: {
    position: Vec3;
    yaw: number;
    halfExtents: Vec3;
  };
  checkpoints: { id: string; position: Vec3; yaw: number; radius: number }[];
  streams: { polyline: Vec3[]; width: number }[];
  killY: number;
  meta: {
    usedFallback: boolean;
    repairAttempts: number;
  };
}
```

Also create minimal biome types so imports resolve:

`src/biome/types.ts`:
```ts
import type { BiomeId } from "@/shared/types";

export interface PropSpawnRule {
  meshKey: string;
  weight: number;
  collides: boolean;
}

export interface BiomeProfile {
  id: BiomeId;
  displayName: string;
  description: string;
  skyColor: string;
  fogColor: string;
  fogDensity: number;
  groundPalette: { high: string; mid: string; low: string; path: string };
  waterColor: string;
  streamDensity: number;
  offPathRoughness: number;
  propDensity: number;
  propTable: PropSpawnRule[];
  pathWidth?: number;
  mapSize?: number;
}
```

`src/biome/profiles/cliffs.ts`:
```ts
import type { BiomeProfile } from "../types";

export const cliffsBiome: BiomeProfile = {
  id: "cliffs",
  displayName: "Cliffs",
  description: "Rocky ridges and sheer drops",
  skyColor: "#87a0b5",
  fogColor: "#c4b8a8",
  fogDensity: 0.012,
  groundPalette: {
    high: "#8a8680",
    mid: "#a89880",
    low: "#5c5348",
    path: "#b8a990",
  },
  waterColor: "#4a7a8c",
  streamDensity: 0.35,
  offPathRoughness: 0.85,
  propDensity: 0.25,
  propTable: [
    { meshKey: "rock_pile", weight: 1, collides: false },
    { meshKey: "scrub", weight: 1, collides: false },
    { meshKey: "pillar_rock", weight: 0.4, collides: false },
  ],
};
```

`src/biome/registry.ts`:
```ts
import type { BiomeId } from "@/shared/types";
import type { BiomeProfile } from "./types";
import { cliffsBiome } from "./profiles/cliffs";

const REGISTRY: Record<string, BiomeProfile> = {
  [cliffsBiome.id]: cliffsBiome,
};

export function listBiomes(): BiomeProfile[] {
  return Object.values(REGISTRY);
}

export function getBiome(id: BiomeId): BiomeProfile {
  const b = REGISTRY[id];
  if (!b) throw new Error(`Unknown biome: ${id}`);
  return b;
}
```

- [ ] **Step 4: Run tests — PASS**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/levelgen src/biome tests/levelgen/rng.test.ts
git commit -m "feat: add seeded RNG, level types, and cliffs biome profile"
```

---

### Task 4: Path generation + geometric constraints (TDD)

**Files:**
- Create: `src/levelgen/path.ts`, `src/levelgen/heightmap.ts`
- Test: `tests/levelgen/pathConstraints.test.ts`

**Interfaces:**
- Consumes: `mulberry32`, `VEHICLE_CAPABILITIES`, path constants
- Produces:
  - `generatePathPolyline(rng, mapSize, vehicle) -> { points: Vec3[]; startYaw: number; endYaw: number }`
  - `assignPathHeights(points, vehicle) -> Vec3[]`
  - `sampleHeight / setHeight / worldToGrid / gridToWorld` heightmap helpers

- [ ] **Step 1: Write failing path constraint tests**

`tests/levelgen/pathConstraints.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { assignPathHeights, maxSegmentSlopeRad } from "@/levelgen/path";
import { VEHICLE_CAPABILITIES } from "@/shared/vehicleCapabilities";
import { PATH_SAFETY_FACTOR } from "@/levelgen/types";

describe("assignPathHeights", () => {
  it("keeps slopes within safety budget", () => {
    const flat = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 4 },
      { x: 0, y: 0, z: 8 },
      { x: 0, y: 50, z: 12 }, // intentional spike before assign
    ];
    const out = assignPathHeights(flat, VEHICLE_CAPABILITIES);
    const limit =
      Math.tan(VEHICLE_CAPABILITIES.maxSlopeRad) * PATH_SAFETY_FACTOR + 1e-6;
    for (let i = 1; i < out.length; i++) {
      const dx = out[i].x - out[i - 1].x;
      const dz = out[i].z - out[i - 1].z;
      const dh = Math.abs(out[i].y - out[i - 1].y);
      const horiz = Math.hypot(dx, dz) || 1e-6;
      expect(dh / horiz).toBeLessThanOrEqual(limit);
      expect(dh).toBeLessThanOrEqual(
        VEHICLE_CAPABILITIES.maxStepHeight * PATH_SAFETY_FACTOR + 1e-6,
      );
    }
  });
});

describe("maxSegmentSlopeRad export", () => {
  it("exists for validators", () => {
    expect(typeof maxSegmentSlopeRad).toBe("function");
  });
});
```

- [ ] **Step 2: Run — FAIL**

```bash
npm test
```

- [ ] **Step 3: Implement heightmap helpers + path**

`src/levelgen/heightmap.ts`:
```ts
import type { Vec3 } from "@/shared/types";

export function createHeightmap(resolution: number, fill = 0): Float32Array {
  return new Float32Array(resolution * resolution).fill(fill);
}

export function idx(resolution: number, col: number, row: number): number {
  return row * resolution + col;
}

export function worldToGrid(
  x: number,
  z: number,
  worldSize: number,
  resolution: number,
): { col: number; row: number; fx: number; fz: number } {
  const origin = -worldSize / 2;
  const cell = worldSize / (resolution - 1);
  const u = (x - origin) / cell;
  const v = (z - origin) / cell;
  const col = Math.floor(u);
  const row = Math.floor(v);
  return { col, row, fx: u - col, fz: v - row };
}

export function gridToWorld(
  col: number,
  row: number,
  worldSize: number,
  resolution: number,
): { x: number; z: number } {
  const origin = -worldSize / 2;
  const cell = worldSize / (resolution - 1);
  return { x: origin + col * cell, z: origin + row * cell };
}

export function sampleBilinear(
  heightmap: Float32Array,
  resolution: number,
  worldSize: number,
  x: number,
  z: number,
): number {
  const { col, row, fx, fz } = worldToGrid(x, z, worldSize, resolution);
  const c0 = Math.max(0, Math.min(resolution - 2, col));
  const r0 = Math.max(0, Math.min(resolution - 2, row));
  const h00 = heightmap[idx(resolution, c0, r0)];
  const h10 = heightmap[idx(resolution, c0 + 1, r0)];
  const h01 = heightmap[idx(resolution, c0, r0 + 1)];
  const h11 = heightmap[idx(resolution, c0 + 1, r0 + 1)];
  const h0 = h00 * (1 - fx) + h10 * fx;
  const h1 = h01 * (1 - fx) + h11 * fx;
  return h0 * (1 - fz) + h1 * fz;
}

export function setDisk(
  heightmap: Float32Array,
  resolution: number,
  worldSize: number,
  center: Vec3,
  radius: number,
  y: number,
): void {
  const cell = worldSize / (resolution - 1);
  const rCells = Math.ceil(radius / cell) + 1;
  const { col, row } = worldToGrid(center.x, center.z, worldSize, resolution);
  for (let dr = -rCells; dr <= rCells; dr++) {
    for (let dc = -rCells; dc <= rCells; dc++) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || r < 0 || c >= resolution || r >= resolution) continue;
      const p = gridToWorld(c, r, worldSize, resolution);
      if (Math.hypot(p.x - center.x, p.z - center.z) <= radius) {
        heightmap[idx(resolution, c, r)] = y;
      }
    }
  }
}
```

`src/levelgen/path.ts`:
```ts
import type { Vec3 } from "@/shared/types";
import type { VehicleCapabilities } from "@/shared/vehicleCapabilities";
import { clamp } from "@/shared/math";
import {
  PATH_POINT_SPACING_M,
  PATH_SAFETY_FACTOR,
  START_FINISH_EDGE_MARGIN_M,
} from "./types";

export function maxSegmentSlopeRad(a: Vec3, b: Vec3): number {
  const horiz = Math.hypot(b.x - a.x, b.z - a.z) || 1e-6;
  return Math.atan(Math.abs(b.y - a.y) / horiz);
}

export function assignPathHeights(
  points: Vec3[],
  vehicle: VehicleCapabilities,
): Vec3[] {
  if (points.length === 0) return [];
  const out: Vec3[] = points.map((p) => ({ ...p }));
  out[0].y = out[0].y || 8;
  const maxGrade = Math.tan(vehicle.maxSlopeRad) * PATH_SAFETY_FACTOR;
  const maxStep = vehicle.maxStepHeight * PATH_SAFETY_FACTOR;
  for (let i = 1; i < out.length; i++) {
    const horiz =
      Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z) || 1e-6;
    const maxDh = Math.min(maxStep, maxGrade * horiz);
    const target = out[i].y;
    const prev = out[i - 1].y;
    out[i].y = clamp(target, prev - maxDh, prev + maxDh);
  }
  // second pass backward for consistency
  for (let i = out.length - 2; i >= 0; i--) {
    const horiz =
      Math.hypot(out[i].x - out[i + 1].x, out[i].z - out[i + 1].z) || 1e-6;
    const maxDh = Math.min(maxStep, maxGrade * horiz);
    out[i].y = clamp(out[i].y, out[i + 1].y - maxDh, out[i + 1].y + maxDh);
  }
  return out;
}

export function generatePathPolyline(
  rng: () => number,
  mapSize: number,
  vehicle: VehicleCapabilities,
): { points: Vec3[]; startYaw: number; endYaw: number } {
  const m = START_FINISH_EDGE_MARGIN_M;
  const half = mapSize / 2;
  const start = {
    x: -half + m,
    y: 10,
    z: (rng() * 2 - 1) * (half - m),
  };
  const end = {
    x: half - m,
    y: 10,
    z: (rng() * 2 - 1) * (half - m),
  };

  const points: Vec3[] = [{ ...start }];
  let x = start.x;
  let z = start.z;
  let yaw = Math.atan2(end.x - start.x, end.z - start.z);
  const maxTurn = PATH_POINT_SPACING_M / Math.max(vehicle.minTurnRadius, 0.1);

  for (let guard = 0; guard < 2000; guard++) {
    const toEndX = end.x - x;
    const toEndZ = end.z - z;
    const dist = Math.hypot(toEndX, toEndZ);
    if (dist < PATH_POINT_SPACING_M * 1.2) break;

    const desired = Math.atan2(toEndX, toEndZ);
    let delta = desired - yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const noise = (rng() - 0.5) * maxTurn;
    delta = clamp(delta + noise, -maxTurn, maxTurn);
    yaw += delta;

    x += Math.sin(yaw) * PATH_POINT_SPACING_M;
    z += Math.cos(yaw) * PATH_POINT_SPACING_M;
    x = clamp(x, -half + m * 0.5, half - m * 0.5);
    z = clamp(z, -half + m * 0.5, half - m * 0.5);
    // gentle random elevation target; assignPathHeights will clamp
    const y = 8 + (rng() - 0.5) * 12;
    points.push({ x, y, z });
  }
  points.push({ ...end });

  const withHeights = assignPathHeights(points, vehicle);
  const startYaw = Math.atan2(
    withHeights[1].x - withHeights[0].x,
    withHeights[1].z - withHeights[0].z,
  );
  const n = withHeights.length;
  const endYaw = Math.atan2(
    withHeights[n - 1].x - withHeights[n - 2].x,
    withHeights[n - 1].z - withHeights[n - 2].z,
  );
  return { points: withHeights, startYaw, endYaw };
}

export function fallbackPath(
  mapSize: number,
  vehicle: VehicleCapabilities,
): { points: Vec3[]; startYaw: number; endYaw: number } {
  const m = START_FINISH_EDGE_MARGIN_M;
  const half = mapSize / 2;
  const points: Vec3[] = [];
  const startX = -half + m;
  const endX = half - m;
  for (let x = startX; x <= endX; x += PATH_POINT_SPACING_M) {
    const t = (x - startX) / (endX - startX);
    const y = 10 + Math.sin(t * Math.PI) * 3;
    points.push({ x, y, z: 0 });
  }
  if (points[points.length - 1].x < endX) {
    points.push({ x: endX, y: 10, z: 0 });
  }
  const withHeights = assignPathHeights(points, vehicle);
  return { points: withHeights, startYaw: 0, endYaw: 0 };
}
```

- [ ] **Step 4: Run tests — PASS**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/levelgen/path.ts src/levelgen/heightmap.ts tests/levelgen/pathConstraints.test.ts
git commit -m "feat: path polyline generation with slope/step clamping"
```

---

### Task 5: Validate, repair, generateLevel (full pipeline + corpus tests)

**Files:**
- Create: `src/levelgen/validate.ts`, `src/levelgen/repair.ts`, `src/levelgen/generateLevel.ts`
- Test: `tests/levelgen/validate.test.ts`, `tests/levelgen/reproducibility.test.ts`, `tests/levelgen/seedCorpus.test.ts`

**Interfaces:**
- Consumes: path, heightmap, biome, vehicle caps
- Produces: `generateLevel(input: GenerateLevelInput): LevelData`, `validateLevel(level, vehicle): ValidationResult`

- [ ] **Step 1: Write corpus + reproducibility tests first**

`tests/levelgen/reproducibility.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { generateLevel } from "@/levelgen/generateLevel";
import { cliffsBiome } from "@/biome/profiles/cliffs";
import { VEHICLE_CAPABILITIES } from "@/shared/vehicleCapabilities";
import { hashFloat32Array } from "@/shared/hash";

describe("generateLevel reproducibility", () => {
  it("same seed => same heightmap hash and POI JSON", () => {
    const input = {
      seed: 42,
      biome: cliffsBiome,
      vehicle: VEHICLE_CAPABILITIES,
    };
    const a = generateLevel(input);
    const b = generateLevel(input);
    expect(hashFloat32Array(a.heightmap)).toBe(hashFloat32Array(b.heightmap));
    expect(JSON.stringify(a.checkpoints)).toBe(JSON.stringify(b.checkpoints));
    expect(JSON.stringify(a.start)).toBe(JSON.stringify(b.start));
    expect(JSON.stringify(a.finish)).toBe(JSON.stringify(b.finish));
  });
});
```

`tests/levelgen/seedCorpus.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { generateLevel } from "@/levelgen/generateLevel";
import { validateLevel } from "@/levelgen/validate";
import { cliffsBiome } from "@/biome/profiles/cliffs";
import { VEHICLE_CAPABILITIES } from "@/shared/vehicleCapabilities";
import { mulberry32 } from "@/levelgen/rng";

const FIXED = [1, 2, 7, 42, 99, 12345, 99991];

describe("seed corpus GeometricSolvability", () => {
  it("fixed seeds pass", () => {
    for (const seed of FIXED) {
      const level = generateLevel({
        seed,
        biome: cliffsBiome,
        vehicle: VEHICLE_CAPABILITIES,
      });
      const v = validateLevel(level, VEHICLE_CAPABILITIES);
      expect(v.ok, `seed ${seed}: ${v.reasons.join("; ")}`).toBe(true);
    }
  });

  it("20 random seeds from meta-seed pass", () => {
    const rng = mulberry32(20260709);
    for (let i = 0; i < 20; i++) {
      const seed = (rng() * 0xffffffff) >>> 0;
      const level = generateLevel({
        seed,
        biome: cliffsBiome,
        vehicle: VEHICLE_CAPABILITIES,
      });
      const v = validateLevel(level, VEHICLE_CAPABILITIES);
      expect(v.ok, `seed ${seed}: ${v.reasons.join("; ")}`).toBe(true);
    }
  });
});
```

`tests/levelgen/validate.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { validateLevel } from "@/levelgen/validate";
import { generateLevel } from "@/levelgen/generateLevel";
import { cliffsBiome } from "@/biome/profiles/cliffs";
import { VEHICLE_CAPABILITIES } from "@/shared/vehicleCapabilities";

describe("validateLevel", () => {
  it("passes a generated level", () => {
    const level = generateLevel({
      seed: 7,
      biome: cliffsBiome,
      vehicle: VEHICLE_CAPABILITIES,
    });
    expect(validateLevel(level, VEHICLE_CAPABILITIES).ok).toBe(true);
  });

  it("fails when path empty", () => {
    const level = generateLevel({
      seed: 7,
      biome: cliffsBiome,
      vehicle: VEHICLE_CAPABILITIES,
    });
    level.pathPolyline = [];
    expect(validateLevel(level, VEHICLE_CAPABILITIES).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run — FAIL (missing generateLevel)**

```bash
npm test
```

- [ ] **Step 3: Implement validate, repair, generateLevel**

Implement `validateLevel` checking (per spec §7.5 Geometric):

1. `pathPolyline.length >= 2`
2. Each consecutive pair slope/step within budget
3. Left/right track offsets `± trackWidth/2` along path normal pass slope/step (sample heights via bilinear)
4. Curvature: heading change implies radius >= minTurnRadius * safety (approximate)
5. Stream depth on path: for each stream near path samples, dip <= STREAM_MAX_DEPTH_ON_PATH_M (if streams store absolute heights, compare path y - water)
6. Finite heightmap samples on path ribbon
7. Checkpoints have finite yaw/position

Implement `repairLevel(level, vehicle, attempt)`:

1. Flatten peaks near path (pull high cells toward path y)
2. Raise troughs on path
3. Widen path carve radius
4. Reduce off-path amplitude near path

Implement `generateLevel`:

```ts
export function generateLevel(input: GenerateLevelInput): LevelData {
  const mapSize = input.mapSize ?? input.biome.mapSize ?? DEFAULT_MAP_SIZE;
  const resolution = input.resolution ?? DEFAULT_RESOLUTION;
  const vehicle = input.vehicle;
  const rng = mulberry32(input.seed >>> 0);

  let path = generatePathPolyline(rng, mapSize, vehicle);
  let heightmap = carveAndDecorate(path.points, mapSize, resolution, input.biome, rng, vehicle);
  let level = buildLevelData(input, mapSize, resolution, path, heightmap, false, 0);

  let attempts = 0;
  let v = validateLevel(level, vehicle);
  while (!v.ok && attempts < MAX_REPAIR_ATTEMPTS) {
    attempts++;
    heightmap = repairHeightmap(level, vehicle, attempts, rng);
    level = { ...level, heightmap, meta: { usedFallback: false, repairAttempts: attempts } };
    // re-sample path Y from heightmap after repair
    level = resyncPathHeights(level);
    v = validateLevel(level, vehicle);
  }

  if (!v.ok) {
    path = fallbackPath(mapSize, vehicle);
    heightmap = carveAndDecorate(path.points, mapSize, resolution, input.biome, rng, vehicle, true);
    level = buildLevelData(input, mapSize, resolution, path, heightmap, true, attempts);
  }
  return level;
}
```

Fill in helpers in the same files: `carveAndDecorate` (path ribbon width = trackWidth + 2*pathClearance or biome.pathWidth), off-path fBm-ish noise using rng, stream placement by `streamDensity`, checkpoints every CHECKPOINT_SPACING_M with yaw from tangent, finish halfExtents `{x:4,y:3,z:4}`, killY = min height - 20.

Keep functions pure (no Three/Rapier imports).

- [ ] **Step 4: Run full unit suite — PASS**

```bash
npm test
```

If corpus flakes: tighten path generation or repair until green; do not weaken validator below spec.

- [ ] **Step 5: Commit**

```bash
git add src/levelgen tests/levelgen
git commit -m "feat: path-first generateLevel with validation and corpus tests"
```

---

### Task 6: Input router + keyboard provider

**Files:**
- Create: `src/input/types.ts`, `src/input/InputRouter.ts`, `src/input/KeyboardProvider.ts`
- Test: `tests/input/InputRouter.test.ts`

**Interfaces:**
- Consumes: nothing from physics
- Produces:
  - `InputActions`: `{ throttle: number; steer: number; brake: number; cameraToggle: boolean; respawn: boolean }`
  - `InputRouter.sample(): InputActions`
  - `KeyboardProvider` maps WASD/arrows/C/R

- [ ] **Step 1: Write router test**

`tests/input/InputRouter.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { InputRouter } from "@/input/InputRouter";
import type { InputProvider } from "@/input/types";

describe("InputRouter", () => {
  it("forwards provider sample", () => {
    const provider: InputProvider = {
      sample: () => ({
        throttle: 1,
        steer: -0.5,
        brake: 0,
        cameraToggle: false,
        respawn: false,
      }),
      dispose: () => {},
    };
    const router = new InputRouter(provider);
    expect(router.sample().throttle).toBe(1);
    expect(router.sample().steer).toBe(-0.5);
  });
});
```

- [ ] **Step 2: Implement input**

`src/input/types.ts`:
```ts
export interface InputActions {
  throttle: number; // -1..1 (negative = reverse intent)
  steer: number; // -1..1
  brake: number; // 0..1
  cameraToggle: boolean; // edge: true only on press frame if possible
  respawn: boolean;
}

export interface InputProvider {
  sample(): InputActions;
  dispose(): void;
}
```

`src/input/InputRouter.ts`:
```ts
import type { InputActions, InputProvider } from "./types";

export class InputRouter {
  constructor(private provider: InputProvider) {}
  sample(): InputActions {
    return this.provider.sample();
  }
  dispose(): void {
    this.provider.dispose();
  }
}
```

`src/input/KeyboardProvider.ts`:
```ts
import type { InputActions, InputProvider } from "./types";

export class KeyboardProvider implements InputProvider {
  private keys = new Set<string>();
  private cameraPressed = false;
  private respawnPressed = false;
  private onDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
    if (e.code === "KeyC") this.cameraPressed = true;
    if (e.code === "KeyR") this.respawnPressed = true;
  };
  private onUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  constructor(target: Window = window) {
    target.addEventListener("keydown", this.onDown);
    target.addEventListener("keyup", this.onUp);
  }

  sample(): InputActions {
    const up = this.keys.has("KeyW") || this.keys.has("ArrowUp");
    const down = this.keys.has("KeyS") || this.keys.has("ArrowDown");
    const left = this.keys.has("KeyA") || this.keys.has("ArrowLeft");
    const right = this.keys.has("KeyD") || this.keys.has("ArrowRight");
    let throttle = 0;
    if (up) throttle += 1;
    if (down) throttle -= 1;
    let steer = 0;
    if (left) steer -= 1;
    if (right) steer += 1;
    const actions: InputActions = {
      throttle,
      steer,
      brake: down && !up ? 1 : 0,
      cameraToggle: this.cameraPressed,
      respawn: this.respawnPressed,
    };
    this.cameraPressed = false;
    this.respawnPressed = false;
    return actions;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onDown);
    window.removeEventListener("keyup", this.onUp);
  }
}
```

- [ ] **Step 3: Run tests — PASS**

```bash
npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/input tests/input
git commit -m "feat: input router and keyboard provider"
```

---

### Task 7: Physics world + raycast vehicle on flat ground

**Files:**
- Create: `src/physics/PhysicsWorld.ts`, `src/physics/vehicle/VehicleController.ts`, `src/physics/vehicle/VehicleConfig.ts` (re-export shared config), temporary flat-ground harness wired from `GameApp` or `main`
- Manual test: drive 60s on plane

**Interfaces:**
- Consumes: `InputActions`, `VEHICLE_CONFIG`, Rapier
- Produces:
  - `PhysicsWorld` with `step()`, `getWorld()`
  - `VehicleController` with `constructor(world, pose)`, `update(dt, input)`, `getPose()`, `reset(pose)`, `chassisBody`

- [ ] **Step 1: Implement PhysicsWorld bootstrap**

`src/physics/PhysicsWorld.ts`:
```ts
import RAPIER from "@dimforge/rapier3d-compat";

export class PhysicsWorld {
  readonly world: RAPIER.World;

  private constructor(world: RAPIER.World) {
    this.world = world;
  }

  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    const gravity = { x: 0, y: -9.81, z: 0 };
    return new PhysicsWorld(new RAPIER.World(gravity));
  }

  step(): void {
    this.world.step();
  }

  createGroundPlane(y = 0): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, y, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.1, 500), body);
  }
}
```

- [ ] **Step 2: Implement VehicleController**

Core algorithm each fixed tick:

1. Read chassis rotation/translation.
2. For each wheel local position: raycast down restLength+travel; if hit, compute compression; spring+damper force along surface normal/up; apply force at wheel point.
3. Lateral/longitudinal friction from velocity at contact; apply drive force from throttle * engineForce when grounded; brakeForce when brake.
4. Steering: rotate front wheel direction by steer * maxSteerRad * speedFactor.

`src/physics/vehicle/VehicleController.ts` — full class applying Rapier forces; expose:

```ts
export class VehicleController {
  update(dt: number, input: InputActions): void;
  getPose(): { position: Vec3; yaw: number; quaternion: {x,y,z,w} };
  reset(pose: Pose2D): void;
  getWheelDebug(): ... // optional
}
```

Use `VEHICLE_CONFIG` from `@/shared/vehicleConfig`. Chassis collider: cuboid half-extents from config; mass from config.

- [ ] **Step 3: Wire temporary Playing sandbox in `src/main.ts` / `GameApp`**

- Init Rapier, plane, vehicle at `{0, 2, 0}`, keyboard input.
- Three.js simple box chassis following pose.
- Fixed timestep loop with accumulator.
- On-screen debug text for throttle/steer (optional).

Manual gate: drive, turn, brake, reverse for 60s without exploding.

- [ ] **Step 4: Commit**

```bash
git add src/physics src/main.ts src/app src/render/createRenderer.ts src/render/JeepMesh.ts
git commit -m "feat: raycast vehicle on flat ground"
```

(Create minimal `createRenderer.ts` + `JeepMesh.ts` as needed for the sandbox.)

---

### Task 8: Heightfield terrain + spawn + finish win

**Files:**
- Create: `src/physics/createHeightfield.ts`, `src/render/TerrainMesh.ts`, `src/render/GameScene.ts`, `src/gameplay/FinishSystem.ts`
- Modify: app loading path to call `generateLevel` + build world

**Interfaces:**
- Consumes: `LevelData`, Rapier world
- Produces: terrain collider + mesh; finish sensor; `FinishSystem.update(chassisPos) => boolean`

- [ ] **Step 1: createHeightfield**

```ts
// src/physics/createHeightfield.ts
import RAPIER from "@dimforge/rapier3d-compat";
import type { LevelData } from "@/levelgen/types";

export function createHeightfieldCollider(
  world: RAPIER.World,
  level: LevelData,
): RAPIER.Collider {
  const nrows = level.resolution;
  const ncols = level.resolution;
  const scale = {
    x: level.worldSize,
    y: 1,
    z: level.worldSize,
  };
  // Rapier heightfield: heights row-major; verify against library docs for version used.
  const desc = RAPIER.ColliderDesc.heightfield(nrows - 1, ncols - 1, level.heightmap, scale)
    .setTranslation(0, 0, 0);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  return world.createCollider(desc, body);
}
```

Verify Rapier heightfield constructor signature for installed version; adjust nrows/ncols/scale so world extents match `worldSize` and origin convention in shared math. Add a unit-free manual check: spawn at `level.start` should be slightly above terrain.

- [ ] **Step 2: TerrainMesh**

Build `THREE.BufferGeometry` grid from heightmap; vertex colors from biome palette (path cells lighter). Align translation/scale with collider.

- [ ] **Step 3: FinishSystem**

```ts
export class FinishSystem {
  constructor(private finish: LevelData["finish"]) {}
  isFinished(position: Vec3): boolean {
    const he = this.finish.halfExtents;
    const p = this.finish.position;
    return (
      Math.abs(position.x - p.x) <= he.x &&
      Math.abs(position.y - p.y) <= he.y &&
      Math.abs(position.z - p.z) <= he.z
    );
  }
}
```

Also add a visible low-poly finish pillar in `GameScene`.

- [ ] **Step 4: Loading flow**

`GameStateMachine` transitions: Menu (temp auto) -> Loading generates seed 42 cliffs -> Playing. On finish -> log win / Result stub.

Manual gate: seed **42** completable along path.

- [ ] **Step 5: Commit**

```bash
git add src/physics/createHeightfield.ts src/render src/gameplay src/app
git commit -m "feat: heightfield terrain, spawn, and finish trigger"
```

---

### Task 9: Checkpoints + respawn + kill-Y

**Files:**
- Create: `src/gameplay/CheckpointSystem.ts`, `src/gameplay/RespawnSystem.ts`
- Modify: Playing loop

**Interfaces:**
- Consumes: `LevelData.checkpoints`, `start`, `killY`, input.respawn
- Produces: last checkpoint pose; `maybeRespawn(vehicle, pos)`

- [ ] **Step 1: CheckpointSystem**

```ts
export class CheckpointSystem {
  private last: Pose2D;
  constructor(start: Pose2D, private checkpoints: LevelData["checkpoints"]) {
    this.last = { ...start, position: { ...start.position } };
  }
  update(pos: Vec3): void {
    for (const cp of this.checkpoints) {
      if (Math.hypot(pos.x - cp.position.x, pos.z - cp.position.z) <= cp.radius) {
        this.last = {
          position: { ...cp.position, y: cp.position.y + 1.2 },
          yaw: cp.yaw,
        };
      }
    }
  }
  getRespawnPose(): Pose2D {
    return this.last;
  }
}
```

- [ ] **Step 2: RespawnSystem**

If `pos.y < killY` or `input.respawn`: `vehicle.reset(checkpoint.getRespawnPose())` + input lock timer 0.25s.

- [ ] **Step 3: Manual checklist**

Drive off edge; confirm respawn facing path; press R.

- [ ] **Step 4: Commit**

```bash
git add src/gameplay
git commit -m "feat: checkpoints, kill-Y, and manual respawn"
```

---

### Task 10: Camera rig TP / FP

**Files:**
- Create: `src/render/CameraRig.ts`
- Modify: Playing loop + input cameraToggle

**Interfaces:**
- Consumes: chassis pose/quaternion
- Produces: `CameraRig.setMode('third'|'first')`, `update(dt)`

- [ ] **Step 1: Implement CameraRig**

```ts
export type CameraMode = "third" | "first";

export class CameraRig {
  mode: CameraMode = "third";
  constructor(private camera: THREE.PerspectiveCamera) {}
  toggle(): void {
    this.mode = this.mode === "third" ? "first" : "third";
    this.camera.fov = this.mode === "third" ? 55 : 72;
    this.camera.updateProjectionMatrix();
  }
  update(chassis: THREE.Object3D, dt: number): void {
    if (this.mode === "third") {
      // desired local offset (0, 3.5, -8); smooth damp toward world position
    } else {
      // eye local (0, 1.35, 0.35)
    }
  }
}
```

- [ ] **Step 2: Edge-trigger C key via InputActions.cameraToggle**

- [ ] **Step 3: Manual S5** — drive segment in both modes

- [ ] **Step 4: Commit**

```bash
git add src/render/CameraRig.ts
git commit -m "feat: third and first person camera toggle"
```

---

### Task 11: HUD minimap + goal arrow + seed display

**Files:**
- Create: `src/ui/minimap.ts`, `src/ui/hud.ts`, `src/ui/dom.ts`
- Modify: Playing enter/exit

**Interfaces:**
- Consumes: `MinimapModel` from spec
- Produces: DOM HUD + canvas minimap draw each frame

- [ ] **Step 1: Minimap**

North-up; map XZ from `[-worldSize/2, worldSize/2]` to canvas; player triangle by yaw; finish marker.

```ts
export interface MinimapModel {
  worldSize: number;
  player: { x: number; z: number; yaw: number };
  finish: { x: number; z: number };
  checkpoints: { x: number; z: number }[];
}

export function drawMinimap(ctx: CanvasRenderingContext2D, model: MinimapModel): void {
  // clear, ground rect, checkpoints, finish, player
}
```

- [ ] **Step 2: Goal arrow**

Compute angle between player forward and to-finish vector in XZ; rotate CSS arrow.

- [ ] **Step 3: HUD shows biome name + seed always**

- [ ] **Step 4: Manual S6/S10**

- [ ] **Step 5: Commit**

```bash
git add src/ui
git commit -m "feat: HUD minimap, goal arrow, and seed display"
```

---

### Task 12: Game state machine + menu + result + error

**Files:**
- Create: `src/app/GameStateMachine.ts`, `src/app/GameApp.ts`, `src/ui/menu.ts`, `src/ui/result.ts`, `src/ui/error.ts`
- Modify: `src/main.ts` to only `new GameApp().start()`

**Interfaces:**
- Consumes: `listBiomes()`, `generateLevel`, full systems
- Produces: complete loop S1, S8, S10

- [ ] **Step 1: State machine**

States: `boot | menu | loading | playing | result | error`.

```ts
export type GameState =
  | { name: "boot" }
  | { name: "menu" }
  | { name: "loading"; biomeId: string; seed: number }
  | { name: "playing"; biomeId: string; seed: number }
  | { name: "result"; biomeId: string; seed: number }
  | { name: "error"; message: string };
```

- [ ] **Step 2: Menu UI**

- List biomes from registry (only cliffs).
- Seed field: empty = random uint32; else parse integer.
- Start button -> loading.

- [ ] **Step 3: Result UI**

Success message; buttons: Retry same seed, New random seed, Menu.

- [ ] **Step 4: Error UI**

Message + Retry / Menu for WASM failures.

- [ ] **Step 5: Cliffs presentation polish**

Fog, sky clear color from biome, decorative props as non-colliding meshes scattered with seeded rng (optional light touch if time), finish pillar, stream meshes from `level.streams`.

- [ ] **Step 6: Manual S1/S8/S9**

- [ ] **Step 7: Commit**

```bash
git add src/app src/ui src/main.ts src/render src/biome
git commit -m "feat: menu, result, error flow and cliffs presentation"
```

---

### Task 13: MVP harden + full checklist

**Files:**
- Modify: tuning constants only if needed; README
- Create: `README.md` with controls, scripts, seed tips

**Interfaces:** none new

- [ ] **Step 1: Run automated tests**

```bash
npm test
npm run build
```

Expected: all green; production build succeeds.

- [ ] **Step 2: Manual checklist from spec §13.2**

- [ ] Menu starts cliffs with random seed  
- [ ] Explicit seed twice matches layout  
- [ ] Seed 42 finish without mandatory off-path  
- [ ] Fall respawn facing OK  
- [ ] R respawns  
- [ ] C toggles TP/FP  
- [ ] Minimap + arrow work  
- [ ] Win → Retry / Menu  
- [ ] Soft perf: no sustained <30 fps on mid laptop @ res 129  

- [ ] **Step 3: Write README.md**

```md
# Low-Poly Jeep Off-Road

## Scripts
- npm run dev
- npm test
- npm run build

## Controls
- WASD / Arrows drive
- C camera
- R respawn

## Spec
See docs/superpowers/specs/2026-07-09-lowpoly-jeep-offroad-design.md
```

- [ ] **Step 4: Commit**

```bash
git add README.md src
git commit -m "chore: MVP harden, README, and ship checklist"
```

---

## Spec Coverage Matrix

| Spec requirement | Task(s) |
|------------------|---------|
| S1 Menu biome | 12 |
| S2 Seed reproducibility | 5, 12, 13 |
| S3 Geometric solvability | 4, 5 |
| S4 Raycast vehicle | 7 |
| S5 TP/FP | 10 |
| S6 Minimap + goal | 11 |
| S7 Respawn | 9 |
| S8 Finish win | 8, 12 |
| S9 Low-poly cliffs | 8, 12 |
| S10 Seed UX | 11, 12 |
| Path-first + fallback | 4, 5 |
| Heightfield | 8 |
| Input abstraction | 6 |
| Error state | 12 |
| Vitest corpus | 5 |
| Extensible biomes | 3, 12 |

---

## Plan Self-Review

1. **Spec coverage:** S1–S10 mapped; non-goals not scheduled.  
2. **Placeholders:** Task 5–8 include algorithmic detail; implementers must complete full `generateLevel` helpers in Task 5 without leaving `throw new Error("TODO")`. If a helper is missing from a code block, define it in the same task before commit.  
3. **Type consistency:** `LevelData`, `Pose2D`, `InputActions`, `VehicleCapabilities` names match across tasks.  
4. **Rapier heightfield API:** verify at Task 8 against installed package docs; adjust scale/origin once with a single helper used by mesh + collider + minimap.  
5. **TDD:** Tasks 2–6 lead with tests; vehicle/camera/UI use manual gates as integration is browser-bound.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-09-lowpoly-jeep-offroad.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with checkpoints  

Which approach?
