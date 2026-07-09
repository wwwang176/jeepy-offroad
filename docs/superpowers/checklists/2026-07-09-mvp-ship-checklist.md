# MVP Ship Checklist (S1–S10)

**Branch:** `feat/lowpoly-jeep-mvp`  
**Date:** 2026-07-09  
**Environment:** Windows, Chrome/Edge recommended  

## Automated

| Check | Command | Result | Notes |
|-------|---------|--------|-------|
| Unit tests | `npm test` | ☐ pass | Includes levelgen corpus, input, geometry |
| Typecheck + build | `npm run build` | ☐ pass | |

## Manual playtest

Run: `cd .worktrees/feat-lowpoly-jeep-mvp && npm run dev`

| ID | Criterion | Result | Notes |
|----|-----------|--------|-------|
| S1 | Menu lists Cliffs; Start begins a run | ☐ | Flat physics test must **not** show in production build |
| S2 | Same biome+seed twice matches layout | ☐ | e.g. seed `42` twice |
| S3 | Main path geometrically solvable | ☐ | Stay on path corridor to finish |
| S4 | Raycast jeep drives; suspension supports chassis | ☐ | On flat / slopes without scraping as primary support |
| S5 | Full run in third-person **and** first-person | ☐ | C toggles; FP follows chassis pitch on slopes |
| S6 | Minimap + goal arrow | ☐ | North-up minimap; arrow to finish |
| S7 | Fall / R respawn at checkpoint with yaw | ☐ | Kill-Y and R; 0.25s input lock |
| S8 | Finish volume → result → Menu/Retry | ☐ | |
| S9 | Low-poly cliffs presentation | ☐ | Fog, palette, streams, finish marker |
| S10 | Seed visible on HUD; menu seed field works | ☐ | Empty = random uint32 |

## Controls smoke

| Action | Expected | Result |
|--------|----------|--------|
| W | throttle | ☐ |
| S alone | reverse | ☐ |
| W+S | brake | ☐ |
| C held | camera toggles **once** (no auto-repeat spam) | ☐ |
| R held | respawn **once** per press | ☐ |

## Sign-off

| Role | Name | Date | Sign |
|------|------|------|------|
| Implementer | | | ☐ |
| Reviewer | | | ☐ |

## Known residual risks

- Some seeds may use generation fallback path (`meta.usedFallback`); still must be completable.
- Bundle size large (~Rapier WASM); acceptable for MVP.
- Touch controls deferred.
