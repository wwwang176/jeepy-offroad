# Low-Poly Jeep Off-Road — Design Spec

**Date:** 2026-07-09  
**Status:** Draft (Codex review incorporated; awaiting user approval)  
**Project:** `grok-jeep-game`  
**Constraint:** Extensible architecture first; ship one playable biome vertical slice.

---

## 1. Goal

Build a browser-based 3D off-road driving game where the player:

1. Picks a **biome / scene theme** on the main menu (cliffs, rainforest, etc. — **not** difficulty tiers).
2. Drives a low-poly jeep with **semi-realistic** vehicle physics.
3. Crosses cliffs, streams, and other obstacles.
4. Reaches a finish volume to clear the run.
5. Uses **third-person or first-person** camera, with **minimap** and **goal guidance** on the HUD.

Terrain is **seeded procedural** generation with a **guaranteed drivable route** to the finish (path-first generation + solvability constraints).

### 1.1 Non-goals (MVP)

- Multiplayer
- Timed trials / damage / fuel systems
- Mobile-first controls (architecture only reserves input providers)
- Full biome catalog (only one biome ships in MVP)
- External level editor pipeline
- Photoreal graphics
- Camera collision pull-in, free mouse-look in first person
- Audio

### 1.2 Success criteria (MVP)

| ID | Criterion |
|----|-----------|
| S1 | Main menu lists at least one biome; selecting it starts a run. |
| S2 | Same `(biomeId, seed)` reproduces the same layout (bit-identical heightmap + POIs for pure logic). |
| S3 | Generated main path passes **GeometricSolvability** (and MVP playability gates in section 6.5). |
| S4 | Semi-realistic jeep: 4-wheel raycast suspension, throttle/brake/steer, stable on slopes. |
| S5 | Toggle third-person / first-person; both usable for a full run (checklist in section 8). |
| S6 | HUD: minimap + direction-to-finish indicator. |
| S7 | Fall / stuck recovery via checkpoint or start respawn (pose includes yaw). |
| S8 | Entering finish volume shows clear success state and return-to-menu. |
| S9 | Low-poly visual language (flat colors, simple meshes, light stylization). |
| S10 | Seed is visible in HUD; menu can start with random seed **or** explicit seed for replay. |

---

## 2. Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Language | TypeScript (strict) | Safety for sim + generation code. |
| Bundler / dev | Vite | Fast HMR, simple static deploy. |
| Rendering | Three.js (current stable at scaffold time) | Mature WebGL, low-poly friendly. |
| Physics | Rapier3D (`@dimforge/rapier3d-compat`) | WASM performance; heightfield support. |
| Vehicle | Custom raycast vehicle on Rapier rigid body | Semi-realistic control; parameters shared with generator. |
| UI | HTML/CSS overlay (DOM) + 2D canvas minimap | Clear separation from 3D; easy menu/HUD. |
| RNG | Seeded PRNG (`mulberry32`) | Small, reproducible, no deps. |
| Tests | Vitest for pure logic | Generation, validation, math without WebGL CI. |
| Deploy target | Static site | No backend in MVP. |

**Rejected for long-term core:** Cannon-es as primary physics; closed vehicle kits that hide suspension parameters.

---

## 3. Conventions (units, coordinates)

| Topic | Convention |
|-------|------------|
| World units | Meters |
| Up axis | +Y |
| Horizontal plane | XZ |
| Yaw | Radians around +Y; 0 faces +Z |
| Heightmap origin | World corner `(-worldSize/2, 0, -worldSize/2)`; +X columns, +Z rows |
| Height sample | `heightmap[row * resolution + col]` = Y in meters |
| Cell size | `worldSize / (resolution - 1)` |
| Time | Seconds; physics fixed step `1/60` |

---

## 4. High-Level Architecture

