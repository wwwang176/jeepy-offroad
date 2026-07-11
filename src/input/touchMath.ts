import { clamp } from "@/shared/math";

/**
 * Horizontal-only virtual stick: map pixel offset from pad center to steer -1..1.
 * Deadzone kills thumb jitter at rest.
 */
export function stickSteerFromOffset(
  dxPx: number,
  radiusPx: number,
  deadzone = 0.12,
): number {
  if (radiusPx <= 1e-6) return 0;
  const n = clamp(dxPx / radiusPx, -1, 1);
  if (Math.abs(n) < deadzone) return 0;
  // Rescale so leaving deadzone starts from 0 (no jump to deadzone value).
  const sign = n < 0 ? -1 : 1;
  return sign * ((Math.abs(n) - deadzone) / (1 - deadzone));
}

/**
 * Breakpoint (px) at/below which on-screen drive controls are shown.
 * RWD-only: no pointer/hover/maxTouchPoints heuristics.
 * Override with `?touch=1` / `?controls=1` (force on) or `?touch=0` (force off).
 */
export const TOUCH_UI_MAX_WIDTH_PX = 900;

/**
 * Show virtual controls when the layout is "phone/tablet width".
 * Pure RWD via max-width — matches how HUD/CSS already reflow.
 */
export function prefersTouchUi(
  matchMedia: (q: string) => { matches: boolean } = globalThis.matchMedia?.bind(
    globalThis,
  ) ?? (() => ({ matches: false })),
  opts?: {
    search?: string;
    maxWidthPx?: number;
  },
): boolean {
  try {
    const search =
      opts?.search ??
      (typeof location !== "undefined" ? location.search : "");
    const params = new URLSearchParams(search);
    if (params.get("touch") === "1" || params.get("controls") === "1") {
      return true;
    }
    if (params.get("touch") === "0") {
      return false;
    }

    const maxW = opts?.maxWidthPx ?? TOUCH_UI_MAX_WIDTH_PX;
    return matchMedia(`(max-width: ${maxW}px)`).matches;
  } catch {
    return false;
  }
}
