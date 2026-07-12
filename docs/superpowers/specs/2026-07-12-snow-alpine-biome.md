# Snow Alpine Biome — Design Spec

**Date:** 2026-07-12  
**Status:** Ready for implement (Claude plan review incorporated 2026-07-12)  
**Branch:** `feat/snow-alpine-biome`  
**Project:** `grok-jeep-game`  
**Constraint:** Third scene theme; must feel **not** like recolored sand or rainforest. Hero beat = **long downhill** on **cold palette + bare rock**.

---

## 1. Goal

Ship a third menu biome — **snow alpine (雪山／垭口)** — where the player:

1. Immediately reads “cold mountain,” not desert or jungle.
2. Drives a **sustained downhill** as the signature gameplay beat (throttle management, 4L engine brake, sight lines).
3. Sees **bare rock** as structure (piles / pillars along and off path), not warm red canyon walls.
4. Keeps the same loop: menu → seed → path-first level → checkpoints → finish → result.

Biome remains a **scene theme**, not a difficulty tier. Solvability still uses global `VehicleCapabilities`.

### 1.1 Why this theme (product)

| Existing | Player tag |
|----------|------------|
| `sand` | Warm, dry, open, **flat-ish skate** |
| `rainforest` | Green, wet, dense, **rain + mud cruise** |
| **`alpine` (new)** | Cold, bare rock + residual snow, **gravity pushes you** |

**Rejected as third biome (for this effort):** canyon-only — too close to sand (dry rock corridor without true walls) under current path-first visuals.

### 1.2 Non-goals (this feature)

- True vertical cliffs / fall-to-death canyon walls
- Snow deformation, tire snow-plow particles (nice-to-have later)
- Per-surface traction maps (ice patch vs rock patch) — whole-biome scales only
- Avalanche, cold damage, day/night cycle
- New tree LODs or external art pipeline
- Relaxing `maxSlopeRad` / solvability for “steeper than the jeep allows”
- Making alpine “harder” via longer path or tighter turns as a difficulty mode
- Path-biased prop density (“rocks denser near path”) — current spawn is uniform + path exclusion
- Menu backdrop theme per biome (menu 3D backdrop stays sand-toned; not a bug)

### 1.3 Success criteria

| ID | Criterion |
|----|-----------|
| A1 | Menu lists alpine; start run with random or explicit seed. |
| A2 | Same `(alpine, seed)` reproduces layout (heightmap + POIs). **Note:** adding a third id remaps `random` via `seed % n` — intentional break for old random seeds. |
| A3 | Cold identity without rain: sky/fog/palette/water ≠ sand/rainforest. |
| A4 | Props: bare rock dominant; no cactus/palm vocabulary. |
| A5 | **Descent signature:** fixed seed corpus — **netDrop** (`path[0].y − path[n-1].y`) product goals in §5.3; CI uses conservative floors in the plan. |
| A6 | Full throttle in 4H on the long descent feels **unsafe**; 4L engine brake is clearly useful (playtest). **See §4.2:** biome `brakeScale` also scales 4L force today. |
| A7 | Traction: slippery enough to read “snow/ice grit,” distinct from rainforest baseline; may be near sand but colder framing. |
| A8 | Path continuous grade stays within vehicle budget (assert max segment grade ≤ solvability grade). Production `generateLevel` has **no** repair/fallback loop — do not require `usedFallback`. Optional: call `validateLevel` in corpus for extra gates. |
| A9 | i18n EN + zh name/description. |
| A10 | Random biome selection includes alpine (deterministic cover of all registered ids). |

---

## 2. Player fantasy

> Start near a **high shoulder / pass**. The ribbon drops into a colder valley.  
> **Rock spines** frame the route. Residual snow on the track.  
> You **hold speed** with range and brake — not a ski jump, a long controlled dump of altitude.

Tone: quiet, sparse, serious off-road — low-poly, not photoreal ski resort.

---

## 3. Visual & audio identity

### 3.1 Palette (canonical targets; tune in playtest)

