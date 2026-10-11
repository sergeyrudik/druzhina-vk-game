import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as engine from "../app/game-engine.ts";
import { createAdPolicy, AD_INTERVAL_MS } from "../app/ad-policy.ts";

// Copied into each game's tests directory. Execute its real arrow functions,
// with SDK transport mocked; no copied reward or transition implementation.
// Model the browser atomic Web Lock transport, held until SDK completion.
// Unsupported/no-lock mode is tested separately in the shared policy suite.
function testLocks() {
  let held = false;
  return { request: async (_name, _options, callback) => {
    if (held) return callback(null);
    held = true;
    try { return await callback({}); } finally { held = false; }
  } };
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const game = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).name.replace("-vk-game", "");
const source = ts.createSourceFile("page.tsx", fs.readFileSync(path.join(root, "app/page.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function actualHandler(name, scope) {
  let arrow;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) {
      const initializer = node.initializer;
      arrow = ts.isCallExpression(initializer) ? initializer.arguments[0] : initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(arrow && ts.isArrowFunction(arrow), `actual production handler ${name}`);
  const code = ts.transpileModule(`const invoke = ${arrow.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return Function(...Object.keys(scope), `${code}\nreturn invoke;`)(...Object.values(scope));
}

function actualEffect(fragment, scope) {
  let arrow;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" &&
        node.arguments[0]?.getText(source).includes(fragment)) arrow = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(arrow && ts.isArrowFunction(arrow), "actual production effect");
  const code = ts.transpileModule(`const invoke = ${arrow.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return Function(...Object.keys(scope), `${code}\nreturn invoke;`)(...Object.values(scope));
}

function fixture({ response = true, throws = false, lives = 3, completed = false, deferred = false, ready = true, locks = testLocks() } = {}) {
  let clock = 1_800_000_000_000;
  const state = { ...engine.createDefaultSave(), running: false, victory: completed, interstitialBusy: false, messages: [], events: [] };
  if (game === "traktir") { state.lives = lives; state.score = 500; }
  if (completed && game === "druzhina") state.stats.campaignsWon = state.campaign;
  const original = structuredClone(state);
  state.orders = [{ id: 1, recipe: ["bread"], reward: 10, createdAt: clock, deadline: clock + 14000 }];
  const calls = [];
  let resolveShow;
  const storage = new Map();
  const policy = createAdPolicy({ locks, storageKey: "handler-test", now: () => clock,
    storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) },
    onInterstitialBusyChange: (v) => { state.interstitialBusy = v; },
  });
  const bridgeRef = { current: ready ? { send: async (method, params) => {
    calls.push({ method, format: params?.ad_format });
    if (method === "VKWebAppCheckNativeAds") return { result: response };
    if (throws) throw new Error("Mocked SDK failure");
    if (deferred) return new Promise((resolve) => { resolveShow = resolve; });
    return { result: response };
  } } : null };
  const write = (key) => (value) => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  const noop = () => {};
  const scope = { syncExternalBeforeAction:()=>false, progressEpochRef: {current:0}, latestSaveRef:{current:null},
    saveGuardRef:{current:{refresh:()=>null,latest:()=>null,initialize(){},revision:()=>0,persist:async()=>({value:null,external:null})}},
    adoptExternalSave:()=>{}, setSaveRenderRevision:()=>{}, saveRenderRevision:0,
    readCurrentRaw:()=>null, readStoredValue:()=>null, SAVE_KEY:'single-session-test',
 ...engine, save: original, rewards: original.rewards, stats: original.stats, units: original.units,
    campaign: original.campaign ?? 1, wave: original.wave ?? 1, upgrades: original.upgrades,
    orders: state.orders, active: 0, picked: [], now: clock, enemies: [], castleHp: 100, totalPower: 100,
    maxCastleHp: 100, victory: completed, tutorialDone: true, vkReady: ready, running: false,
    bridgeRef, adPolicyRef: { current: policy }, adAvailable: ready, adPendingRef: { current: false },
    saveRef: { current: original },
    adBusyRef: { current: false }, interstitialBusyRef: { current: false }, adBusy: false,
    rewardBlockedReason: "", showStart: false, boundaryPendingRef: { current: false },
    nextId: { current: 20 }, enemiesRef: { current: [] }, battleLootRef: { current: 0 },
    REWARD_DAILY_LIMIT: 8, REWARD_COOLDOWN_MS: AD_INTERVAL_MS, REWARD_LIVES: 2, MAX_LIVES: 5, REWARD_COINS: 75,
    checkRewardAvailability: async () => {}, haptic: noop, playTone: noop, playSound: noop,
    showToast: noop, incrementDaily: noop,
    trackEvent: (name) => state.events.push(name),
    setToast: (v) => state.messages.push(v), setMessage: (v) => state.messages.push(v),
    setAdStatus: (v) => state.messages.push(v), setClock: noop, setAdAvailable: noop,
    setCommonRewardWait: noop,
    window: { setTimeout: () => 0, clearTimeout: noop },
    Date: { now: () => clock },
    beginKitchen: () => { state.kitchenStarted = (state.kitchenStarted ?? 0) + 1; policy.startGameplay(); },
    applySave: (next) => { Object.assign(state, next); },
    setSave: (value) => { Object.assign(state, typeof value === "function" ? value(state) : value); },
  };
  for (const key of ["Coins","Rewards","Stats","Running","UserPaused","Distance","Entities","Lane","AdPending","AdBusy","Units","Wave","CastleHp","Enemies","Paused","Victory","Defeat","ShowResult","Campaign","Selected","ActiveTab","Orders","Picked","ShakePlate","Active","Now","Crystals","BossWave","TutorialDone","TutorialStep"]) {
    scope[`set${key}`] = write(key[0].toLowerCase() + key.slice(1));
  }
  if (game === "druzhina") scope.maybeShowInterstitial = actualHandler("maybeShowInterstitial", scope);
  if (game === "traktir") scope.maybeShowKitchenInterstitial = actualHandler("maybeShowKitchenInterstitial", scope);
  return { state, original, calls, policy, scope, storage,
    advance: (ms) => { clock += ms; }, time: () => clock, resolve: (value) => resolveShow({ result: value }),
    reward: () => actualHandler(game === "sani" ? "reviveByAd" : game === "traktir" ? "watchAdForLives" : "showRewardedAd", scope)(),
    boundary: () => actualHandler(game === "sani" ? "startRun" : game === "traktir" ? "startNewShift" : "startCampaign", scope)(2),
  };
}

for (const outcome of ["success", "cancel", "error", "unavailable"]) {
  test(`${game}: actual reward handler ${outcome} gives only a completed reward`, async () => {
    const f = fixture({ response: outcome !== "cancel", throws: outcome === "error", ready: outcome !== "unavailable" });
    await f.reward();
    const succeeded = outcome === "success";
    assert.equal(f.state.stats.adsWatched, succeeded ? 1 : 0);
    assert.equal(f.state.rewards.count, succeeded ? 1 : 0);
    if (game === "sani") assert.equal(f.state.running, succeeded);
    if (game === "traktir") assert.equal(f.state.lives, succeeded ? 5 : 3);
    if (game === "druzhina") assert.equal(f.state.coins, f.original.coins + (succeeded ? 75 : 0));
    assert.equal(f.policy.isBusy(), false);
    assert.equal(f.storage.size, succeeded ? 1 : 0);
  });
}

test(`${game}: actual reward cannot immediately follow an interstitial`, async () => {
  const f = fixture();
  f.policy.startGameplay(); f.advance(AD_INTERVAL_MS);
  assert.equal(await f.policy.maybeInterstitial(f.scope.bridgeRef.current.send, true), true);
  const before = f.calls.length;
  await f.reward();
  assert.equal(f.calls.length, before);
  assert.equal(f.state.stats.adsWatched, 0);
  assert.match(f.state.messages.join(" "), /мин|подожд/i);
});

test(`${game}: duplicate pending reward calls cannot double grant`, async () => {
  const f = fixture({ deferred: true });
  const first = f.reward();
  await new Promise(resolve=>setImmediate(resolve));
  await f.reward();
  assert.equal(f.calls.filter(c => c.method === "VKWebAppShowNativeAds").length, 1);
  f.resolve(true); await first;
  assert.equal(f.state.stats.adsWatched, 1);
  assert.equal(f.state.rewards.count, 1);
});

test(`${game}: first real round remains free after a long-open pregame menu`, async () => {
  const f = fixture(); f.advance(AD_INTERVAL_MS * 10);
  await f.boundary();
  assert.equal(f.calls.length, 0);
});

for (const outcome of ["success", "cancel", "error", "unavailable"]) {
  test(`${game}: eligible explicit new-round boundary ${outcome} continues for free`, async () => {
    const f = fixture({ response: outcome !== "cancel", throws: outcome === "error", ready: outcome !== "unavailable" });
    f.policy.startGameplay(); f.advance(AD_INTERVAL_MS);
    await f.boundary();
    assert.equal(f.policy.isBusy(), false);
    assert.equal(f.state.interstitialBusy, false);
    if (game === "sani") assert.equal(f.state.running, true);
    if (game === "traktir") { assert.equal(f.state.lives, 3); assert.equal(f.state.score, 0); assert.equal(f.state.kitchenStarted, 1); }
    if (game === "druzhina") { assert.equal(f.state.campaign, 2); assert.equal(f.state.wave, 1); }
  });
}

test(`${game}: new-round mutations wait until pending native advertisement ends`, async () => {
  const f = fixture({ deferred: true });
  f.policy.startGameplay(); f.advance(AD_INTERVAL_MS);
  const pending = f.boundary();
  await new Promise(resolve=>setImmediate(resolve)); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.policy.isBusy(), true);
  if (game === "sani") assert.equal(f.state.running, false);
  if (game === "traktir") { assert.equal(f.state.score, 500); assert.equal(f.state.kitchenStarted, undefined); }
  if (game === "druzhina") assert.equal(f.state.campaign, f.original.campaign);
  await f.boundary();
  assert.equal(f.calls.filter(c => c.method === "VKWebAppShowNativeAds").length, 1);
  f.resolve(false); await pending;
  assert.equal(f.policy.isBusy(), false);
});

if (game === "druzhina") {
  test("druzhina: last enemy removed before the260ms final-wave completion cannot start a reward that next campaign would discard", async () => {
    const f = fixture({ deferred: true });
    f.scope.running = true;
    f.scope.wave = 10;
    f.scope.maybeShowInterstitial = actualHandler("maybeShowInterstitial", f.scope);
    let finishWave;
    f.scope.window.setTimeout = (fn) => { finishWave = fn; return 1; };
    actualEffect("const completionReward = getWaveReward", f.scope)();
    assert.equal(typeof finishWave, "function");
    await f.reward();
    assert.equal(f.calls.length, 0, "SDK must not start within the pending final-completion timer");
    assert.equal(f.state.rewards.count, 0);
    finishWave();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.state.victory, true);
    f.scope.running = false;
    f.scope.victory = true;
    f.scope.stats = f.state.stats;
    await f.reward();
    assert.equal(f.calls.length, 0, "completed campaign must remain ineligible");
    await f.boundary();
    assert.equal(f.state.campaign, 2);
    assert.equal(f.state.coins, engine.getStartingCoins(f.original.upgrades.treasury));
    assert.equal(f.state.stats.adsWatched, 0);
  });
  test("druzhina: actual next-campaign/reset handlers cannot mutate progress while a rewarded video is pending", async () => {
    const f = fixture({ deferred: true });
    const reward = f.reward();
    await new Promise(resolve=>setImmediate(resolve));
    await f.boundary();
    actualHandler("resetAllProgress", f.scope)();
    assert.equal(f.state.campaign, f.original.campaign);
    assert.equal(f.state.coins, f.original.coins);
    assert.equal(f.calls.filter(c => c.method === "VKWebAppShowNativeAds").length, 1);
    f.resolve(true);
    await reward;
    assert.equal(f.state.coins, f.original.coins + 75);
    assert.equal(f.state.rewards.count, 1);
  });
  test("druzhina: actual reset handler also refuses a pending campaign transition", () => {
    const f = fixture();
    f.scope.boundaryPendingRef.current = true;
    actualHandler("resetAllProgress", f.scope)();
    assert.equal(f.state.coins, f.original.coins);
    assert.equal(f.state.campaign, f.original.campaign);
  });
  test("druzhina: completed-campaign reward cannot consume an ad/quota for coins that next campaign discards", async () => {
    const f = fixture({ completed: true }); await f.reward();
    assert.equal(f.calls.length, 0);
    assert.equal(f.state.coins, f.original.coins);
    assert.equal(f.state.rewards.count, 0);
    assert.equal(f.state.stats.adsWatched, 0);
  });
  for (const [wave, hp, expected] of [[1,100,0],[2,100,0],[3,100,1],[5,100,0],[6,100,1],[8,100,0],[9,100,1],[10,100,1],[3,0,0],[10,0,0]]) {
    test(`druzhina: actual wave completion at wave ${wave}, hp ${hp} requests ${expected} interstitial(s)`, async () => {
      const f = fixture(); f.policy.startGameplay(); f.advance(AD_INTERVAL_MS);
      f.scope.wave = wave; f.scope.castleHp = hp; f.scope.running = true;
      f.scope.maybeShowInterstitial = actualHandler("maybeShowInterstitial", f.scope);
      let completion;
      f.scope.window.setTimeout = (fn) => { completion = fn; return 1; };
      actualEffect("const completionReward = getWaveReward", f.scope)();
      completion();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(f.calls.filter(c => c.method === "VKWebAppShowNativeAds").length, expected);
      assert.equal(f.state.defeat ?? false, hp === 0);
    });
  }
} else {
  test(`${game}: daily rollover resets quota without removing the three-minute cooldown`, () => {
    const timestamp = Date.parse("2026-10-10T23:59:59Z");
    const next = engine.refreshRewards({ date: "2026-10-10", count: 8, lastRewardAt: timestamp }, "2026-10-11");
    assert.equal(next.date, "2026-10-11"); assert.equal(next.count, 0); assert.equal(next.lastRewardAt, timestamp);
  });
}
if (game === "traktir") {
  for (const served of [18,19,39]) {
    test(`traktir: real completed-serve handler gates interstitial at ${served + 1} serves`, async () => {
      const f = fixture({ deferred: true }); f.policy.startGameplay(); f.advance(AD_INTERVAL_MS);
      f.original.stats.served = served;
      actualHandler("pickIngredient", f.scope)("bread");
      await new Promise(resolve=>setImmediate(resolve)); await new Promise(resolve=>setImmediate(resolve));
      const expected = (served + 1) % 20 === 0 ? 1 : 0;
      assert.equal(f.calls.filter(c => c.method === "VKWebAppShowNativeAds").length, expected);
      if (expected) {
        const score = f.state.score;
        actualHandler("pickIngredient", f.scope)("bread");
        assert.equal(f.state.score, score, "controls cannot mutate kitchen while ad is pending");
        f.resolve(false);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(f.policy.isBusy(), false);
      }
    });
  }
  test("traktir: real pause/resume effect preserves order time and speed-score during a sixty-second ad", () => {
    const f = fixture();
    const originalOrder = structuredClone(f.state.orders[0]);
    const pauseRef = { current: null };
    let resume;
    const scope = { ...f.scope, started: true, save: f.original, kitchenActive: false,
      performance: { now: f.time, timeOrigin: 0 }, pausedAtRef: pauseRef,
      window: { setTimeout: (fn) => { resume = fn; return 1; }, clearTimeout: () => {} },
    };
    actualEffect("pausedAtRef.current ??= tick", scope)();
    f.advance(60000);
    scope.kitchenActive = true;
    actualEffect("pausedAtRef.current ??= tick", scope)();
    resume();
    assert.equal(f.state.orders[0].deadline - originalOrder.deadline, 60000);
    assert.equal(f.state.orders[0].createdAt - originalOrder.createdAt, 60000);
    assert.equal(engine.orderProgress(f.state.orders[0], f.time()), engine.orderProgress(originalOrder, f.time() - 60000));
    assert.deepEqual(engine.scoreForServe(f.state.orders[0], f.time(), 1), engine.scoreForServe(originalOrder, f.time() - 60000, 1));
  });
  for (const [before, after, calls] of [[0,2,1],[3,5,1],[4,5,1],[5,5,0]]) {
    test(`traktir: actual lives top-up ${before}→${after} calls SDK ${calls} time(s)`, async () => {
      const f = fixture({ lives: before }); await f.reward();
      assert.equal(f.state.lives, after);
      assert.equal(f.calls.length, calls);
      assert.equal(f.state.stats.adsWatched, calls);
      assert.equal(f.state.rewards.count, calls);
    });
  }
}

