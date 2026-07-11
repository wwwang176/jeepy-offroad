import {
  DEFAULT_DRIVE_RANGE,
  toggleDriveRange,
  type DriveRange,
} from "@/shared/driveTrain";
import type { InputActions, InputProvider, ProviderSample } from "./types";

/** Pick the value with larger absolute magnitude (signed). */
export function maxAbs(a: number, b: number): number {
  return Math.abs(b) > Math.abs(a) ? b : a;
}

/** Merge multiple device samples (pure; no range state). */
export function mergeProviderSamples(samples: ProviderSample[]): ProviderSample {
  const out: ProviderSample = {
    throttle: 0,
    steer: 0,
    brake: 0,
    rangeToggle: false,
    cameraToggle: false,
    respawn: false,
    lookDeltaX: 0,
    lookDeltaY: 0,
  };
  for (const s of samples) {
    out.throttle = maxAbs(out.throttle, s.throttle);
    out.steer = maxAbs(out.steer, s.steer);
    out.brake = Math.max(out.brake, s.brake);
    out.rangeToggle = out.rangeToggle || s.rangeToggle;
    out.cameraToggle = out.cameraToggle || s.cameraToggle;
    out.respawn = out.respawn || s.respawn;
    out.lookDeltaX += s.lookDeltaX;
    out.lookDeltaY += s.lookDeltaY;
  }
  return out;
}

/**
 * Routes one or more InputProviders into a single InputActions stream.
 * Owns transfer-case state so keyboard + touch never disagree on 4H/4L.
 */
export class InputRouter {
  private readonly providers: InputProvider[];
  private driveRange: DriveRange = DEFAULT_DRIVE_RANGE;

  constructor(providers: InputProvider | InputProvider[]) {
    this.providers = Array.isArray(providers) ? providers : [providers];
  }

  getDriveRange(): DriveRange {
    return this.driveRange;
  }

  sample(): InputActions {
    const samples = this.providers.map((p) => p.sample());
    const merged = mergeProviderSamples(samples);
    if (merged.rangeToggle) {
      this.driveRange = toggleDriveRange(this.driveRange);
    }
    return {
      throttle: merged.throttle,
      steer: merged.steer,
      brake: merged.brake,
      driveRange: this.driveRange,
      cameraToggle: merged.cameraToggle,
      respawn: merged.respawn,
      lookDeltaX: merged.lookDeltaX,
      lookDeltaY: merged.lookDeltaY,
    };
  }

  dispose(): void {
    for (const p of this.providers) {
      p.dispose();
    }
  }
}
