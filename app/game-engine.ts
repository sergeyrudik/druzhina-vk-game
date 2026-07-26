export type UnitKind = "sword" | "bow" | "mage" | "guard";
export type EnemyKind = "goblin" | "wolf" | "troll";

export type Unit = {
  id: number;
  kind: UnitKind;
  level: number;
};

export type Enemy = {
  id: number;
  hp: number;
  maxHp: number;
  progress: number;
  kind: EnemyKind;
};

export type Upgrades = {
  forge: number;
  walls: number;
  treasury: number;
};

export type GameStats = {
  wavesWon: number;
  unitsMerged: number;
  unitsRecruited: number;
  campaignsWon: number;
  bestWave: number;
  adsWatched: number;
};

export type DailyProgress = {
  date: string;
  merge: number;
  recruit: number;
  wave: number;
  claimed: string[];
};

export type RewardLimits = {
  date: string;
  count: number;
  lastRewardAt: number;
};

export type CampaignProfile = {
  campaign: number;
  chapter: number;
  cycle: number;
  title: string;
  healthMultiplier: number;
  rewardMultiplier: number;
  extraEnemies: number;
  wolfChance: number;
  bossHealthMultiplier: number;
};

export type WaveBalance = {
  wave: number;
  campaign: CampaignProfile;
  enemyCount: number;
  isBossWave: boolean;
  healthMultiplier: number;
  completionReward: number;
};

export type GameSave = {
  version: 2;
  updatedAt: number;
  units: Array<Unit | null>;
  coins: number;
  crystals: number;
  wave: number;
  castleHp: number;
  campaign: number;
  sound: boolean;
  tutorialDone: boolean;
  upgrades: Upgrades;
  stats: GameStats;
  daily: DailyProgress;
  rewards: RewardLimits;
};

export const MAX_WAVE = 10;
export const MAX_UNIT_LEVEL = 4;
export const BOARD_SIZE = 12;
export const UNIT_LEVEL_MULTIPLIER = 2.25;

export const UNIT_DATA: Record<UnitKind, { icon: string; name: string; color: string; power: number }> = {
  sword: { icon: "⚔️", name: "Ратник", color: "#e66f3f", power: 7 },
  bow: { icon: "🏹", name: "Лучник", color: "#4f9c5e", power: 5 },
  mage: { icon: "✨", name: "Волхв", color: "#8266d4", power: 10 },
  guard: { icon: "🛡️", name: "Страж", color: "#3983b8", power: 6 },
};

export const INITIAL_UNITS: Array<Unit | null> = [
  { id: 1, kind: "sword", level: 1 },
  { id: 2, kind: "sword", level: 1 },
  { id: 3, kind: "bow", level: 1 },
  null,
  { id: 4, kind: "guard", level: 1 },
  null,
  null,
  null,
  null,
  null,
  null,
  null,
];

const UNIT_KINDS: UnitKind[] = ["sword", "bow", "mage", "guard"];
const CHAPTERS = [
  { title: "Берёзовый тракт", wolfChance: 0.3, bossHealthMultiplier: 1 },
  { title: "Волчья пуща", wolfChance: 0.58, bossHealthMultiplier: 0.95 },
  { title: "Каменный перевал", wolfChance: 0.2, bossHealthMultiplier: 1.18 },
  { title: "Туманные болота", wolfChance: 0.42, bossHealthMultiplier: 1.08 },
  { title: "Северная застава", wolfChance: 0.27, bossHealthMultiplier: 1.25 },
] as const;