```
App shell: Boot -> Menu -> Loading -> Playing -> Result
                 \-> Error (boot/load failure, retry or menu)

          +----------------+     +----------------+
          | UI (DOM)       |     | Input Router   |
          | Menu/HUD/Result|     | Keyboard MVP   |
          +--------+-------+     +--------+-------+
                   |                      |
                   +----------+-----------+
                              |
                      +-------v--------+
                      | Play Session   |
                      | biomeId, seed  |
                      +-------+--------+
                              |
         +--------------------+--------------------+
         |                    |                    |
 +-------v------+     +-------v------+     +-------v------+
 | LevelGen     |     | World / Sim  |     | Presentation |
 | path-first   |     | Rapier + car |     | Three + cam  |
 +--------------+     +--------------+     +--------------+
```

### 4.1 Module boundaries

| Module | Responsibility | Must not |
|--------|----------------|----------|
| `app/` | Boot, state machine, wiring | Physics formulas or mesh gen |
| `input/` | Abstract axes/actions | Know Three or Rapier |
| `biome/` | Biome profile data | Generate path geometry |
| `levelgen/` | Seeded layout, validation | Render or step physics |
| `physics/` | Rapier world, colliders, vehicle | Own biome art choices |
| `gameplay/` | Checkpoints, finish, respawn, win | Own rendering details |
| `render/` | Three scene, materials, camera | Own win rules |
| `ui/` | Menu, HUD, minimap, result | Step simulation |
| `shared/` | Math, RNG, types, vehicle caps/config | Side effects |

**Rule:** Level generation imports **vehicle capability constants** from `shared/vehicleCapabilities.ts` so solvability matches the jeep.

### 4.2 Public module contracts (MVP)

| API | Module | Contract |
|-----|--------|----------|
| `generateLevel(input) -> LevelData` | `levelgen` | Pure, deterministic for seed; never throws for valid input (uses repair/fallback). |
| `createTerrainCollider(world, level)` | `physics` | Builds Rapier **heightfield** from `LevelData`. |
| `VehicleController.update(dt, input, world)` | `physics/vehicle` | Fixed-step only; raycasts against current world; applies forces then caller steps world. |
| `CameraRig.update(mode, chassisPose, dt)` | `render` | TP/FP mounts from config. |
| `Minimap.draw(model)` | `ui` | Pure draw from `MinimapModel` (no Rapier). |

### 4.3 Frame loop (Playing) — fixed step

Per accumulated fixed tick (`dt = 1/60`):

1. Read input snapshot (actions sampled once per tick from latest edge state).
2. `VehicleController`: cast 4 suspension rays using **current** rigid-body pose (pre-step); compute spring/damper + tire forces; apply forces/torques to chassis.
3. `world.step()` (Rapier).
4. Gameplay: test sensors (checkpoints, finish), kill-Y, manual respawn request.
5. (After all fixed steps for the frame) Sync Three meshes from physics; update camera; update HUD/minimap.

No render interpolation required for MVP (hard sync is OK).

### 4.4 Error state

| Failure | Behavior |
|---------|----------|
| Rapier WASM load fail | `Error` state: message + Retry |
| Unexpected generation exception | Should not happen; if it does, `Error` + return Menu; log seed/biome |

---

## 5. Game Flow

### 5.1 States

| State | Enter | Exit |
|-------|-------|------|
| `Boot` | Load Rapier WASM | Ready -> `Menu`; fail -> `Error` |
| `Menu` | List biomes; seed = random or user-entered uint32 | Start -> `Loading` |
| `Loading` | `generateLevel` + build world/meshes | Ready -> `Playing`; fail -> `Error` |
| `Playing` | Drive; HUD | Finish -> `Result`; Quit -> `Menu` |
| `Result` | Success panel (seed shown) | Retry same seed / New seed / Menu |
| `Error` | Message | Retry / Menu |

### 5.2 Win / fail (MVP)

- **Win:** Chassis AABB/sensor intersects finish trigger (**axis-aligned box** centered at finish pose, size from `LevelData.finish.halfExtents`).
- **No permanent fail.** Kill-Y or key **R** -> respawn at last checkpoint pose (or start), zero velocities, 0.25s input lock.

