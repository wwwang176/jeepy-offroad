export function normalizeSeed(seed: number): number {
  return seed >>> 0;
}

/** Empty/whitespace => random uint32. Non-integer string throws. */
export function parseSeedInput(raw: string): number {
  const t = raw.trim();
  if (t === "") {
    return (Math.random() * 0x100000000) >>> 0;
  }
  if (!/^-?\d+$/.test(t)) {
    throw new Error(`Invalid seed: ${raw}`);
  }
  return normalizeSeed(Number(t));
}
