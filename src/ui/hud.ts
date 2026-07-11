import { drawMinimap, type MinimapModel } from "./minimap";

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

export interface HudHandles {
  root: HTMLElement;
  minimapCanvas: HTMLCanvasElement;
  minimapCtx: CanvasRenderingContext2D;
  goalArrow: HTMLElement;
  infoEl: HTMLElement;
  gearEl: HTMLElement;
  speedEl: HTMLElement;
  dispose: () => void;
}

const MINIMAP_SIZE = 180;
/** m/s → km/h */
const MPS_TO_KMH = 3.6;

/**
 * Mount play HUD: biome/seed, speed, transfer-case, goal arrow, minimap.
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
        <span class="hud-gear-label">RANGE</span>
        <span class="hud-gear-value">4H</span>
        <span class="hud-gear-hint">Shift</span>
      </div>
    </div>
    <div class="hud-goal" aria-hidden="true">
      <div class="hud-goal-arrow">▲</div>
      <div class="hud-goal-label">FINISH</div>
    </div>
    <canvas class="hud-minimap" width="${MINIMAP_SIZE}" height="${MINIMAP_SIZE}"></canvas>
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

  parent.appendChild(root);

  return {
    root,
    minimapCanvas,
    minimapCtx,
    goalArrow,
    infoEl,
    gearEl,
    speedEl,
    dispose: () => {
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
  return `${biomeId} · seed ${seed}${usedFallback ? " · fallback path" : ""}`;
}
