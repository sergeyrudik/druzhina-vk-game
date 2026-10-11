import assert from "node:assert/strict";
import test from "node:test";
import { createAdPolicy, AD_INTERVAL_MS, AD_RETRY_MS } from "../app/ad-policy.ts";

function fixture({ storage, onInterstitialBusyChange } = {}) {
  let time = 1_800_000_000_000;
  const policy = createAdPolicy({ storageKey: "test:last-ad", now: () => time, storage: storage ?? null, onInterstitialBusyChange });
  const calls = [];
  const send = async (method) => { calls.push(method); return { result: true }; };
  return { policy, calls, send, advance: (ms) => { time += ms; }, time: () => time };
}

test("a gameplay boundary and three-minute first-session grace are both required", async () => {
  const f = fixture();
  f.advance(AD_INTERVAL_MS * 5);
  assert.equal(await f.policy.maybeInterstitial(f.send, true), false);
  f.policy.startGameplay();
  f.advance(AD_INTERVAL_MS - 1);
  assert.equal(await f.policy.maybeInterstitial(f.send, true), false);
  f.advance(1);
  assert.deepEqual(f.calls, []); // Passing time alone never calls the SDK.
  assert.equal(await f.policy.maybeInterstitial(f.send, true), true);
  assert.deepEqual(f.calls, ["VKWebAppCheckNativeAds", "VKWebAppShowNativeAds"]);
});

test("repeated gameplay starts do not restart the grace period", async () => {
  const f = fixture();
  f.policy.startGameplay();
  f.advance(AD_INTERVAL_MS - 1);
  f.policy.startGameplay();
  f.advance(1);
  assert.equal(await f.policy.maybeInterstitial(f.send, true), true);
});

test("the first voluntary reward is allowed and suppresses automatic ads for three minutes after completion", async () => {
  const f = fixture();
  f.policy.startGameplay();
  assert.equal(f.policy.beginReward(), true);
  f.advance(61_000); // Video duration must not consume the following cooldown.
  f.policy.finishReward(true);
  assert.equal(f.policy.rewardWaitMs(), AD_INTERVAL_MS);
  f.advance(AD_INTERVAL_MS - 1);
  assert.equal(await f.policy.maybeInterstitial(f.send, true), false);
  f.advance(1);
  assert.equal(await f.policy.maybeInterstitial(f.send, true), true);
});

test("an interstitial suppresses rewarded requests as well as further interstitials", async () => {
  const f = fixture();
  f.policy.startGameplay();
  f.advance(AD_INTERVAL_MS);
  assert.equal(await f.policy.maybeInterstitial(f.send, true), true);
  assert.equal(f.policy.beginReward(), false);
  assert.equal(await f.policy.maybeInterstitial(f.send, true), false);
  f.advance(AD_INTERVAL_MS);
  assert.equal(f.policy.beginReward(), true);
  f.policy.finishReward(false);
});

test("a cancelled reward consumes no cooldown and always releases its lock", () => {
  const f = fixture();
  assert.equal(f.policy.beginReward(), true);
  assert.equal(f.policy.beginReward(), false);
  f.policy.finishReward(false);
  assert.equal(f.policy.rewardWaitMs(), 0);
  assert.equal(f.policy.isBusy(), false);
  assert.equal(f.policy.beginReward(), true);
});

test("pending availability/presentation prevents both formats from overlapping", async () => {
  const f = fixture();
  f.policy.startGameplay();
  f.advance(AD_INTERVAL_MS);
  let resolveCheck;
  let requests = 0;
  const pending = f.policy.maybeInterstitial(async () => {
    requests += 1;
    return new Promise((resolve) => { resolveCheck = resolve; });
  }, true);
  assert.equal(f.policy.isBusy(), true);
  assert.equal(f.policy.beginReward(), false);
  assert.equal(await f.policy.maybeInterstitial(f.send, true), false);
  resolveCheck({ result: false });
  assert.equal(await pending, false);
  assert.equal(requests, 1);
  assert.equal(f.policy.isBusy(), false);
});

for (const result of [false, undefined, "true", 1, null]) {
  test(`availability requires literal true: ${String(result)}`, async () => {
    const f = fixture();
    f.policy.startGameplay();
    f.advance(AD_INTERVAL_MS);
    let calls = 0;
    assert.equal(await f.policy.maybeInterstitial(async () => { calls += 1; return { result }; }, true), false);
    assert.equal(calls, 1);
    assert.equal(f.policy.rewardWaitMs(), 0);
    assert.equal(f.policy.isBusy(), false);
  });
}

