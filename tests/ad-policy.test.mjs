import assert from "node:assert/strict";
import test from "node:test";
import { createAdPolicy, AD_INTERVAL_MS, AD_RETRY_MS } from "../app/ad-policy.ts";

function fixture({ storage, onInterstitialBusyChange } = {}) {
  let time = 1_800_000_000_000;
  const values = new Map();
  const policy = createAdPolicy({ storageKey: "test:last-ad", now: () => time, storage: storage ?? { getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,value) }, settle: async () => {}, locks: null, onInterstitialBusyChange });
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
  assert.equal(await f.policy.beginReward(), true);
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
  assert.equal(await f.policy.beginReward(), false);
  assert.equal(await f.policy.maybeInterstitial(f.send, true), false);
  f.advance(AD_INTERVAL_MS);
  assert.equal(await f.policy.beginReward(), true);
  f.policy.finishReward(false);
});

test("a cancelled reward consumes no cooldown and always releases its lock", async () => {
  const f = fixture();
  assert.equal(await f.policy.beginReward(), true);
  assert.equal(await f.policy.beginReward(), false);
  f.policy.finishReward(false);
  assert.equal(f.policy.rewardWaitMs(), 0);
  assert.equal(f.policy.isBusy(), false);
  assert.equal(await f.policy.beginReward(), true);
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
  assert.equal(await f.policy.beginReward(), false);
  assert.equal(await f.policy.maybeInterstitial(f.send, true), false);
  await new Promise(setImmediate);
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
  await new Promise(setImmediate);
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
  assert.equal(await f.policy.beginReward(), true);
});

test("the common timestamp survives reload and day rollover; fresh sessions still have grace", async () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const f = fixture({ storage });
  assert.equal(await f.policy.beginReward(), true);
  f.policy.finishReward(true);
  const reloaded = createAdPolicy({ storageKey: "test:last-ad", now: f.time, storage, locks: null, settle: async () => {} });
  assert.equal(await reloaded.beginReward(), false);
  f.advance(AD_INTERVAL_MS);
  assert.equal(await reloaded.maybeInterstitial(f.send, true), false);
  reloaded.startGameplay();
  f.advance(AD_INTERVAL_MS);
  assert.equal(await reloaded.maybeInterstitial(f.send, true), true);
});

test("old game saves seed recent rewarded timestamps without shortening protection", async () => {
  const f = fixture();
  f.policy.seedLastAdAt(f.time() - 10_000);
  f.policy.seedLastAdAt(f.time() - 100_000);
  assert.equal(f.policy.rewardWaitMs(), AD_INTERVAL_MS - 10_000);
  assert.equal(await f.policy.beginReward(), false);
});

test("migrated legacy reward protection survives a game-save reset and reload", async () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const f = fixture({ storage });
  f.policy.seedLastAdAt(f.time() - 30_000);
  const reloaded = createAdPolicy({ storageKey: "test:last-ad", now: f.time, storage, locks: null, settle: async () => {} });
  assert.equal(reloaded.rewardWaitMs(), AD_INTERVAL_MS - 30_000);
  assert.equal(await reloaded.beginReward(), false);
});

test("blocked shared storage without Web Locks declines ads and releases free gameplay", async () => {
  const f = fixture({ storage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } });
  f.policy.startGameplay(); f.advance(AD_INTERVAL_MS);
  assert.equal(await f.policy.maybeInterstitial(f.send, true), false);
  assert.equal(await f.policy.beginReward(), false); assert.deepEqual(f.calls, []); assert.equal(f.policy.isBusy(), false);
});

function fakeLocks() {
 let held=false;
 return { request: async (_key, _options, callback) => { if(held) return callback(null); held=true;try{return await callback({name:"ad"});}finally{held=false;} } };
}
for(const locksSupported of [true,false]) test(`two independent policies allow one simultaneous SDK presentation (Web Locks=${locksSupported})`,async()=>{
 const values=new Map();const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};const locks=locksSupported?fakeLocks():null;
 let time=1800000000000;const a=createAdPolicy({storageKey:"cross",storage,locks,settle:async()=>{},now:()=>time}),b=createAdPolicy({storageKey:"cross",storage,locks,settle:async()=>{},now:()=>time});
 const granted=await Promise.all([a.beginReward(),b.beginReward()]);assert.equal(granted.filter(Boolean).length,1);const winner=granted[0]?a:b,loser=granted[0]?b:a;
 assert.equal(await loser.beginReward(),false);winner.finishReward(true);await new Promise(setImmediate);assert.equal(await loser.beginReward(),false,"reread common successful timestamp");time+=180000;assert.equal(await loser.beginReward(),true);loser.finishReward(false);
});
test("Web Lock remains held through a long SDK wait and cancellation frees another policy",async()=>{
 const locks=fakeLocks(),storage={getItem:()=>null,setItem:()=>{}};const a=createAdPolicy({storageKey:"hold",locks,storage}),b=createAdPolicy({storageKey:"hold",locks,storage});assert.equal(await a.beginReward(),true);assert.equal(await b.beginReward(),false);a.finishReward(false);await new Promise(setImmediate);assert.equal(await b.beginReward(),true);b.finishReward(false);
});
test("fallback lease cancellation releases nonce and a crashed expired lease can be recovered",async()=>{
 let time=1800000000000;const values=new Map([["fallback:lease",JSON.stringify({nonce:"crashed",until:time+1000})]]);const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};const a=createAdPolicy({storageKey:"fallback",storage,locks:null,settle:async()=>{},now:()=>time});assert.equal(await a.beginReward(),false);time+=1001;assert.equal(await a.beginReward(),true);a.finishReward(false);assert.equal(values.get("fallback:lease"),"null");assert.equal(await a.beginReward(),true);a.finishReward(false);
});
test("fallback nonce readback declines a stolen claim before SDK",async()=>{
 const values=new Map();const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};const a=createAdPolicy({storageKey:"stolen",storage,locks:null,settle:async()=>{values.set("stolen:lease",JSON.stringify({nonce:"another",until:Date.now()+300000}));}});assert.equal(await a.beginReward(),false);assert.equal(a.isBusy(),false);
});
test("shared gate serializes automatic and explicit formats across separate controllers",async()=>{
 const locks=fakeLocks(),values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};let time=1800000000000;const a=createAdPolicy({storageKey:"formats",locks,storage,now:()=>time}),b=createAdPolicy({storageKey:"formats",locks,storage,now:()=>time});a.startGameplay();time+=180000;let resolve;let requests=0;const interstitial=a.maybeInterstitial(async()=>{requests++;return new Promise(r=>resolve=r);},true);await new Promise(setImmediate);assert.equal(await b.beginReward(),false);resolve({result:false});assert.equal(await interstitial,false);assert.equal(requests,1);await new Promise(setImmediate);assert.equal(await b.beginReward(),true);b.finishReward(false);
});

test("adopting an older game-save reward timestamp cannot overwrite another tab's newer ad",async()=>{
 const values=new Map();const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};const time=1800000000000;const policy=createAdPolicy({storageKey:"seed",storage,locks:null,settle:async()=>{},now:()=>time});values.set("seed",String(time-10000));policy.seedLastAdAt(time-60000);assert.equal(values.get("seed"),String(time-10000));assert.equal(policy.rewardWaitMs(),170000);assert.equal(await policy.beginReward(),false);
});
