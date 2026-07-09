export interface MinimapModel {
  worldSize: number;
  player: { x: number; z: number; yaw: number };
  finish: { x: number; z: number };
  checkpoints: { x: number; z: number }[];
}

export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  model: MinimapModel,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const pad = 8;
  const half = model.worldSize / 2;
  const toMap = (x: number, z: number) => {
    const u = (x + half) / model.worldSize;
    const v = (z + half) / model.worldSize;
    return {
      px: pad + u * (w - pad * 2),
      // north-up: +Z toward top => invert v
      py: pad + (1 - v) * (h - pad * 2),
    };
  };

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#3a3a3a";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#5a6a4a";
  ctx.fillRect(pad, pad, w - pad * 2, h - pad * 2);

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

  const p = toMap(model.player.x, model.player.z);
  ctx.save();
  ctx.translate(p.px, p.py);
  // yaw 0 = +Z = up on minimap; screen up is -Y so rotate -yaw
  ctx.rotate(-model.player.yaw);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(4, 5);
  ctx.lineTo(-4, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