| Token | Target | Notes |
|-------|--------|-------|
| `skyColor` | Cool pale blue-grey (e.g. `#9aafc4`) | Not sand warm grey-blue |
| `fogColor` | Cold haze (`#c5d0dc` range) | Slightly thicker than sand |
| `fogDensity` | ~0.016–0.024 | Between sand and rainforest; distance softens ridge |
| `groundPalette.high` | Light rock / residual snow | Brightest ridges |
| `groundPalette.mid` | Cool grey scree | |
| `groundPalette.low` | Dark wet rock / shadow | |
| `groundPalette.path` | Packed snow / pale grit | Readable ribbon |
| `waterColor` | Deep cold teal / ink (`#2a4a5c`) | Melt pools, not green jungle water |

Dust / tire tracks inherit terrain palette (existing behavior) → automatically cold-toned.

### 3.2 Props

| meshKey | Role | collides |
|---------|------|----------|
| `rock_pile` | Scree clusters, valley debris | true (existing) |
| `pillar_rock` | Spines, pass markers, sight blockers | true (existing) |
| Optional later | `dead_pine` / `alpine_shrub` | false | **Out of v1** unless cheap |

**Do not use:** `cactus`, `coconut_palm`, `jungle_bush` (wrong biome vocabulary).

v1 density: rock-forward, sparse vs rainforest. **Same placement as sand** (uniform random + exclude near path/start/finish); weights only. No near-path bias.

`groundCoverCountScale`: 0 / omit (no tropical grass carpet).

### 3.3 Weather / VFX

| v1 | Later |
|----|-------|
| No rain (rainforest id hardcode must not fire for alpine) | Optional light snow particles |
| Fog carries cold mood | Wind streak / whiteout |

**Debt note:** Rain is hardcoded to `biome.id === "rainforest"`. Alpine omits weather → no rain. Optional later: `weather?: { kind: "rain" | "snow"; density?: number }` (omit = none). **Do not add weather type in T1** unless GameScene is touched.

### 3.4 Menu

- Icon suggestion: `❄` or `⛰`
- EN name: **Alpine** or **Snow Pass**
- EN desc: e.g. *Residual snow, bare rock, long descents*
- zh: **雪山** / **垭口** — *殘雪、裸岩、長下坡*

---

## 4. Driving identity

### 4.1 Traction (profile scales)

Start from sand-like slip, then tune:

| Field | Starting guess | Intent |
|-------|----------------|--------|
| `frictionSlipScale` | ~0.50–0.55 | Slippery packed snow; not mud |
| `sideFrictionScale` | ~0.42–0.48 | Sideways slide on camber |
| `brakeScale` | **0.75** (same as sand) | Scales `rapierBrakeScale` for **both** service brake and 4L 檔煞 (see §4.2) |

Rainforest keeps baseline (1). Alpine should **not** feel like sticky mud.

### 4.2 4L / engine brake

Existing 4L overspeed engine brake (`V_term` from flat solve) is a **feature, not a bug** for this biome.

- Long descent + gravity → speed builds without throttle.
- Playtest checklist: 4H overshoots / scary; 4L holds near a usable crawl/mid band.

**Decision (review P0-3):** Biome `brakeScale` multiplies the shared `rapierBrakeScale` used by service brake **and** engine brake. Alpine **accepts** this coupling (no drivetrain split in v1). A6 playtest judges 4L usefulness **after** the 0.75 scale — same as sand ice-grit. Revisit only if playtest fails A6; prefer raising `engineBrakeGain` globally or dropM / traction before special-casing drivetrain.

No alpine-specific drivetrain code in v1.

### 4.3 What “big downhill” means (physics-honest)

Vehicle continuous grade budget (existing):

```
maxGrade ≈ tan(maxSlopeRad) * PATH_SAFETY_FACTOR * 0.88
         ≈ tan(28°) * 0.75 * 0.88  ≈ 0.35  (~19° continuous)
```

**Big downhill ≠ cliff.** It means:

1. **Net altitude loss** along the drive path that players feel (tens of meters class, not 2–3 m wobble).
2. **Sustained descending majority** mid-run (not up–down noise that cancels).
3. Local segments still within solvability grade (no “unsolvable wall”).

---

## 5. Levelgen: descent signature

### 5.1 Problem with “profile-only” alpine

Today:

- Base relief: `amp = 12.8 + offPathRoughness * 30` (+ ridge term).
- Path **follows** base then grade-clamps (`fitPathToHeightmap` / `assignPathHeights`).
- Start/finish are **east–west edges** with meander; **no intentional high→low**.

