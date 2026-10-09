/** Deterministic currency split in the smallest NPR unit (paisa). */
export function splitMoneyEvenly(total: number, count: number): number[] {
  if (!Number.isInteger(count) || count < 2) throw new Error('Split count must be at least 2');
  const totalCents = Math.round((Number(total) + Number.EPSILON) * 100);
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, index) => (base + (index >= count - remainder ? 1 : 0)) / 100);
}

export function sumMoney(values: number[]): number {
  return Math.round((values.reduce((sum, value) => sum + value, 0) + Number.EPSILON) * 100) / 100;
}
