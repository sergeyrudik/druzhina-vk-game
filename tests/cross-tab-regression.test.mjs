import {createSaveSnapshotGuard} from "../app/save-snapshot-guard.ts";
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as engine from "../app/game-engine.ts";
import { AD_INTERVAL_MS } from "../app/ad-policy.ts";

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
  const timers = []; const overrides = {};
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
    const x = { syncExternalBeforeAction:()=>false, ...engine, ...s, ...refs, window, clearInterval: noop,
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
    return Object.assign(x, overrides);
  }
  return { s, refs, timers, scope, overrides,
    call: (name, ...args) => variable(name, scope(), true)(...args),
    run: (fragment) => effect(fragment, scope()),
    tick: (ms) => { const timer = timers.findLast(t => t.ms === ms); assert.ok(timer, `scheduled ${ms}ms callback`); timer.fn(); },
  };
}


function click(f, fragment, extras = {}) {
  let handler;
  function visit(n) {
    if (ts.isJsxAttribute(n) && n.name.getText(source) === "onClick" && n.initializer?.expression?.getText(source).includes(fragment)) handler = n.initializer.expression;
    ts.forEachChild(n, visit);
  }
  visit(source); return evaluate(handler, { ...f.scope(), ...extras })();
}



function writers() {
 const store=new Map();const events=[];
 const storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 function wire(f){
  f.overrides.window={...f.scope().window,addEventListener:(name,fn)=>events.push({name,fn}),removeEventListener(){}};
  f.overrides.SAVE_KEY='test-save';f.overrides.VK_SAVE_KEY='test-vk-save';f.overrides.LEGACY_SAVE_KEY='legacy';
  f.overrides.writeStoredValue=(k,v)=>{storage.setItem(k,v);return true;};
  f.overrides.readStoredValue=k=>storage.getItem(k);
  f.overrides.readCurrentRaw=()=>storage.getItem('test-save');
  f.refs.saveGuardRef.current=createSaveSnapshotGuard({storageKey:'test-save',read:()=>storage.getItem('test-save'),write:v=>{storage.setItem('test-save',v);return true;},parse:engine.migrateSave,serialize:engine.serializeSave});
  Object.defineProperty(f.overrides,'saveRenderRevision',{enumerable:true,get:()=>f.refs.saveGuardRef.current.revision()});
  f.overrides.adoptExternalSave=variable('adoptExternalSave',f.scope(),true);
  f.overrides.syncExternalBeforeAction=variable('syncExternalBeforeAction',f.scope(),true);
  if(game==='druzhina'){
   f.overrides.localStorage=storage;f.overrides.latestSaveRef={current:null};f.overrides.cloudSaveQueueRef={current:Promise.resolve()};
   f.overrides.persistValue=variable('persistValue',f.scope(),true);
   const win=f.scope().window;
   f.overrides.window={...win,addEventListener:(name,fn)=>events.push({name,fn}),removeEventListener(){}};
   f.overrides.document={addEventListener:(name,fn)=>events.push({name,fn}),removeEventListener(){}};
  }
 }
 async function persist(f){
  if(game==='druzhina'){f.overrides.persistValue=variable('persistValue',f.scope(),true);f.run('latestSaveRef.current =');f.run('}, 280)');f.tick(280);}
  else f.run('persist(save, saveRenderRevision)');
  await new Promise(resolve=>setImmediate(resolve));
 }
 function toggle(f){click(f,game==='druzhina'?'setSound(!sound)':game==='sani'?'sound: !current.sound':'sound: !s.sound');}
 return{wire,persist,toggle,store,events,current:()=>engine.migrateSave(storage.getItem('test-save'))};
}
async function earn(f){
 if(game==='druzhina'){f.call('buyUnit');return;}
 if(game==='traktir'){f.call('beginKitchen',f.s.save);for(const ingredient of f.s.orders[0].recipe)f.call('pickIngredient',ingredient);return;}
 const random=Math.random;let n=0;Math.random=()=>[.5,.1,0][n++%3];
 try{await f.call('startRun');const clean=f.run('const next = d + 1');for(let i=0;i<35;i++)f.tick(50);clean?.();assert.ok(f.s.save.coins>20);}finally{Math.random=random;}
}
test(`${game} continued two actual snapshot writers must not erase fresh gameplay`,async t=>{
 const a=fixture(),b=fixture(),w=writers();w.wire(a);w.wire(b);await w.persist(a);
 await earn(a);await w.persist(a);const expected=w.current();
 w.toggle(b);await w.persist(b);const observed=w.current();
 t.diagnostic(JSON.stringify({game,expectedCoins:expected.coins,observedCoins:observed.coins,expectedStats:expected.stats,observedStats:observed.stats}));
 assert.equal(observed.coins,expected.coins,'old tab must not overwrite freshly earned/spent wallet');
 assert.deepEqual(observed.stats,expected.stats,'old tab must not overwrite gameplay counters');
});
test(`${game} continued old snapshot must not resurrect progress after another tab reset`,async t=>{
 const a=fixture(),b=fixture(),w=writers();w.wire(a);w.wire(b);await earn(a);await w.persist(a);
 const earned=w.current();if(game==='druzhina')b.call('applySave',earned);else b.s.save=earned;
 resetAction(a.scope());await w.persist(a);const expected=w.current();w.toggle(b);await w.persist(b);const observed=w.current();
 t.diagnostic(JSON.stringify({game,expectedCoins:expected.coins,observedCoins:observed.coins,expectedStats:expected.stats,observedStats:observed.stats}));
 assert.equal(observed.coins,expected.coins,'old tab must not resurrect the pre-reset wallet');
 assert.deepEqual(observed.stats,expected.stats,'old tab must not resurrect pre-reset counters');
});

