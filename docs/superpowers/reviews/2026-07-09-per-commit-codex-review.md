# Per-Commit Code Review: feat/lowpoly-jeep-mvp

Worktree: `D:\projects\grok-jeep-game\.worktrees\feat-lowpoly-jeep-mvp`
Base exclusive: `d00efbadda26546e8b74a7a836305d11f55d1e70`
Range reviewed: `d00efba..HEAD`
Reference docs: `docs/superpowers/specs/2026-07-09-lowpoly-jeep-offroad-design.md` and `docs/superpowers/plans/2026-07-09-lowpoly-jeep-offroad.md`

Review method: ran `git show --stat <sha>` and captured `git show <sha>` for all 16 commits; inspected changed files and HEAD source; ran `npx tsc --noEmit` successfully. `npm test` and `npm run build` were attempted but blocked by sandbox `spawn EPERM` when Vite/Vitest tried to start esbuild. I also sanity-checked the installed Rapier heightfield row/column contract and transform at runtime.

## fe8cb63 - chore: scaffold Vite TypeScript Three Rapier project

Intended summary: scaffolds the Vite/TypeScript/Three/Rapier/Vitest app, HTML canvas/UI roots, CSS, configs, lockfile, and smoke test.

Spec compliance: maps to plan Task 1 and spec Phase 0. Required scripts, strict TS config, app shell roots, and smoke test are present.

Findings:
- Critical: none.
- Major: none.
- Minor: none.
- Nit: none.

Verdict: APPROVE

## d4173f7 - feat: add shared math, coords, seed, and vehicle constants

Intended summary: adds shared math/types, coordinate helpers, vehicle capabilities/config, seed parsing, hash helper, and tests.

Spec compliance: maps to plan Task 2. Units, +Y up, XZ plane, yaw convention, heightmap origin, vehicle capability values, and vehicle config values align with the spec/plan.

Findings:
- Critical: none.
- Major: none.
- Minor: none.
- Nit: `hashFloat32Array` allocates a new `ArrayBuffer`/`DataView` per float. Fine for tests, but avoid runtime reuse.

Verdict: APPROVE

## bfc63be - feat: add seeded RNG, level types, and cliffs biome profile

Intended summary: adds `mulberry32`, levelgen types/constants, biome types, cliffs profile, registry helpers, and RNG tests.

Spec compliance: maps to plan Task 3 and spec sections 6-7. Cliffs has the required palette/streams/decorative non-colliding prop vocabulary, and `LevelData` carries start/finish/checkpoint/yaw/meta fields.

Findings:
- Critical: none.
- Major: none.
- Minor: none.
- Nit: none.

Verdict: APPROVE

## 9ad4012 - feat: path polyline generation with slope/step clamping

Intended summary: adds path generation, constrained path heights, heightmap utilities, fallback path, and path constraint tests.

Spec compliance: maps to the path portion of plan Task 4. Slope/step clamping uses vehicle caps and `PATH_SAFETY_FACTOR`; fallback yaw is correct for a +X corridor.

Findings:
- Critical: none.
- Major: none.
- Minor: The spec calls for deterministic self-intersection simplification when path segments cross. This commit has no explicit crossing detection/simplification pass. Current generation tends to progress toward finish, but the algorithmic step is missing.
- Nit: none.

Verdict: APPROVE WITH FIXES

## 4488888 - feat: path-first generateLevel with full validation and corpus tests

Intended summary: implements `generateLevel`, carving, streams, repair/fallback, validation, and corpus/reproducibility tests.

Spec compliance: maps to plan Task 5 and spec section 7. Most GeometricSolvability checks are represented, but fallback and stream-depth behavior had correctness gaps later addressed by `dc6ce92`.

Findings:
- Critical: none.
- Major: Fallback output was not revalidated after the final `flattenFallbackUntilValid` call before return, weakening the `generateLevel` always-valid contract.
- Major: Streams were carved and then the path ribbon was restamped, which could erase the actual ford dip while retaining stream metadata. That conflicts with the lowered path ford requirement.
- Minor: Stream data did not record intended on-path ford depth, so validation inferred depth only from sampled heights.
- Nit: none.

Verdict: REQUEST CHANGES

## dc6ce92 - fix: levelgen fallback revalidate and stream ford depth

Intended summary: records `depthOnPath`, reapplies ford dips after path restamping, revalidates fallback outputs, and strengthens extreme fallback flattening.

Spec compliance: maps to spec sections 7.4-7.5 and closes the largest Task 5 repair/fallback gaps.

Findings:
- Critical: none.
- Major: none.
- Minor: `flattenFallbackUntilValid` can still return the current level in production if all extreme passes fail, throwing only in test mode. The extreme corridor should be valid, but production does not strictly enforce the public validity contract if that invariant breaks.
- Nit: none.

Verdict: APPROVE WITH FIXES

