import type { InputActions, InputProvider } from "./types";

/**
 * Desktop keyboard + left-drag look.
 * Pointer drag is only started on the game canvas so menus/HUD stay clickable.
 */
export class KeyboardProvider implements InputProvider {
  private keys = new Set<string>();
  private cameraPressed = false;
  private respawnPressed = false;
  private lookX = 0;
  private lookY = 0;
  private dragging = false;
  private pointerId: number | null = null;
  private readonly target: Window;
  private readonly pointerRoot: EventTarget;

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

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const el = e.target as HTMLElement | null;
    if (!el || typeof el.closest !== "function") return;
    // Only start look-drag on the WebGL canvas (not buttons / minimap / menus).
    if (el.tagName !== "CANVAS" || el.classList.contains("hud-minimap")) return;
    this.dragging = true;
    this.pointerId = e.pointerId;
    try {
      el.setPointerCapture?.(e.pointerId);
    } catch {
      // ignore capture failures in tests / odd hosts
    }
    e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    if (this.pointerId !== null && e.pointerId !== this.pointerId) return;
    this.lookX += e.movementX;
    this.lookY += e.movementY;
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.dragging) return;
    if (this.pointerId !== null && e.pointerId !== this.pointerId) return;
    this.dragging = false;
    this.pointerId = null;
  };

  /**
   * @param target keyboard + global pointer move/up target (usually `window`)
   * @param pointerRoot where pointerdown is listened (canvas or window for tests)
   */
  constructor(target: Window = window, pointerRoot: EventTarget = target) {
    this.target = target;
    this.pointerRoot = pointerRoot;
    target.addEventListener("keydown", this.onDown);
    target.addEventListener("keyup", this.onUp);
    pointerRoot.addEventListener("pointerdown", this.onPointerDown as EventListener);
    target.addEventListener("pointermove", this.onPointerMove as EventListener);
    target.addEventListener("pointerup", this.onPointerUp as EventListener);
    target.addEventListener("pointercancel", this.onPointerUp as EventListener);
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
      lookDeltaX: this.lookX,
      lookDeltaY: this.lookY,
    };
    this.cameraPressed = false;
    this.respawnPressed = false;
    this.lookX = 0;
    this.lookY = 0;
    return actions;
  }

  dispose(): void {
    this.target.removeEventListener("keydown", this.onDown);
    this.target.removeEventListener("keyup", this.onUp);
    this.pointerRoot.removeEventListener(
      "pointerdown",
      this.onPointerDown as EventListener,
    );
    this.target.removeEventListener(
      "pointermove",
      this.onPointerMove as EventListener,
    );
    this.target.removeEventListener(
      "pointerup",
      this.onPointerUp as EventListener,
    );
    this.target.removeEventListener(
      "pointercancel",
      this.onPointerUp as EventListener,
    );
  }
}