Raising roughness alone increases **both** ups and downs → more drama, **not** a story beat “we’re going down the mountain.”

### 5.2 Required generation lever (v1)

Add a **biome-optional macro height field** applied when building base terrain (before path fit):

**Option A — Domain slope (recommended v1)**  
`macroY(x,z) = alpineBias * (0.5 - t)` where `t` is normalized progress along the **start→finish chord** (or simply `-x` if start is west / finish east as today).

- West (start) higher, east (finish) lower → path travels **W→E** and tends to **dump altitude** (start at `x = -half+m`, finish at `+half-m`).
- Amplitude example: **25–45 m** end-to-end macro drop before fBm detail (tune; ship start **32 m**).
- fBm / ridges still add local interest; path clamp keeps drivability.

**Option B — Radial peak**  
High near map center or NW; finish in low bowl. Harder to guarantee path rides the fall line; defer unless A is insufficient.

**Option C — Explicit path design profile**  
Force monotone-ish design Y along polyline. Fights “path follows landforms” philosophy; only if A fails playtest.

**Spec decision:** implement **Option A** as `BiomeProfile` optional fields (see §6). Only alpine sets them in v1; sand/rainforest omit → zero behavior change.

### 5.3 Quantitative targets (tune with corpus)

**Source of truth split (review P0-2):**

| Layer | Role |
|-------|------|
| **Spec (this table)** | Product / playtest goals — tighten after P3 |
| **Plan CI** | Conservative floors so first green is honest |

Metrics on finished path polyline Y (after conditioning):

| Metric | Product goal (spec) | CI floor (plan; may lag) |
|--------|---------------------|---------------------------|
| `netDrop = path[0].y − path[n−1].y` | **≥ 18 m** on ≥70% seeds; mean clearly ≫ sand | mean ≥ **12 m**; ≥70% seeds ≥ **10 m** |
| Max single-segment grade | ≤ solvability budget always | **Assert every corpus seed** |
| Longest continuous descent (m) | Playtest observation | Optional log only in v1 |
| `heightRange` / raw `descendFraction` | **Not** ship gates (noisy under meander+fBm; sand heightRange already high) | Do not CI-fail |

Corpus: fixed 20 seeds (plan list).  
`forceFallbackLevel` / `isFallback` carve: **skip macro** (helper only; production never falls back).

### 5.4 Ponds / water

| Field | Alpine v1 **decided** |
|-------|------------------------|
| `streamDensity` | **0.12** → pond band **0** (no melt pools in v1) |

Avoid rainforest-scale flooding. Cold `waterColor` kept for future.

### 5.5 Roughness / path width

| Field | Guess | Intent |
|-------|-------|--------|
| `offPathRoughness` | 0.75–0.9 | Rocky relief; works **with** macro slope |
| `pathWidth` | default or −10% | Slightly tighter mountain track optional |
| `mapSize` | default 256 | No change v1 |

### 5.6 Props placement

Reuse existing prop spawn; alpine `propTable` rock-only.

| Field | Guess |
|-------|-------|
| `propDensity` | 0.5–0.7 |
| `propCountScale` | 6–10 |
| weights | `rock_pile` high, `pillar_rock` medium–high |

No `ensureProps` cactus.

---

## 6. Data model extensions

### 6.1 `BiomeProfile` additions (optional, backward compatible)

```ts
interface BiomeMacroRelief {
  /**
   * End-to-end height added along start→finish chord (m).
   * Positive = start side higher than finish side (descent bias).
   */
  startToFinishDropM: number;
  /**
   * 0 = pure planar ramp; 1 = also lift orthogonal “ridge” optional later.
   * v1: planar ramp only; field may be omitted.
   */
  planarity?: number;
}

interface BiomeProfile {
  // …existing fields…
  /** Optional macro relief for descent-signature biomes (alpine). */
  macroRelief?: BiomeMacroRelief;
  // weather?: { kind: "rain" | "snow"; density?: number }  — add only when GameScene migrates rain (T4 optional)
}
```

T1 adds **`macroRelief` only**. Do not ship unused `weather` field until a consumer exists.

### 6.2 Levelgen touch

In `carveAndDecorate` base loop, after fBm (or added to base):

```
hm[i] += macroSample(x, z, startXZ, endXZ, biome.macroRelief)
```

