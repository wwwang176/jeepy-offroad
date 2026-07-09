export interface InputActions {
  throttle: number; // -1..1
  steer: number; // -1..1
  brake: number; // 0..1
  cameraToggle: boolean;
  respawn: boolean;
  /** Mouse-drag look delta in pixels since last sample (right +, down +). */
  lookDeltaX: number;
  lookDeltaY: number;
}

export interface InputProvider {
  sample(): InputActions;
  dispose(): void;
}
