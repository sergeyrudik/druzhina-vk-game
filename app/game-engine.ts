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

export function getTotalPower(units: Array<Unit | null>, forgeLevel = 0): number {
  const base = units.reduce(
    (sum, unit) => sum + (unit ? UNIT_DATA[unit.kind].power * 2.25 ** (unit.level - 1) : 0),
    0,
  );
  return base * (1 + Math.max(0, forgeLevel) * 0.08);
}

export function getRecruitCost(wave: number): number {
  return 35 + Math.floor(Math.max(1, wave) / 3) * 5;
}

export function getMaxCastleHp(wallsLevel: number): number {
  return 100 + Math.max(0, wallsLevel) * 10;
}

export function getStartingCoins(treasuryLevel: number): number {
  return 160 + Math.max(0, treasuryLevel) * 20;
}

export function getUpgradeCost(level: number): number {
  return 3 + Math.max(0, level) * 2;
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

  if (target.kind === source.kind && target.level === source.level && target.level < MAX_UNIT_LEVEL) {
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
): { enemies: Enemy[]; nextId: number; isBossWave: boolean } {
  const safeWave = Math.min(MAX_WAVE, Math.max(1, Math.round(wave)));
  const safeCampaign = Math.max(1, Math.round(campaign));
  const isBossWave = safeWave === 5 || safeWave === MAX_WAVE;
  const amount = Math.min(3 + safeWave + Math.floor((safeCampaign - 1) / 2), 10);
  const campaignMultiplier = 1 + (safeCampaign - 1) * 0.2;

  const enemies = Array.from({ length: amount }, (_, index): Enemy => {
    let kind: EnemyKind;
    if (isBossWave && index === amount - 1) {
      kind = "troll";
    } else if (random() < 0.34) {
      kind = "wolf";
    } else {
      kind = "goblin";
    }
    const baseHp = kind === "troll" ? 115 + safeWave * 8 : kind === "wolf" ? 39 : 50;
    const hp = Math.round(baseHp * (1 + safeWave * 0.13) * campaignMultiplier);
    return { id: nextId + index, hp, maxHp: hp, progress: -index * 13, kind };
  });

  return { enemies, nextId: nextId + enemies.length, isBossWave };
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