## 4452881 - feat: input router and keyboard provider

Intended summary: adds action types, input router, keyboard controls, and router unit test.

Spec compliance: maps to plan Task 6 and spec section 5.3. Drive, reverse, brake-priority, camera, and respawn bindings match the plan.

Findings:
- Critical: none.
- Major: `KeyboardProvider` treats every `keydown` as a fresh edge for C/R (`src/input/KeyboardProvider.ts:8-12`). Browser auto-repeat can repeatedly toggle camera or respawn while a key is held. Edge actions should ignore `e.repeat` or track up-to-down transitions.
- Minor: Tests only cover router pass-through, not keyboard edge behavior.
- Nit: none.

Verdict: APPROVE WITH FIXES

## 985cd2f - feat: game state machine shell with boot and error states

Intended summary: adds app state machine, Rapier boot, menu/error shell, UI helpers, and entrypoint wiring.

Spec compliance: maps to plan Task 7 and spec sections 4.4/5.1. Boot success enters menu; boot/load failures can enter error.

Findings:
- Critical: none.
- Major: none.
- Minor: `showError` always labels its button `Retry`, but load-failure handling routes to menu. Minor UI mismatch with the spec's retry vs menu distinction.
- Nit: none.

Verdict: APPROVE

## 6585bb4 - feat: raycast vehicle on flat ground

Intended summary: adds flat sandbox, `PhysicsWorld`, raycast vehicle, jeep mesh, renderer, and manual flat driving path.

Spec compliance: maps to plan Task 8 and spec section 8. It implements four suspension rays, AWD drive/brake/steer forces, tire friction, and anti-roll damping, but the suspension geometry prevents raycast suspension from being the primary support.

Findings:
- Critical: none.
- Major: The wheel hardpoints and compression math make the chassis collider touch/penetrate terrain before the suspension can support the vehicle. Wheel origins are local `y: 0.1`, chassis half-height is `0.45`, rest length is `0.55` (`src/shared/vehicleConfig.ts:10-17`), and compression is `suspRestLength - dist` (`src/physics/vehicle/VehicleController.ts:159`). Any positive support compression requires chassis bottom penetration, so the body collider, not suspension, carries the jeep. This fails the semi-realistic S4 intent.
- Minor: The flat test button is acceptable for this development task but should not remain exposed in the MVP menu.
- Nit: none.

Verdict: REQUEST CHANGES

## 7b13264 - feat: heightfield terrain, spawn, and finish trigger

Intended summary: integrates generated heightfield terrain, terrain mesh, generated level play session, vehicle spawn, and finish volume detection.

Spec compliance: maps to plan Task 9 and spec sections 4.2/5.2/7.6. Heightfield uses the same samples as the visual mesh, and finish is an axis-aligned box.

Findings:
- Critical: none.
- Major: `teardownSession` introduced here nulls input and physics without disposing/freeing them. Repeated starts/sandbox switches can leave old keyboard listeners and Rapier WASM worlds alive. This was later fixed in `ee06aed`.
- Minor: The branch lacks an automated/runtime assertion that the Rapier heightfield aligns with the visual mesh. I manually sanity-checked it during review, but the codebase does not guard this high-risk transform.
- Nit: none.

Verdict: APPROVE WITH FIXES

## 27d333a - feat: checkpoints, kill-Y, and manual respawn

Intended summary: adds checkpoint tracking, kill-Y/manual respawn, input lock, and fixed-step gameplay integration.

Spec compliance: maps to plan Task 10 and spec sections 5.2/8.4. Checkpoint yaw is preserved and reset zeros velocities.

Findings:
- Critical: none.
- Major: none.
- Minor: Checkpoint respawn used `cp.position.y + 1.2` while initial spawn used ground + chassis half-height + offset. That inconsistency could respawn lower than initial spawn and was fixed in `ee06aed` with `chassisSpawnY`.
- Nit: none.

Verdict: APPROVE WITH FIXES

## dde6f03 - feat: third and first person camera toggle

Intended summary: adds `CameraRig`, third/first modes, FOV switching, and C-toggle integration.

Spec compliance: maps to plan Task 11 and spec section 9. Third-person offset/FOV and first-person FOV are close, but first-person does not follow chassis pitch.

Findings:
- Critical: none.
- Major: First-person camera uses only yaw-derived vectors and ignores chassis rotation/pitch (`src/render/CameraRig.ts:27-59`). On slopes, FP view remains level instead of following chassis yaw/pitch as required. `VehicleController.getPose()` exposes rotation, but `CameraRig.update` accepts only `{ position, yaw }`.
- Minor: The keyboard auto-repeat issue from `4452881` still affects this toggle.
- Nit: none.

Verdict: APPROVE WITH FIXES

## 9d3f69c - feat: HUD minimap, goal arrow, and seed display

