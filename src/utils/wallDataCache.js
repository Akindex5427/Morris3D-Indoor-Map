// Share immutable wall exports across the main map and route timeline maps.
// Keep pending requests together; a failed request can be retried on remount.
// Cancellation belongs to each subscriber, not to the shared network request.
export function createWallDataCache(fetcher = (...args) => fetch(...args), limit = 32) {
  const entries = new Map();
  return (url) => {
    if (entries.has(url)) {
      const promise = entries.get(url);
      entries.delete(url);
      entries.set(url, promise);
      return promise;
    }
    const promise = Promise.resolve().then(async () => {
      const response = await fetcher(url);
      if (!response.ok) throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
      return response.json();
    }).catch(error => {
      if (entries.get(url) === promise) entries.delete(url);
      throw error;
    });
    entries.set(url, promise);
    while (entries.size > limit) entries.delete(entries.keys().next().value);
    return promise;
  };
}

export const loadWallData = createWallDataCache();
