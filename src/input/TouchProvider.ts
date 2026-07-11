import type { DriveRange } from "@/shared/driveTrain";
import { DRIVE_RANGES } from "@/shared/driveTrain";
import type { InputProvider, ProviderSample } from "./types";
import { prefersTouchUi, stickSteerFromOffset } from "./touchMath";

const STICK_RADIUS_PX = 56;

/**
 * On-screen mobile controls:
 * - Left horizontal stick → steer
 * - Right pedals → throttle / reverse
 * - Buttons → 4H/4L, camera, respawn
 *
 * Visibility is RWD-only (viewport max-width); see prefersTouchUi().
 */
export class TouchProvider implements InputProvider {
  private readonly root: HTMLElement;
  private visible = false;
  /** When true, ignore RWD auto-show (e.g. result overlay). */
  private suppressed = false;
  private steer = 0;
  private throttle = 0;
  private gasDown = false;
  private revDown = false;
  private rangeToggle = false;
  private cameraToggle = false;
  private respawn = false;
  private lastDriveRange: DriveRange | null = null;

  private steerPointerId: number | null = null;
  private gasPointerId: number | null = null;
  private revPointerId: number | null = null;
  private stickOriginX = 0;

  private readonly stickEl: HTMLElement;
  private readonly knobEl: HTMLElement;
  private readonly rangeBtn: HTMLElement;
  private readonly onViewportChange: () => void;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "touch-controls";
    this.root.setAttribute("aria-hidden", "true");
    this.root.innerHTML = `
      <div class="touch-rotate-mask" data-touch-rotate aria-live="polite">
        <span class="touch-rotate-mask-text">請旋轉畫面</span>
      </div>
      <div class="touch-stick" data-touch-stick>
        <div class="touch-stick-ring"></div>
        <div class="touch-stick-knob" data-touch-knob></div>
        <span class="touch-stick-label">STEER</span>
      </div>
      <div class="touch-actions">
        <button type="button" class="touch-btn" data-touch-range title="4H / 4L">4H</button>
        <button type="button" class="touch-btn" data-touch-camera title="Camera">CAM</button>
        <button type="button" class="touch-btn" data-touch-respawn title="Respawn">R</button>
      </div>
      <div class="touch-pedals">
        <button type="button" class="touch-pedal touch-pedal-gas" data-touch-gas>▲</button>
        <button type="button" class="touch-pedal touch-pedal-rev" data-touch-rev>▼</button>
      </div>
    `;

    this.stickEl = this.root.querySelector("[data-touch-stick]")!;
    this.knobEl = this.root.querySelector("[data-touch-knob]")!;
    this.rangeBtn = this.root.querySelector("[data-touch-range]")!;

    this.bindStick(this.stickEl);
    this.bindPedal(this.root.querySelector("[data-touch-gas]")!, "gas");
    this.bindPedal(this.root.querySelector("[data-touch-rev]")!, "rev");
    this.bindEdgeButton(this.rangeBtn, () => {
      this.rangeToggle = true;
    });
    this.bindEdgeButton(this.root.querySelector("[data-touch-camera]")!, () => {
      this.cameraToggle = true;
    });
    this.bindEdgeButton(this.root.querySelector("[data-touch-respawn]")!, () => {
      this.respawn = true;
    });

    this.onViewportChange = () => {
      this.syncVisibilityFromViewport();
      this.updateOrientationClass();
    };

    window.addEventListener("orientationchange", this.onViewportChange);
    window.addEventListener("resize", this.onViewportChange);