Intended summary: adds HUD, north-up minimap, goal arrow, seed/biome/fallback display, and playing-loop integration.

Spec compliance: maps to plan Task 12 and spec section 10. Seed is visible, minimap draws player/finish/checkpoints, and the arrow points relative to finish.

Findings:
- Critical: none.
- Major: none.
- Minor: none.
- Nit: Minimap omits the optional path polyline. Allowed by spec, but route guidance would be clearer with it.

Verdict: APPROVE

## 550295c - feat: menu, result, and cliffs presentation

Intended summary: adds full menu/result UI, explicit/random seed start, result actions, cliffs fog/streams/props/finish marker, and styles.

Spec compliance: maps to plan Task 13 and spec sections 5.1/6.3/10.3/11. Cliffs menu/start/result/presentation mostly comply.

Findings:
- Critical: none.
- Major: The production menu still exposes the dev `Flat physics test` path (`src/ui/menu.ts:12`, `src/ui/menu.ts:45`, `src/ui/menu.ts:116-122`, `src/app/GameApp.ts:134-136`). The MVP menu should be biome/scene selection, and section 6.3 says only list `cliffs`. Remove or dev-gate this before MVP.
- Minor: Control hints are persistent, not dismissible, while the spec only calls them optional first-visit hints.
- Nit: none.

Verdict: APPROVE WITH FIXES

## 30d87b3 - chore: MVP harden, README, and ship checklist

Intended summary: adds README script/control/seed/spec links.

Spec compliance: maps to plan Task 14, but only the README portion is present. Task 14 also requires automated verification and full manual checklist before MVP done.

Findings:
- Critical: none.
- Major: This commit does not perform or record the hardening/checklist work promised by the subject and required by Task 14. The diff only creates `README.md`; there is no manual checklist artifact or evidence for S1-S10/manual playtest gates.
- Minor: none.
- Nit: none.

Verdict: REQUEST CHANGES

## ee06aed - fix: vehicle friction clamp, respawn height, session teardown

Intended summary: fixes friction ellipse scaling, centralizes spawn/respawn height, disposes keyboard input and Rapier world on teardown, and makes checkpoint respawn height consistent.

Spec compliance: improves S4/S7 hardening and fixes several earlier resource/respawn issues.

Findings:
- Critical: none.
- Major: none introduced by this commit.
- Minor: The deeper suspension hardpoint issue from `6585bb4` remains; `chassisSpawnY` preserves the existing high spawn offset but does not make the raycast suspension support the chassis at rest.
- Nit: none.

Verdict: APPROVE

## Cross-Commit Issues

1. Vehicle suspension support is structurally wrong and remains at HEAD. Introduced in `6585bb4`. Wheel origins/rest length/chassis half-height require chassis penetration for positive suspension force (`src/shared/vehicleConfig.ts:10-17`, `src/physics/vehicle/VehicleController.ts:159`). This undermines S4.
2. Keyboard edge actions auto-repeat and remain at HEAD. Introduced in `4452881`; C/R are edge actions but are set on every keydown without checking repeat (`src/input/KeyboardProvider.ts:8-12`).
3. First-person camera ignores chassis pitch and remains at HEAD. Introduced in `dde6f03`; `CameraRig.update` consumes only position/yaw (`src/render/CameraRig.ts:27-31`) and aims FP with a level yaw vector (`src/render/CameraRig.ts:47-58`).
4. Development flat sandbox remains visible in the production menu. Added for Task 8 and carried through `550295c` (`src/ui/menu.ts:116-122`, `src/app/GameApp.ts:134-136`).
5. Regressions partially fixed later: `4488888` fallback/stream gaps fixed mostly by `dc6ce92`; `7b13264` teardown leaks fixed by `ee06aed`; `27d333a` checkpoint height fixed by `ee06aed`; `6585bb4` friction clamp fixed by `ee06aed` but suspension support remains.

## Overall Branch Verdict

REQUEST CHANGES

The branch has broad feature coverage and `npx tsc --noEmit` passes, but HEAD still has S4/S5/S1 compliance issues: the raycast suspension cannot support the chassis before body collision, camera/respawn edges can auto-repeat, first-person camera ignores chassis pitch, and the development flat test remains on the MVP menu. The hardening commit also does not record the required manual checklist.

## Priority Fix List at HEAD

1. Fix vehicle suspension geometry/config so the jeep rests on raycast suspension without chassis terrain contact; validate on flat ground and generated terrain.
2. Emit C/R only on real key press edges; ignore `KeyboardEvent.repeat` and add tests.
3. Pass chassis rotation into `CameraRig` and make first-person follow yaw/pitch.
4. Remove or dev-gate the `Flat physics test` menu path.
5. Complete and record Task 14 hardening, including S1-S10 manual checks and automated verification in an environment where Vite/Vitest can spawn esbuild.
