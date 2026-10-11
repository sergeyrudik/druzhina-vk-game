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
  try {
    const raw = storage?.getItem(options.storageKey);
    const saved = raw === null || raw === undefined ? NaN : Number(raw);
    if (Number.isFinite(saved) && saved >= 0) lastAnyAdAt = Math.min(saved, now());
  } catch { /* Blocked storage must not block free play. */ }

  const seedLastAdAt = (timestamp: number) => {
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
  const rewardWaitMs = () => lastAnyAdAt === null ? 0 : Math.max(0, AD_INTERVAL_MS - (now() - lastAnyAdAt));

  return {
    startGameplay() {
      if (gameplayStartedAt === null) gameplayStartedAt = now();
    },
    seedLastAdAt,
    rewardWaitMs,
    isBusy: () => busy !== null,
    beginReward() {
      if (busy !== null || rewardWaitMs() > 0) return false;
      busy = "reward";
      return true;
    },
    finishReward(watched: boolean) {
      if (busy !== "reward") return;
      if (watched === true) recordSuccess();
      busy = null;
    },
    async maybeInterstitial(send: AdSend, bridgeReady: boolean): Promise<boolean> {
      const timestamp = now();
      if (!bridgeReady || busy !== null || gameplayStartedAt === null ||
        timestamp - gameplayStartedAt < AD_INTERVAL_MS || rewardWaitMs() > 0 ||
        (lastAttemptAt !== null && timestamp - lastAttemptAt < AD_RETRY_MS)) return false;
      busy = "interstitial";
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
        options.onInterstitialBusyChange?.(false);
      }
    },
  };
}