### 5.3 Controls (MVP)

| Action | Default binding |
|--------|-----------------|
| Steer | A / D or Left / Right arrows |
| Throttle | W or Up arrow |
| Brake / reverse | S or Down arrow |
| Camera toggle | C |
| Respawn | R |

Input layer exposes actions; keyboard provider only for MVP. Future touch maps to same actions.

---

## 6. Biomes = Scene Themes (Not Difficulty)

### 6.1 Concept

A **BiomeProfile** changes **look and prop vocabulary**. Product framing is scene choice (cliffs, rainforest), not "level 1 harder than level 2."

**Guardrail:** Biome fields may change flavor (stream density, prop density, off-path roughness) but **must not** relax or bypass global vehicle solvability constraints. Route hardness stays within a shared band enforced by `VehicleCapabilities` + generator safety factors.

### 6.2 BiomeProfile fields

```ts
type BiomeId = string;

interface PropSpawnRule {
  meshKey: string;
  weight: number;
  collides: boolean; // MVP: all false (decorative only)
}

interface BiomeProfile {
  id: BiomeId;
  displayName: string;
  description: string;
  skyColor: string;
  fogColor: string;
  fogDensity: number;
  groundPalette: { high: string; mid: string; low: string; path: string };
  waterColor: string;
  streamDensity: number;    // 0..1, flavor only
  offPathRoughness: number; // 0..1, off-path drama
  propDensity: number;      // 0..1
  propTable: PropSpawnRule[];
  pathWidth?: number;       // override default meters
  mapSize?: number;         // override default meters
}
```

### 6.3 MVP biome: `cliffs`

| Asset | Spec |
|-------|------|
| Palette | Tan/grey rock highs, dusty mid, dark crevices, lighter path ribbon |
| Props (decorative, no collision) | Rock pile, dead scrub, sparse pillar rock (3 keys) |
| Streams | Thin planar water mesh + slightly lowered path ford |
| Markers | Low-poly finish arch/pillar; checkpoint post (optional visual) |
| Menu | Only list `cliffs` (no fake locked biomes) |

Future biomes (rainforest, etc.) = new profile + art, same generator.

---

## 7. Level Generation (Path-First, Seeded, Solvable)

### 7.1 Inputs / defaults

```ts
interface GenerateLevelInput {
  seed: number; // uint32
  biome: BiomeProfile;
  vehicle: VehicleCapabilities;
  mapSize: number;     // default 256
  resolution: number;  // default 129 (odd, power-of-two-plus-one friendly)
}

// Generator constants (MVP defaults)
const PATH_POINT_SPACING_M = 4;
const PATH_SAFETY_FACTOR = 0.75;      // slope/step budget vs vehicle max
const STREAM_MAX_DEPTH_ON_PATH_M = 0.35;
const CHECKPOINT_SPACING_M = 40;
const START_FINISH_EDGE_MARGIN_M = 16;
const MAX_REPAIR_ATTEMPTS = 8;
```

### 7.2 Pipeline (deterministic)

1. **RNG:** `mulberry32(seed)`. Optionally mix biome id into a domain separator for prop placement stream only; path heights must be fully determined by `(seed, biome generation fields, vehicle caps, mapSize, resolution)`.
2. **Start / finish:** Place near opposite sides with edge margin; random along that side within margin.
3. **Backbone path polyline:**
   - Build polyline from start to finish with point spacing ~`PATH_POINT_SPACING_M`.
   - Method: biased random midpoint displacement / noisy corridor toward finish; reject steps that violate `minTurnRadius` (re-sample heading with clamp).
   - Self-intersection: allow mild self-near; if segments cross, simplify by skipping loop (short-circuit) deterministically.
