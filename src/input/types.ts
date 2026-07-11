import type { DriveRange } from "@/shared/driveTrain";

export type { DriveRange };

/**
 * Raw sample from a single input device (keyboard, touch, …).
 * Transfer-case state is owned by InputRouter — providers only emit edges.
 */
export interface ProviderSample {
  throttle: number; // -1..1
  steer: number; // -1..1
  brake: number; // 0..1
  /** Rising edge: toggle 4H ↔ 4L this frame. */
  rangeToggle: boolean;
  cameraToggle: boolean;
  respawn: boolean;
  /** Mouse/touch look delta in pixels since last sample (right +, down +). */
  lookDeltaX: number;
  lookDeltaY: number;
}

/** Merged actions consumed by physics / camera / respawn. */
export interface InputActions {
  throttle: number; // -1..1
  steer: number; // -1..1
  brake: number; // 0..1
  /**
   * Transfer-case range held by InputRouter (Shift / touch button toggles).
   * "H" = 4H road, "L" = 4L crawl.
   */
  driveRange: DriveRange;
  cameraToggle: boolean;
  respawn: boolean;
  /** Look delta in pixels since last sample (right +, down +). */
  lookDeltaX: number;
  lookDeltaY: number;
}

export interface InputProvider {
  sample(): ProviderSample;
  dispose(): void;
}
