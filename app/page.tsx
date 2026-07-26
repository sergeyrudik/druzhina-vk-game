"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import bridge from "@vkontakte/vk-bridge";
import Link from "next/link";
import {
  MAX_WAVE,
  UNIT_DATA,
  canMergeUnits,
  cloneInitialUnits,
  createDefaultSave,
  createWave,
  getCampaignProfile,
  getLocalDateKey,
  getMaxCastleHp,
  getNextId,
  getRecruitCost,
  getStartingCoins,
  getTotalPower,
  getUnitPower,
  getUpgradeCost,
  getWaveBalance,
  getWaveReward,
  healCastle,
  mergeOrMove,
  migrateSave,
  selectNewestSave,
  serializeSave,
  type DailyProgress,
  type Enemy,
  type GameSave,
  type GameStats,
  type RewardLimits,
  type Unit,
  type UnitKind,
  type Upgrades,
} from "./game-engine";

type VKUser = { id?: number; first_name: string; photo_100?: string };
type VKEvent = { detail?: { type?: string } };
type VKBridge = {
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  subscribe?: (handler: (event: VKEvent) => void) => void;
  unsubscribe?: (handler: (event: VKEvent) => void) => void;
};
type GameTab = "campaign" | "camp" | "quests" | "rating";
type DailyField = "merge" | "recruit" | "wave";
type UpgradeKey = keyof Upgrades;

const SAVE_KEY = "druzhina-save-v2";
const LEGACY_SAVE_KEY = "druzhina-save-v1";
const VK_SAVE_KEY = "druzhina_save";
const REWARD_COINS = 75;
const REWARD_COOLDOWN_MS = 3 * 60 * 1000;
const REWARD_DAILY_LIMIT = 8;
const INTERSTITIAL_INTERVAL_MS = 3 * 60 * 1000;
const VK_APP_URL = "https://vk.com/app54694176";

const enemyIcon = { goblin: "👺", wolf: "🐺", troll: "👹" };

const UNIT_ROLES: Record<UnitKind, { title: string; short: string; description: string }> = {
  sword: {
    title: "Натиск",
    short: "сильнее вблизи",
    description: "Ратники наносят усиленный урон врагам, подошедшим к стенам.",
  },
  bow: {
    title: "Дальний бой",
    short: "атакует раньше",
    description: "Лучники начинают обстрел до того, как враги входят в ближний бой.",
  },
  mage: {
    title: "Чародейство",
    short: "урон по площади",
    description: "Волхвы задевают магией второго врага в зоне атаки.",
  },
  guard: {
    title: "Защита стен",
    short: "снижает урон",
    description: "Стражи уменьшают урон, который прорвавшиеся враги наносят городу.",
  },
};

const DAILY_QUESTS: Array<{
  id: string;
  field: DailyField;
  target: number;
  title: string;
  description: string;
  reward: { coins?: number; crystals?: number };
}> = [
  {
    id: "merge",
    field: "merge",
    target: 3,
    title: "Кузнечное дело",
    description: "Объедини 3 пары бойцов",
    reward: { coins: 80 },
  },
  {
    id: "recruit",
    field: "recruit",
    target: 2,
    title: "Новые знамена",
    description: "Призови 2 бойцов",
    reward: { crystals: 2 },
  },
  {
    id: "wave",
    field: "wave",
    target: 3,
    title: "Несокрушимая стена",
    description: "Отбей 3 волны",
    reward: { coins: 100 },
  },
];

const UPGRADE_DATA: Record<
  UpgradeKey,
  { icon: string; title: string; description: string; bonus: (level: number) => string }
> = {
  forge: {
    icon: "⚒️",
    title: "Кузница",
    description: "Увеличивает силу всех бойцов",
    bonus: (level) => `+${level * 8}% к силе`,
  },
  walls: {
    icon: "🏰",
    title: "Крепостные стены",
    description: "Повышают максимальную прочность города",
    bonus: (level) => `+${level * 10} прочности`,
  },
  treasury: {
    icon: "🪙",
    title: "Казна",
    description: "Даёт больше монет в начале нового похода",
    bonus: (level) => `+${level * 20} монет`,
  },
};

function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("VK Bridge timeout")), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function findMergePair(units: Array<Unit | null>): [number, number] | null {
  for (let source = 0; source < units.length; source += 1) {
    for (let target = source + 1; target < units.length; target += 1) {
      if (canMergeUnits(units[source], units[target])) return [source, target];
    }
  }
  return null;
}

