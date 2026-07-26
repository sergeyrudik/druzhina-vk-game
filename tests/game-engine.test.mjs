import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_WAVE,
  UNIT_LEVEL_MULTIPLIER,
  canMergeUnits,
  cloneInitialUnits,
  createDefaultSave,
  createWave,
  getCampaignProfile,
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
} from "../app/game-engine.ts";

test("initial units are cloned and have the expected base power", () => {
  const first = cloneInitialUnits();
  const second = cloneInitialUnits();

  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first[0], second[0]);
  assert.equal(getTotalPower(first), 25);
  assert.ok(Math.abs(getTotalPower(first, 2) - 29) < Number.EPSILON * 29);

  first[0].level = 4;
  assert.equal(second[0].level, 1);
});

test("every legal merge provides a real power gain", () => {
  for (const kind of ["sword", "bow", "mage", "guard"]) {
    for (let level = 1; level < 4; level += 1) {
      const first = { id: 1, kind, level };
      const second = { id: 2, kind, level };
      const before = getUnitPower(first) + getUnitPower(second);
      const result = mergeOrMove([first, second], 0, 1, 20);

      assert.equal(result.outcome, "merged");
      assert.ok(
        getUnitPower(result.unit) > before,
        `${kind} level ${level} should gain power after merging`,
      );
      assert.ok(Math.abs(getUnitPower(result.unit) / getUnitPower(first) - UNIT_LEVEL_MULTIPLIER) < 1e-12);
    }
  }
});

test("merge eligibility is explicit and respects the level cap", () => {
  const sword = { id: 1, kind: "sword", level: 2 };
  assert.equal(canMergeUnits(sword, { id: 2, kind: "sword", level: 2 }), true);
  assert.equal(canMergeUnits(sword, { id: 3, kind: "bow", level: 2 }), false);
  assert.equal(canMergeUnits(sword, { id: 4, kind: "sword", level: 3 }), false);
  assert.equal(canMergeUnits({ ...sword, level: 4 }, { id: 5, kind: "sword", level: 4 }), false);
  assert.equal(canMergeUnits(null, sword), false);
});

test("recruit cost grows at the configured wave thresholds", () => {
  assert.equal(getRecruitCost(0), 35);
  assert.equal(getRecruitCost(1), 35);
  assert.equal(getRecruitCost(3), 40);
  assert.equal(getRecruitCost(6), 45);
  assert.equal(getRecruitCost(10), 50);
});

test("balance helpers return finite bounded values for unsafe inputs", () => {
  assert.equal(getRecruitCost(Number.NaN), 35);
  assert.equal(getMaxCastleHp(Number.POSITIVE_INFINITY), 100);
  assert.equal(getStartingCoins(-100), 160);
  assert.equal(getUpgradeCost(Number.NaN), 3);
  assert.equal(getUnitPower({ id: 1, kind: "sword", level: Number.NaN }, Number.NaN), 7);
});

test("next entity id is always greater than saved unit and enemy ids", () => {
  const units = cloneInitialUnits();
  units[6] = { id: 47, kind: "mage", level: 2 };

  assert.equal(getNextId(units), 48);
  assert.equal(
    getNextId(units, [
      { id: 73, kind: "wolf", hp: 10, maxHp: 10, progress: 0 },
    ]),
    74,
  );
});

test("equal units merge without mutating the original board", () => {
  const original = cloneInitialUnits();
  const result = mergeOrMove(original, 0, 1, 20);

  assert.equal(result.outcome, "merged");
  assert.equal(result.nextId, 21);
  assert.equal(result.units[0], null);
  assert.deepEqual(result.units[1], { id: 20, kind: "sword", level: 2 });
  assert.ok(getTotalPower(result.units) > getTotalPower(original));
  assert.deepEqual(original[0], { id: 1, kind: "sword", level: 1 });
  assert.deepEqual(original[1], { id: 2, kind: "sword", level: 1 });
});

