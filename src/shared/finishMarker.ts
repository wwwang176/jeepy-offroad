/**
 * Finish is a super-tall translucent green column (visual + trigger half-height).
 * XZ still comes from level `finish.halfExtents`; Y is overridden for visibility.
 */
export const FINISH_COLUMN_HEIGHT_M = 80;

export function finishColumnHalfHeight(): number {
  return FINISH_COLUMN_HEIGHT_M * 0.5;
}
