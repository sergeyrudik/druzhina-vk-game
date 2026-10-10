type BridgeClient = {
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
};

const TIMED_METHODS = new Set([
  "VKWebAppSetViewSettings",
  "VKWebAppGetUserInfo",
  "VKWebAppStorageGet",
  "VKWebAppStorageSet",
  "VKWebAppCheckNativeAds",
]);

export function withBridgeTimeout<T>(promise: Promise<T>, timeoutMs = 1800): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("VK Bridge timeout")), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export function createVkBridge<T extends BridgeClient>(client: T, timeoutMs = 1800): T {
  type Waiter = {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timer?: ReturnType<typeof setTimeout>;
  };
  type WriteJob = { params: Record<string, unknown>; waiters: Set<Waiter> };
  type WriteQueue = { pending: WriteJob | null };
  const writes = new Map<string, WriteQueue>();
  let showingAd = false;

  const drainWrites = async (key: string, queue: WriteQueue) => {
    while (queue.pending) {
      const job = queue.pending;
      queue.pending = null;
      try {
        // Keep serialization tied to the actual VK response: a timeout cannot cancel a write.
        const result = await client.send("VKWebAppStorageSet", job.params);
        for (const waiter of job.waiters) {
          clearTimeout(waiter.timer);
          waiter.resolve(result);
        }
      } catch (error) {
        for (const waiter of job.waiters) {
          clearTimeout(waiter.timer);
          waiter.reject(error);
        }
      }
    }
    writes.delete(key);
  };

  const enqueueWrite = (params: Record<string, unknown>) => {
    const key = String(params.key);
    const existing = writes.get(key);
    const queue = existing ?? { pending: null };
    const job = queue.pending ?? { params, waiters: new Set<Waiter>() };
    job.params = params;
    queue.pending = job;
    writes.set(key, queue);
    const result = new Promise<unknown>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      waiter.timer = setTimeout(() => {
        job.waiters.delete(waiter);
        reject(new Error("VK Bridge timeout"));
      }, timeoutMs);
      job.waiters.add(waiter);
    });
    if (!existing) void drainWrites(key, queue);
    return result;
  };

  return {
    ...client,
    async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
      if (method === "VKWebAppStorageSet" && params && typeof params.key === "string") {
        return enqueueWrite(params);
      }
      if (method === "VKWebAppShowNativeAds") {
        if (showingAd) throw new Error("An advertisement is already open");
        showingAd = true;
        try {
          return await client.send(method, params);
        } finally {
          showingAd = false;
        }
      }
      const request = client.send(method, params);
      return TIMED_METHODS.has(method) ? withBridgeTimeout(request, timeoutMs) : request;
    },
  };
}

export function readStoredValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStoredValue(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
