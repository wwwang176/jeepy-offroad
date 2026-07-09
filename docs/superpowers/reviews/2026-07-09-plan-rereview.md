# Plan Re-Review (Codex)

**Date:** 2026-07-09  
**Subject:** `docs/superpowers/plans/2026-07-09-lowpoly-jeep-offroad.md`  
**Against:** `docs/superpowers/specs/2026-07-09-lowpoly-jeep-offroad-design.md`  
**Previous verdict:** BLOCK  
**This verdict:** **APPROVE WITH FIXES**

> Note: Codex ran in read-only sandbox and could not write this file itself; findings reconstructed from Codex turn output.

---

## Overall

Previous BLOCK must-fixes are largely addressed at the planning level. The plan is executable for agentic work with one material residual: Task 8 still ships a skeletal `VehicleController` code block (comment-only body), which conflicts with the plan’s “no placeholders” rule and risks agents copying a non-functional controller.

Architecture, solvability pipeline, task order, tests, and contracts no longer warrant BLOCK.

---

## Previous must-fix checklist

| # | Item | Status |
|---|------|--------|
| 1 | Full GeometricSolvability checklist | **PASS** — Task 5 lists all 9 items |
| 2 | Fallback re-validated + repair/fallback tests | **PASS** — `forceFallbackLevel`, re-validate, `repairFallback.test.ts` |
| 3 | Fallback yaw PI/2 for +X | **PASS** — code + unit test |
| 4 | 20-seed reproducibility | **PASS** — FIXED_20 dual-run test |
| 5 | API alignment with spec | **PASS** — locked contracts table |
| 6 | State machine before terrain | **PASS** — Task 7 then Task 9 |
| 7 | Scaffold smoke test | **PASS** — `tests/smoke.test.ts` |
| 8 | S5 full-run both cameras | **PASS** — Task 11/14 |
| 9 | Shared coords, uint32 seed, brake/reverse, no placeholders | **PARTIAL** — coords/seed/brake PASS; **placeholders residual in Task 8** |

---

## Remaining findings

### Major (fix before or during Task 8 execution)

1. **Task 8 `VehicleController` is still a skeleton**  
   - Problem: Code block shows method signatures and `// 1) raycast...` comments instead of a complete implementable class. Contradicts Global Constraints “No placeholders.”  
   - Fix: Expand Task 8 with a full raycast vehicle implementation (or a clearly complete reference algorithm with all force equations and Rapier calls), copy-pasteable.

### Minor

1. Helper bodies in Task 5 (`carveAndDecorate`, `repairHeightmap`, etc.) are specified by contract/steps rather than full source — acceptable if agents treat the step list as mandatory, but higher risk than fully inlined code.  
2. Rapier heightfield constructor still “verify against installed docs” — keep as first sub-step of Task 9, not a soft skip.

### Nit

1. Codex could not write review file due to sandbox (process issue only).

---

## Must fix vs can defer

**Must fix (before relying on Task 8 for agents):**

- Replace Task 8 vehicle skeleton with complete implementation guidance.

**Can defer:**

- Fully inlining every levelgen helper as multi-hundred-line blobs (keep step contracts if tests gate behavior).  
- Decorative prop density polish.  
- Physics playability CI.

---

## Verdict

**APPROVE WITH FIXES** (at re-review time)

Safe to start execution of Tasks 1–7 as written. **Patch Task 8 vehicle section before or at the start of Task 8.** Not a re-BLOCK on architecture or solvability.

---

## Follow-up (same day)

**2026-07-09:** Task 8 in the plan was expanded with a full copy-pasteable `VehicleController` (suspension rays, spring/damper, friction ellipse, drive/brake/reverse, anti-roll), plus complete `JeepMesh` / `createRenderer` / flat-sandbox wiring. Residual Major item addressed in plan text; ready for full execution.