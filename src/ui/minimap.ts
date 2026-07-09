export interface MinimapModel {
  worldSize: number;
  player: { x: number; z: number; yaw: number };
  finish: { x: number; z: number };
  checkpoints: { x: number; z: number }[];
  /** Optional route (world XZ). */
  path?: { x: number; z: number }[];
}

/**
 * Heading-up bird's-eye minimap.
 *
 * Player at center, nose always up. World in vehicle frame:
 *   localRight  =  (dx, dz) · (cos ψ, −sin ψ)
 *   localFwd    =  (dx, dz) · (sin ψ,  cos ψ)
 *
 * Empirically (yaw≈0, object on vehicle +X): must use **−localRight** on
 * canvas X so vehicle-right lands on screen-right (was mirrored / “from below”).
 * Forward still maps to screen up via −localFwd (canvas Y grows down).
 *
 * Left turn: ahead swings toward screen-right when spin feels correct with this basis.
 */
export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  model: MinimapModel,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const pad = 8;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const cx = pad + innerW * 0.5;
  const cy = pad + innerH * 0.5;
  const scale = Math.min(innerW, innerH) / model.worldSize;

  const yaw = model.player.yaw;
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const px0 = model.player.x;
  const pz0 = model.player.z;

  /** World XZ → canvas (heading-up; L/R un-mirrored per in-game check). */
  const toMap = (x: number, z: number) => {
    const dx = x - px0;
    const dz = z - pz0;
    const localRight = dx * cosY - dz * sinY;
    const localFwd = dx * sinY + dz * cosY;
    return {
      // Flip lateral: vehicle-right → screen-right (user verified yaw≈0)
      px: cx - localRight * scale,
      py: cy - localFwd * scale,
    };
  };

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#3a3a3a";
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(pad, pad, innerW, innerH);
  ctx.clip();

  ctx.fillStyle = "#5a6a4a";
  ctx.fillRect(pad, pad, innerW, innerH);

  const path = model.path;
  if (path && path.length >= 2) {
    ctx.strokeStyle = "rgba(200, 190, 150, 0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const p0 = toMap(path[0]!.x, path[0]!.z);
    ctx.moveTo(p0.px, p0.py);
    for (let i = 1; i < path.length; i++) {
      const pt = toMap(path[i]!.x, path[i]!.z);
      ctx.lineTo(pt.px, pt.py);
    }
    ctx.stroke();
  }

  ctx.fillStyle = "#fc3";
  for (const c of model.checkpoints) {
    const p = toMap(c.x, c.z);
    ctx.beginPath();
    ctx.arc(p.px, p.py, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  const f = toMap(model.finish.x, model.finish.z);
  ctx.fillStyle = "#0f0";
  ctx.fillRect(f.px - 4, f.py - 4, 8, 8);

  ctx.restore();

  // Player always center, nose up
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(4, 5);
  ctx.lineTo(-4, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.lineWidth = 1;
  ctx.strokeRect(pad + 0.5, pad + 0.5, innerW - 1, innerH - 1);
}
