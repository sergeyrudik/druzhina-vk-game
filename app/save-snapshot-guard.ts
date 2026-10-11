type Options<T> = {
  storageKey: string;
  read: () => string | null;
  write: (value: string) => boolean;
  parse: (value: string | null) => T | null;
  serialize: (save: T) => string;
};

// A render snapshot is not a transaction. Never give an old tab a newer timestamp
// after another tab changed storage. Native Web Locks serialize these writers;
// without them the exact-raw check still rejects already observed stale saves.
export function createSaveSnapshotGuard<T>(options: Options<T>) {
  let observed = options.read();
  let revision = 0;
  let forceNextCommit = false;
  const initialize = (raw: string | null, forceCommit = false) => {
    observed = raw; revision += 1; forceNextCommit = forceCommit;
  };
  const refresh = (): T | null => {
    const raw = options.read();
    if (raw === observed) return null;
    observed = raw;
    revision += 1;
    forceNextCommit = false;
    return options.parse(raw);
  };
  const latest = (): T | null => options.parse(options.read());
  const content = (value: unknown, root = true): unknown => {
    if (Array.isArray(value)) return value.map((entry) => content(entry, false));
    if (!value || typeof value !== "object") return value;
    const object = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort()
      .filter((key) => !root || key !== "updatedAt")
      .map((key) => [key, content(object[key], false)]));
  };
  const persist = async (save: T, expectedRevision = revision) => {
    const run = async () => {
      const external = refresh();
      if (external) return { value: null, external };
      if (expectedRevision !== revision) return { value: null, external: latest() };
      const candidate = JSON.parse(options.serialize(save)) as Record<string, unknown>;
      const previous = observed ? options.parse(observed) : null;
      // Storage adoption produces a render, not another gameplay action. Do not
      // bounce the same save between tabs merely to refresh its timestamp.
      if (!forceNextCommit && previous &&
          JSON.stringify(content(candidate)) === JSON.stringify(content(previous))) {
        return { value: null, external: null };
      }
      const oldTimestamp = previous && typeof previous === "object"
        ? (previous as Record<string, unknown>).updatedAt : 0;
      const safeTimestamp = typeof oldTimestamp === "number" && Number.isSafeInteger(oldTimestamp)
        && oldTimestamp >= 0 ? Math.min(Number.MAX_SAFE_INTEGER, oldTimestamp + 1) : 0;
      candidate.updatedAt = Math.max(typeof candidate.updatedAt === "number" ? candidate.updatedAt : 0, safeTimestamp);
      const value = JSON.stringify(candidate);
      const localWritten = options.write(value);
      if (localWritten) observed = value;
      forceNextCommit = false;
      return { value, external: null, localWritten };
    };
    if (typeof navigator !== "undefined" && navigator.locks?.request) {
      return navigator.locks.request(`${options.storageKey}:write`, run);
    }
    return run();
  };
  return { initialize, refresh, latest, persist, revision: () => revision,
    isCurrentValue: (value: string) => options.read() === value };
}
