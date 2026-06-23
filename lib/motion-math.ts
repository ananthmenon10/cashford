// Pure easing + interpolation maths for the count-up animation (lib/settlement.ts style: no I/O,
// fully unit-tested). The rAF/DOM wrapper that calls these lives in components/motion.tsx.

// Clamp progress into the unit interval so a late/early frame can't over- or under-shoot.
const clamp01 = (p: number): number => (p < 0 ? 0 : p > 1 ? 1 : p);

// easeOutCubic — fast start, gentle settle. f(0)=0, f(1)=1, monotonically increasing.
export function easeOutCubic(p: number): number {
  return 1 - Math.pow(1 - clamp01(p), 3);
}

// The value to display at progress `p` while rolling from `from` to `to`. Works for negatives
// (a falling net rolls 0 → −N); the sign is the caller's formatter's concern.
export function countUpFrame(from: number, to: number, p: number): number {
  return from + (to - from) * easeOutCubic(p);
}
