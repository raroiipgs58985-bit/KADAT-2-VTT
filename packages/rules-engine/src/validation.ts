export function integer(value: number, name: string, minimum?: number): void {
  if (!Number.isSafeInteger(value) || (minimum !== undefined && value < minimum)) {
    throw new RangeError(`Invalid ${name}: ${value}`);
  }
}

export function uniqueIds(ids: readonly string[], name: string): void {
  if (ids.some((id) => id.length === 0) || new Set(ids).size !== ids.length) {
    throw new Error(`Empty or duplicate ${name}`);
  }
}

/** Code-point ordering does not depend on the host locale. */
export function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
