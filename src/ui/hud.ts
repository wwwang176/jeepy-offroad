import { drawMinimap, type MinimapModel } from "./minimap";

export interface HudModel {
  biomeId: string;
  seed: number;
  usedFallback?: boolean;
  worldSize: number;
  player: { x: number; z: number; yaw: number };
  finish: { x: number; z: number };
  checkpoints: { x: number; z: number }[];
}

export interface HudHandles {
  root: HTMLElement;
  minimapCanvas: HTMLCanvasElement;
  minimapCtx: CanvasRenderingContext2D;
  goalArrow: HTMLElement;
  infoEl: HTMLElement;
  dispose: () => void;
}

const MINIMAP_SIZE = 180;

/**
 * Mount play HUD: biome/seed label, goal arrow, and north-up minimap.
 */
export function createHud(
  parent: HTMLElement,
  opts: { biomeId: string; seed: number; usedFallback?: boolean },
): HudHandles {
  const root = document.createElement("div");
  root.className = "hud";
  root.innerHTML = `
    <div class="hud-info panel"></div>
    <div class="hud-goal" aria-hidden="true">
      <div class="hud-goal-arrow">▲</div>
      <div class="hud-goal-label">FINISH</div>
    </div>
    <canvas class="hud-minimap" width="${MINIMAP_SIZE}" height="${MINIMAP_SIZE}"></canvas>
  `;

  const infoEl = root.querySelector<HTMLElement>(".hud-info")!;
  infoEl.textContent = formatInfo(opts.biomeId, opts.seed, opts.usedFallback);

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

  const dx = model.finish.x - model.player.x;
  const dz = model.finish.z - model.player.z;
  // World yaw of vector to finish (yaw 0 = +Z) minus player yaw.
  const toFinishYaw = Math.atan2(dx, dz);
  const rel = toFinishYaw - model.player.yaw;
  hud.goalArrow.style.transform = `rotate(${rel}rad)`;

  const minimapModel: MinimapModel = {
    worldSize: model.worldSize,
    player: model.player,
    finish: model.finish,
    checkpoints: model.checkpoints,
  };
  drawMinimap(hud.minimapCtx, minimapModel);
}

function formatInfo(
  biomeId: string,
  seed: number,
  usedFallback?: boolean,
): string {
  return `${biomeId} · seed ${seed}${usedFallback ? " · fallback path" : ""}`;
}
