export const AD_INTERVAL_MS = 180_000;
export const AD_RETRY_MS = 60_000;

type AdSend = (
  method: "VKWebAppCheckNativeAds" | "VKWebAppShowNativeAds",
  params: { ad_format: "interstitial" },
) => Promise<unknown>;

type AdStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type PolicyOptions = {
  storageKey: string;
  now?: () => number;
  storage?: AdStorage | null;
  locks?: Pick<LockManager, "request"> | null;
  settle?: () => Promise<void>;
  onInterstitialBusyChange?: (busy: boolean) => void;
};

function succeeded(response: unknown): boolean {
  return typeof response === "object" && response !== null &&
    "result" in response && response.result === true;
}

/** Event-gated ads: elapsed time alone never starts a presentation. */
export function createAdPolicy(options: PolicyOptions) {
  const now = options.now ?? Date.now;
  let storage: AdStorage | null = options.storage ?? null;
  if (options.storage === undefined) {
    try { storage = typeof localStorage === "undefined" ? null : localStorage; } catch { /* Storage is optional. */ }
  }
  let gameplayStartedAt: number | null = null;
  let lastAnyAdAt: number | null = null;
  let lastAttemptAt: number | null = null;
  let busy: "reward" | "interstitial" | null = null;
  let releaseGate: (() => void) | null = null;
  const locks = options.locks === undefined ? (typeof navigator !== "undefined" ? navigator.locks : undefined) : options.locks;
  const refreshLastAdAt = () => {
    try {
      const raw = storage?.getItem(options.storageKey);
      const saved = raw == null ? NaN : Number(raw);
      if (Number.isFinite(saved) && saved >= 0) lastAnyAdAt = Math.max(lastAnyAdAt ?? 0, Math.min(saved, now()));
    } catch { /* Free play remains available when persistence is blocked. */ }
  };
  refreshLastAdAt();

  const acquireGate = async (): Promise<boolean> => {
    if (locks) {
      return new Promise<boolean>((resolve) => {
        try {
          void locks.request(`${options.storageKey}:presentation`, { ifAvailable: true }, async (lock) => {
            if (!lock) { resolve(false); return; }
            await new Promise<void>((release) => { releaseGate = release; resolve(true); });
          }).catch(() => resolve(false));
        } catch { resolve(false); }
      });
    }
    // Unsupported Web Locks: a settled, renewable nonce lease cooperates across
    // tabs. With no usable shared storage, decline ads rather than overlap SDKs.
    if (!storage) return false;
    const key = `${options.storageKey}:lease`;
    const nonce = `${now()}:${Math.random()}:${Math.random()}`;
    const read = () => { try { return JSON.parse(storage!.getItem(key) ?? "null") as { nonce: string; until: number } | null; } catch { return null; } };
    try {
      const previous = read();
      if (previous && previous.until > now()) return false;
      storage.setItem(key, JSON.stringify({ nonce, until: now() + 300_000 }));
      await (options.settle ? options.settle() : new Promise<void>((resolve) => setTimeout(resolve, 35)));
      if (read()?.nonce !== nonce) return false;
      const renew = () => { if (read()?.nonce === nonce) { try { storage!.setItem(key, JSON.stringify({ nonce, until: now() + 300_000 })); } catch { /* Optional. */ } } };
      const timer = typeof window === "undefined" ? null : setInterval(renew, 30_000);
      releaseGate = () => {
        if (timer !== null) clearInterval(timer);
        if (read()?.nonce === nonce) { try { storage!.setItem(key, "null"); } catch { /* Expiry recovers it. */ } }
      };
      return true;
    } catch { return false; }
  };
  const release = () => { const finish = releaseGate; releaseGate = null; finish?.(); };

  const seedLastAdAt = (timestamp: number) => {
    refreshLastAdAt();
    if (!Number.isFinite(timestamp) || timestamp <= 0) return;
    const safe = Math.min(timestamp, now());
    if (lastAnyAdAt === null || safe > lastAnyAdAt) {
      lastAnyAdAt = safe;
      try { storage?.setItem(options.storageKey, String(lastAnyAdAt)); } catch { /* Optional persistence. */ }
    }
  };
  const recordSuccess = () => {
    lastAnyAdAt = now();
    try { storage?.setItem(options.storageKey, String(lastAnyAdAt)); } catch { /* Optional persistence. */ }
  };
  const rewardWaitMs = () => { refreshLastAdAt(); return lastAnyAdAt === null ? 0 : Math.max(0, AD_INTERVAL_MS - (now() - lastAnyAdAt)); };

  return {
    startGameplay() {
      if (gameplayStartedAt === null) gameplayStartedAt = now();
    },
    seedLastAdAt,
    rewardWaitMs,
    isBusy: () => busy !== null,
    async beginReward(): Promise<boolean> {
      if (busy !== null || rewardWaitMs() > 0) return false;
      busy = "reward";
      if (!(await acquireGate())) { busy = null; return false; }
      if (busy !== "reward" || rewardWaitMs() > 0) { release(); busy = null; return false; }
      return true;
    },
    finishReward(watched: boolean) {
      if (busy !== "reward") return;
      if (watched === true) recordSuccess();
      busy = null;
      release();
    },
    async maybeInterstitial(send: AdSend, bridgeReady: boolean): Promise<boolean> {
      const timestamp = now();
      if (!bridgeReady || busy !== null || gameplayStartedAt === null ||
        timestamp - gameplayStartedAt < AD_INTERVAL_MS || rewardWaitMs() > 0 ||
        (lastAttemptAt !== null && timestamp - lastAttemptAt < AD_RETRY_MS)) return false;
      busy = "interstitial";
      if (!(await acquireGate())) { busy = null; return false; }
      if (rewardWaitMs() > 0) { release(); busy = null; return false; }
      lastAttemptAt = timestamp;
      options.onInterstitialBusyChange?.(true);
      try {
        const available = await send("VKWebAppCheckNativeAds", { ad_format: "interstitial" });
        if (!succeeded(available)) return false;
        const shown = await send("VKWebAppShowNativeAds", { ad_format: "interstitial" });
        if (!succeeded(shown)) return false;
        recordSuccess();
        return true;
      } catch {
        // Cancel, unavailable inventory, and SDK errors always leave free play available.
        return false;
      } finally {
        lastAttemptAt = now();
        busy = null;
        release();
        options.onInterstitialBusyChange?.(false);
      }
    },
  };
}