4. **Path heights:**
   - Assign Y along polyline so consecutive samples satisfy:
     - `abs(dh) / horizontalDist <= tan(maxSlopeRad) * PATH_SAFETY_FACTOR`
     - `abs(dh) <= maxStepHeight * PATH_SAFETY_FACTOR`
   - Prefer smooth grade changes; clamp locally if violated.
5. **Carve ribbon:** For each path sample, set heightmap cells within `pathWidth/2` (default from vehicle track + clearance or biome override) to path height; constrained smooth (only cells that remain within slope limits relative to path center).
6. **Off-path terrain:** fBm noise * roughness; raise cliffs away from path; do not modify path-masked cells.
7. **Streams:** Place 0..N crossings based on `streamDensity`. At path intersection, ford depth <= `STREAM_MAX_DEPTH_ON_PATH_M` and still passes slope/step on centerline + left/right tracks.
8. **Checkpoints:** Every `CHECKPOINT_SPACING_M` along arc length (excluding start); each stores **position + yaw** (path tangent) + radius.
9. **Finish:** At path end; store position, yaw, **halfExtents** box (e.g. 4 x 3 x 4 m).
10. **Validate** (section 7.5). On fail: **repair** then re-validate up to `MAX_REPAIR_ATTEMPTS`. If still fail: **fallback path** (section 7.4). Set `LevelData.meta.usedFallback`.

### 7.3 Outputs

```ts
interface Pose2D {
  position: Vec3; // y = ground height
  yaw: number;
}

interface LevelData {
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
    halfExtents: Vec3; // box trigger
  };
  checkpoints: { id: string; position: Vec3; yaw: number; radius: number }[];
  streams: { polyline: Vec3[]; width: number }[];
  killY: number; // e.g. minHeight - 20
  meta: {
    usedFallback: boolean;
    repairAttempts: number;
  };
}
```

### 7.4 Repair and fallback

| Stage | Behavior |
|-------|----------|
| Repair ops (in order, deterministic) | (1) Flatten path-adjacent peaks; (2) Raise path troughs; (3) Widen path mask by 1 cell; (4) Reduce off-path noise near path. |
| Fallback | Straight-ish ribbon: straight line start->finish in XZ with gentle vertical S-curve within slope limits; minimal streams; still places start/finish/checkpoints. Same seed still reproducible. |
| Guarantee | `generateLevel` always returns `LevelData` for valid numeric inputs. |

### 7.5 Solvability (split definition)

#### GeometricSolvability (required automated tests)

1. Continuous centerline from start to finish (ordered samples).
2. Every centerline segment passes slope + step vs `VehicleCapabilities * PATH_SAFETY_FACTOR`.
3. Left and right **wheel-track** offsets (`± trackWidth/2` along path normal) also pass slope + step.
4. Path ribbon width >= `trackWidth + 2 * pathClearance`.
5. Curvature radius along path >= `minTurnRadius` (polyline heading changes).
6. No gaps (heightmap defined everywhere; path cells finite).
7. Stream depth on path samples <= `STREAM_MAX_DEPTH_ON_PATH_M`.
8. Spawn and each checkpoint: ground under pose; yaw defined; not inside finish box incorrectly.

#### VehiclePlayability (MVP scope)

- **MVP guarantee = GeometricSolvability only** (static). Document this honestly in UI if needed ("route designed for this jeep").
- **Soft gate (manual / later automated):** drive smoke on a fixed seed corpus (section 12) must complete without respawn on at least 3 of 5 seeds after vehicle tuning lock.
- Full physics path simulation in CI is **post-MVP**.

### 7.6 Collision representation (MVP decision)

**Use Rapier heightfield** as the sole terrain collider.

| Rule | Detail |
|------|--------|
| Source | Same `LevelData.heightmap` as visual mesh |
| Scale | Map `resolution` samples across `worldSize` meters; heights in meters |
| Visual | Non-indexed or indexed grid mesh sampling same heights; vertex colors from biome palette + path mask |
| Props | Decorative only in MVP (no colliders) so they cannot block the guaranteed path |