    parent.appendChild(this.root);
    this.syncVisibilityFromViewport();
    this.updateOrientationClass();
  }

  /** Keep RANGE button label in sync with InputRouter / vehicle. */
  setDriveRange(range: DriveRange): void {
    if (this.lastDriveRange === range) return;
    this.lastDriveRange = range;
    this.rangeBtn.textContent = DRIVE_RANGES[range].label;
    this.rangeBtn.classList.toggle("is-low", range === "L");
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.classList.toggle("is-visible", visible);
    this.root.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  /**
   * Re-append into #ui-root after clearUi() / innerHTML wipes.
   * loadLevel mounts controls early; enter("playing") clears the root.
   */
  reattach(parent: HTMLElement): void {
    if (this.root.parentElement !== parent) {
      parent.appendChild(this.root);
    }
    this.suppressed = false;
    this.syncVisibilityFromViewport();
    this.updateOrientationClass();
  }

  /**
   * Force-hide (result screen) or re-enable RWD auto visibility.
   * While suppressed, resize will not bring controls back.
   */
  setSuppressed(suppressed: boolean): void {
    this.suppressed = suppressed;
    if (suppressed) {
      this.setVisible(false);
    } else {
      this.syncVisibilityFromViewport();
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Re-evaluate RWD breakpoint (no-op while suppressed). */
  syncVisibilityFromViewport(): void {
    if (this.suppressed) {
      this.setVisible(false);
      return;
    }
    this.setVisible(prefersTouchUi());
  }

  sample(): ProviderSample {
    const actions: ProviderSample = {
      throttle: this.throttle,
      steer: this.steer,
      brake: 0,
      rangeToggle: this.rangeToggle,
      cameraToggle: this.cameraToggle,
      respawn: this.respawn,
      lookDeltaX: 0,
      lookDeltaY: 0,
    };
    this.rangeToggle = false;
    this.cameraToggle = false;
    this.respawn = false;
    return actions;
  }

  dispose(): void {
    window.removeEventListener("orientationchange", this.onViewportChange);
    window.removeEventListener("resize", this.onViewportChange);
    this.root.remove();
  }

  private updateOrientationClass(): void {
    // Prefer landscape for dual-thumb layout; portrait shows rotate hint.
    const portrait =
      typeof window !== "undefined" &&
      window.matchMedia?.("(orientation: portrait)")?.matches;
    this.root.classList.toggle("is-portrait", !!portrait);
  }

  private recomputeThrottle(): void {
    if (this.gasDown && !this.revDown) this.throttle = 1;
    else if (this.revDown && !this.gasDown) this.throttle = -1;
    else this.throttle = 0;
  }

  private bindEdgeButton(el: HTMLElement, onPress: () => void): void {
    let activeId: number | null = null;
    const down = (e: PointerEvent) => {
      if (!this.visible) return;
      if (activeId !== null) return;
      e.preventDefault();
      e.stopPropagation();
      activeId = e.pointerId;
      try {
        el.setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      el.classList.add("is-active");
      onPress();
    };
    const up = (e: PointerEvent) => {
      if (activeId !== null && e.pointerId !== activeId) return;
      activeId = null;
      el.classList.remove("is-active");
      try {
        el.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", up);
  }

  private bindPedal(el: HTMLElement, kind: "gas" | "rev"): void {
    const down = (e: PointerEvent) => {
      if (!this.visible) return;
      // Ignore second finger while this pedal is already held.
      if (kind === "gas" && this.gasDown) return;
      if (kind === "rev" && this.revDown) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        el.setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      if (kind === "gas") {
        this.gasPointerId = e.pointerId;
        this.gasDown = true;
      } else {
        this.revPointerId = e.pointerId;
        this.revDown = true;
      }
      el.classList.add("is-active");
      this.recomputeThrottle();
    };
    const up = (e: PointerEvent) => {
      if (kind === "gas") {
        if (this.gasPointerId !== null && e.pointerId !== this.gasPointerId) {
          return;
        }
        this.gasPointerId = null;
        this.gasDown = false;
      } else {
        if (this.revPointerId !== null && e.pointerId !== this.revPointerId) {
          return;
        }
        this.revPointerId = null;
        this.revDown = false;
      }
      el.classList.remove("is-active");
      this.recomputeThrottle();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", up);
  }

  private bindStick(el: HTMLElement): void {
    const down = (e: PointerEvent) => {
      if (!this.visible) return;
      // Keep first thumb; second finger must not steal steer origin.
      if (this.steerPointerId !== null) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        el.setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      this.steerPointerId = e.pointerId;
      const rect = el.getBoundingClientRect();
      this.stickOriginX = rect.left + rect.width / 2;
      this.applyStickX(e.clientX);
      el.classList.add("is-active");
    };
    const move = (e: PointerEvent) => {
      if (this.steerPointerId === null || e.pointerId !== this.steerPointerId) {
        return;
      }
      e.preventDefault();
      this.applyStickX(e.clientX);
    };
    const up = (e: PointerEvent) => {
      if (this.steerPointerId === null || e.pointerId !== this.steerPointerId) {
        return;
      }
      this.steerPointerId = null;
      this.steer = 0;
      this.knobEl.style.transform = "translate(-50%, -50%)";
      el.classList.remove("is-active");
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", up);
  }

  private applyStickX(clientX: number): void {
    const dx = clientX - this.stickOriginX;
    this.steer = stickSteerFromOffset(dx, STICK_RADIUS_PX);
    const visual = Math.max(-STICK_RADIUS_PX, Math.min(STICK_RADIUS_PX, dx));
    this.knobEl.style.transform = `translate(calc(-50% + ${visual}px), -50%)`;
  }
}
