const valueCache = new Map<string, { expiresAt: number; value: unknown }>();
const inflightCache = new Map<string, Promise<unknown>>();

export async function getCachedValue<T>(key: string, ttlMs: number, factory: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const existing = valueCache.get(key);

  if (existing && existing.expiresAt > now) {
    return existing.value as T;
  }

  const inflight = inflightCache.get(key);
  if (inflight) {
    return inflight as Promise<T>;
  }

  const nextPromise = factory()
    .then((value) => {
      valueCache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
      });
      inflightCache.delete(key);
      return value;
    })
    .catch((error) => {
      inflightCache.delete(key);
      throw error;
    });

  inflightCache.set(key, nextPromise);
  return nextPromise;
}

export function invalidateCachedValue(key: string) {
  valueCache.delete(key);
  inflightCache.delete(key);
}