---

## 8. Vehicle (Semi-Realistic)

### 8.1 Model

- Chassis: single rigid body (box compound), mass from config.
- Four suspension rays at wheel corners (down in chassis local -Y):
  - Spring + damper support force along ray.
  - Tire: simplified friction ellipse (longitudinal drive/brake + lateral grip).
- Drive: **AWD** torque split equal front/rear when grounded.
- Steer: front wheels; max steer angle decreases with speed.
- Brake: opposing longitudinal force; low-speed reverse when throttle reverse.
- Optional soft anti-roll: scale lateral grip or add roll-damping torque if roll rate high (document if enabled).

### 8.2 VehicleCapabilities (generator-facing, initial MVP numbers)

```ts
// shared/vehicleCapabilities.ts — initial guesses; tune but keep table updated
export const VEHICLE_CAPABILITIES = {
  maxSlopeRad: (28 * Math.PI) / 180, // 28 deg
  maxStepHeight: 0.45,               // m
  minTurnRadius: 6.0,                // m at crawl
  trackWidth: 1.6,                   // m
  wheelBase: 2.4,                    // m
  pathClearance: 0.8,                // m each side beyond track
} as const;
```

### 8.3 VehicleConfig (controller-facing, initial MVP numbers)

```ts
export const VEHICLE_CONFIG = {
  massKg: 1400,
  chassisHalfExtents: { x: 0.9, y: 0.45, z: 1.3 }, // m
  wheelPositions: [ /* FL, FR, RL, RR local positions from COM */ ],
  suspRestLength: 0.55,
  suspMaxTravel: 0.25,
  springStiffness: 42000,
  springDamping: 4500,
  engineForce: 9000,
  brakeForce: 12000,
  maxSteerRad: (32 * Math.PI) / 180,
  tireGripLong: 1.1,
  tireGripLat: 1.0,
  frictionEllipse: true,
} as const;
```

Wheel local positions derived from `trackWidth` / `wheelBase` (not free-floating magic numbers).

### 8.4 Respawn

Snap chassis to `{position, yaw}` of last checkpoint (or start), zero linear/angular velocity, 0.25s input lock.

---

## 9. Camera

| Mode | Mount / behavior |
|------|------------------|
| Third person (default) | Spring arm: local offset `(0, 3.5, -8)` m from chassis; look-at `(0, 1.2, 0)`; smooth follow ~10 Hz lag. No collision pull-in MVP. |
| First person | Eye local `(0, 1.35, 0.35)`; yaw/pitch follow chassis (no free mouse-look MVP). |

- Toggle: key **C**, blend <= 0.25s or instant.
- FOV: TP 55 deg, FP 72 deg.
- **Acceptance (S5):** Complete one full run in each mode without being unable to see the route ahead for >2s continuously (manual checklist).

---

## 10. HUD and Guidance

### 10.1 Minimap model

```ts
interface MinimapModel {
  worldSize: number;
  player: { x: number; z: number; yaw: number };
  finish: { x: number; z: number };
  checkpoints: { x: number; z: number }[];
  // optional: pathPolyline downsample
}
```

| Rule | Choice |
|------|--------|
| Orientation | **North-up** (world +Z = up on minimap) |
| Player | Triangle rotated by yaw |
| Finish | Distinct marker |
| Size | ~160–200 px corner |
| Update | Every frame; 2D canvas |

World-to-minimap: linear map XZ from `[-worldSize/2, worldSize/2]` into canvas with padding.

### 10.2 Goal guidance

- Screen-space arrow: direction from player to finish in XZ, drawn on HUD (not world-only).
- Optional world beacon at finish (low-poly pillar) — yes for cliffs MVP.
- Distance text: optional, not required for S6.

### 10.3 Other HUD

- Biome name + **seed** (always visible during play) for share/replay.
- Control hints first visit (dismissible).

---