if (game === "sani") {
  test("sani: actual New run reset waits for ad, returns to free start and cannot immediately show another ad", async () => {
    const f = fixture({ deferred: true }); f.policy.startGameplay(); f.advance(AD_INTERVAL_MS);
    f.state.distance = 999;
    const pending = actualHandler("resetForNewRun", f.scope)();
    await new Promise(resolve=>setImmediate(resolve)); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.state.distance, 999);
    f.resolve(false); await pending;
    assert.equal(f.state.distance, 0); assert.equal(f.state.running, false);
    const count = f.calls.length;
    await f.boundary();
    assert.equal(f.calls.length, count, "failed attempt backoff prevents immediate second request");
    assert.equal(f.state.running, true);
  });
}


test(`${game}: unsupported Web Locks refuses ads honestly and leaves the next round free`, async () => {
  const f = fixture({ locks: null });
  await f.reward();
  assert.equal(f.calls.length, 0, "no SDK without atomic presentation lock");
  assert.deepEqual(f.state.rewards, f.original.rewards);
  assert.deepEqual(f.state.stats, f.original.stats);
  assert.equal(f.state.coins, f.original.coins);
  if (game === "traktir") assert.equal(f.state.lives, 3);
  assert.equal(f.policy.isBusy(), false);
  assert.equal(f.policy.rewardWaitMs(), 0);
  assert.ok(f.state.messages.includes("Реклама сейчас недоступна. Попробуйте позже."));
  assert.doesNotMatch(f.state.messages.join(" "), /через 0 мин/);
  f.policy.startGameplay(); f.advance(AD_INTERVAL_MS);
  await f.boundary();
  assert.equal(f.calls.length, 0, "unsupported interstitial also leaves free play available");
  assert.equal(f.policy.isBusy(), false);
  if (game === "sani") assert.equal(f.state.running, true);
  if (game === "traktir") { assert.equal(f.state.lives, 3); assert.equal(f.state.score, 0); }
  if (game === "druzhina") { assert.equal(f.state.campaign, 2); assert.equal(f.state.wave, 1); }
});