test(`${game} continued external reset invalidates actual deferred gameplay timer and clears transient play`, async()=>{
 const a=fixture(),b=fixture(),w=writers();w.wire(a);w.wire(b);await earn(a);await w.persist(a);
 if(game==='druzhina')b.call('applySave',w.current());else b.s.save=w.current();
 b.refs.saveGuardRef.current.initialize(w.store.get('test-save'));
 let stale;
 if(game==='druzhina'){
  b.call('spawnCurrentWave');b.run('battleTimer.current = window.setInterval');
  let ticks=0;while(b.s.enemies.length&&ticks++<1000)b.tick(420);assert.ok(ticks<1000);
  b.run('const completionReward = getWaveReward');stale=b.timers.findLast(t=>t.ms===260).fn;
 }else if(game==='sani'){await b.call('startRun');b.run('const next = d + 1');stale=b.timers.findLast(t=>t.ms===50).fn;}
 else{b.call('beginKitchen',b.s.save);b.run('const alive = list.filter');stale=b.timers.findLast(t=>t.ms===250).fn;b.s.now+=60000;}
 resetAction(a.scope());await w.persist(a);b.run('const syncFromStorage =');
 const expected=structuredClone(game==='druzhina'?b.s.stats:b.s.save.stats),coins=game==='druzhina'?b.s.coins:b.s.save.coins;
 stale();assert.deepEqual(game==='druzhina'?b.s.stats:b.s.save.stats,expected);assert.equal(game==='druzhina'?b.s.coins:b.s.save.coins,coins);
 assert.equal(game==='druzhina'?b.s.running:b.s.started,false);
 if(game==='sani')assert.equal(b.s.distance,0);if(game==='traktir')assert.deepEqual(b.s.orders,[]);
 await w.persist(b);assert.deepEqual(w.current().stats,engine.createDefaultSave().stats);
});
test(`${game} continued deferred rewarded SDK completion uses remote-reset canonical quota without resuming obsolete session`,async()=>{
 const a=fixture(),b=fixture(),w=writers();w.wire(a);w.wire(b);
 const limits={date:engine.getLocalDateKey(),count:7,lastRewardAt:Date.now()-AD_INTERVAL_MS-1000};
 a.s.rewards=limits;a.s.save.rewards=limits;await w.persist(a);
 if(game==='druzhina')b.call('applySave',w.current());else {b.s.save=w.current();b.refs.saveRef.current=b.s.save;}
 b.refs.saveGuardRef.current.initialize(w.store.get('test-save'));
 let resolveVideo,calls=0;const promise=new Promise(resolve=>resolveVideo=resolve);
 b.refs.bridgeRef.current={send:async method=>{if(method==='VKWebAppShowNativeAds'){calls++;return promise;}return{};}};
 b.s.adAvailable=true;b.s.vkReady=true;
 b.refs.adPolicyRef.current={isBusy:()=>false,startGameplay(){},seedLastAdAt(){},rewardWaitMs:()=>0,beginReward:()=>true,finishReward(){},maybeInterstitial:async()=>false};
 const request=b.call(game==='druzhina'?'showRewardedAd':game==='sani'?'reviveByAd':'watchAdForLives');
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);resetAction(a.scope());await w.persist(a);b.run('const syncFromStorage =');
 resolveVideo({result:true});await request;await w.persist(b);
 const saved=w.current();assert.equal(saved.rewards.count,8);assert.equal(saved.stats.adsWatched,1);assert.equal(game==='druzhina'?b.s.running:b.s.started,false);
 if(game==='druzhina')assert.equal(saved.coins,235);if(game==='traktir')assert.equal(saved.lives,5);
 await b.call(game==='druzhina'?'showRewardedAd':game==='sani'?'reviveByAd':'watchAdForLives');assert.equal(calls,1,'ninth daily reward blocked before SDK');
});