## 11. Presentation (Low-Poly)

- Flat/low-vertex meshes; vertex colors or simple Lambert.
- One directional light + ambient; biome fog.
- Jeep: procedural box kit acceptable for MVP (body + cabin + 4 wheel cylinders).
- Streams: planar mesh along stream polylines + path dip.

---

## 12. Repository Layout

```
grok-jeep-game/
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  docs/superpowers/specs/
  public/
  src/
    main.ts
    app/
      GameApp.ts
      GameStateMachine.ts
    input/
      types.ts
      InputRouter.ts
      KeyboardProvider.ts
    biome/
      types.ts
      registry.ts
      profiles/cliffs.ts
    levelgen/
      types.ts
      generateLevel.ts
      path.ts
      heightmap.ts
      validate.ts
      repair.ts
      rng.ts
    physics/
      PhysicsWorld.ts
      createHeightfield.ts
      vehicle/
        VehicleController.ts
        VehicleConfig.ts
    gameplay/
      CheckpointSystem.ts
      FinishSystem.ts
      RespawnSystem.ts
    render/
      createRenderer.ts
      GameScene.ts
      TerrainMesh.ts
      JeepMesh.ts
      CameraRig.ts
      materials.ts
    ui/
      menu.ts
      hud.ts
      minimap.ts
      result.ts
      error.ts
    shared/
      math.ts
      types.ts
      vehicleCapabilities.ts
      vehicleConfig.ts
  tests/
    levelgen/
      pathConstraints.test.ts
      validate.test.ts
      reproducibility.test.ts
      seedCorpus.test.ts
```

---

## 13. Testing Strategy

### 13.1 Automated (Vitest)

| Test | Pass criteria |
|------|---------------|
| Reproducibility | 20 fixed seeds: hash of heightmap + JSON of POIs identical across two runs |
| GeometricSolvability | Every seed in corpus `PASS` validator |
| Repair/fallback | Injected broken path becomes valid; fallback sets `usedFallback` |
| Slope/step unit | Synthetic segments at limit pass; beyond fail |
| Seed corpus | At least seeds `[1, 2, 7, 42, 99, 12345, 99991]` plus 20 random uint32 from fixed meta-seed |

### 13.2 Manual playtest checklist (MVP ship)

- [ ] Menu starts `cliffs` with random seed
- [ ] Enter explicit seed, run twice, layout matches
- [ ] Drive to finish on seed 42 without requiring off-path
- [ ] Fall off cliff -> respawn at checkpoint with correct facing
- [ ] R respawns
- [ ] C toggles TP/FP; complete short segment in each
- [ ] Minimap shows player + finish; arrow points to finish
- [ ] Win panel; Retry same seed; Menu
- [ ] Mid laptop target: 256m map, resolution 129, Chrome, ~60 fps while driving (soft: no sustained <30)

---

## 14. Phased Delivery (MVP = through hardening)

| Phase | Delivers | Ship gate |
|-------|----------|-----------|
| 0 Scaffold | Vite TS Three Rapier boot, state machine, Error state | Boots to menu shell |
| 1 Contracts | shared types, caps, config, RNG | Unit tests import caps |
| 2 Input | Keyboard -> actions | Actions update in debug overlay |
| 3 Flat vehicle | Raycast jeep on plane | Drive/turn/brake stable 60s |
| 4 Levelgen | Path-first + validate + repair/fallback tests | Corpus green |
| 5 Terrain play | Heightfield + spawn + finish win | Seed 42 completable |
| 6 Gameplay | Checkpoints, kill-Y, R respawn | Respawn checklist |
| 7 Camera | TP/FP toggle | S5 checklist |
| 8 HUD | Minimap + goal arrow + seed display | S6/S10 |
| 9 Biome menu | Cliffs presentation + menu start | S1/S9 |
| 10 Harden | Tuning, performance, full manual checklist | **MVP SHIP** (S1–S10) |