function safeInteger(value: number, fallback: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

function safeLevel(value: number) {
  return safeInteger(value, 1, 1, MAX_UNIT_LEVEL);
}

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function cloneInitialUnits(): Array<Unit | null> {
  return INITIAL_UNITS.map((unit) => (unit ? { ...unit } : null));
}

export function createDefaultSave(now = Date.now()): GameSave {
  return {
    version: 2,
    updatedAt: now,
    units: cloneInitialUnits(),
    coins: 160,
    crystals: 8,
    wave: 1,
    castleHp: 100,
    campaign: 1,
    sound: true,
    tutorialDone: false,
    upgrades: { forge: 0, walls: 0, treasury: 0 },
    stats: {
      wavesWon: 0,
      unitsMerged: 0,
      unitsRecruited: 0,
      campaignsWon: 0,
      bestWave: 1,
      adsWatched: 0,
    },
    daily: { date: getLocalDateKey(), merge: 0, recruit: 0, wave: 0, claimed: [] },
    rewards: { date: getLocalDateKey(), count: 0, lastRewardAt: 0 },
  };
}

export function getUnitPower(unit: Unit, forgeLevel = 0): number {
  const data = UNIT_DATA[unit.kind];
  if (!data) return 0;
  const level = safeLevel(unit.level);
  const forge = safeInteger(forgeLevel, 0, 0, 5);
  return data.power * UNIT_LEVEL_MULTIPLIER ** (level - 1) * (1 + forge * 0.08);
}

export function getTotalPower(units: Array<Unit | null>, forgeLevel = 0): number {
  return units.reduce((sum, unit) => sum + (unit ? getUnitPower(unit, forgeLevel) : 0), 0);
}

export function canMergeUnits(source: Unit | null | undefined, target: Unit | null | undefined): boolean {
  return Boolean(
    source &&
      target &&
      source.kind === target.kind &&
      Number.isInteger(source.level) &&
      Number.isInteger(target.level) &&
      source.level >= 1 &&
      source.level === target.level &&
      target.level < MAX_UNIT_LEVEL,
  );
}

export function getCampaignProfile(campaign: number): CampaignProfile {
  const safeCampaign = safeInteger(campaign, 1, 1, 999);
  const chapterIndex = (safeCampaign - 1) % CHAPTERS.length;
  const cycle = Math.floor((safeCampaign - 1) / CHAPTERS.length) + 1;
  const chapter = CHAPTERS[chapterIndex];

  return {
    campaign: safeCampaign,
    chapter: chapterIndex + 1,
    cycle,
    title: cycle === 1 ? chapter.title : `${chapter.title} · круг ${cycle}`,
    // Linear growth is readable for players and the cap prevents endless saves
    // from becoming numerically impossible after a long absence.
    healthMultiplier: Math.min(3, 1 + (safeCampaign - 1) * 0.2),
    rewardMultiplier: Math.min(1.75, 1 + (safeCampaign - 1) * 0.08),
    extraEnemies: Math.min(2, Math.floor((safeCampaign - 1) / 2)),
    wolfChance: chapter.wolfChance,
    bossHealthMultiplier: chapter.bossHealthMultiplier,
  };
}

export function getWaveReward(wave: number, campaign = 1): number {
  const safeWave = safeInteger(wave, 1, 1, MAX_WAVE);
  const profile = getCampaignProfile(campaign);
  return Math.round((18 + safeWave * 4) * profile.rewardMultiplier);
}

export function getWaveBalance(wave: number, campaign = 1): WaveBalance {
  const safeWave = safeInteger(wave, 1, 1, MAX_WAVE);
  const profile = getCampaignProfile(campaign);
  const isBossWave = safeWave === 5 || safeWave === MAX_WAVE;
  return {
    wave: safeWave,
    campaign: profile,
    enemyCount: Math.min(3 + safeWave + profile.extraEnemies, 10),
    isBossWave,
    healthMultiplier: profile.healthMultiplier,
    completionReward: getWaveReward(safeWave, profile.campaign),
  };
}

export function getRecruitCost(wave: number): number {
  const safeWave = safeInteger(wave, 1, 1, MAX_WAVE);
  return 35 + Math.floor(safeWave / 3) * 5;
}

export function getMaxCastleHp(wallsLevel: number): number {
  return 100 + safeInteger(wallsLevel, 0, 0, 5) * 10;
}

export function getStartingCoins(treasuryLevel: number): number {
  return 160 + safeInteger(treasuryLevel, 0, 0, 5) * 20;
}

export function getUpgradeCost(level: number): number {
  return 3 + safeInteger(level, 0, 0, 5) * 2;
}

export function getNextId(units: Array<Unit | null>, enemies: Enemy[] = []): number {
  const unitIds = units.flatMap((unit) => (unit ? [unit.id] : []));
  const enemyIds = enemies.map((enemy) => enemy.id);
  return Math.max(19, ...unitIds, ...enemyIds) + 1;
}

export function mergeOrMove(
  units: Array<Unit | null>,
  selected: number,
  targetIndex: number,
  nextId: number,
): {
  units: Array<Unit | null>;
  nextId: number;
  outcome: "moved" | "merged" | "swapped" | "noop";
  unit?: Unit;
} {
  if (
    selected < 0 ||
    targetIndex < 0 ||
    selected >= units.length ||
    targetIndex >= units.length ||
    selected === targetIndex
  ) {
    return { units, nextId, outcome: "noop" };
  }

  const source = units[selected];
  const target = units[targetIndex];
  if (!source) return { units, nextId, outcome: "noop" };

  const result = [...units];
  if (!target) {
    result[targetIndex] = source;
    result[selected] = null;
    return { units: result, nextId, outcome: "moved", unit: source };
  }

  if (canMergeUnits(source, target)) {
    const merged = { ...target, id: nextId, level: target.level + 1 };
    result[targetIndex] = merged;
    result[selected] = null;
    return { units: result, nextId: nextId + 1, outcome: "merged", unit: merged };
  }

  result[targetIndex] = source;
  result[selected] = target;
  return { units: result, nextId, outcome: "swapped", unit: source };
}

export function createWave(
  wave: number,
  nextId: number,
  campaign = 1,
  random: () => number = Math.random,
): { enemies: Enemy[]; nextId: number; isBossWave: boolean; chapter: CampaignProfile } {
  const balance = getWaveBalance(wave, campaign);
  const safeWave = balance.wave;
  const safeNextId = safeInteger(nextId, 20, 1, Number.MAX_SAFE_INTEGER - balance.enemyCount);

  const enemies = Array.from({ length: balance.enemyCount }, (_, index): Enemy => {
    let kind: EnemyKind;
    const randomValue = random();
    const roll = Number.isFinite(randomValue) ? Math.min(1, Math.max(0, randomValue)) : 0.5;
    if (balance.isBossWave && index === balance.enemyCount - 1) {
      kind = "troll";
    } else if (roll < balance.campaign.wolfChance) {
      kind = "wolf";
    } else {
      kind = "goblin";
    }
    const baseHp = kind === "troll" ? 115 + safeWave * 8 : kind === "wolf" ? 39 : 50;
    const bossMultiplier = kind === "troll" ? balance.campaign.bossHealthMultiplier : 1;
    const hp = Math.round(baseHp * (1 + safeWave * 0.13) * balance.healthMultiplier * bossMultiplier);
    return { id: safeNextId + index, hp, maxHp: hp, progress: -index * 13, kind };
  });

  return {
    enemies,
    nextId: safeNextId + enemies.length,
    isBossWave: balance.isBossWave,
    chapter: balance.campaign,
  };
}

export function healCastle(
  castleHp: number,
  crystals: number,
  maxCastleHp = 100,
): { castleHp: number; crystals: number; healed: boolean } {
  if (crystals < 2 || castleHp >= maxCastleHp) return { castleHp, crystals, healed: false };
  return {
    castleHp: Math.min(maxCastleHp, castleHp + 25),
    crystals: crystals - 2,
    healed: true,
  };
}

function isUnit(value: unknown): value is Unit {
  if (!value || typeof value !== "object") return false;
  const unit = value as Partial<Unit>;
  return (
    typeof unit.id === "number" &&
    UNIT_KINDS.includes(unit.kind as UnitKind) &&
    typeof unit.level === "number" &&
    unit.level >= 1 &&
    unit.level <= MAX_UNIT_LEVEL
  );
}

function finiteNumber(value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function normaliseDaily(value: unknown): DailyProgress {
  const today = getLocalDateKey();
  if (!value || typeof value !== "object") {
    return { date: today, merge: 0, recruit: 0, wave: 0, claimed: [] };
  }
  const daily = value as Partial<DailyProgress>;
  if (daily.date !== today) return { date: today, merge: 0, recruit: 0, wave: 0, claimed: [] };
  return {
    date: today,
    merge: finiteNumber(daily.merge, 0),
    recruit: finiteNumber(daily.recruit, 0),
    wave: finiteNumber(daily.wave, 0),
    claimed: Array.isArray(daily.claimed)
      ? daily.claimed.filter((key): key is string => typeof key === "string").slice(0, 8)
      : [],
  };
}

function normaliseRewards(value: unknown): RewardLimits {
  const today = getLocalDateKey();
  if (!value || typeof value !== "object") return { date: today, count: 0, lastRewardAt: 0 };
  const rewards = value as Partial<RewardLimits>;
  return {
    date: rewards.date === today ? today : today,
    count: rewards.date === today ? finiteNumber(rewards.count, 0, 0, 8) : 0,
    lastRewardAt: finiteNumber(rewards.lastRewardAt, 0),
  };
}

export function migrateSave(input: unknown): GameSave | null {
  let parsed = input;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;

  const source = parsed as Partial<GameSave> & { version?: number };
  const defaults = createDefaultSave();
  const unitsSource = Array.isArray(source.units) ? source.units : defaults.units;
  const units = Array.from({ length: BOARD_SIZE }, (_, index) => {
    const unit = unitsSource[index];
    return isUnit(unit) ? { ...unit, level: Math.round(unit.level) } : null;
  });
  if (!units.some(Boolean)) units.splice(0, BOARD_SIZE, ...cloneInitialUnits());

  const upgradesSource = source.upgrades && typeof source.upgrades === "object" ? source.upgrades : defaults.upgrades;
  const upgrades: Upgrades = {
    forge: finiteNumber(upgradesSource.forge, 0, 0, 5),
    walls: finiteNumber(upgradesSource.walls, 0, 0, 5),
    treasury: finiteNumber(upgradesSource.treasury, 0, 0, 5),
  };
  const maxCastleHp = getMaxCastleHp(upgrades.walls);
  const statsSource = source.stats && typeof source.stats === "object" ? source.stats : defaults.stats;

  return {
    version: 2,
    updatedAt: finiteNumber(source.updatedAt, 0),
    units,
    coins: finiteNumber(source.coins, defaults.coins, 0, 999_999),
    crystals: finiteNumber(source.crystals, defaults.crystals, 0, 99_999),
    wave: finiteNumber(source.wave, 1, 1, MAX_WAVE),
    castleHp: finiteNumber(source.castleHp, maxCastleHp, 0, maxCastleHp),
    campaign: finiteNumber(source.campaign, 1, 1, 999),
    sound: typeof source.sound === "boolean" ? source.sound : true,
    tutorialDone: typeof source.tutorialDone === "boolean" ? source.tutorialDone : false,
    upgrades,
    stats: {
      wavesWon: finiteNumber(statsSource.wavesWon, 0),
      unitsMerged: finiteNumber(statsSource.unitsMerged, 0),
      unitsRecruited: finiteNumber(statsSource.unitsRecruited, 0),
      campaignsWon: finiteNumber(statsSource.campaignsWon, 0),
      bestWave: finiteNumber(statsSource.bestWave, 1, 1, MAX_WAVE),
      adsWatched: finiteNumber(statsSource.adsWatched, 0),
    },
    daily: normaliseDaily(source.daily),
    rewards: normaliseRewards(source.rewards),
  };
}

export function serializeSave(save: GameSave): string {
  return JSON.stringify({ ...save, version: 2 });
}

export function selectNewestSave(localSave: GameSave | null, cloudSave: GameSave | null): GameSave | null {
  if (!localSave) return cloudSave;
  if (!cloudSave) return localSave;
  return cloudSave.updatedAt >= localSave.updatedAt ? cloudSave : localSave;
}