test("units move to empty cells and swap with non-matching units", () => {
  const original = cloneInitialUnits();
  const moved = mergeOrMove(original, 2, 3, 20);

  assert.equal(moved.outcome, "moved");
  assert.equal(moved.units[2], null);
  assert.deepEqual(moved.units[3], original[2]);
  assert.equal(moved.nextId, 20);

  const swapped = mergeOrMove(original, 0, 2, 20);
  assert.equal(swapped.outcome, "swapped");
  assert.deepEqual(swapped.units[0], original[2]);
  assert.deepEqual(swapped.units[2], original[0]);
});

test("level-four units cannot merge beyond the level cap", () => {
  const board = Array.from({ length: 12 }, () => null);
  board[0] = { id: 1, kind: "guard", level: 4 };
  board[1] = { id: 2, kind: "guard", level: 4 };

  const result = mergeOrMove(board, 0, 1, 20);
  assert.equal(result.outcome, "swapped");
  assert.equal(result.nextId, 20);
  assert.equal(result.units.filter(Boolean).length, 2);
});

test("invalid merge selections are safe no-ops", () => {
  const board = cloneInitialUnits();

  for (const [selected, target] of [
    [-1, 0],
    [0, -1],
    [0, 0],
    [99, 0],
    [3, 4],
  ]) {
    const result = mergeOrMove(board, selected, target, 20);
    assert.equal(result.outcome, "noop");
    assert.strictEqual(result.units, board);
  }
});

test("boss waves contain one troll and preserve unique sequential ids", () => {
  const result = createWave(5, 50, 1, () => 1);

  assert.equal(result.isBossWave, true);
  assert.equal(result.chapter.title, "Берёзовый тракт");
  assert.equal(result.enemies.length, 8);
  assert.deepEqual(
    result.enemies.map((enemy) => enemy.id),
    [50, 51, 52, 53, 54, 55, 56, 57],
  );
  assert.equal(result.nextId, 58);
  assert.equal(result.enemies.at(-1).kind, "troll");
  assert.ok(result.enemies.slice(0, -1).every((enemy) => enemy.kind === "goblin"));
  assert.ok(result.enemies.every((enemy) => enemy.hp === enemy.maxHp && enemy.hp > 0));
});

test("campaign profiles rotate distinct chapters and scale without runaway values", () => {
  const first = getCampaignProfile(1);
  const second = getCampaignProfile(2);
  const sixth = getCampaignProfile(6);
  const endless = getCampaignProfile(999);

  assert.equal(first.title, "Берёзовый тракт");
  assert.equal(second.title, "Волчья пуща");
  assert.notEqual(first.wolfChance, second.wolfChance);
  assert.equal(second.healthMultiplier, 1.2);
  assert.equal(sixth.chapter, 1);
  assert.equal(sixth.cycle, 2);
  assert.match(sixth.title, /круг 2/);
  assert.equal(endless.healthMultiplier, 3);
  assert.equal(endless.rewardMultiplier, 1.75);
  assert.equal(endless.extraEnemies, 2);
});

test("wave balance is deterministic and rewards later campaigns", () => {
  const opening = getWaveBalance(1, 1);
  const boss = getWaveBalance(5, 3);

  assert.deepEqual(
    {
      wave: opening.wave,
      enemyCount: opening.enemyCount,
      isBossWave: opening.isBossWave,
      completionReward: opening.completionReward,
    },
    { wave: 1, enemyCount: 4, isBossWave: false, completionReward: 22 },
  );
  assert.equal(boss.enemyCount, 9);
  assert.equal(boss.isBossWave, true);
  assert.ok(boss.healthMultiplier > opening.healthMultiplier);
  assert.ok(boss.completionReward > getWaveReward(5, 1));
  assert.equal(getWaveReward(Number.NaN, Number.NaN), 22);
});

test("wave and campaign inputs are clamped and scaled predictably", () => {
  const first = createWave(1, 20, 1, () => 0);
  const lateCampaign = createWave(MAX_WAVE + 100, 20, 3, () => 0);

  assert.equal(first.enemies.length, 4);
  assert.ok(first.enemies.every((enemy) => enemy.kind === "wolf"));
  assert.equal(lateCampaign.enemies.length, 10);
  assert.equal(lateCampaign.isBossWave, true);
  assert.ok(lateCampaign.enemies[0].hp > first.enemies[0].hp);
});

