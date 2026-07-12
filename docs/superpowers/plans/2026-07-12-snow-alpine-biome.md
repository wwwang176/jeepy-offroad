# Snow Alpine Biome — Implementation Plan

**Date:** 2026-07-12  
**Branch:** `feat/snow-alpine-biome`  
**Spec:** `docs/superpowers/specs/2026-07-12-snow-alpine-biome.md`  
**Goal:** Third biome — cold alpine pass, bare rock, **descent-signature** path via macro relief; playable from menu with EN/zh.  
**Review:** Claude plan review incorporated (P0/P1) 2026-07-12 — metrics split, no fallback-rate gate, max-grade assert, brakeScale accepted as coupling, no weather type in T1.

---

## Architecture (short)

```
BiomeProfile (alpine)
  ├─ palette / fog / traction / rock propTable
  └─ macroRelief.startToFinishDropM
           │
           v
generatePathPolyline → carveAndDecorate
  fBm base + macroRamp(start,end,dropM) → fitPath (grade clamp)
           │
           v
GameScene (existing rocks) + menu/i18n
```

Sand / rainforest omit `macroRelief` → bit-identical generation vs today.

---

## PR / task DAG

```
T0 docs (this) ──┐
                 ├─► T1 types + alpine profile + registry
                 │         │
                 │         ├─► T2 i18n + menu card
                 │         │
                 │         └─► T3 macroRelief in levelgen + unit tests
                 │                   │
                 └───────────────────┴─► T4 playtest tune + optional weather hook
                                         │
                                         └─► T5 checklist / merge readiness
```

Suggested commits (atomic):

1. `docs: snow alpine biome spec + plan`
2. `feat(biome): alpine profile + registry`
3. `feat(i18n): alpine strings + menu card`
4. `feat(levelgen): macro relief descent bias`
5. `test(levelgen): alpine net-drop corpus`
6. `chore: playtest tuning` (as needed)

---

## T0 — Docs on branch

- [x] Spec: `docs/superpowers/specs/2026-07-12-snow-alpine-biome.md`
- [x] Plan: this file
- [x] Decisions locked: id `alpine`, zh 雪山, ponds off 0.12, drop 32 m, brakeScale 0.75 couples 4L

**Done when:** branch has docs; no code required.

---

## T1 — Profile + registry

### Files

| Action | Path |
|--------|------|
| Create | `src/biome/profiles/alpine.ts` |
| Edit | `src/biome/types.ts` — optional `macroRelief` only (no weather type in T1) |
| Edit | `src/biome/registry.ts` — register alpine |
| Edit | `tests/biome/registry.test.ts` — list includes alpine; random covers all ids |

### Profile v1 draft values

```ts
// alpine.ts — starting points; tune in T4
id: "alpine"
displayName: "Alpine"
description: "Residual snow, bare rock, long descents"
skyColor: "#9aafc4"
fogColor: "#c5d0dc"
fogDensity: 0.02
groundPalette: {
  high: "#e8eef4",
  mid: "#9aa6b0",
  low: "#4a5560",
  path: "#d0d8e0",
}
waterColor: "#2a4a5c"
streamDensity: 0.12          // pond band → 0
offPathRoughness: 0.82
propDensity: 0.55
propCountScale: 8
traction: {
  frictionSlipScale: 0.52,
  sideFrictionScale: 0.45,
  brakeScale: 0.75,
}
propTable: [
  { meshKey: "rock_pile", weight: 1, collides: true },
  { meshKey: "pillar_rock", weight: 0.75, collides: true },
]
macroRelief: { startToFinishDropM: 32 }
// weather omitted in v1
```

### Types

```ts
export interface BiomeMacroRelief {
  /** Meters: start side higher than finish side along path chord. */
  startToFinishDropM: number;
}

// on BiomeProfile:
macroRelief?: BiomeMacroRelief;
// no weather field until GameScene consumer (T4 optional)
```

### Tests

