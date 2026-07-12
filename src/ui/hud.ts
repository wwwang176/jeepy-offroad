import { drawMinimap, type MinimapModel } from "./minimap";
import { biomeDisplayName, t } from "@/i18n";

export interface HudModel {
  biomeId: string;
  seed: number;
  usedFallback?: boolean;
  /** Transfer-case label, e.g. "4H" / "4L". */
  driveLabel?: string;
  /** Ground speed in m/s (converted to km/h for display). */
  speedMps?: number;
  worldSize: number;
  player: { x: number; z: number; yaw: number };
  finish: { x: number; z: number };
  checkpoints: { x: number; z: number }[];
  path?: { x: number; z: number }[];
}

export interface HudHandlers {
  /** Confirmed leave to main menu (after abandon modal). */
  onQuitToMenu: () => void;
  /** Modal open/close — pause drive / suppress touch while open. */
  onQuitModalChange?: (open: boolean) => void;
}

export interface HudHandles {
  root: HTMLElement;
  minimapCanvas: HTMLCanvasElement;
  minimapCtx: CanvasRenderingContext2D;
  goalArrow: HTMLElement;
  infoEl: HTMLElement;
  gearEl: HTMLElement;
  speedEl: HTMLElement;
  menuBtn: HTMLButtonElement;
  openQuitModal: () => void;
  closeQuitModal: () => void;
  isQuitModalOpen: () => boolean;
  dispose: () => void;
}

const MINIMAP_SIZE = 180;
/** m/s → km/h */
const MPS_TO_KMH = 3.6;

/**
 * Mount play HUD: biome/seed, speed, transfer-case, goal arrow, minimap,
 * menu button (left of map) + quit-confirm modal.
 */
export function createHud(
  parent: HTMLElement,
  opts: {
    biomeId: string;
    seed: number;
    usedFallback?: boolean;
    driveLabel?: string;
    speedMps?: number;
  },
  handlers?: HudHandlers,
): HudHandles {
  const root = document.createElement("div");
  root.className = "hud";
  root.innerHTML = `
    <div class="hud-info panel"></div>
    <div class="hud-drive">
      <div class="hud-speed panel" aria-live="off">
        <span class="hud-speed-value">0</span>
        <span class="hud-speed-unit">km/h</span>
      </div>
      <div class="hud-gear panel" aria-live="polite" title="Shift or RANGE: toggle 4H / 4L">
        <span class="hud-gear-label">${t("hud.range")}</span>
        <span class="hud-gear-value">4H</span>
        <span class="hud-gear-hint">Shift</span>
      </div>
    </div>
    <div class="hud-goal" aria-hidden="true">
      <div class="hud-goal-arrow">▲</div>
      <div class="hud-goal-label">${t("hud.finish")}</div>
    </div>
    <button type="button" class="hud-menu-btn" id="hud-menu-btn">${t("hud.menu")}</button>
    <canvas class="hud-minimap" width="${MINIMAP_SIZE}" height="${MINIMAP_SIZE}"></canvas>
    <div
      class="hud-quit-modal"
      id="hud-quit-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hud-quit-title"
      hidden
    >
      <div class="hud-quit-panel panel modal-panel">
        <h2 class="modal-title" id="hud-quit-title">${t("hud.quit.title")}</h2>
        <p class="hud-quit-copy">${t("hud.quit.copy")}</p>
        <div class="hud-quit-actions">
          <button type="button" class="hud-quit-stay" id="hud-quit-stay">${t("hud.quit.stay")}</button>
          <button type="button" class="btn-ghost hud-quit-leave" id="hud-quit-leave">${t("hud.quit.leave")}</button>
        </div>
      </div>
    </div>
  `;

  const infoEl = root.querySelector<HTMLElement>(".hud-info")!;
  infoEl.textContent = formatInfo(opts.biomeId, opts.seed, opts.usedFallback);

  const gearEl = root.querySelector<HTMLElement>(".hud-gear")!;
  const speedEl = root.querySelector<HTMLElement>(".hud-speed")!;
  setGearDisplay(gearEl, opts.driveLabel || "4H");
  setSpeedDisplay(speedEl, opts.speedMps ?? 0);

  const goalArrow = root.querySelector<HTMLElement>(".hud-goal-arrow")!;
  const minimapCanvas = root.querySelector<HTMLCanvasElement>(".hud-minimap")!;
  const minimapCtx = minimapCanvas.getContext("2d");
  if (!minimapCtx) throw new Error("2D context unavailable for minimap");

  const menuBtn = root.querySelector<HTMLButtonElement>("#hud-menu-btn")!;
  const quitModal = root.querySelector<HTMLElement>("#hud-quit-modal")!;
  const stayBtn = root.querySelector<HTMLButtonElement>("#hud-quit-stay")!;
  const leaveBtn = root.querySelector<HTMLButtonElement>("#hud-quit-leave")!;

  let quitOpen = false;

  const setQuitOpen = (open: boolean): void => {
    if (quitOpen === open) return;
    quitOpen = open;
    quitModal.hidden = !open;
    quitModal.classList.toggle("is-open", open);
    handlers?.onQuitModalChange?.(open);
    if (open) {
      // Prefer stay so Enter doesn't leave by accident
      requestAnimationFrame(() => stayBtn.focus());
    }
  };

  const openQuitModal = (): void => setQuitOpen(true);
  const closeQuitModal = (): void => setQuitOpen(false);

  menuBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    openQuitModal();
  });
  stayBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    closeQuitModal();
  });
  leaveBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    closeQuitModal();
    handlers?.onQuitToMenu?.();
  });
  quitModal.addEventListener("click", (ev) => {
    if (ev.target === quitModal) closeQuitModal();
  });

  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key !== "Escape") return;
    // Only handle while this HUD is mounted (playing / sandbox).
    if (!root.isConnected) return;
    ev.preventDefault();
    if (quitOpen) closeQuitModal();
    else openQuitModal();
  };
  window.addEventListener("keydown", onKeyDown);

  parent.appendChild(root);

  return {
    root,
    minimapCanvas,
    minimapCtx,
    goalArrow,
    infoEl,
    gearEl,
    speedEl,
    menuBtn,
    openQuitModal,
    closeQuitModal,
    isQuitModalOpen: () => quitOpen,
    dispose: () => {
      window.removeEventListener("keydown", onKeyDown);
      if (quitOpen) {
        quitOpen = false;
        handlers?.onQuitModalChange?.(false);
      }
      root.remove();
    },
  };
}

