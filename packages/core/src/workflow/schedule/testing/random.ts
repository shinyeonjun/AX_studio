/** Deterministic PRNG for property tests (tests only). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Fixed seeds 1..n; AX_SCHEDULE_SEEDS overrides n for longer local runs. */
export function seedList(defaultCount: number): number[] {
  const configured = Number(process.env.AX_SCHEDULE_SEEDS);
  const count = Number.isSafeInteger(configured) && configured > 0 ? configured : defaultCount;
  return Array.from({ length: count }, (_, index) => index + 1);
}