- `listBiomes()` length ≥ 3; ids include `alpine`
- `getBiome("alpine")` returns profile with `macroRelief`
- `resolveBiomeId("random", seed)` for seeds `0..n-1` covers **all** registered ids (`seed % n`)

**Done when:** unit tests green; no menu yet still OK if only registry.

---

## T2 — i18n + menu

### Files

| Edit | Notes |
|------|--------|
| `src/i18n/messages.ts` | `biome.alpine.name` / `.desc` EN + zh; extend `MessageKey` |
| `src/i18n/index.ts` | `biomeDisplayName` / `biomeDescription` branches **or** dynamic `biome.${id}.*` |
| `src/ui/menu.ts` | Card after rainforest: icon `❄`, `biomeId: "alpine"` |
| `tests/i18n/i18n.test.ts` | Alpine keys resolve both locales |

### Copy

| Key | EN | zh |
|-----|----|----|
| name | Alpine | 雪山 |
| desc | Residual snow, bare rock, long descents | 殘雪、裸岩與長下坡 |

### Optional small refactor (same PR if cheap)

```ts
// Prefer convention over if-chain growth
function biomeDisplayName(id: string): string {
  const key = `biome.${id}.name` as MessageKey;
  if (hasMessage(key)) return t(key);
  return getBiome(id as BiomeId)?.displayName ?? id;
}
```

Only if `hasMessage` exists or easy; else three-way if is fine for v1.

**Done when:** menu shows third biome; start loading alpine works (even before macro, terrain is cold rock).

---

## T3 — Macro relief (descent identity)

### Files

| Action | Path |
|--------|------|
| Create | `src/levelgen/macroRelief.ts` — pure helpers |
| Edit | `src/levelgen/generateLevel.ts` — apply after fBm, before base snapshot |
| Create | `tests/levelgen/macroRelief.test.ts` |
| Create/Edit | `tests/levelgen/alpineDescentCorpus.test.ts` |

### Algorithm (v1 planar ramp)

Inputs: path start `S`, path end `E` (XZ), `dropM = biome.macroRelief?.startToFinishDropM ?? 0`.

```
chord = E - S  (xz)
len2 = max(dot(chord,chord), eps)
// For each grid (x,z):
u = dot((x,z) - S, chord) / len2   // 0 at start, 1 at finish
u = clamp(u, 0, 1)                 // or allow slight extrapolate off ribbon
macroY = dropM * (0.5 - u)         // +dropM/2 at start, -dropM/2 at finish
hm += macroY
```

Properties:

- Deterministic; independent of RNG beyond path shape.
- Mean-preserving around path midpoint.
- Path fit then rides high→low; grade clamp enforces drivability.

**Do not** apply macro on fallback strip unless easy — prefer skip when `isFallback` to keep repair simple.

### Integration point

`carveAndDecorate` after fBm fill loop, **before** `baseHeightmap = copy(hm)`:

```ts
if (biome.macroRelief && !isFallback) {
  applyMacroRelief(hm, resolution, mapSize, pathXZ[0], pathXZ[pathXZ.length-1], biome.macroRelief);
}
```

### Unit tests (CI floors — not product goals; see spec §5.3)

1. **Ramp polarity:** sample near start higher than near finish by ≈ `dropM` (± cell error).  
2. **Idempotent / no NaN.**  
3. **Omitted macro:** sand/rainforest unchanged when `macroRelief` absent (repro hash or helper no-op).  
4. **Corpus alpine** (20 fixed seeds):  
   - `netDrop = path[0].y - path[n-1].y`  
   - **mean netDrop ≥ 12** and **≥70% seeds with netDrop ≥ 10** (product goal ≥18@70% is post-playtest tighten).  
5. **Max segment grade** ≤ `tan(maxSlopeRad) * PATH_SAFETY_FACTOR` (or same budget `assignPathHeights` uses) on **every** alpine corpus seed.  
6. Optional: `validateLevel` on corpus — no production fallback rate (always 0).  
7. Sand same seeds: mean netDrop not required high (baseline observation only).

