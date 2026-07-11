# Hydrology Water Surface Correction

Diagnosis + Codex review of user complaints on `feat/stream-water-replan`
(seed ~929210958). Read-only review; implement next.

## Root causes (current code)

### 1. Pond floats above shore
`buildPondAtEnd()` sets `pond.surfaceY = end.surfaceY` from the stream sample
**before** local rim/basin is evaluated, then carves a circular bowl to that
level. There is no “water plane vs local shore” solve, so the disc can sit
above nearby terrain.

### 2. Pond looks rectangular / pad-like
Visible outline is a **synthetic regular 16-gon**, not the set of terrain cells
actually under water. Render fans a flat polygon at `surfaceY`. Terrain may be
irregular; the water outline is not.

### 3. River goes up and down
`assignSurfaceAndBed()` does `surface = g0 - clearance`, then smooth +
**bidirectional** `limitSurfaceSlope` (allows rise and fall). Free surface
tracks terrain undulation instead of flowing downhill.

## Recommended model (no fluid sim)

| Body | Free surface |
|------|----------------|
| Pond / lake | One horizontal `surfaceY` |
| Stream / river | Monotone non-increasing downstream (piecewise linear) |
| Cascade | Explicit step only when required drop exceeds max smooth slope |

### Stream free surface

```
// Flow direction: higher endpoint → lower endpoint
if g0[0] < g0[n-1]: reverse stations

bankCeil[i] = min(leftBankG0, rightBankG0) - clearance

// Initial: linear downhill under bank ceilings
startY = bankCeil[0]
endY   = min(bankCeil[n-1], startY - minDrop)
surface = lerp(startY, endY)

for i: surface[i] = min(surface[i], bankCeil[i])
for i = 1..n-1:
  surface[i] = min(surface[i], surface[i-1])           // never rise
  surface[i] = max(surface[i], surface[i-1] - maxStep) // no cliff

// Bed adapts to surface — never raise surface just to force depth
bed = max(surface - targetDepth, g0 - MAX_CUT)
if depth < minDepth: shallow/narrow segment, not raise surface
```

### Pond level + irregular shore

```
candidate = connected stream end surfaceY
rimLow    = percentile(heights on ring @ radius, 20)
surfaceY  = min(candidate, rimLow - RIM_CLEARANCE)
// then carve bowl under surfaceY

// After carve: wet mask
wet = floodFill from center where hm <= surfaceY + eps, within maxRadius
polygon = marchingSquares / contour of wet  (or radial rays as cheaper v1)
// simplify RDP; emit polygon + horizontal surfaceY
```

**Render stays dumb:** only consumes emitted `surfaceY` + polygon.

## Delete / replace

- Bidirectional `limitSurfaceSlope` → downstream-only monotone
- `surface = g0 - clearance` as final height source → bank-ceiling constrained profile
- Raising surface to satisfy min depth when banks forbid it
- Regular circular pond polygon as production output
- `pond.surfaceY = end.surfaceY` as authoritative (only a candidate)

## Implementation order

1. **Stream monotone free surface** + flow direction + bank ceiling
2. **Pond surfaceY from rim/basin** + carve below it; lock stream ends to ponds
3. **Wet polygon** from heightfield (flood + contour; radial rays OK for first pass)
4. **Seed checks** 929210958: monotonicity, shore flush, non-regular polygon

## Acceptance (seed 929210958)

- `samples[i+1].surfaceY <= samples[i].surfaceY + 0.01` along flow
- Pond shore vertices: terrain within ~`[-0.05, +0.15]` m of `surfaceY`
- Pond polygon not a regular N-gon (radius variance / irregularity)
- No pond water vertex > ~0.10 m above adjacent shore terrain
- Stream ends match connected pond `surfaceY` within epsilon
