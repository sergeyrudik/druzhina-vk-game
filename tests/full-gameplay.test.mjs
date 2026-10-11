import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as engine from "../app/game-engine.ts";
import { createAdPolicy, AD_INTERVAL_MS } from "../app/ad-policy.ts";

// Exercise the production event/effect bodies. Fake scheduling and local state
// are unit-logic evidence, not a browser/React/native VK certification.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const game = JSON.parse(fs.readFileSync(path.join(root, "package.json"))).name.replace("-vk-game", "");
const source = ts.createSourceFile("page.tsx", fs.readFileSync(path.join(root, "app/page.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const factories = new Map();
const variables = new Map();
const effects = new Map();
function evaluate(node, scope) {
  assert.ok(node, "production AST node exists");
  const names = Object.keys(scope);
  const key = node.pos + ":" + names.join(",");
  if (!factories.has(key)) {
    const code = ts.transpileModule(`const value = ${node.getText(source)};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    factories.set(key, Function(...names, `${code}\nreturn value;`));
  }
  return factories.get(key)(...Object.values(scope));
}
function variable(name, scope, callback = false) {
  if (!variables.has(name)) {
    function visit(n) {
      if (ts.isVariableDeclaration(n) && n.name.getText(source) === name) variables.set(name, n.initializer);
      ts.forEachChild(n, visit);
    }
    visit(source);
  }
  let node = variables.get(name);
  if (callback && ts.isCallExpression(node)) node = node.arguments[0];
  return evaluate(node, scope);
}
function effect(fragment, scope) {
  if (!effects.has(fragment)) {
    function visit(n) {
      if (ts.isCallExpression(n) && n.expression.getText(source) === "useEffect" && n.arguments[0]?.getText(source).includes(fragment)) effects.set(fragment, n.arguments[0]);
      ts.forEachChild(n, visit);
    }
    visit(source);
  }
  return evaluate(effects.get(fragment), scope)();
}
function resetAction(scope) {
  if (game === "druzhina") return variable("resetAllProgress", scope, true)();
  let handler;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "resetProgress") handler = node.initializer;
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "button" && node.children.some(child => ts.isJsxText(child) && child.text.trim() === "Сбросить")) {
      const attr = node.openingElement.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(source) === "onClick");
      if (attr?.initializer?.expression && ts.isArrowFunction(attr.initializer.expression)) handler = attr.initializer.expression;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return evaluate(handler, scope)();
}
function fixture() {
  const s = { ...engine.createDefaultSave(), save: engine.createDefaultSave(), running: false, showStart: true,
    userPaused: false, backgrounded: false, started: true, hydrated: true, tab: "play", adPending: false,
    interstitialBusy: false, distance: 0, lane: 1, entities: [], messages: [], toasts: [], enemies: [],
    paused: false, overlayPause: false, victory: false, defeat: false, tutorialStep: 0, selected: 0,
    active: 0, picked: [], now: 1_800_000_000_000, orders: [], kitchenActive: true, events: [], ads: 0,
  };
  const timers = [];
  const refs = { progressEpochRef: { current: 0 }, latestSaveRef: { current: s },
    saveGuardRef: { current: { latest: () => null, refresh: () => null, initialize() {}, revision: () => 0, persist: async () => ({value:null, external:null}) } }, nextId: { current: 20 }, enemiesRef: { current: [] }, battleLootRef: { current: 0 },
    battleTimer: { current: null }, adPendingRef: { current: false }, adBusyRef: { current: false },
    interstitialBusyRef: { current: false }, boundaryPendingRef: { current: false },
    bridgeRef: { current: null }, adPolicyRef: { current: { isBusy: () => false, startGameplay() {}, maybeInterstitial: async () => false, seedLastAdAt() {}, rewardWaitMs: () => 0 } },
    saveRef: { current: s.save }, pausedAtRef: { current: null },
  };
  const noop = () => {};
  const window = { setInterval: (fn, ms) => { timers.push({ fn, ms, interval: true }); return timers.length; },
    clearInterval: noop, setTimeout: (fn, ms) => { timers.push({ fn, ms, interval: false }); return timers.length; }, clearTimeout: noop };
  function scope() {
    const x = { syncExternalBeforeAction:()=>false, readCurrentRaw:()=>null, readStoredValue:()=>null, SAVE_KEY:"single-session-test", ...engine, ...s, ...refs, window, clearInterval: noop,
      save: s.save, vkReady: s.vkReady ?? false, adAvailable: s.adAvailable ?? false,
      REVIVE_COST_COINS: 12, REWARD_COINS: 75, REWARD_LIVES: 2, MAX_LIVES: 5,
      REWARD_DAILY_LIMIT: 8, REWARD_COOLDOWN_MS: AD_INTERVAL_MS,
      playTone: noop, playSound: noop, haptic: noop, trackEvent: (v) => s.events.push(v),
      checkRewardAvailability: async () => {}, persistValue: noop,
      setSave: (v) => { s.save = typeof v === "function" ? v(s.save) : v; refs.saveRef.current = s.save; },
      setMessage: (v) => { s.message = v; s.messages.push(v); }, setToast: (v) => s.toasts.push(v), showToast: (v) => s.toasts.push(v),
      setAdStatus: noop, setCommonRewardWait: noop, performance: { now: () => s.now, timeOrigin: 0 },
    };
    for (const name of ["SaveRenderRevision", "Coins", "Crystals", "Units", "Upgrades", "Daily", "Rewards", "Stats", "Running", "Paused", "UserPaused", "Distance", "Entities", "Lane", "Victory", "Defeat", "ShowResult", "ShowSettings", "ShowHelp", "ShowStart", "ShowResources", "Sound", "Selected", "ActiveTab", "Enemies", "BossWave", "TutorialDone", "TutorialStep", "Wave", "Campaign", "CastleHp", "Orders", "Picked", "ShakePlate", "Active", "Now", "Started", "Tab", "AdPending", "AdBusy", "Clock", "AdAvailable"]) {
      const key = name[0].toLowerCase() + name.slice(1);
      x["set" + name] = (v) => { s[key] = typeof v === "function" ? v(s[key]) : v; };
    }
    x.maybeShowKitchenInterstitial = async () => { s.ads += 1; return false; };
    x.maybeShowInterstitial = async () => { s.ads += 1; return false; };
    if (game === "traktir") {
      x.beginKitchen = variable("beginKitchen", x, true);
      x.applySave = variable("applySave", x, true);
    }
    if (game === "druzhina") {
      x.totalPower = engine.getTotalPower(s.units, s.upgrades.forge);
      x.maxCastleHp = engine.getMaxCastleHp(s.upgrades.walls);
      x.combatProfile = variable("combatProfile", x, true)();
      x.recruitCost = engine.getRecruitCost(s.wave);
      x.incrementDaily = variable("incrementDaily", x, true);
      x.DAILY_QUESTS = variable("DAILY_QUESTS", {});
      x.UPGRADE_DATA = variable("UPGRADE_DATA", {});
      x.applySave = variable("applySave", x, true);
      x.clock = s.clock ?? Date.now();
      x.commonRewardWait = refs.adPolicyRef.current.rewardWaitMs();
      x.adBusy = false;
      x.rewardBlockedReason = variable("rewardBlockedReason", x, true)();
    }
    return x;
  }
  return { s, refs, timers, scope,
    call: (name, ...args) => variable(name, scope(), true)(...args),
    run: (fragment) => effect(fragment, scope()),
    tick: (ms) => { const timer = timers.findLast(t => t.ms === ms); assert.ok(timer, `scheduled ${ms}ms callback`); timer.fn(); },
  };
}

for (const count of [3, 8]) {
  test(`${game} actual progress reset preserves same-day reward quota and rejects a ninth SDK reward even after common cooldown`, async () => {
    const f = fixture();
    const now = Date.now();
    const earned = { date: engine.getLocalDateKey(), count, lastRewardAt: now - AD_INTERVAL_MS };
    f.s.rewards = { ...earned }; f.s.save.rewards = { ...earned };
    f.s.coins = 777; f.s.save.coins = 777;
    let clock = now;
    const storage = new Map(); const calls = [];
    f.refs.adPolicyRef.current = createAdPolicy({ settle: async()=>{}, storageKey: "gameplay-reset-quota", now: () => clock,
      storage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) } });
    f.refs.adPolicyRef.current.seedLastAdAt(earned.lastRewardAt);
    f.refs.bridgeRef.current = { send: async (method) => { calls.push(method); return { result: true }; } };
    f.s.vkReady = true; f.s.adAvailable = true;
    resetAction(f.scope());
    const resetSave = game === "druzhina" ? f.s : f.s.save;
    assert.deepEqual(resetSave.rewards, earned, "reset must retain earned quota/timestamp while resetting game progress");
    assert.equal(resetSave.coins, engine.createDefaultSave().coins);
    if (count === 8) {
      clock += AD_INTERVAL_MS; f.s.clock = clock;
      await f.call(game === "druzhina" ? "showRewardedAd" : game === "sani" ? "reviveByAd" : "watchAdForLives");
      assert.equal(calls.filter(m => m === "VKWebAppShowNativeAds").length, 0);
      assert.equal(resetSave.stats.adsWatched, 0);
      assert.equal(resetSave.rewards.count, 8);
    }
  });
}

test(`${game} actual progress reset refreshes an old-day quota but retains last successful ad timestamp`, () => {
  const f = fixture();
  const lastRewardAt = Date.now() - 1000;
  f.s.rewards = { date: "2000-01-01", count: 8, lastRewardAt };
  f.s.save.rewards = { ...f.s.rewards };
  resetAction(f.scope());
  const rewards = game === "druzhina" ? f.s.rewards : f.s.save.rewards;
  assert.equal(rewards.date, engine.getLocalDateKey()); assert.equal(rewards.count, 0);
  assert.equal(rewards.lastRewardAt, lastRewardAt);
});

test(`${game} actual ninth reward stays SDK-blocked after reset with elapsed common cooldown`, async () => {
  const f = fixture(); const now = Date.now(); const calls = [];
  const rewards = { date: engine.getLocalDateKey(), count: 8, lastRewardAt: now - AD_INTERVAL_MS };
  f.s.rewards = { ...rewards }; f.s.save.rewards = { ...rewards };
  f.s.vkReady = true; f.s.adAvailable = true; f.s.clock = now + AD_INTERVAL_MS;
  f.refs.bridgeRef.current = { send: async method => { calls.push(method); return { result: true }; } };
  f.refs.adPolicyRef.current = createAdPolicy({ settle: async()=>{}, storageKey: "ninth-reset-test", now: () => now + AD_INTERVAL_MS,
    storage: { getItem: () => null, setItem() {} } });
  f.refs.adPolicyRef.current.seedLastAdAt(rewards.lastRewardAt);
  resetAction(f.scope());
  await f.call(game === "druzhina" ? "showRewardedAd" : game === "sani" ? "reviveByAd" : "watchAdForLives");
  assert.equal(calls.filter(method => method === "VKWebAppShowNativeAds").length, 0);
});

for (const lock of ["sharedAd", "rewardPending", "boundaryPending"]) {
  test(`${game} actual reset cannot erase progress during ${lock}`, () => {
    const f = fixture(); f.s.coins = 777; f.s.save.coins = 777;
    if (lock === "sharedAd") f.refs.adPolicyRef.current.isBusy = () => true;
    if (lock === "rewardPending") { f.refs.adPendingRef.current = true; f.refs.adBusyRef.current = true; }
    if (lock === "boundaryPending") f.refs.boundaryPendingRef.current = true;
    resetAction(f.scope());
    assert.equal(game === "druzhina" ? f.s.coins : f.s.save.coins, 777);
  });
}

if (game === "sani") {
  test("sani actual run/crash/new-run/revive preserves resource and statistics rules", async () => {
    const f = fixture();
    await f.call("startRun");
    assert.equal(f.s.save.stats.runs, 1);
    f.s.entities = [{ id: 800, lane: 1, y: 0.70, kind: "tree" }];
    f.run("const next = d + 1"); f.tick(50);
    assert.equal(f.s.running, false);
    assert.equal(f.s.distance, 1);
    assert.equal(f.s.save.best, 1);
    assert.equal(f.s.save.stats.crashes, 1);
    assert.equal(f.s.message, "Крушение на 1 м");
    const before = f.s.save.coins;
    f.call("reviveByCoins");
    assert.equal(f.s.save.coins, before - 12);
    assert.equal(f.s.running, true);
    assert.equal(f.s.distance, 1, "paid continue retains run distance");
    assert.equal(f.s.save.stats.runs, 1, "continue is not a new run");
    await f.call("resetForNewRun");
    assert.equal(f.s.running, false); assert.equal(f.s.distance, 0);
    await f.call("startRun");
    assert.equal(f.s.save.stats.runs, 2);
    assert.equal(f.s.save.coins, before - 12);
  });
  test("sani production coin collision collects once then durable save round-trips", () => {
    const f = fixture(); f.s.running = true;
    f.s.entities = [{ id: 810, lane: 1, y: 0.70, kind: "coin" }];
    f.run("const next = d + 1"); f.tick(50); f.tick(50);
    assert.equal(f.s.save.coins, 21); assert.equal(f.s.save.stats.coinsCollected, 1);
    assert.deepEqual(engine.migrateSave(engine.serializeSave(f.s.save)).stats, f.s.save.stats);
  });
  for (const [key, value] of [["running", false], ["userPaused", true], ["backgrounded", true], ["tab", "help"], ["tab", "stats"], ["adPending", true], ["interstitialBusy", true], ["started", false]]) {
    test(`sani production movement effect does not schedule gameplay when ${key}=${value}`, () => {
      const f = fixture(); f.s.running = true; f.s[key] = value;
      f.run("const next = d + 1"); assert.equal(f.timers.length, 0);
    });
  }
  test("sani insufficient coin revive and unavailable ad leave crashed state unchanged", async () => {
    const f = fixture(); f.s.save.coins = 11; f.s.distance = 77; f.s.message = "Крушение на 77 м";
    f.call("reviveByCoins"); await f.call("reviveByAd");
    assert.equal(f.s.save.coins, 11); assert.equal(f.s.running, false); assert.equal(f.s.distance, 77);
    assert.equal(f.s.save.stats.adsWatched, 0);
    assert.deepEqual(f.s.toasts, ["Не хватает монет", "Реклама пока недоступна"]);
  });
}

if (game === "traktir") {
  test("traktir actual wrong prefix/clear-equivalent state does not spend lives and complete serve rewards exactly once", () => {
    const f = fixture();
    f.s.orders = [{ id: 1, recipe: ["bread", "meat"], reward: 8, createdAt: f.s.now, deadline: f.s.now + 14000 }];
    f.call("pickIngredient", "fish");
    assert.equal(f.s.save.lives, 3); assert.equal(f.s.save.coins, 20); assert.deepEqual(f.s.picked, []);
    assert.equal(f.s.toasts.at(-1), "Не тот порядок");
    f.call("pickIngredient", "bread"); assert.deepEqual(f.s.picked, ["bread"]);
    const expected = engine.applyServe(f.s.save, f.s.orders[0], f.s.now);
    f.call("pickIngredient", "meat");
    assert.deepEqual(f.s.save, expected); assert.deepEqual(f.s.picked, []);
    assert.equal(f.s.save.stats.served, 1); assert.equal(f.s.save.streak, 1);
    assert.equal(f.s.toasts.at(-1), "Подано!");
  });
  test("traktir production expiry can burn simultaneous orders, completes one shift and retry preserves earned totals", async () => {
    const f = fixture(); f.s.save.score = 120; f.s.save.best = 190; f.s.save.coins = 83; f.s.save.streak = 5;
    f.s.orders = Array.from({ length: 3 }, (_, id) => ({ id, recipe: ["pie"], reward: 6, createdAt: f.s.now - 16000, deadline: f.s.now - 1 }));
    f.run("const alive = list.filter"); f.tick(250);
    assert.equal(f.s.save.lives, 0); assert.equal(f.s.save.streak, 0); assert.equal(f.s.save.stats.plays, 1);
    assert.equal(f.s.orders.length, 0); assert.equal(f.s.toasts.at(-1), "Заказы сгорели");
    await f.call("startNewShift");
    assert.equal(f.s.save.lives, 3); assert.equal(f.s.save.score, 0); assert.equal(f.s.save.streak, 0);
    assert.equal(f.s.save.coins, 83); assert.equal(f.s.save.best, 190); assert.equal(f.s.save.stats.plays, 1);
    assert.equal(f.s.orders.length, 2);
  });
  test("traktir actual new kitchen and unavailable reward do not grant any lives or reset score", async () => {
    const f = fixture(); f.s.save.lives = 0; f.s.save.score = 90;
    await f.call("watchAdForLives");
    assert.equal(f.s.save.lives, 0); assert.equal(f.s.save.score, 90); assert.equal(f.s.save.stats.adsWatched, 0);
    assert.equal(f.s.message, "Реклама пока недоступна");
    assert.equal(engine.migrateSave(engine.serializeSave(f.s.save)).lives, 0);
  });
  test("traktir production expiry effect does not run when kitchen is paused", () => {
    const f = fixture(); f.s.kitchenActive = false;
    f.run("const alive = list.filter"); assert.equal(f.timers.length, 0);
  });
}

if (game === "druzhina") {
  function naturalCampaign(seed, { spend = true, campaign = 1, startWave = 1 } = {}) {
    const f = fixture(); f.s.campaign = campaign; f.s.wave = startWave;
    if (startWave === 3) {
      // Explicit logic fixture approximating root's documented UI state. This
      // does not alter the browser: 32.75 power = merged sword + bow +2 guards.
      f.s.units = engine.cloneInitialUnits();
      f.call("chooseCell", 1);
      f.s.units[0] = { id: 19, kind: "guard", level: 1 };
      f.s.coins = 261; f.s.crystals = 8; f.s.castleHp = 84;
    }
    let word = seed;
    const nativeRandom = Math.random;
    Math.random = () => { word = (Math.imul(word, 1664525) + 1013904223) >>> 0; return word / 2 ** 32; };
    const waves = [];
    try {
      function mergeAll() {
        for (let guard = 0; guard < 100; guard++) {
          let pair;
          for (let a = 0; a < f.s.units.length; a++) for (let b = a + 1; b < f.s.units.length; b++) {
            if (!pair && engine.canMergeUnits(f.s.units[a], f.s.units[b])) pair = [a, b];
          }
          if (!pair) return;
          f.s.selected = pair[0]; f.call("chooseCell", pair[1]);
        }
        assert.fail("merge strategy must terminate");
      }
      function claimEligible() {
        for (const name of ["recruit", "merge", "wave"]) f.call("claimQuest", name);
      }
      if (spend) {
        f.call("buyUpgrade", "walls"); f.call("buyUpgrade", "forge");
      }
      for (let rounds = 0; rounds < 20 && !f.s.victory; rounds++) {
        if (spend) {
          mergeAll(); claimEligible();
          for (let buys = 0; buys < 100 && f.s.coins >= engine.getRecruitCost(f.s.wave) && f.s.units.some(u => !u); buys++) {
            f.call("buyUnit"); mergeAll(); claimEligible();
          }
          const maxHp = engine.getMaxCastleHp(f.s.upgrades.walls);
          while (f.s.castleHp < maxHp - 10 && f.s.crystals >= 2) f.call("heal");
        }
        const before = { wave: f.s.wave, hp: f.s.castleHp, power: engine.getTotalPower(f.s.units, f.s.upgrades.forge), coins: f.s.coins, crystals: f.s.crystals };
        f.call("spawnCurrentWave");
        assert.equal(f.s.running, true);
        f.run("battleTimer.current = window.setInterval");
        let ticks = 0;
        while (f.s.enemies.length > 0 && ticks++ < 1000) f.tick(420);
        assert.ok(ticks < 1000, "battle must terminate in finite time");
        f.run("const completionReward = getWaveReward"); f.tick(260);
        waves.push({ ...before, ticks, endHP: f.s.castleHp, coinsAfter: f.s.coins, lost: f.s.defeat });
        if (f.s.defeat) return { won: false, defeatWave: f.s.wave, waves, f };
      }
      return { won: f.s.victory, waves, f };
    } finally { Math.random = nativeRandom; }
  }
  test("druzhina20 seeded campaigns execute actual buy/merge/quest/combat/completion through all10waves without ad rewards", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const result = naturalCampaign(seed);
      assert.equal(result.won, true, `ordinary seed ${seed} wins using earned currency`);
      assert.equal(result.f.s.stats.campaignsWon, 1);
      assert.equal(result.f.s.stats.adsWatched, 0);
      assert.equal(result.f.s.wave, 10);
      assert.equal(result.waves.length, 10);
    }
  });
  test("druzhina20 documented wave3 logic fixtures finish10waves without currency/ad grants", (t) => {
    for (let seed = 1; seed <= 20; seed++) {
      const result = naturalCampaign(seed, { startWave: 3 });
      assert.equal(result.won, true, `wave3 seed ${seed}`);
      if (seed === 1) t.diagnostic(JSON.stringify({ evidence: "seeded_wave3_logic_fixture_not_UI", waves: result.waves }));
    }
  });
  test("druzhina nextcampaign with deliberate no spending produces natural wall loss and free retry; retry keeps exact team and resources", (t) => {
    const result = naturalCampaign(1, { spend: false, campaign: 2 });
    assert.equal(result.won, false); assert.equal(result.f.s.castleHp, 0);
    const f = result.f; const durable = structuredClone({ units: f.s.units, coins: f.s.coins, crystals: f.s.crystals, wave: f.s.wave, campaign: f.s.campaign });
    f.call("retryCurrentWave");
    assert.equal(f.s.castleHp, 65);
    assert.deepEqual({ units: f.s.units, coins: f.s.coins, crystals: f.s.crystals, wave: f.s.wave, campaign: f.s.campaign }, durable);
    t.diagnostic(JSON.stringify({ evidence: "seeded_no_spending_campaign2_logic_not_UI", defeatWave: result.defeatWave, waves: result.waves }));
  });
  test("druzhina actual merge/move/recruit sequence spends displayed cost and updates daily progress", () => {
    const f = fixture(); const power = engine.getTotalPower(f.s.units);
    f.call("chooseCell", 1);
    assert.equal(f.s.units.filter(Boolean).length, 3); assert.equal(f.s.units[1].level, 2);
    assert.ok(engine.getTotalPower(f.s.units) > power); assert.equal(f.s.daily.merge, 1);
    f.call("chooseCell", 1); f.call("chooseCell", 11);
    assert.equal(f.s.units[11].level, 2); assert.equal(f.s.daily.merge, 1, "move is not merge");
    const before = f.s.coins; f.call("buyUnit");
    assert.equal(f.s.coins, before - engine.getRecruitCost(f.s.wave));
    assert.equal(f.s.units.filter(Boolean).length, 4); assert.equal(f.s.daily.recruit, 1);
  });
  test("druzhina actual capped/insufficient/full-board branches cannot overspend resources", () => {
    const f = fixture(); f.s.coins = 0; f.call("buyUnit"); assert.equal(f.s.coins, 0);
    assert.equal(f.s.message, "Не хватает монет");
    f.s.coins = 999; f.s.units = Array.from({ length: engine.BOARD_SIZE }, (_, i) => ({ id: i + 1, kind: "sword", level: 4 }));
    f.call("buyUnit"); assert.equal(f.s.coins, 999); assert.equal(f.s.message, "Нет свободных мест — объедини бойцов");
    f.s.upgrades.forge = 5; const gems = f.s.crystals; f.call("buyUpgrade", "forge"); assert.equal(f.s.crystals, gems);
    f.s.upgrades.forge = 0; f.s.crystals = 2; f.call("buyUpgrade", "forge"); assert.equal(f.s.upgrades.forge, 0); assert.equal(f.s.crystals, 2);
  });
  test("druzhina actual wall/forge/treasury upgrades and healing retain bounded health/currency", () => {
    const f = fixture(); f.s.castleHp = 84;
    f.call("buyUpgrade", "walls"); assert.equal(f.s.castleHp, 94); assert.equal(f.s.crystals, 5); assert.equal(f.s.upgrades.walls, 1);
    f.call("buyUpgrade", "forge"); assert.equal(f.s.crystals, 2); assert.equal(f.s.upgrades.forge, 1);
    assert.ok(Math.abs(engine.getTotalPower(f.s.units, 1) - engine.getTotalPower(f.s.units) * 1.08) < 1e-10);
    f.call("heal"); assert.equal(f.s.castleHp, 110); assert.equal(f.s.crystals, 0);
    f.call("heal"); assert.equal(f.s.castleHp, 110); assert.equal(f.s.crystals, 0);
  });
  test("druzhina actual quests grant once, refuse incomplete and reset stale day", () => {
    const f = fixture();
    f.call("claimQuest", "merge"); assert.equal(f.s.coins, 160);
    f.s.daily.merge = 3; f.call("claimQuest", "merge"); assert.equal(f.s.coins, 240);
    f.call("claimQuest", "merge"); assert.equal(f.s.coins, 240);
    f.s.daily.recruit = 2; f.call("claimQuest", "recruit"); assert.equal(f.s.crystals, 10);
    f.s.daily.wave = 3; f.call("claimQuest", "wave"); assert.equal(f.s.coins, 340);
    f.s.daily.date = "2000-01-01"; f.call("claimQuest", "merge");
    assert.equal(f.s.daily.merge, 0); assert.equal(f.s.daily.claimed.length, 0); assert.equal(f.s.coins, 340);
  });
  test("druzhina actual defeat/retry retains army/resources/wave and restores65% maximum walls", async () => {
    const f = fixture(); f.s.wave = 6; f.s.upgrades.walls = 2; f.s.coins = 22; f.s.crystals = 3;
    f.s.running = true; f.s.castleHp = 0; f.s.enemies = []; f.refs.battleLootRef.current = 65;
    const army = structuredClone(f.s.units);
    f.run("const completionReward = getWaveReward"); f.tick(260);
    assert.equal(f.s.defeat, true); assert.equal(f.s.showResult, true); assert.equal(f.s.stats.wavesWon, 0);
    assert.equal(f.s.coins, 22); assert.equal(f.refs.battleLootRef.current, 0); assert.equal(f.s.ads, 0);
    f.call("retryCurrentWave");
    assert.equal(f.s.castleHp, 78); assert.equal(f.s.wave, 6); assert.deepEqual(f.s.units, army);
    assert.equal(f.s.coins, 22); assert.equal(f.s.crystals, 3); assert.equal(f.s.defeat, false);
    f.call("spawnCurrentWave"); assert.equal(f.s.running, true); assert.ok(f.s.enemies.length > 0);
  });
  test("druzhina strengthening after defeat: free retry cannot discard health bought with crystals", () => {
    const f = fixture(); f.s.wave = 5; f.s.castleHp = 0; f.s.defeat = true; f.s.showResult = false;
    for (let heal = 0; heal < 3; heal++) f.call("heal");
    assert.equal(f.s.castleHp, 75); assert.equal(f.s.crystals, 2);
    f.call("retryCurrentWave");
    assert.equal(f.s.castleHp, 75, "retry must preserve already purchased health above its free65%floor");
    assert.equal(f.s.crystals, 2); assert.equal(f.s.wave, 5); assert.equal(f.s.defeat, false);
    f.call("spawnCurrentWave"); assert.equal(f.s.running, true);
  });
  test("druzhina actual final-wave win/nextcampaign preserves upgrades/statistics/crystals and derives victory after reload", async () => {
    const f = fixture(); f.s.wave = 10; f.s.running = true; f.s.enemies = []; f.s.upgrades.treasury = 2;
    f.refs.battleLootRef.current = 65; const before = f.s.coins;
    f.run("const completionReward = getWaveReward"); f.tick(260);
    assert.equal(f.s.victory, true); assert.equal(f.s.coins, before + 65 + engine.getWaveReward(10));
    assert.equal(f.s.stats.campaignsWon, 1); assert.equal(f.s.crystals, 11);
    f.call("applySave", engine.migrateSave(engine.serializeSave(f.s)));
    assert.equal(f.s.victory, true);
    await f.call("startCampaign", 2);
    assert.equal(f.s.campaign, 2); assert.equal(f.s.wave, 1); assert.equal(f.s.victory, false);
    assert.equal(f.s.coins, 200); assert.equal(f.s.crystals, 11); assert.equal(f.s.stats.campaignsWon, 1);
    assert.equal(f.s.upgrades.treasury, 2); assert.deepEqual(f.s.units, engine.cloneInitialUnits());
    assert.equal(f.s.castleHp, 100);
  });
  for (const key of ["paused", "overlayPause"]) {
    test(`druzhina actual combat effect freezes during ${key}`, () => {
      const f = fixture(); f.s.running = true; f.s[key] = true;
      f.run("battleTimer.current = window.setInterval"); assert.equal(f.timers.length, 0);
    });
  }
}
