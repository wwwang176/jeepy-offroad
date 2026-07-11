import type { InputProvider, ProviderSample } from "./types";

/**
 * Desktop keyboard + pointer look (mouse and touch).
 * Look drag starts on the game canvas only so menus / HUD / touch pads stay usable.
 * Touch UI pads sit above the canvas with enlarged safe hit-zones so edge
 * presses near sticks do not flick the camera.
 */
export class KeyboardProvider implements InputProvider {
  private keys = new Set<string>();
  private cameraPressed = false;
  private respawnPressed = false;
  private rangeTogglePressed = false;
  private lookX = 0;
  private lookY = 0;
  private dragging = false;
  private pointerId: number | null = null;
  private lastClientX = 0;
  private lastClientY = 0;
  private readonly target: Window;
  private readonly pointerRoot: EventTarget;

  private onDown = (e: KeyboardEvent) => {
    // Ignore OS key auto-repeat for edge actions and held-key bookkeeping
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === "KeyC") this.cameraPressed = true;
    if (e.code === "KeyR") this.respawnPressed = true;
    // Shift = transfer-case toggle edge (4H ↔ 4L); state lives on InputRouter
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
      this.rangeTogglePressed = true;
    }
  };
  private onUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const el = e.target as HTMLElement | null;
    if (!el || typeof el.closest !== "function") return;
    // Only start look-drag on the WebGL canvas (not buttons / minimap / menus / pads).
    if (el.tagName !== "CANVAS" || el.classList.contains("hud-minimap")) return;
    // Touch pads / HUD panels use stopPropagation + higher layers; if we still
    // receive a pad hit, never look from it.
    if (el.closest?.(".touch-controls, .touch-safe, .hud, .panel")) return;

    this.dragging = true;
    this.pointerId = e.pointerId;
    this.lastClientX = e.clientX;
    this.lastClientY = e.clientY;
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

    // movementX/Y are often 0 on mobile Safari — fall back to client deltas.
    let dx = e.movementX;
    let dy = e.movementY;
    if (
      (dx === 0 && dy === 0) ||
      (e.pointerType === "touch" && !Number.isFinite(dx))
    ) {
      dx = e.clientX - this.lastClientX;
      dy = e.clientY - this.lastClientY;
    }
    // Touch often reports both movement* and client*; prefer client for touch.
    if (e.pointerType === "touch") {
      dx = e.clientX - this.lastClientX;
      dy = e.clientY - this.lastClientY;
    }
    this.lastClientX = e.clientX;
    this.lastClientY = e.clientY;

    this.lookX += dx;
    this.lookY += dy;
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

  sample(): ProviderSample {
    const up = this.keys.has("KeyW") || this.keys.has("ArrowUp");
    const down = this.keys.has("KeyS") || this.keys.has("ArrowDown");
    const left = this.keys.has("KeyA") || this.keys.has("ArrowLeft");
    const right = this.keys.has("KeyD") || this.keys.has("ArrowRight");

    // W/S are drive intent only. Brake is derived in driveTrain from
    // opposite-to-motion throttle (forward+S or reverse+W). No input = coast.
    let throttle = 0;
    const brake = 0;
    if (up && !down) {
      throttle = 1;
    } else if (down && !up) {
      throttle = -1;
    }
    // both pressed → treat as coast (no fight between keys)

    let steer = 0;
    if (left) steer -= 1;
    if (right) steer += 1;

    const actions: ProviderSample = {
      throttle,
      steer,
      brake,
      rangeToggle: this.rangeTogglePressed,
      cameraToggle: this.cameraPressed,
      respawn: this.respawnPressed,
      lookDeltaX: this.lookX,
      lookDeltaY: this.lookY,
    };
    this.cameraPressed = false;
    this.respawnPressed = false;
    this.rangeTogglePressed = false;
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