**Do not** assert fallback rate or raw descendFraction/heightRange gates.

**Done when:** tests green; one manual seed shows obvious long descent on HUD altimeter / eye.

---

## T4 — Playtest tuning + optional weather

### Playtest script (human)

| Step | Check |
|------|--------|
| 1 | Menu card reads cold mountain |
| 2 | Seed 42 twice: same layout |
| 3 | First 30 s: cold fog, grey-white ground, only rocks |
| 4 | Mid run: sustained downhill; speed climbs if 4H + throttle |
| 5 | 4L: speed held / braked without service brake only |
| 6 | Rocks block / scrape occasionally; not jungle density |
| 7 | No rain, no cactus, no palm |
| 8 | Finish still reachable; respawn OK |

### Knobs (only profile / drop first)

| Symptom | Knob |
|---------|------|
| Not enough down | ↑ `startToFinishDropM` (try 40–48) |
| Path too ramp-smooth | ↑ `offPathRoughness` slightly |
| Too skate / same as sand | tweak traction scales; colder path color |
| Too empty | ↑ `propCountScale` / pillar weight |
| Path grade / validate noise | ↓ drop or roughness |
| 4L weak on descent (after brakeScale 0.75) | playtest A6; prefer dropM/traction before drivetrain split |
| White void | ↑ fogDensity slightly; darken `low` palette |

### Optional weather hook (same phase if touching GameScene)

```ts
// GameScene: replace biome.id === "rainforest"
const rain = biome.weather?.kind === "rain" ? new RainVFX(...) : null;
// rainforest profile: weather: { kind: "rain" }
```

Snow particles: **out of scope** unless leftover time; fog is enough for v1.

**Done when:** user OK on A3–A7 feel; numbers written back into profile constants in code.

---

## T5 — Merge readiness

- [ ] `npm test` green  
- [ ] `npm run build` green  
- [ ] No sand/rainforest visual regressions (spot seeds 42 / rainforest known seed)  
- [ ] Spec success criteria A1–A10 checked  
- [ ] Update MVP checklist or add alpine row if desired  
- [ ] Merge to master **only when asked**; push only when asked  

---

## Explicit non-work (guardrails)

| Do not | Why |
|--------|-----|
| New mesh keys in v1 | Bare rock reuse is enough |
| Canyon walls / kill volumes | Different feature |
| Biome-specific engine brake gain | Prefer global 4L; accept brakeScale coupling (spec §4.2) |
| Raise `maxSlopeRad` for alpine | Breaks shared solvability contract |
| Difficulty label on card | Theme only |
| Stream/river revive for alpine | Ponds off v1 |
| Near-path prop bias | Same uniform spawn as sand |
| MenuBackdrop per-biome | Non-goal |

---

## Effort guess

| Task | Effort |
|------|--------|
| T0 docs | done on branch |
| T1 profile/registry | ~0.5–1 h |
| T2 i18n/menu | ~0.5 h |
| T3 macro + tests | ~2–3 h |
| T4 playtest tune | ~1–2 h + human drives |
| T5 polish/merge | ~0.5 h |

**Critical path:** T3 (without it, alpine risks “cold sand”).

---

## Acceptance matrix (ship)

| ID | Proof |
|----|--------|
| A1 | Menu + start |
| A2 | Repro test or manual double load |
| A3 | Screenshot / eye vs sand & rainforest |
| A4 | propTable audit |
| A5 | corpus test |
| A6 | playtest notes |
| A7 | playtest notes |
| A8 | validate + tests |
| A9 | i18n test |
| A10 | random resolve test |

---

## First code command after approve

```text
Implement T1–T3 per docs/superpowers/plans/2026-07-12-snow-alpine-biome.md
on branch feat/snow-alpine-biome. Do not push. Keep sand/rainforest bit-stable
when macroRelief omitted.
```