export default function Home() {
  const defaults = useMemo(() => createDefaultSave(), []);
  const [units, setUnits] = useState<Array<Unit | null>>(defaults.units);
  const [coins, setCoins] = useState(defaults.coins);
  const [crystals, setCrystals] = useState(defaults.crystals);
  const [wave, setWave] = useState(defaults.wave);
  const [castleHp, setCastleHp] = useState(defaults.castleHp);
  const [campaign, setCampaign] = useState(defaults.campaign);
  const [sound, setSound] = useState(defaults.sound);
  const [tutorialDone, setTutorialDone] = useState(defaults.tutorialDone);
  const [upgrades, setUpgrades] = useState<Upgrades>(defaults.upgrades);
  const [stats, setStats] = useState<GameStats>(defaults.stats);
  const [daily, setDaily] = useState<DailyProgress>(defaults.daily);
  const [rewards, setRewards] = useState<RewardLimits>(defaults.rewards);

  const [enemies, setEnemies] = useState<Enemy[]>([]);
  const [selected, setSelected] = useState<number | null>(0);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [message, setMessage] = useState("Нажми на второго ратника ⚔️");
  const [showHelp, setShowHelp] = useState(false);
  const [showStart, setShowStart] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showResources, setShowResources] = useState<"coins" | "crystals" | null>(null);
  const [victory, setVictory] = useState(false);
  const [defeat, setDefeat] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [activeTab, setActiveTab] = useState<GameTab>("campaign");
  const [tutorialStep, setTutorialStep] = useState<0 | 1 | 2>(0);
  const [bossWave, setBossWave] = useState(false);
  const [vkUser, setVkUser] = useState<VKUser | null>(null);
  const [vkReady, setVkReady] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [adBusy, setAdBusy] = useState(false);
  const [adAvailable, setAdAvailable] = useState<boolean | null>(null);
  const [adStatus, setAdStatus] = useState("");
  const [clock, setClock] = useState(0);

  const nextId = useRef(20);
  const enemiesRef = useRef<Enemy[]>([]);
  const battleTimer = useRef<number | null>(null);
  const bridgeRef = useRef<VKBridge | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const latestSaveRef = useRef<GameSave>(defaults);
  const sessionStartedAt = useRef(0);
  const lastInterstitialAt = useRef(0);
  const adBusyRef = useRef(false);
  const interstitialBusyRef = useRef(false);
  const lastAdCheckAt = useRef(0);
  const battleLootRef = useRef(0);
  const cloudSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const modalReturnFocusRef = useRef<HTMLElement | null>(null);

  const maxCastleHp = useMemo(() => getMaxCastleHp(upgrades.walls), [upgrades.walls]);
  const totalPower = useMemo(() => getTotalPower(units, upgrades.forge), [units, upgrades.forge]);
  const campaignProfile = useMemo(() => getCampaignProfile(campaign), [campaign]);
  const waveBalance = useMemo(() => getWaveBalance(wave, campaign), [campaign, wave]);
  const combatProfile = useMemo(() => {
    const byKind = units.reduce<Record<UnitKind, number>>(
      (totals, unit) => {
        if (unit) totals[unit.kind] += getUnitPower(unit, upgrades.forge);
        return totals;
      },
      { sword: 0, bow: 0, mage: 0, guard: 0 },
    );
    const safePower = Math.max(1, totalPower);
    const guardRanks = units.reduce(
      (sum, unit) => sum + (unit?.kind === "guard" ? unit.level : 0),
      0,
    );
    return {
      byKind,
      rangedShare: (byKind.bow + byKind.mage) / safePower,
      mageShare: byKind.mage / safePower,
      swordShare: byKind.sword / safePower,
      wallReduction: Math.min(0.42, guardRanks * 0.045),
    };
  }, [totalPower, units, upgrades.forge]);
  const mergePair = findMergePair(units);
  const selectedUnit = selected === null ? null : units[selected];
  const recommendedPower = Math.round(
    21 + wave * 7.5 + (campaignProfile.healthMultiplier - 1) * 32 + (waveBalance.isBossWave ? 15 : 0),
  );
  const readiness =
    totalPower >= recommendedPower * 1.12
      ? { label: "Преимущество", className: "strong" }
      : totalPower >= recommendedPower * 0.82
        ? { label: "Равный бой", className: "even" }
        : { label: "Высокий риск", className: "danger" };
  const recruitCost = getRecruitCost(wave);
  const overlayPause = showStart || showSettings || Boolean(showResources) || showHelp || showResult || adBusy;

  const playSound = useCallback(
    (kind: "tap" | "merge" | "battle" | "win" | "error") => {
      if (!sound || typeof window === "undefined") return;
      try {
        const context = audioContextRef.current ?? new AudioContext();
        audioContextRef.current = context;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const frequencies = { tap: 420, merge: 680, battle: 220, win: 820, error: 150 };
        oscillator.frequency.value = frequencies[kind];
        oscillator.type = kind === "battle" ? "sawtooth" : "sine";
        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + (kind === "win" ? 0.35 : 0.14));
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + (kind === "win" ? 0.38 : 0.16));
      } catch {
        // Sound is optional and must never block gameplay.
      }
    },
    [sound],
  );

  const trackEvent = useCallback((eventName: string, params: Record<string, string | number | boolean> = {}) => {
    if (!bridgeRef.current) return;
    const eventParams: Record<string, string> = {};
    Object.entries(params).forEach(([key, value]) => {
      eventParams[key] = String(value);
    });
    void bridgeRef.current
      .send("VKWebAppTrackEvent", { event_name: eventName, event_params: eventParams })
      .catch(() => undefined);
  }, []);

  const persistValue = useCallback(
    (value: string) => {
      try {
        localStorage.setItem(SAVE_KEY, value);
        localStorage.removeItem(LEGACY_SAVE_KEY);
      } catch {
        trackEvent("save_write_error", { source: "local" });
      }
      if (!bridgeRef.current || value.length >= 4000) return;
      cloudSaveQueueRef.current = cloudSaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (!bridgeRef.current) return;
          await bridgeRef.current.send("VKWebAppStorageSet", { key: VK_SAVE_KEY, value });
        })
        .catch(() => {
          trackEvent("save_write_error", { source: "vk" });
        });
    },
    [trackEvent],
  );

  const applySave = useCallback((save: GameSave) => {
    setUnits(save.units);
    setCoins(save.coins);
    setCrystals(save.crystals);
    setWave(save.wave);
    setCastleHp(save.castleHp);
    setCampaign(save.campaign);
    setSound(save.sound);
    setTutorialDone(save.tutorialDone);
    setTutorialStep(save.tutorialDone ? 2 : save.wave > 1 ? 1 : 0);
    setUpgrades(save.upgrades);
    setStats(save.stats);
    setDaily(save.daily);
    setRewards(save.rewards);
    setVictory(save.stats.campaignsWon >= save.campaign);
    setDefeat(save.castleHp <= 0);
    setSelected(save.units.findIndex(Boolean) >= 0 ? save.units.findIndex(Boolean) : null);
    setMessage(
      save.stats.campaignsWon >= save.campaign
        ? `Поход ${save.campaign} завершён. Открыта новая глава.`
        : save.castleHp <= 0
          ? `Стены разрушены. Дружина готова повторить волну ${save.wave}.`
          : save.tutorialDone
            ? `Подготовь дружину к волне ${save.wave}`
            : "Нажми на второго ратника ⚔️",
    );
    nextId.current = getNextId(save.units);
  }, []);

  const checkRewardAvailability = useCallback(async () => {
    if (!bridgeRef.current) return;
    lastAdCheckAt.current = Date.now();
    try {
      const response = (await bridgeRef.current.send("VKWebAppCheckNativeAds", {
        ad_format: "reward",
      })) as { result?: boolean };
      setAdAvailable(response.result === true);
      trackEvent("reward_check", { available: response.result === true });
    } catch {
      setAdAvailable(false);
      trackEvent("reward_check", { available: false });
    }
  }, [trackEvent]);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      let localSave: GameSave | null = null;
      try {
        localSave =
          migrateSave(localStorage.getItem(SAVE_KEY)) ?? migrateSave(localStorage.getItem(LEGACY_SAVE_KEY));
      } catch {
        // Private browsing and strict WebViews may deny localStorage access.
      }
      let cloudSave: GameSave | null = null;

      try {
        await promiseWithTimeout(bridge.send("VKWebAppInit"), 3500);
        if (cancelled) return;
        bridgeRef.current = bridge as unknown as VKBridge;
        setVkReady(true);

        try {
          await bridgeRef.current.send("VKWebAppSetViewSettings", {
            status_bar_style: "light",
            action_bar_color: "#223922",
            navigation_bar_color: "#223922",
          });
        } catch {
          // Some desktop VK clients do not support every view setting.
        }

        try {
          const user = (await bridgeRef.current.send("VKWebAppGetUserInfo")) as VKUser;
          setVkUser(user);
        } catch {
          // Profile data is optional.
        }

        try {
          const storage = (await bridgeRef.current.send("VKWebAppStorageGet", {
            keys: [VK_SAVE_KEY],
          })) as { keys?: Array<{ value: string }> };
          cloudSave = migrateSave(storage.keys?.[0]?.value);
        } catch {
          // Local storage remains the fallback.
          trackEvent("save_load_error", { source: "vk" });
        }
      } catch {
        bridgeRef.current = null;
        setVkReady(false);
      }

      if (cancelled) return;
      const chosen = selectNewestSave(localSave, cloudSave);
      applySave(chosen ?? createDefaultSave());
      setHydrated(true);
      trackEvent("app_open", {
        source: chosen === cloudSave && cloudSave ? "vk" : chosen ? "local" : "new",
      });
      void checkRewardAvailability();
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [applySave, checkRewardAvailability, trackEvent]);

  useEffect(() => {
    latestSaveRef.current = {
      version: 2,
      updatedAt: Date.now(),
      units,
      coins,
      crystals,
      wave,
      castleHp,
      campaign,
      sound,
      tutorialDone,
      upgrades,
      stats,
      daily,
      rewards,
    };
  }, [
    campaign,
    castleHp,
    coins,
    crystals,
    daily,
    rewards,
    sound,
    stats,
    tutorialDone,
    units,
    upgrades,
    wave,
  ]);

  useEffect(() => {
    if (!hydrated) return;
    const timeout = window.setTimeout(() => {
      persistValue(serializeSave(latestSaveRef.current));
    }, 280);
    return () => window.clearTimeout(timeout);
  }, [
    campaign,
    castleHp,
    coins,
    crystals,
    daily,
    hydrated,
    rewards,
    sound,
    stats,
    persistValue,
    tutorialDone,
    units,
    upgrades,
    wave,
  ]);

  useEffect(() => {
    if (!hydrated) return;
    const flush = () => persistValue(serializeSave(latestSaveRef.current));
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, [hydrated, persistValue]);

  useEffect(() => {
    const now = Date.now();
    sessionStartedAt.current = now;
    const initialClock = window.setTimeout(() => setClock(now), 0);
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => {
      window.clearTimeout(initialClock);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!hydrated || daily.date === getLocalDateKey()) return;
    const resetTimer = window.setTimeout(() => {
      setDaily({ date: getLocalDateKey(), merge: 0, recruit: 0, wave: 0, claimed: [] });
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [clock, daily.date, hydrated]);

  useEffect(() => {
    if (
      !vkReady ||
      adAvailable !== false ||
      adBusyRef.current ||
      clock - lastAdCheckAt.current < 60_000
    ) {
      return;
    }
    void checkRewardAvailability();
  }, [adAvailable, checkRewardAvailability, clock, vkReady]);

  useEffect(() => {
    const handleVisibility = () => setPaused(document.hidden);
    const handleBridgeEvent = (event: VKEvent) => {
      if (event.detail?.type === "VKWebAppViewHide") setPaused(true);
      if (event.detail?.type === "VKWebAppViewRestore") setPaused(false);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    const activeBridge = bridgeRef.current;
    activeBridge?.subscribe?.(handleBridgeEvent);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      activeBridge?.unsubscribe?.(handleBridgeEvent);
    };
  }, [vkReady]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (showSettings) setShowSettings(false);
      else if (showResources) setShowResources(null);
      else if (showHelp) setShowHelp(false);
      else if (showResult) setShowResult(false);
      else if (showStart && hydrated) setShowStart(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [hydrated, showHelp, showResources, showResult, showSettings, showStart]);

  useEffect(() => {
    const overlayOpen = showStart || showSettings || Boolean(showResources) || showHelp || showResult;
    if (!overlayOpen) return;

    const previousOverflow = document.body.style.overflow;
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalReturnFocusRef.current = activeElement;
    document.body.style.overflow = "hidden";
    const backgroundElements = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".topbar, .battle-card, .camp-card, .feature-card, .bottom-nav",
      ),
    );
    if (showStart && (showSettings || Boolean(showResources) || showHelp || showResult)) {
      const startDialog = document.querySelector<HTMLElement>(".start-screen");
      if (startDialog) backgroundElements.push(startDialog);
    }
    backgroundElements.forEach((element) => {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    });

    const focusTimer = window.setTimeout(() => {
      const dialogs = document.querySelectorAll<HTMLElement>("[data-game-dialog='active']");
      const dialog = dialogs[dialogs.length - 1];
      const focusable = dialog?.querySelector<HTMLElement>(
        "button:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])",
      );
      focusable?.focus();
    }, 0);

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const dialogs = document.querySelectorAll<HTMLElement>("[data-game-dialog='active']");
      const dialog = dialogs[dialogs.length - 1];
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])",
        ),
      ).filter((element) => !element.hasAttribute("hidden"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", trapFocus);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", trapFocus);
      document.body.style.overflow = previousOverflow;
      backgroundElements.forEach((element) => {
        element.removeAttribute("inert");
        element.removeAttribute("aria-hidden");
      });
      modalReturnFocusRef.current?.focus();
      modalReturnFocusRef.current = null;
    };
  }, [showHelp, showResources, showResult, showSettings, showStart]);

  const incrementDaily = useCallback((field: DailyField) => {
    setDaily((current) => {
      const today = getLocalDateKey();
      const active =
        current.date === today
          ? current
          : { date: today, merge: 0, recruit: 0, wave: 0, claimed: [] };
      return { ...active, [field]: active[field] + 1 };
    });
  }, []);

  const spawnCurrentWave = useCallback(() => {
    if (running || castleHp <= 0 || victory || stats.campaignsWon >= campaign) return;
    const spawned = createWave(wave, nextId.current, campaign);
    nextId.current = spawned.nextId;
    battleLootRef.current = 0;
    enemiesRef.current = spawned.enemies;
    setEnemies(spawned.enemies);
    setBossWave(spawned.isBossWave);
    setRunning(true);
    setPaused(false);
    setDefeat(false);
    setMessage(spawned.isBossWave ? `Босс волны ${wave} выходит на тракт!` : `Волна ${wave} наступает!`);
    setTutorialStep((step) => (step === 0 ? 1 : step));
    playSound("battle");
    trackEvent("wave_start", {
      wave,
      campaign,
      power: Math.round(totalPower),
      boss: spawned.isBossWave,
    });
  }, [campaign, castleHp, playSound, running, stats.campaignsWon, totalPower, trackEvent, victory, wave]);

  useEffect(() => {
    if (!running || paused || overlayPause) return;
    battleTimer.current = window.setInterval(() => {
      const current = enemiesRef.current;
      if (!current.length) return;
      const damage = Math.max(1, totalPower * 0.12);
      let primaryHit = false;
      let splashHit = false;
      let earned = 0;
      let wallDamage = 0;
      const next = current
        .map((enemy) => {
          let hp = enemy.hp;
          const rangedDamage = enemy.progress > -2 ? damage * combatProfile.rangedShare : 0;
          const closeDamage =
            enemy.progress > 13
              ? damage *
                (1 - combatProfile.rangedShare) *
                (1 + (enemy.progress > 55 ? combatProfile.swordShare * 0.3 : 0))
              : 0;
          const primaryDamage = rangedDamage + closeDamage;
          if (!primaryHit && primaryDamage > 0) {
            hp -= primaryDamage;
            primaryHit = true;
          } else if (
            primaryHit &&
            !splashHit &&
            enemy.progress > -2 &&
            combatProfile.mageShare > 0
          ) {
            hp -= damage * combatProfile.mageShare * 0.48;
            splashHit = true;
          }
          const speed = enemy.kind === "wolf" ? 2.4 : enemy.kind === "troll" ? 1.1 : 1.55;
          return { ...enemy, hp, progress: enemy.progress + speed };
        })
        .filter((enemy) => {
          if (enemy.hp <= 0) {
            earned += enemy.kind === "troll" ? 65 : enemy.kind === "wolf" ? 14 : 12;
            return false;
          }
          if (enemy.progress >= 93) {
            const baseWallDamage = enemy.kind === "troll" ? 26 : enemy.kind === "wolf" ? 8 : 9;
            wallDamage += Math.max(1, Math.round(baseWallDamage * (1 - combatProfile.wallReduction)));
            return false;
          }
          return true;
        });
      enemiesRef.current = next;
      setEnemies(next);
      if (earned) battleLootRef.current += earned;
      if (wallDamage) setCastleHp((value) => Math.max(0, value - wallDamage));
    }, 420);
    return () => {
      if (battleTimer.current) window.clearInterval(battleTimer.current);
    };
  }, [combatProfile, overlayPause, paused, running, totalPower]);

  const maybeShowInterstitial = useCallback(async () => {
    const now = Date.now();
    if (
      interstitialBusyRef.current ||
      !bridgeRef.current ||
      !tutorialDone ||
      now - sessionStartedAt.current < INTERSTITIAL_INTERVAL_MS ||
      now - lastInterstitialAt.current < INTERSTITIAL_INTERVAL_MS
    ) {
      return;
    }
    interstitialBusyRef.current = true;
    try {
      const check = (await bridgeRef.current.send("VKWebAppCheckNativeAds", {
        ad_format: "interstitial",
      })) as { result?: boolean };
      if (!check.result) {
        trackEvent("interstitial_unavailable", { wave, campaign });
        return;
      }
      const shown = (await bridgeRef.current.send("VKWebAppShowNativeAds", {
        ad_format: "interstitial",
      })) as { result?: boolean };
      if (shown.result === true) {
        lastInterstitialAt.current = Date.now();
        trackEvent("interstitial_complete", { wave, campaign });
      } else {
        trackEvent("interstitial_cancelled", { wave, campaign });
      }
    } catch {
      trackEvent("interstitial_error", { wave, campaign });
    } finally {
      interstitialBusyRef.current = false;
    }
  }, [campaign, trackEvent, tutorialDone, wave]);

  useEffect(() => {
    if (!running || enemies.length !== 0) return;
    const timeout = window.setTimeout(() => {
      setRunning(false);
      setBossWave(false);
      if (castleHp <= 0) {
        battleLootRef.current = 0;
        setDefeat(true);
        setShowResult(true);
        setMessage("Город пал, но дружина сохранена. Подготовься и повтори волну.");
        playSound("error");
        trackEvent("wave_fail", { wave, campaign, power: Math.round(totalPower) });
        return;
      }

      const completionReward = getWaveReward(wave, campaign);
      const earnedLoot = battleLootRef.current;
      battleLootRef.current = 0;
      setCoins((value) => value + completionReward + earnedLoot);
      setStats((current) => ({
        ...current,
        wavesWon: current.wavesWon + 1,
        bestWave: Math.max(current.bestWave, wave),
        campaignsWon: wave >= MAX_WAVE ? current.campaignsWon + 1 : current.campaignsWon,
      }));
      incrementDaily("wave");
      if (!tutorialDone) trackEvent("tutorial_complete", { wave, campaign });
      setTutorialDone(true);
      setTutorialStep(2);
      trackEvent("wave_win", {
        wave,
        campaign,
        castle_hp: castleHp,
        reward: completionReward + earnedLoot,
      });

      if (wave >= MAX_WAVE) {
        setVictory(true);
        setShowResult(true);
        setCrystals((value) => value + 3);
        setMessage("Все земли спасены!");
        playSound("win");
        trackEvent("campaign_complete", { campaign, castle_hp: castleHp });
      } else {
        if (wave % 3 === 0) void maybeShowInterstitial();
        setWave((value) => value + 1);
        setMessage(`Волна отбита! Получено ${completionReward + earnedLoot} монет.`);
        playSound("win");
      }
    }, 260);
    return () => window.clearTimeout(timeout);
  }, [
    campaign,
    castleHp,
    enemies.length,
    incrementDaily,
    maybeShowInterstitial,
    playSound,
    running,
    totalPower,
    trackEvent,
    tutorialDone,
    wave,
  ]);

  const buyUnit = () => {
    const empty = units.findIndex((unit) => !unit);
    if (empty < 0) {
      setMessage("Нет свободных мест — объедини бойцов");
      playSound("error");
      return;
    }
    if (coins < recruitCost) {
      setMessage("Не хватает монет");
      playSound("error");
      return;
    }
    const kinds: UnitKind[] = ["sword", "bow", "guard", "mage"];
    const availableKinds = wave > 3 ? kinds : kinds.slice(0, 3);
    const pairCandidates = availableKinds.filter((candidate) =>
      units.some((unit) => unit?.kind === candidate && unit.level === 1),
    );
    const pool = pairCandidates.length > 0 && Math.random() < 0.65 ? pairCandidates : availableKinds;
    const kind = pool[Math.floor(Math.random() * pool.length)];
    const recruited = { id: nextId.current++, kind, level: 1 };
    setUnits((current) => current.map((unit, index) => (index === empty ? recruited : unit)));
    setCoins((value) => value - recruitCost);
    setStats((current) => ({ ...current, unitsRecruited: current.unitsRecruited + 1 }));
    incrementDaily("recruit");
    setMessage(`${UNIT_DATA[kind].name} вступает в дружину`);
    playSound("tap");
    trackEvent("unit_recruit", { kind, cost: recruitCost, wave, campaign });
  };

  const chooseCell = (index: number) => {
    if (running) return;
    const target = units[index];
    if (selected === null) {
      if (target) {
        setSelected(index);
        playSound("tap");
      }
      return;
    }
    if (selected === index) {
      setSelected(null);
      return;
    }
    const result = mergeOrMove(units, selected, index, nextId.current);
    if (result.outcome === "noop") {
      setSelected(null);
      return;
    }
    setUnits(result.units);
    nextId.current = result.nextId;
    setSelected(null);

    if (result.outcome === "merged" && result.unit) {
      setMessage(`${UNIT_DATA[result.unit.kind].name} повышен до ${result.unit.level} уровня!`);
      setStats((current) => ({ ...current, unitsMerged: current.unitsMerged + 1 }));
      incrementDaily("merge");
      setTutorialStep(1);
      playSound("merge");
      trackEvent("unit_merge", { kind: result.unit.kind, level: result.unit.level, wave, campaign });
      if (!tutorialDone && tutorialStep === 0) {
        trackEvent("tutorial_merge", { kind: result.unit.kind, level: result.unit.level });
      }
      void bridgeRef.current
        ?.send("VKWebAppTapticNotificationOccurred", { type: "success" })
        .catch(() => undefined);
      return;
    }

    setMessage(
      result.outcome === "moved"
        ? `${result.unit ? UNIT_DATA[result.unit.kind].name : "Боец"} перемещён`
        : "Бойцы поменялись местами",
    );
    playSound("tap");
  };

  const mergeTarget = (index: number) => {
    if (selected === null || index === selected || !units[selected] || !units[index]) return false;
    return canMergeUnits(units[selected], units[index]);
  };

  const suggestMerge = () => {
    if (!mergePair) {
      setMessage("Сейчас нет пары. Призови нового бойца или перестрой дружину.");
      playSound("error");
      return;
    }
    setSelected(mergePair[0]);
    const unit = units[mergePair[0]];
    setMessage(
      unit
        ? `Подсказка: объедини двух бойцов «${UNIT_DATA[unit.kind].name}» ${unit.level} уровня`
        : "Пара найдена",
    );
    playSound("tap");
  };

  const heal = () => {
    const result = healCastle(castleHp, crystals, maxCastleHp);
    if (!result.healed) return;
    setCrystals(result.crystals);
    setCastleHp(result.castleHp);
    setMessage("Стены города восстановлены");
    playSound("merge");
    trackEvent("castle_heal", { castle_hp: result.castleHp, wave, campaign });
  };

  const startCampaign = (nextCampaign = campaign) => {
    const freshUnits = cloneInitialUnits();
    setUnits(freshUnits);
    setCoins(getStartingCoins(upgrades.treasury));
    setWave(1);
    setCastleHp(maxCastleHp);
    setEnemies([]);
    enemiesRef.current = [];
    nextId.current = getNextId(freshUnits);
    setRunning(false);
    setPaused(false);
    setVictory(false);
    setDefeat(false);
    setShowResult(false);
    setCampaign(nextCampaign);
    setSelected(0);
    setActiveTab("campaign");
    setMessage(nextCampaign > campaign ? `Поход ${nextCampaign} начинается!` : "Дружина снова у городских стен.");
    trackEvent("campaign_start", { campaign: nextCampaign, retry: nextCampaign === campaign });
  };

  const retryCurrentWave = () => {
    setCastleHp(Math.max(1, Math.ceil(maxCastleHp * 0.65)));
    setEnemies([]);
    enemiesRef.current = [];
    battleLootRef.current = 0;
    setRunning(false);
    setPaused(false);
    setDefeat(false);
    setShowResult(false);
    setSelected(units.findIndex(Boolean) >= 0 ? units.findIndex(Boolean) : null);
    setMessage(`Стены восстановлены до 65%. Дружина готова повторить волну ${wave}.`);
    trackEvent("wave_retry_ready", { wave, campaign });
  };

  const resetAllProgress = () => {
    const fresh = createDefaultSave();
    applySave(fresh);
    setEnemies([]);
    enemiesRef.current = [];
    setRunning(false);
    setPaused(false);
    setVictory(false);
    setDefeat(false);
    setShowResult(false);
    setShowSettings(false);
    setShowStart(false);
    setSelected(0);
    setActiveTab("campaign");
    setMessage("Новый поход начинается!");
    persistValue(serializeSave(fresh));
    trackEvent("progress_reset");
  };

  const rewardBlockedReason = useMemo(() => {
    const today = getLocalDateKey();
    const todayCount = rewards.date === today ? rewards.count : 0;
    if (todayCount >= REWARD_DAILY_LIMIT) return "Лимит наград на сегодня исчерпан";
    const wait = REWARD_COOLDOWN_MS - (clock - rewards.lastRewardAt);
    if (wait > 0) return `Следующая награда через ${Math.ceil(wait / 60_000)} мин.`;
    if (adAvailable === false) return "Реклама сейчас недоступна";
    return "";
  }, [adAvailable, clock, rewards]);

  const showRewardedAd = async () => {
    if (!bridgeRef.current || adBusyRef.current || adBusy || rewardBlockedReason) return;
    adBusyRef.current = true;
    setAdBusy(true);
    setAdStatus("");
    trackEvent("reward_start", { wave, campaign, placement: showStart ? "start" : "game" });
    try {
      const response = (await bridgeRef.current.send("VKWebAppShowNativeAds", {
        ad_format: "reward",
      })) as { result?: boolean };
      if (!response.result) {
        setAdStatus("Реклама завершилась без награды");
        trackEvent("reward_incomplete", { wave, campaign });
        return;
      }
      const today = getLocalDateKey();
      setCoins((value) => value + REWARD_COINS);
      setRewards((current) => ({
        date: today,
        count: current.date === today ? current.count + 1 : 1,
        lastRewardAt: Date.now(),
      }));
      setStats((current) => ({ ...current, adsWatched: current.adsWatched + 1 }));
      setClock(Date.now());
      setAdStatus(`Награда получена: +${REWARD_COINS} монет`);
      setMessage(`Спасибо за поддержку! Получено ${REWARD_COINS} монет`);
      playSound("win");
      trackEvent("reward_complete", { reward: REWARD_COINS, wave, campaign });
      void bridgeRef.current
        .send("VKWebAppTapticNotificationOccurred", { type: "success" })
        .catch(() => undefined);
    } catch {
      setAdAvailable(false);
      setAdStatus("Реклама пока недоступна — попробуй позже");
      trackEvent("reward_error", { wave, campaign });
    } finally {
      adBusyRef.current = false;
      setAdBusy(false);
      window.setTimeout(() => void checkRewardAvailability(), 1200);
    }
  };

  const claimQuest = (questId: string) => {
    const quest = DAILY_QUESTS.find((item) => item.id === questId);
    if (daily.date !== getLocalDateKey()) {
      setDaily({ date: getLocalDateKey(), merge: 0, recruit: 0, wave: 0, claimed: [] });
      setMessage("Наступил новый день — задания обновлены");
      return;
    }
    if (!quest || daily.claimed.includes(quest.id) || daily[quest.field] < quest.target) return;
    setDaily((current) => ({ ...current, claimed: [...current.claimed, quest.id] }));
    if (quest.reward.coins) setCoins((value) => value + quest.reward.coins!);
    if (quest.reward.crystals) setCrystals((value) => value + quest.reward.crystals!);
    setMessage(`Задание «${quest.title}» выполнено!`);
    playSound("win");
    trackEvent("daily_claim", { quest: quest.id });
  };

  const buyUpgrade = (key: UpgradeKey) => {
    const level = upgrades[key];
    if (level >= 5) return;
    const cost = getUpgradeCost(level);
    if (crystals < cost) {
      setMessage("Для улучшения не хватает кристаллов");
      setShowResources("crystals");
      playSound("error");
      return;
    }
    setCrystals((value) => value - cost);
    setUpgrades((current) => ({ ...current, [key]: current[key] + 1 }));
    if (key === "walls") setCastleHp((value) => value + 10);
    setMessage(`${UPGRADE_DATA[key].title} улучшена до ${level + 1} уровня`);
    playSound("merge");
    trackEvent("camp_upgrade", { upgrade: key, level: level + 1, cost });
  };

  const shareResult = async () => {
    if (!bridgeRef.current) return;
    try {
      await bridgeRef.current.send("VKWebAppShare", { link: VK_APP_URL });
      trackEvent("share_complete", { campaign, best_wave: stats.bestWave });
    } catch {
      setMessage("Не удалось открыть меню публикации");
    }
  };

  const inviteFriends = async () => {
    if (!bridgeRef.current) return;
    try {
      await bridgeRef.current.send("VKWebAppShowInviteBox");
      trackEvent("invite_complete", { campaign });
    } catch {
      setMessage("Приглашения недоступны в этом клиенте VK");
    }
  };

  const startOrContinue = () => {
    if (victory || stats.campaignsWon >= campaign) {
      startCampaign(campaign + 1);
      setShowStart(false);
      return;
    }
    if (defeat || castleHp <= 0) {
      setShowStart(false);
      setShowResult(true);
      return;
    }
    setShowStart(false);
    playSound("tap");
    trackEvent(wave > 1 || stats.wavesWon > 0 ? "game_resume" : "game_start", { wave, campaign });
  };

  const activeQuestCount = DAILY_QUESTS.filter(
    (quest) => daily[quest.field] >= quest.target && !daily.claimed.includes(quest.id),
  ).length;

  return (
    <main className="game-shell">
      <div className="sun" />
      <div className="cloud cloud-one" />
      <div className="cloud cloud-two" />

      <header className="topbar">
        <button className="brand brand-button" onClick={() => setShowStart(true)} aria-label="Открыть главное меню">
          <span className="brand-mark">Д</span>
          <span><strong>ДРУЖИНА</strong><small>ЗАЩИТА ГОРОДА</small></span>
        </button>
        <div className="resources" aria-label="Ресурсы">
          <div className="resource">
            <span>🪙</span><b>{coins}</b>
            <button onClick={() => setShowResources("coins")} aria-label="Получить монеты">+</button>
          </div>
          <div className="resource">
            <span>💎</span><b>{crystals}</b>
            <button onClick={() => setShowResources("crystals")} aria-label="Получить кристаллы">+</button>
          </div>
        </div>
        <div className="top-actions">
          {vkUser && (
            <div className="vk-player" title={`Игрок: ${vkUser.first_name}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {vkUser.photo_100 ? <img src={vkUser.photo_100} alt="" /> : "VK"}
              <span>{vkUser.first_name}</span>
            </div>
          )}
          <button onClick={() => setSound(!sound)} aria-label={sound ? "Выключить звук" : "Включить звук"}>
            {sound ? "🔊" : "🔇"}
          </button>
          <button onClick={() => setShowHelp(true)} aria-label="Правила игры">?</button>
        </div>
      </header>

      {activeTab === "campaign" && (
        <>
          <section className="battle-card">
            <div className="battle-heading">
              <div className="battle-copy">
                <span className="eyebrow">ПОХОД {campaign} · {campaignProfile.title.toUpperCase()}</span>
                <h1>
                  Волна {wave} <span>/ {MAX_WAVE}</span>
                  {(wave === 5 || wave === MAX_WAVE) && <em className="boss-label">БОСС</em>}
                </h1>
                <div className="wave-route" aria-label={`Пройдено волн: ${wave - 1} из ${MAX_WAVE}`}>
                  {Array.from({ length: MAX_WAVE }, (_, index) => (
                    <i
                      className={`${index + 1 < wave ? "done" : ""} ${index + 1 === wave ? "current" : ""} ${index + 1 === 5 || index + 1 === MAX_WAVE ? "boss" : ""}`}
                      key={index}
                    />
                  ))}
                </div>
              </div>
              <div className="power">
                <span>Сила дружины</span>
                <strong><span aria-hidden="true">⚡</span> {Math.round(totalPower)}</strong>
                <em className={`readiness ${readiness.className}`}>{readiness.label}</em>
              </div>
            </div>

            <div className="battle-intel" aria-label="Разведка перед волной">
              <span><b aria-hidden="true">👣</b> Врагов: {waveBalance.enemyCount}</span>
              <span><b aria-hidden="true">{waveBalance.isBossWave ? "👹" : "🪙"}</b> {waveBalance.isBossWave ? "Впереди босс" : `Награда: ${waveBalance.completionReward}`}</span>
              <span><b aria-hidden="true">🎯</b> Совет: сила {recommendedPower}+</span>
            </div>

            <div className={`battlefield ${paused && running ? "is-paused" : ""}`}>
              <div className="far-forest" />
              <div className="road" />
              <div className="castle">
                <div className="flag">◆</div>
                <div className="tower left-tower" />
                <div className="tower right-tower" />
                <div className="gate">⌂</div>
              </div>
              <div className="defenders">
                {units.filter(Boolean).slice(0, 4).map((unit, index) => unit && (
                  <span key={unit.id} style={{ left: `${14 + index * 5}%`, animationDelay: `${index * 0.12}s` }}>
                    {UNIT_DATA[unit.kind].icon}
                  </span>
                ))}
              </div>
              {enemies.map((enemy) => (
                <div className={`enemy ${enemy.kind === "troll" ? "boss-enemy" : ""}`} key={enemy.id} style={{ left: `${enemy.progress}%` }}>
                  <div className="enemy-health"><i style={{ width: `${Math.max(0, enemy.hp / enemy.maxHp) * 100}%` }} /></div>
                  <span>{enemyIcon[enemy.kind]}</span>
                </div>
              ))}
              {paused && running && <div className="pause-label">ПАУЗА</div>}
              {!running && <div className="battle-tip">{message}</div>}
              {bossWave && running && <div className="boss-warning">⚠ БОСС НА ТРАКТЕ</div>}
              {running && (
                <span className="sr-only" role="status">
                  {paused || overlayPause ? "Бой приостановлен" : `Идёт волна ${wave}. Врагов осталось: ${enemies.length}`}
                </span>
              )}
            </div>

            <div className="castle-health">
              <span><span aria-hidden="true">🏰</span> Стены города</span>
              <div
                className="health-track"
                role="progressbar"
                aria-label="Прочность стен"
                aria-valuemin={0}
                aria-valuemax={maxCastleHp}
                aria-valuenow={castleHp}
              >
                <i style={{ width: `${Math.max(0, castleHp / maxCastleHp) * 100}%` }} />
              </div>
              <b>{castleHp}/{maxCastleHp}</b>
              <button
                onClick={heal}
                disabled={crystals < 2 || castleHp >= maxCastleHp}
                aria-label="Восстановить 25 прочности за 2 кристалла"
              >
                +25 · 💎2
              </button>
            </div>
          </section>

          <section className="camp-card">
            <div className="camp-header">
              <div><span className="eyebrow">БОЕВОЙ ЛАГЕРЬ</span><h2>Собери дружину</h2></div>
              <p className="camp-message" aria-live="polite">{message}</p>
            </div>
            {!tutorialDone && (
              <div className="tutorial-line" aria-label="Обучение">
                <span className={`tutorial-number ${tutorialStep === 0 ? "current" : ""}`}>1</span>
                <b>Объедини ратников</b>
                <span>Выбери двух одинаковых воинов</span>
                <i>→</i>
                <span className={`tutorial-number ${tutorialStep === 1 ? "current" : ""}`}>2</span>
                <b>Нажми «В бой!»</b>
              </div>
            )}
            <div className="unit-grid">
              {units.map((unit, index) => (
                <button
                  className={`unit-cell ${selected === index ? "selected" : ""} ${mergeTarget(index) ? "merge-target" : ""} ${unit ? "occupied" : ""}`}
                  key={index}
                  onClick={() => chooseCell(index)}
                  disabled={running}
                  aria-pressed={selected === index}
                  aria-label={unit ? `${UNIT_DATA[unit.kind].name}, уровень ${unit.level}` : "Свободное место"}
                >
                  {unit ? (
                    <>
                      <span className="unit-aura" style={{ background: UNIT_DATA[unit.kind].color }} />
                      <span className="unit-icon">{UNIT_DATA[unit.kind].icon}</span>
                      <span className="level">Ур. {unit.level}</span>
                      <span className="stars">{"★".repeat(unit.level)}</span>
                      {mergeTarget(index) && <span className="tap-here">НАЖМИ</span>}
                    </>
                  ) : <span className="empty-plus">+</span>}
                </button>
              ))}
            </div>
            <div className="unit-inspector">
              <div>
                {selectedUnit ? (
                  <>
                    <span className="inspector-icon" aria-hidden="true">{UNIT_DATA[selectedUnit.kind].icon}</span>
                    <span>
                      <b>{UNIT_DATA[selectedUnit.kind].name} · уровень {selectedUnit.level}</b>
                      <small title={UNIT_ROLES[selectedUnit.kind].description}>
                        Сила {Math.round(getUnitPower(selectedUnit, upgrades.forge))} · {UNIT_ROLES[selectedUnit.kind].title}: {UNIT_ROLES[selectedUnit.kind].short}
                      </small>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="inspector-icon" aria-hidden="true">☝️</span>
                    <span><b>Выбери бойца</b><small>Покажем его силу и особую роль</small></span>
                  </>
                )}
              </div>
              <button onClick={suggestMerge} disabled={running}>
                {mergePair ? "Подсказать пару" : "Пар пока нет"}
              </button>
            </div>
            <div className="role-bonuses" aria-label="Активные особенности дружины">
              {combatProfile.byKind.bow > 0 && <span>🏹 Ранний обстрел</span>}
              {combatProfile.byKind.mage > 0 && <span>✨ Урон по площади</span>}
              {combatProfile.byKind.sword > 0 && <span>⚔️ Натиск у стен</span>}
              {combatProfile.byKind.guard > 0 && <span>🛡️ −{Math.round(combatProfile.wallReduction * 100)}% урона стенам</span>}
            </div>
            <div className="camp-actions">
              <button className="recruit" onClick={buyUnit} disabled={running}>
                <span className="recruit-icon">⚔</span>
                <span><b>Призвать бойца</b><small>Случайный воин</small></span>
                <strong>🪙 {recruitCost}</strong>
              </button>
              <button
                className="fight"
                onClick={
                  victory
                    ? () => startCampaign(campaign + 1)
                    : defeat || castleHp <= 0
                      ? retryCurrentWave
                      : spawnCurrentWave
                }
                disabled={running}
              >
                <span>
                  {victory
                    ? "СЛЕДУЮЩИЙ ПОХОД"
                    : defeat || castleHp <= 0
                      ? "ВОССТАНОВИТЬ СТЕНЫ"
                      : running
                        ? paused || overlayPause ? "ПАУЗА" : "ИДЁТ БОЙ…"
                        : "В БОЙ!"}
                </span>
                <small>
                  {victory
                    ? `${getCampaignProfile(campaign + 1).title} ждёт`
                    : defeat || castleHp <= 0
                      ? "Дружина сохранится · 65% прочности"
                      : !running
                        ? `Награда за волну ${getWaveReward(wave, campaign)} 🪙`
                        : ""}
                </small>
              </button>
              {vkReady && (
                <button
                  className="rewarded-ad"
                  onClick={showRewardedAd}
                  disabled={adBusy || running || Boolean(rewardBlockedReason)}
                  title={rewardBlockedReason}
                >
                  <span>🎬</span>
                  <span>
                    <b>{adBusy ? "ЗАГРУЗКА…" : `+${REWARD_COINS} МОНЕТ`}</b>
                    <small>{rewardBlockedReason || "за добровольный просмотр"}</small>
                  </span>
                </button>
              )}
            </div>
            {adStatus && <p className="ad-status" role="status">{adStatus}</p>}
          </section>
        </>
      )}

      {activeTab === "camp" && (
        <section className="feature-card">
          <div className="feature-heading">
            <span className="feature-icon">🏕️</span>
            <div><span className="eyebrow">ПОСТОЯННЫЕ УЛУЧШЕНИЯ</span><h1>Лагерь дружины</h1></div>
          </div>
          <p className="feature-intro">Улучшения сохраняются между походами. Максимальный уровень каждого строения — 5.</p>
          <div className="upgrade-grid">
            {(Object.keys(UPGRADE_DATA) as UpgradeKey[]).map((key) => {
              const item = UPGRADE_DATA[key];
              const level = upgrades[key];
              const cost = getUpgradeCost(level);
              return (
                <article className="upgrade-card" key={key}>
                  <span className="upgrade-icon">{item.icon}</span>
                  <div className="upgrade-copy">
                    <h2>{item.title}</h2>
                    <p>{item.description}</p>
                    <strong>{item.bonus(level)}</strong>
                    <div className="upgrade-level" aria-label={`Уровень ${level} из 5`}>
                      {Array.from({ length: 5 }, (_, index) => <i className={index < level ? "filled" : ""} key={index} />)}
                    </div>
                  </div>
                  <button onClick={() => buyUpgrade(key)} disabled={level >= 5}>
                    {level >= 5 ? "МАКСИМУМ" : `УЛУЧШИТЬ · 💎${cost}`}
                  </button>
                </article>
              );
            })}
          </div>
          <div className="feature-note">Текущая сила: <b>⚡ {Math.round(totalPower)}</b> · Стены: <b>{maxCastleHp}</b> · Стартовая казна: <b>{getStartingCoins(upgrades.treasury)} 🪙</b></div>
        </section>
      )}

      {activeTab === "quests" && (
        <section className="feature-card">
          <div className="feature-heading">
            <span className="feature-icon">📜</span>
            <div><span className="eyebrow">ОБНОВЛЯЮТСЯ КАЖДЫЙ ДЕНЬ</span><h1>Задания</h1></div>
          </div>
          <p className="feature-intro">Выполняй задания в походе и забирай награды. Прогресс сбросится завтра.</p>
          <div className="quest-list">
            {DAILY_QUESTS.map((quest) => {
              const progress = Math.min(quest.target, daily[quest.field]);
              const complete = progress >= quest.target;
              const claimed = daily.claimed.includes(quest.id);
              return (
                <article className={`quest-card ${complete ? "complete" : ""}`} key={quest.id}>
                  <div>
                    <span className="quest-check">{claimed ? "✓" : complete ? "!" : "·"}</span>
                    <div><h2>{quest.title}</h2><p>{quest.description}</p></div>
                  </div>
                  <div className="quest-progress">
                    <div><i style={{ width: `${(progress / quest.target) * 100}%` }} /></div>
                    <b>{progress}/{quest.target}</b>
                  </div>
                  <button onClick={() => claimQuest(quest.id)} disabled={!complete || claimed}>
                    {claimed
                      ? "ПОЛУЧЕНО"
                      : `ЗАБРАТЬ · ${quest.reward.coins ? `${quest.reward.coins} 🪙` : `${quest.reward.crystals} 💎`}`}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {activeTab === "rating" && (
        <section className="feature-card">
          <div className="feature-heading">
            <span className="feature-icon">🏆</span>
            <div><span className="eyebrow">ЛИЧНАЯ ЛЕТОПИСЬ</span><h1>Достижения</h1></div>
          </div>
          <p className="feature-intro">Публичный рейтинг появится после серверной проверки результатов. Сейчас здесь только твоя честная статистика.</p>
          <div className="stat-grid">
            <article><span>🛡️</span><b>{stats.wavesWon}</b><small>волн отбито</small></article>
            <article><span>⚔️</span><b>{stats.unitsMerged}</b><small>объединений</small></article>
            <article><span>🏕️</span><b>{stats.campaignsWon}</b><small>походов завершено</small></article>
            <article><span>🎬</span><b>{stats.adsWatched}</b><small>наград получено</small></article>
          </div>
          <div className="social-actions">
            <button onClick={shareResult} disabled={!vkReady}>Поделиться результатом</button>
            <button onClick={inviteFriends} disabled={!vkReady}>Позвать друзей</button>
          </div>
          {!vkReady && <p className="feature-note">Социальные функции доступны внутри приложения VK.</p>}
        </section>
      )}

      <nav className="bottom-nav" aria-label="Разделы игры">
        <button className={activeTab === "campaign" ? "active" : ""} onClick={() => setActiveTab("campaign")} aria-current={activeTab === "campaign" ? "page" : undefined}>
          <span>⚔️</span>Поход
        </button>
        <button className={activeTab === "camp" ? "active" : ""} onClick={() => setActiveTab("camp")} disabled={running} aria-current={activeTab === "camp" ? "page" : undefined}>
          <span>🏕️</span>Лагерь
        </button>
        <button className={activeTab === "quests" ? "active" : ""} onClick={() => setActiveTab("quests")} disabled={running} aria-current={activeTab === "quests" ? "page" : undefined}>
          <span>📜</span>Задания{activeQuestCount > 0 && <i>{activeQuestCount}</i>}
        </button>
        <button className={activeTab === "rating" ? "active" : ""} onClick={() => setActiveTab("rating")} disabled={running} aria-current={activeTab === "rating" ? "page" : undefined}>
          <span>🏆</span>Итоги
        </button>
      </nav>

      {showStart && (
        <div
          className="start-screen"
          role="dialog"
          aria-modal="true"
          aria-labelledby="start-title"
          data-game-dialog="active"
        >
          <div className="start-rays" />
          <div className="start-card">
            <div className="start-emblem">Д</div>
            <span className="start-kicker">СКАЗАНИЕ О ДРЕВНИХ ЗЕМЛЯХ</span>
            <h2 id="start-title">ДРУЖИНА</h2>
            <p className="start-subtitle">ЗАЩИТА ГОРОДА</p>
            <div className="start-divider"><i />⚔<i /></div>
            <p className="start-progress">
              {victory || stats.campaignsWon >= campaign
                ? `Открыт поход ${campaign + 1} · ${getCampaignProfile(campaign + 1).title}`
                : `Поход ${campaign} · ${campaignProfile.title} · Волна ${wave} из ${MAX_WAVE}`}
            </p>
            <button className="start-play" onClick={startOrContinue} disabled={!hydrated}>
              <span>▶</span>
              <b>
                {!hydrated
                  ? "ЗАГРУЗКА…"
                  : victory || stats.campaignsWon >= campaign
                    ? `ПОХОД ${campaign + 1}`
                    : defeat || castleHp <= 0
                      ? "ВЕРНУТЬСЯ К ДРУЖИНЕ"
                      : wave > 1 || stats.wavesWon > 0
                        ? "ПРОДОЛЖИТЬ"
                        : "НАЧАТЬ ИГРУ"}
              </b>
            </button>
            <div className="start-secondary">
              <button onClick={() => setShowHelp(true)}><span>📜</span>Как играть</button>
              <button onClick={() => setShowSettings(true)}><span>⚙️</span>Настройки</button>
            </div>
            {vkReady && tutorialDone && (
              <button
                className="start-ad"
                onClick={showRewardedAd}
                disabled={adBusy || Boolean(rewardBlockedReason)}
                title={rewardBlockedReason}
              >
                🎬 {adBusy ? "Загрузка рекламы…" : rewardBlockedReason || `Получить ${REWARD_COINS} монет за рекламу`}
              </button>
            )}
            {adStatus && <p className="start-ad-status" role="status">{adStatus}</p>}
            <small>Объединяй воинов · Защищай город · Стань легендой</small>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="modal-backdrop settings-backdrop" onClick={() => setShowSettings(false)}>
          <div className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" data-game-dialog="active" onClick={(event) => event.stopPropagation()}>
            <span className="modal-icon">⚙️</span>
            <h2 id="settings-title">Настройки</h2>
            <button className="setting-row" onClick={() => setSound(!sound)}>
              <span>Звук</span><b>{sound ? "Включён 🔊" : "Выключен 🔇"}</b>
            </button>
            <button className="setting-row" onClick={() => { setShowSettings(false); setShowHelp(true); }}>
              <span>Правила игры</span><b>Открыть →</b>
            </button>
            <div className="legal-links">
              <Link href="/privacy/">Конфиденциальность</Link>
              <Link href="/terms/">Правила сервиса</Link>
            </div>
            <button className="reset-progress" disabled={!hydrated} onClick={() => {
              if (window.confirm("Удалить весь прогресс, улучшения и статистику?")) resetAllProgress();
            }}>Удалить весь прогресс</button>
            <button className="settings-close" onClick={() => setShowSettings(false)}>Готово</button>
          </div>
        </div>
      )}

      {showResources && (
        <div className="modal-backdrop" onClick={() => setShowResources(null)}>
          <div className="modal resource-modal" role="dialog" aria-modal="true" aria-labelledby="resource-title" data-game-dialog="active" onClick={(event) => event.stopPropagation()}>
            <span className="modal-icon">{showResources === "coins" ? "🪙" : "💎"}</span>
            <h2 id="resource-title">{showResources === "coins" ? "Получить монеты" : "Получить кристаллы"}</h2>
            <p>
              {showResources === "coins"
                ? "Монеты выдаются за волны, задания и добровольный просмотр рекламы."
                : "Кристаллы выдаются за ежедневные задания и завершённые походы."}
            </p>
            {showResources === "coins" && vkReady && (
              <button onClick={() => { setShowResources(null); void showRewardedAd(); }} disabled={Boolean(rewardBlockedReason)}>
                {rewardBlockedReason || `Смотреть рекламу · +${REWARD_COINS}`}
              </button>
            )}
            <button onClick={() => { setShowResources(null); setShowStart(false); setActiveTab("quests"); }}>Открыть задания</button>
            <button className="secondary-modal-button" onClick={() => setShowResources(null)}>Закрыть</button>
          </div>
        </div>
      )}

      {showHelp && (
        <div className="modal-backdrop" onClick={() => setShowHelp(false)}>
          <div className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" data-game-dialog="active" onClick={(event) => event.stopPropagation()}>
            <span className="modal-icon" aria-hidden="true">🛡️</span>
            <h2 id="help-title">Как играть</h2>
            <ol className="help-steps">
              <li><b>Собери дружину.</b> Выбирай одинаковых бойцов одного уровня, чтобы объединить их и получить прирост силы.</li>
              <li><b>Учитывай роли.</b> Лучники стреляют раньше, волхвы бьют по площади, ратники сильнее у стен, а стражи защищают город.</li>
              <li><b>Подготовься к волне.</b> Сверь силу с советом разведки, лечи стены и нажимай «В бой!».</li>
              <li><b>Развивай лагерь.</b> Постоянные улучшения и ежедневные задания сохраняются между походами.</li>
            </ol>
            <button onClick={() => setShowHelp(false)}>Понятно</button>
          </div>
        </div>
      )}

      {showResult && (victory || defeat) && (
        <div className="modal-backdrop" onClick={() => setShowResult(false)}>
          <div className="modal result-modal" role="dialog" aria-modal="true" aria-labelledby="result-title" data-game-dialog="active" onClick={(event) => event.stopPropagation()}>
            <span className="modal-icon" aria-hidden="true">{victory ? "🏆" : "🔥"}</span>
            <h2 id="result-title">{victory ? "Земли спасены!" : "Город пал"}</h2>
            <p>
              {victory
                ? `Поход ${campaign} завершён. Получено 3 кристалла. Следующая глава — «${getCampaignProfile(campaign + 1).title}», а награды станут ценнее.`
                : `Дружина и ресурсы сохранены. Стены можно восстановить до 65% и повторить волну ${wave} без полного сброса похода.`}
            </p>
            <div className="result-actions">
              <button onClick={victory ? () => startCampaign(campaign + 1) : retryCurrentWave}>
                {victory ? `Начать поход ${campaign + 1}` : `Повторить волну ${wave}`}
              </button>
              <button
                className="secondary-modal-button"
                onClick={() => {
                  setShowResult(false);
                  if (victory) setActiveTab("rating");
                }}
              >
                {victory ? "Вернуться к итогам" : "Сначала усилить дружину"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
