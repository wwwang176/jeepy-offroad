# Low-Poly Jeep Off-Road

## Scripts
- `npm run dev` — local game
- `npm test` — unit tests
- `npm run build` — production build
- `npm run preview` — serve production build (base path `/jeepy-offroad/`)

## Play online
Deployed from `master` via GitHub Actions → GitHub Pages:

https://wwwang176.github.io/jeepy-offroad/

Repo **Settings → Pages → Source** must be **GitHub Actions** (not “Deploy from a branch”).

## Controls
- WASD / Arrow keys — drive (S alone reverse; W+S brake)
- C — camera third/first
- R — respawn

## Seed
Empty menu field = random uint32. Same biome + seed reproduces layout.

## Spec / Plan / Checklist
- docs/superpowers/specs/2026-07-09-lowpoly-jeep-offroad-design.md
- docs/superpowers/plans/2026-07-09-lowpoly-jeep-offroad.md
- docs/superpowers/checklists/2026-07-09-mvp-ship-checklist.md
- docs/superpowers/reviews/2026-07-09-per-commit-codex-review.md

## Dev only
In `npm run dev`, the menu may show **Flat physics test**. Production builds hide it.
