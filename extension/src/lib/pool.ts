/** Run `fn` over `items` with a bounded concurrency pool, preserving input order. */
export async function runPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length || 1) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) break;
        results[i] = await fn(items[i]!, i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
