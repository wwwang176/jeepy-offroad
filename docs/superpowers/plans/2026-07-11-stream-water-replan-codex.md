**Diagnosis**

The water bugs are architectural, not material tweaks:

- Stream carving and water rendering each appear to derive their own `waterY`, so the terrain bed and rendered surface drift apart.
- The current stream mesh behaves like a terrain-following drape in places, while the desired model needs a mostly horizontal free surface per reach/pond.
- The channel cut is not constrained by a single “soft dig + max cut” rule, so seed `929210958` can produce water floating above bed in one spot and buried under terrain at edges.
- Pond creation is not part of the same hydrology graph as stream reaches, so channel-end ponds can be visually present but topologically disconnected.
- `depthWrite: false` hides some ordering artifacts but makes water/terrain intersections less trustworthy. It should not be the core fix.
- The patch stack likely added local clamps around symptoms instead of enforcing one source of truth for bed, bank, surface, and connectivity.

**Recommended Model**

Use one levelgen-owned hydrology model.

Levelgen should emit final water geometry intent, and render should only consume it.

Core rules:

- Each stream/river reach has:
  - a centerline
  - width
  - bed profile
  - bank profile
  - a single computed `surfaceY` model
  - connection metadata
- Each pond has:
  - basin polygon or radius
  - outlet/inlet links
  - one horizontal `surfaceY`
  - carved bed/bowl below that surface
- Water surface is horizontal per pond and mostly horizontal per reach segment, not fully terrain-draped.
- Terrain carving guarantees:
  - wetted bed is below `surfaceY`
  - banks rise to or above `surfaceY`
  - cut depth is capped by `STREAM_MAX_CUT` or successor constants
  - shape blends with soft shoulders instead of vertical cuts
- Paths crossing water become explicit fords:
  - lower/flatten road bed locally
  - optionally shallow the stream at crossing
  - preserve stream connectivity through the ford

**Delete/Simplify**

Remove or avoid:

- Render-side recomputation of stream/pond `waterY`.
- Any independent water height constants in `GameScene.ts`.
- Patch-only clamps that separately push water up/down after terrain carving.
- Special cases that fix only channel ends without connecting them to pond metadata.
- Reliance on `depthWrite: false` to mask wrong geometry.
- Duplicate `STREAM_*` constants if they describe the same physical value in different files.

Keep:

- Three.js mesh generation.
- Transparent water material, but make geometry correct first.
- Existing stream path generation if usable, but route it through the unified schema.

**Pipeline**

1. **Base terrain**
   - Generate the normal heightfield first.
   - Do not carve water yet.

2. **Hydrology candidate generation**
   - Generate stream/river centerlines.
   - Generate channel-end pond candidates where appropriate.
   - Build an explicit graph:
     - stream reach -> pond
     - pond -> outlet reach
     - reach -> reach
   - Reject or repair dangling pond/stream endings unless deliberately marked as dry/decorative.

3. **Assign water levels**
   - Ponds get one horizontal `surfaceY`.
   - Stream reaches get either:
     - one `surfaceY` for short/flat reaches, or
     - stepped/segmented `surfaceY` for longer descending channels.
   - Never let render derive a different value.

4. **Carve terrain**
   - For each stream sample:
     - compute desired bed: `surfaceY - targetDepth`
     - apply soft dig toward desired bed
     - clamp by max cut
     - shape cross-section with bed, inner bank, outer blend
   - For each pond:
     - carve basin below `surfaceY`
     - blend rim to surrounding terrain
     - guarantee inlet/outlet cells connect below or at water level

5. **Path fords**
   - After water carving but before final mesh emission, apply road/path crossings.
   - Detect path-water intersections from the hydrology graph, not visual mesh overlap.
   - Flatten ford crossing locally.
   - Keep a continuous submerged channel through the ford.

6. **Finalize terrain**
   - Run erosion/smoothing only if it respects water constraints.
   - Revalidate water invariants after smoothing.

7. **Emit schema**
   - `generateLevel` returns terrain plus water bodies/reaches with final `surfaceY`, bed data, width, and connectivity.
   - Rendering receives this data directly.

8. **Render**
   - `GameScene.ts` builds stream/pond meshes from emitted hydrology.
   - Stream mesh vertices use emitted `surfaceY` or per-segment surface values.
   - Pond mesh uses one flat plane or triangulated polygon at pond `surfaceY`.
   - Water material can use normal maps/alpha, but not height correction.

**Schema**

