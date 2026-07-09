import type { InputActions, InputProvider } from "./types";

export class KeyboardProvider implements InputProvider {
  private keys = new Set<string>();
  private cameraPressed = false;
  private respawnPressed = false;
  private readonly target: Window;
  private onDown = (e: KeyboardEvent) => {
    // Ignore OS key auto-repeat for edge actions and held-key bookkeeping
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === "KeyC") this.cameraPressed = true;
    if (e.code === "KeyR") this.respawnPressed = true;
  };
  private onUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  constructor(target: Window = window) {
    this.target = target;
    target.addEventListener("keydown", this.onDown);
    target.addEventListener("keyup", this.onUp);
  }

  sample(): InputActions {
    const up = this.keys.has("KeyW") || this.keys.has("ArrowUp");
    const down = this.keys.has("KeyS") || this.keys.has("ArrowDown");
    const left = this.keys.has("KeyA") || this.keys.has("ArrowLeft");
    const right = this.keys.has("KeyD") || this.keys.has("ArrowRight");

    let throttle = 0;
    let brake = 0;
    if (up && down) {
      throttle = 0;
      brake = 1;
    } else if (up) {
      throttle = 1;
    } else if (down) {
      throttle = -1;
    }

    let steer = 0;
    if (left) steer -= 1;
    if (right) steer += 1;

    const actions: InputActions = {
      throttle,
      steer,
      brake,
      cameraToggle: this.cameraPressed,
      respawn: this.respawnPressed,
    };
    this.cameraPressed = false;
    this.respawnPressed = false;
    return actions;
  }

  dispose(): void {
    this.target.removeEventListener("keydown", this.onDown);
    this.target.removeEventListener("keyup", this.onUp);
  }
}