test(`${game} continued quota from a changed committed save is adopted before starting SDK`,async()=>{
 const a=fixture(),b=fixture(),w=writers();w.wire(a);w.wire(b);await w.persist(a);b.refs.saveGuardRef.current.initialize(w.store.get('test-save'));
 const limits={date:engine.getLocalDateKey(),count:8,lastRewardAt:Date.now()-AD_INTERVAL_MS-1000};a.s.rewards=limits;a.s.save.rewards=limits;await w.persist(a);
 let calls=0;b.refs.bridgeRef.current={send:async()=>{calls++;return{result:true};}};b.s.adAvailable=true;b.s.vkReady=true;
 await b.call(game==='druzhina'?'showRewardedAd':game==='sani'?'reviveByAd':'watchAdForLives');
 assert.equal(calls,0);assert.equal((game==='druzhina'?b.s.rewards:b.s.save.rewards).count,8);
});
test(`${game} continued pending new-round boundary cannot restart an externally reset session`,async()=>{
 const a=fixture(),b=fixture(),w=writers();w.wire(a);w.wire(b);await w.persist(a);b.refs.saveGuardRef.current.initialize(w.store.get('test-save'));
 let end;const pending=new Promise(resolve=>end=resolve);b.refs.adPolicyRef.current={isBusy:()=>false,startGameplay(){},seedLastAdAt(){},rewardWaitMs:()=>0,maybeInterstitial:()=>pending};
 b.overrides.maybeShowKitchenInterstitial=()=>pending;b.overrides.maybeShowInterstitial=()=>pending;
 const request=b.call(game==='druzhina'?'startCampaign':game==='sani'?'startRun':'startNewShift',2);
 resetAction(a.scope());await w.persist(a);b.run('const syncFromStorage =');end(false);await request;
 assert.equal(game==='druzhina'?b.s.running:b.s.started,false);
 if(game==='druzhina')assert.equal(b.s.campaign,1);if(game==='sani')assert.equal(b.s.save.stats.runs,0);if(game==='traktir')assert.deepEqual(b.s.orders,[]);
});

test(`${game} continued adopted canonical snapshot is never echoed into another save commit`,async()=>{
 const a=fixture(),b=fixture(),w=writers();w.wire(a);w.wire(b);await earn(a);await w.persist(a);b.run('const syncFromStorage =');
 const before=w.store.get('test-save');await w.persist(b);assert.equal(w.store.get('test-save'),before,'adoption must not bounce new updatedAt back to the first tab');
});
test(`${game} continued reset of identical defaults still commits a detectable change with frozen clock`,async()=>{
 const now=Date.now;Date.now=()=>1800000000000;
 try{const a=fixture(),b=fixture(),w=writers();w.wire(a);w.wire(b);await w.persist(a);const before=w.store.get('test-save');b.refs.saveGuardRef.current.initialize(before);resetAction(a.scope());await w.persist(a);assert.notEqual(w.store.get('test-save'),before,'reset must be distinguishable even within the same millisecond');b.run('const syncFromStorage =');assert.equal(game==='druzhina'?b.s.showStart:!b.s.started,true);}finally{Date.now=now;}
});