export function updateHud(hud: HudHandles, model: HudModel): void {
  hud.infoEl.textContent = formatInfo(
    model.biomeId,
    model.seed,
    model.usedFallback,
  );
  setGearDisplay(hud.gearEl, model.driveLabel || "4H");
  setSpeedDisplay(hud.speedEl, model.speedMps ?? 0);

  // Vehicle-local bearing to finish (same basis as minimap).
  //   localRight = (dx,dz)·(cos ψ, −sin ψ)
  //   localFwd   = (dx,dz)·(sin ψ,  cos ψ)
  // CSS rotate + = clockwise. Match minimap lateral sign (−localRight =
  // screen-right) so finish on the right rotates the ▲ to the right.
  const dx = model.finish.x - model.player.x;
  const dz = model.finish.z - model.player.z;
  const yaw = model.player.yaw;
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const localRight = dx * cosY - dz * sinY;
  const localFwd = dx * sinY + dz * cosY;
  const rel = Math.atan2(-localRight, localFwd);
  // scaleX after rotate in matrix terms: thin the glyph on local X, then spin.
  hud.goalArrow.style.transform = `rotate(${rel}rad) scaleX(0.5)`;

  const minimapModel: MinimapModel = {
    worldSize: model.worldSize,
    player: model.player,
    finish: model.finish,
    checkpoints: model.checkpoints,
    path: model.path,
  };
  drawMinimap(hud.minimapCtx, minimapModel);
}

/** Update speed + transfer-case (level + sandbox). */
export function updateHudDrive(
  hud: HudHandles,
  opts: { driveLabel: string; speedMps: number },
): void {
  setGearDisplay(hud.gearEl, opts.driveLabel || "4H");
  setSpeedDisplay(hud.speedEl, opts.speedMps);
}

/** @deprecated use updateHudDrive */
export function updateHudGear(hud: HudHandles, driveLabel: string): void {
  setGearDisplay(hud.gearEl, driveLabel || "4H");
}

export function speedMpsToKmh(mps: number): number {
  return Math.max(0, mps) * MPS_TO_KMH;
}

function setGearDisplay(gearEl: HTMLElement, label: string): void {
  const value = gearEl.querySelector<HTMLElement>(".hud-gear-value");
  if (value) value.textContent = label;
  gearEl.dataset.range = label === "4L" ? "L" : "H";
  gearEl.classList.toggle("hud-gear--low", label === "4L");
}

function setSpeedDisplay(speedEl: HTMLElement, speedMps: number): void {
  const value = speedEl.querySelector<HTMLElement>(".hud-speed-value");
  if (!value) return;
  const kmh = Math.round(speedMpsToKmh(speedMps));
  value.textContent = String(kmh);
  // Mild emphasis when moving
  speedEl.classList.toggle("hud-speed--moving", kmh >= 3);
}

function formatInfo(
  biomeId: string,
  seed: number,
  usedFallback?: boolean,
): string {
  const biome = biomeDisplayName(biomeId);
  const key = usedFallback ? "hud.info.fallback" : "hud.info";
  return t(key, { biome, seed });
}