test("cancelled presentation retries only at a later boundary after a minute", async () => {
  const changes = [];
  const f = fixture({ onInterstitialBusyChange: (busy) => changes.push(busy) });
  f.policy.startGameplay();
  f.advance(AD_INTERVAL_MS);
  let calls = 0;
  const cancel = async () => ({ result: ++calls % 2 === 1 });
  assert.equal(await f.policy.maybeInterstitial(cancel, true), false);
  f.advance(AD_RETRY_MS - 1);
  assert.equal(await f.policy.maybeInterstitial(cancel, true), false);
  assert.equal(calls, 2);
  f.advance(1);
  assert.equal(await f.policy.maybeInterstitial(f.send, true), true);
  assert.deepEqual(changes, [true, false, true, false]);
});

for (const result of [false, undefined, "true", 1, null]) {
  test(`presentation requires literal true before persisting frequency: ${String(result)}`, async () => {
    const f = fixture();
    f.policy.startGameplay();
    f.advance(AD_INTERVAL_MS);
    let calls = 0;
    const show = async () => ({ result: ++calls === 1 ? true : result });
    assert.equal(await f.policy.maybeInterstitial(show, true), false);
    assert.equal(calls, 2);
    assert.equal(f.policy.rewardWaitMs(), 0);
    assert.equal(f.policy.isBusy(), false);
  });
}

test("ordinary browser play does not even request native ad availability", async () => {
  const f = fixture();
  f.policy.startGameplay();
  f.advance(AD_INTERVAL_MS * 10);
  assert.equal(await f.policy.maybeInterstitial(f.send, false), false);
  assert.deepEqual(f.calls, []);
});

test("a long cancelled video starts the failed-attempt backoff at completion", async () => {
  const f = fixture();
  f.policy.startGameplay();
  f.advance(AD_INTERVAL_MS);
  let resolveVideo;
  const pending = f.policy.maybeInterstitial(async (method) => {
    if (method === "VKWebAppCheckNativeAds") return { result: true };
    return new Promise((resolve) => { resolveVideo = resolve; });
  }, true);
  await Promise.resolve();
  f.advance(90_000);
  resolveVideo({ result: false });
  assert.equal(await pending, false);
  assert.equal(await f.policy.maybeInterstitial(f.send, true), false);
  f.advance(AD_RETRY_MS);
  assert.equal(await f.policy.maybeInterstitial(f.send, true), true);
});

test("SDK errors leave free play unlocked without consuming a successful-ad interval", async () => {
  const f = fixture();
  f.policy.startGameplay();
  f.advance(AD_INTERVAL_MS);
  assert.equal(await f.policy.maybeInterstitial(async () => { throw new Error("unavailable"); }, true), false);
  assert.equal(f.policy.isBusy(), false);
  assert.equal(f.policy.beginReward(), true);
});

test("the common timestamp survives reload and day rollover; fresh sessions still have grace", async () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const f = fixture({ storage });
  assert.equal(f.policy.beginReward(), true);
  f.policy.finishReward(true);
  const reloaded = createAdPolicy({ storageKey: "test:last-ad", now: f.time, storage });
  assert.equal(reloaded.beginReward(), false);
  f.advance(AD_INTERVAL_MS);
  assert.equal(await reloaded.maybeInterstitial(f.send, true), false);
  reloaded.startGameplay();
  f.advance(AD_INTERVAL_MS);
  assert.equal(await reloaded.maybeInterstitial(f.send, true), true);
});

test("old game saves seed recent rewarded timestamps without shortening protection", () => {
  const f = fixture();
  f.policy.seedLastAdAt(f.time() - 10_000);
  f.policy.seedLastAdAt(f.time() - 100_000);
  assert.equal(f.policy.rewardWaitMs(), AD_INTERVAL_MS - 10_000);
  assert.equal(f.policy.beginReward(), false);
});

test("migrated legacy reward protection survives a game-save reset and reload", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const f = fixture({ storage });
  f.policy.seedLastAdAt(f.time() - 30_000);
  const reloaded = createAdPolicy({ storageKey: "test:last-ad", now: f.time, storage });
  assert.equal(reloaded.rewardWaitMs(), AD_INTERVAL_MS - 30_000);
  assert.equal(reloaded.beginReward(), false);
});

test("blocked or malformed local storage does not block free gameplay", async () => {
  const f = fixture({ storage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } });
  f.policy.startGameplay();
  f.advance(AD_INTERVAL_MS);
  assert.equal(await f.policy.maybeInterstitial(f.send, true), true);
  assert.equal(f.policy.isBusy(), false);
});
