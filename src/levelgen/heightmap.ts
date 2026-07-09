import type { Vec3 } from "@/shared/types";
import { gridToWorld, idx, worldToGrid } from "@/shared/coords";

export function createHeightmap(resolution: number, fill = 0): Float32Array {
  return new Float32Array(resolution * resolution).fill(fill);
}

export function sampleBilinear(
  heightmap: Float32Array,
  resolution: number,
  worldSize: number,
  x: number,
  z: number,
): number {
  const { col, row, fx, fz } = worldToGrid(x, z, worldSize, resolution);
  const c0 = Math.max(0, Math.min(resolution - 2, col));
  const r0 = Math.max(0, Math.min(resolution - 2, row));
  const h00 = heightmap[idx(resolution, c0, r0)];
  const h10 = heightmap[idx(resolution, c0 + 1, r0)];
  const h01 = heightmap[idx(resolution, c0, r0 + 1)];
  const h11 = heightmap[idx(resolution, c0 + 1, r0 + 1)];
  const h0 = h00 * (1 - fx) + h10 * fx;
  const h1 = h01 * (1 - fx) + h11 * fx;
  return h0 * (1 - fz) + h1 * fz;
}

export function setDisk(
  heightmap: Float32Array,
  resolution: number,
  worldSize: number,
  center: Vec3,
  radius: number,
  y: number,
): void {
  const cell = worldSize / (resolution - 1);
  const rCells = Math.ceil(radius / cell) + 1;
  const { col, row } = worldToGrid(center.x, center.z, worldSize, resolution);
  for (let dr = -rCells; dr <= rCells; dr++) {
    for (let dc = -rCells; dc <= rCells; dc++) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || r < 0 || c >= resolution || r >= resolution) continue;
      const p = gridToWorld(c, r, worldSize, resolution);
      if (Math.hypot(p.x - center.x, p.z - center.z) <= radius) {
        heightmap[idx(resolution, c, r)] = y;
      }
    }
  }
}
