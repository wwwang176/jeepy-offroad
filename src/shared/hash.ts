export function hashFloat32Array(data: Float32Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    const buf = new DataView(new ArrayBuffer(4));
    buf.setFloat32(0, data[i], true);
    for (let b = 0; b < 4; b++) {
      h ^= buf.getUint8(b);
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
