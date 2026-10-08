import type { RangeResult } from '@kadat/contracts';

export function resolveRange(distance: number, optimal: number): RangeResult {
  if (!Number.isFinite(distance) || distance < 0.5 || !Number.isFinite(optimal) || optimal <= 0) {
    throw new RangeError('Invalid range input');
  }
  const [band, modifier] =
    distance <= 3
      ? (['point-blank', 30] as const)
      : distance <= optimal / 2
        ? (['short', 10] as const)
        : distance <= optimal * 2
          ? (['optimal', 0] as const)
          : distance <= optimal * 4
            ? (['long', -10] as const)
            : (['extreme', -30] as const);
  return { distance, optimal, band, modifier };
}