test("wave generation sanitizes ids and non-finite random values", () => {
  const result = createWave(Number.NaN, -50, 2, () => Number.NaN);

  assert.equal(result.enemies[0].id, 1);
  assert.equal(result.nextId, 5);
  assert.ok(result.enemies.every((enemy) => enemy.kind === "wolf"));
  assert.ok(result.enemies.every((enemy) => Number.isFinite(enemy.hp) && enemy.hp > 0));
});

test("healing spends crystals only when the castle can be healed", () => {
  assert.deepEqual(healCastle(40, 5), {
    castleHp: 65,
    crystals: 3,
    healed: true,
  });
  assert.deepEqual(healCastle(90, 2), {
    castleHp: 100,
    crystals: 0,
    healed: true,
  });
  assert.deepEqual(healCastle(100, 8), {
    castleHp: 100,
    crystals: 8,
    healed: false,
  });
  assert.deepEqual(healCastle(50, 1), {
    castleHp: 50,
    crystals: 1,
    healed: false,
  });
});

test("legacy saves migrate to the current complete schema", () => {
  const migrated = migrateSave({
    units: cloneInitialUnits(),
    coins: 275,
    wave: 4,
    castleHp: 71,
  });

  assert.ok(migrated);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.coins, 275);
  assert.equal(migrated.wave, 4);
  assert.equal(migrated.castleHp, 71);
  assert.equal(migrated.crystals, 8);
  assert.equal(migrated.campaign, 1);
  assert.equal(migrated.sound, true);
  assert.equal(migrated.units.length, 12);
  assert.deepEqual(migrated.upgrades, { forge: 0, walls: 0, treasury: 0 });
  assert.match(migrated.daily.date, /^\d{4}-\d{2}-\d{2}$/);
});

test("save migration rejects malformed JSON and clamps unsafe values", () => {
  assert.equal(migrateSave("{not-json"), null);
  assert.equal(migrateSave(null), null);

  const migrated = migrateSave({
    version: 2,
    units: [{ id: 1, kind: "invalid", level: 99 }],
    coins: -10,
    crystals: Number.POSITIVE_INFINITY,
    wave: 999,
    castleHp: 999,
    campaign: 0,
    upgrades: { forge: 99, walls: 2, treasury: -1 },
    stats: { bestWave: 500 },
    rewards: { date: "2000-01-01", count: 999, lastRewardAt: -1 },
  });

  assert.ok(migrated);
  assert.equal(migrated.coins, 0);
  assert.equal(migrated.crystals, 8);
  assert.equal(migrated.wave, MAX_WAVE);
  assert.equal(migrated.castleHp, 120);
  assert.equal(migrated.campaign, 1);
  assert.deepEqual(migrated.upgrades, { forge: 5, walls: 2, treasury: 0 });
  assert.equal(migrated.stats.bestWave, MAX_WAVE);
  assert.equal(migrated.rewards.count, 0);
  assert.equal(migrated.rewards.lastRewardAt, 0);
  assert.ok(migrated.units.some(Boolean), "an invalid/empty board falls back to initial units");
});

test("serialized saves round-trip without losing fields", () => {
  const save = createDefaultSave(1_234_567);
  save.campaign = 3;
  save.crystals = 17;
  save.sound = false;
  save.upgrades.forge = 2;

  const restored = migrateSave(serializeSave(save));
  assert.deepEqual(restored, save);
});

test("the newest timestamp wins between local and VK saves", () => {
  const local = createDefaultSave(100);
  const cloud = createDefaultSave(200);
  local.coins = 111;
  cloud.coins = 222;

  assert.strictEqual(selectNewestSave(local, cloud), cloud);
  assert.strictEqual(selectNewestSave(cloud, local), cloud);
  assert.strictEqual(selectNewestSave(local, null), local);
  assert.strictEqual(selectNewestSave(null, cloud), cloud);
});