Add or consolidate around a levelgen-owned schema in `src/levelgen/types.ts`.

Suggested shape:

```ts
export type WaterKind = 'stream' | 'river' | 'pond';

export interface WaterConnection {
  fromId: string;
  toId: string;
  kind: 'inlet' | 'outlet' | 'continuation' | 'ford';
}

export interface StreamSample {
  x: number;
  z: number;
  bedY: number;
  surfaceY: number;
  width: number;
  depth: number;
  bankWidth: number;
}

export interface StreamReach {
  id: string;
  kind: 'stream' | 'river';
  samples: StreamSample[];
  connections: WaterConnection[];
}

export interface PondBody {
  id: string;
  kind: 'pond';
  center: { x: number; z: number };
  radius?: number;
  polygon?: Array<{ x: number; z: number }>;
  surfaceY: number;
  bedY: number;
  rimY: number;
  connections: WaterConnection[];
}

export type WaterBody = StreamReach | PondBody;
```

Constants should describe physical constraints, for example:

```ts
STREAM_TARGET_DEPTH
STREAM_MIN_DEPTH
STREAM_BANK_CLEARANCE
STREAM_MAX_CUT
STREAM_SOFT_DIG_STRENGTH
STREAM_BANK_BLEND_WIDTH
POND_TARGET_DEPTH
POND_RIM_CLEARANCE
POND_MAX_CUT
FORD_TARGET_DEPTH
FORD_WIDTH
```

The important rule: these constants live in levelgen and rendering does not redefine them.

**Acceptance Checks Seed 929210958**

For seed `929210958`, add deterministic checks around generated level data before rendering:

- No dual water height:
  - every rendered stream/pond mesh uses emitted `surfaceY`
  - no render-local `waterY` derivation remains

- Bed clearance:
  - every wetted stream sample has `surfaceY - bedY >= STREAM_MIN_DEPTH`
  - target central depth should remain near the intended value, for example around `0.25m` if that is the desired stream depth

- No buried edge water:
  - terrain inside the wetted channel must be below `surfaceY`
  - terrain at immediate bank/rim should be at or above `surfaceY + STREAM_BANK_CLEARANCE` except at explicit fords/inlets/outlets

- No floating water:
  - stream surface must not sit visibly above an uncarved terrain strip
  - max allowed unintended water-bed visual gap is the modeled depth, not an accidental air gap

- Pond connectivity:
  - every channel-end pond connected to a stream has at least one inlet/outlet edge
  - endpoint terrain between stream and pond is carved below or at `surfaceY`
  - no dry terrain wall separates the stream mesh from the pond mesh

- Ford behavior:
  - paths crossing streams are marked as fords
  - ford bed remains passable and connected
  - water does not disappear or form a blocked dam at the crossing

- Material sanity:
  - water can render with transparency
  - `depthWrite: false` is not required to hide terrain intersection bugs

**PR Sequence**

1. **PR 1: Hydrology schema and constants**
   - Consolidate `STREAM_*` constants in `types.ts`.
   - Add water body/reach schema.
   - No visual behavior change except plumbing.

2. **PR 2: Single source of truth for water height**
   - Move all stream/pond `surfaceY` decisions into levelgen.
   - Remove render-side water height derivation.
   - Update `GameScene.ts` water mesh builders to consume emitted values.

3. **PR 3: Stream soft-dig carving**
   - Replace local clamps with cross-section carving.
   - Apply target depth, bank clearance, soft dig, and max cut.
   - Add seed `929210958` checks for bed/surface/bank invariants.

4. **PR 4: Pond integration**
   - Generate ponds as water graph nodes.
   - Carve basins and rims from the same `surfaceY` model.
   - Connect stream endpoints into ponds explicitly.

5. **PR 5: Path fords**
   - Detect path-water intersections.
   - Emit ford metadata.
   - Carve ford crossings after stream/pond carving while preserving flow continuity.

6. **PR 6: Render/material cleanup**
   - Simplify water mesh functions.
   - Remove workaround material settings where possible.
   - Keep transparency/normal styling only after geometry checks pass.

**Non-goals**

- Do not build fluid simulation.
- Do not make water fully terrain-draped.
- Do not solve all terrain erosion or biome blending in this refactor.
- Do not redesign the whole level generator.
- Do not make ponds decorative-only unless explicitly marked disconnected.
- Do not use material/render hacks as the primary fix for wrong geometry.
- Do not hand-roll complex Three.js water physics; simple generated meshes are enough.