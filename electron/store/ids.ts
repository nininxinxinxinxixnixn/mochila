/**
 * Stable, dependency-free id generator for clipboard items.
 *
 * Combines a monotonic timestamp with random entropy — good enough for a
 * single-machine local store and avoids a uuid dependency.
 */
export function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