**MVP ship is end of Phase 10**, not before hardening.

---

## 15. Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Extensible skeleton, one biome first | User goal C + vertical slice |
| Stack | Three.js + Rapier + Vite + TS | Perf + terrain physics |
| Vehicle | Custom raycast semi-realistic | Capability-coupled generation |
| Levels | Biome themes, not difficulty tiers | Product intent + solvability guardrails |
| Generation | Path-first + geometric solvability + repair/fallback | Guaranteed route (static) |
| Playability CI | Geometric only for MVP; manual soft drive gate | Avoid blocking on full vehicle sim |
| Terrain collider | Heightfield only | One source with visual mesh |
| Win | Finish box trigger | Simple loop |
| Platform | Desktop keyboard; abstract input | Touch later |
| Seed UX | Visible + menu entry + result retry | S2/S10 |

---

## 16. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Vehicle tuning calendar risk | High | Lock initial caps early (Phase 1/3); only change with generator re-test |
| Geometric pass but undrivable | High | Safety factor 0.75; wheel-track validation; manual seed corpus |
| Heightfield transform bugs | Medium | Single helper for index <-> world; shared by mesh, collider, minimap |
| Boring corridors | Medium | Off-path cliffs + constrained fords |
| Scope creep | High | Non-goals enforced until S1–S10 |

---

## 17. Open Questions

| Item | Status |
|------|--------|
| Biome = scene not difficulty | Resolved |
| Three + Rapier approach | Resolved |
| Path-first + heightfield | Resolved |
| MVP solvability = geometric | Resolved (playability soft-gate manual) |
| Seed replay UX | Resolved (menu field + HUD + retry) |
| Initial vehicle numbers | Resolved as starting table; tunable with tests |
| Free mouse-look / cam collision | Deferred post-MVP |
| Audio | Deferred post-MVP |
| Physics smoke in CI | Deferred post-MVP |

---

## 18. PR Plan (dependency DAG)

| PR | Title | Delivers | Depends | Gate |
|----|-------|----------|---------|------|
| PR1 | chore: scaffold Vite TS Three Rapier | Boot, empty scene, scripts | — | App loads |
| PR2 | feat: shared contracts + RNG + vehicle caps/config | Types, constants, unit smoke | PR1 | Caps imported by tests |
| PR3 | feat: input router + keyboard | Actions | PR1 | Debug shows axes |
| PR4 | feat: raycast vehicle flat ground | Drivable jeep | PR2–3 | 60s stable drive |
| PR5 | feat: path-first levelgen + tests | `generateLevel`, corpus | PR2 | Vitest corpus green |
| PR6 | feat: heightfield + spawn + finish | Drive generated map, win | PR4–5 | Seed 42 completable |
| PR7 | feat: checkpoints + respawn | Recovery | PR6 | Respawn checklist |
| PR8 | feat: camera TP/FP | Camera | PR4 | S5 manual |
| PR9 | feat: HUD minimap + goal + seed | Guidance | PR6 | S6/S10 |
| PR10 | feat: cliffs biome + menu | Menu start | PR6–9 | S1/S9 |
| PR11 | chore: MVP harden + checklist | Tuning, perf, docs | PR10 | **S1–S10 ship** |

Solo repo may squash; order is the implementation agent DAG.

---

## 19. Review history

- **2026-07-09:** Initial draft.
- **2026-07-09 Codex review:** Critical gaps on solvability vs vehicle, missing numbers, fallback, checkpoint yaw, heightfield decision, MVP vs Phase 5 contradiction, contracts, encoding.
- **2026-07-09:** Spec revised to address must-fix list before implementation plan.

---

## 20. Approval Gate

After user approves this document:

1. Freeze MVP scope to S1–S10 and non-goals above.
2. Write implementation plan via Superpowers `writing-plans` to `docs/superpowers/plans/2026-07-09-lowpoly-jeep-offroad.md`.
3. Only then scaffold code (PR1).