Macro must be **deterministic** from biome + path endpoints (or seed-stable start/end already chosen). Prefer using **actual path start/end XZ** after polyline exists so meander still aligns with high→low.

Order:

1. Generate path XZ  
2. Build base fBm  
3. **Add macro ramp using path start/end**  
4. Snapshot base  
5. fitPath / condition / ponds  

### 6.3 Files expected to change (implementation plan owns order)

| Area | Files |
|------|--------|
| Profile | `src/biome/profiles/alpine.ts` (new), `registry.ts` |
| Types | `src/biome/types.ts` |
| Levelgen | `generateLevel.ts` (+ small helper e.g. `macroRelief.ts`) |
| Tests | `tests/biome/…`, `tests/levelgen/…` descent metrics |
| i18n | `messages.ts`, `index.ts` helpers |
| Menu | `menu.ts` card |
| Render | `GameScene.ts` only if weather hook; else zero if no new mesh |
| Physics colliders | none if only existing rocks |

---

## 7. Differentiation checklist (vs sand / rainforest)

| Axis | Sand | Rainforest | Alpine |
|------|------|------------|--------|
| Temperature read | Warm | Humid green | **Cold** |
| Moisture | Dry | Rain + many ponds | **Dry / rare melt** |
| Vegetation | Cactus | Palm + bush + grass | **None (rock only)** |
| Traction story | Skate flats | Grip baseline | **Slide on descent** |
| Vertical story | Ridges / wobble | Soft relief + fords | **Net dump high→low** |
| Signature prop | Cactus | Palm | **Pillar / pile rock** |
| Signature VFX | Dust warm | Rain | Fog cold (snow later) |

If playtest says “still sand,” priority fix order: (1) macro drop, (2) palette, (3) remove wrong props, (4) traction, (5) fog.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Macro drop + grade clamp flattens path into boring ramp | Keep fBm amp; clamp only continuous grade; meander laterally |
| Grade budget exceeded on path | Assert max segment grade in corpus; lower `startToFinishDropM` if needed |
| Alpine = “white sand” | Ban warm props; cold water; no rain; rocks not cacti |
| Players miss downhill if start/finish reverse relative height | Define drop as start→finish along path direction; metric netDrop |
| 4H too easy still | Rely on gravity + slip; optional later slight engineBrakeGain tweak |
| Pond band cliff at 0.15/0.5 | Explicit alpine density choice; document band |
| Hardcoded rainforest rain | Weather field or leave alpine without id check |

---

## 9. Phased delivery

| Phase | Scope | Exit |
|-------|--------|------|
| **P0 — Plan** | This spec + implementation plan on branch | Docs merged or approved |
| **P1 — Data slice** | Profile + registry + i18n + menu; **no** macro yet; rock props + cold palette + traction | Playable “cold rock map” |
| **P2 — Descent** | `macroRelief` + levelgen + corpus metrics tests | A5 metrics green |
| **P3 — Feel** | Traction / fog / prop density playtest; 4L checklist A6 | User sign-off |
| **P4 — Polish (optional)** | Weather hook + light snow; dead pine mesh; menu icon polish | Nice-to-have |

**Do not** ship P1 alone as “the alpine feature” if marketing promises big downhill — P2 is part of the identity.

---

## 10. Decisions (locked for implement)

| # | Decision |
|---|----------|
| 1 | Biome id: **`alpine`** |
| 2 | EN **Alpine** / zh **雪山** |
| 3 | Ponds: **off** (`streamDensity: 0.12`) |
| 4 | Weather migration: **follow-up** (not T1) |
| 5 | `startToFinishDropM`: start **32**, tune in playtest |
| 6 | `brakeScale` **0.75** couples service + 4L; accept for v1 (§4.2) |

---

## 11. References

- Architecture / biome rules: `docs/superpowers/specs/2026-07-09-lowpoly-jeep-offroad-design.md` §6–7  
- Traction / profiles: `src/biome/types.ts`, `sand.ts`, `rainforest.ts`  
- Grade clamp: `src/levelgen/path.ts` (`assignPathHeights`)  
- Base relief: `src/levelgen/generateLevel.ts` (`carveAndDecorate`)  
- 4L engine brake: drivetrain + `VehicleController` (flat `V_term`)  
- Rock colliders: `src/physics/propColliders.ts`
