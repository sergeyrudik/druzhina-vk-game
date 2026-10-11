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


function rng(seed) { let word = seed; return () => { word = (Math.imul(word,1664525)+1013904223)>>>0; return word / 2**32; }; }

test('continued druzhina default save campaigns1..36 buys all15 earned upgrades and retains, quest claims and reload completion gates', async t=>{
 const f=fixture(),random=Math.random;Math.random=rng(7);const waves=[]; const catalog=new Set(); let cappedSwap=false;
 function inspect(){ for(const unit of f.s.units)if(unit)catalog.add(`${unit.kind}:${unit.level}`); }
 f.overrides.mergePair=undefined;
 function pair(){
 let decl; function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='findMergePair')decl=n;ts.forEachChild(n,visit);}visit(source);
 return evaluate(decl,f.scope())(f.s.units);
}
 function mergeAll(){for(let i=0;i<100;i++){inspect();const p=pair();if(!p)return;f.s.selected=null;f.call('chooseCell',p[0]);f.call('chooseCell',p[1]);}assert.fail('finite merge loop');}
 function claims(){for(const id of ['recruit','merge','wave'])f.call('claimQuest',id);}
 try{
  // Start with actual default board: pair suggestion and deselection then a
  // real move to an empty cell and mismatch swap (no injected fighters).
  f.overrides.mergePair=pair();f.call('suggestMerge');assert.equal(f.s.selected,pair()[0]);
  const origin=f.s.selected;f.call('chooseCell',origin);assert.equal(f.s.selected,null);
  f.call('chooseCell',origin);const empty=f.s.units.findIndex(u=>!u);f.call('chooseCell',empty);assert.equal(f.s.units[origin],null);
  f.call('chooseCell',empty);const mismatch=f.s.units.findIndex(u=>u&&u.kind!==f.s.units[empty].kind);const before=[f.s.units[empty].id,f.s.units[mismatch].id];f.call('chooseCell',mismatch);assert.deepEqual([f.s.units[empty].id,f.s.units[mismatch].id],before.reverse());
  for(let campaign=1;campaign<=36;campaign++){
   if(campaign>1)await f.call('startCampaign',campaign);
   let failures=0;
   while(!f.s.victory){
    mergeAll();claims();
    for(let i=0;i<100&&f.s.coins>=engine.getRecruitCost(f.s.wave)&&f.s.units.some(u=>!u);i++){f.call('buyUnit');inspect();mergeAll();claims();}
    for(const key of ['forge','walls','treasury'])if(f.s.upgrades[key]<5&&f.s.crystals>=engine.getUpgradeCost(f.s.upgrades[key]))f.call('buyUpgrade',key);
    inspect();
    if(!cappedSwap){for(let a=0;a<f.s.units.length;a++)for(let b=a+1;b<f.s.units.length;b++)if(f.s.units[a]?.level===4&&f.s.units[b]?.level===4&&f.s.units[a].kind===f.s.units[b].kind){const before=f.s.stats.unitsMerged;const ids=[f.s.units[a].id,f.s.units[b].id];f.s.selected=null;f.call('chooseCell',a);f.call('chooseCell',b);assert.equal(f.s.stats.unitsMerged,before);assert.deepEqual([f.s.units[a].id,f.s.units[b].id],ids.reverse());cappedSwap=true;}}
    const wave=f.s.wave;f.call('spawnCurrentWave');assert.equal(f.s.running,true);
    const clean=f.run('battleTimer.current = window.setInterval');let ticks=0;while(f.s.enemies.length&&ticks++<1000)f.tick(420);clean?.();assert.ok(ticks<1000);
    f.run('const completionReward = getWaveReward');f.tick(260);claims();
    waves.push({campaign,wave,defeat:f.s.defeat,wall:f.s.castleHp,coins:f.s.coins,gems:f.s.crystals});
    if(f.s.defeat){assert.ok(failures++<15,'earned troops must eventually clear campaign');const team=structuredClone(f.s.units);f.call('retryCurrentWave');assert.deepEqual(f.s.units,team);}
   }
   assert.equal(f.s.stats.campaignsWon,campaign);
   const saved=engine.migrateSave(engine.serializeSave(f.s));const fresh=fixture();fresh.call('applySave',saved);assert.equal(fresh.s.victory,true);assert.deepEqual(fresh.s.upgrades,f.s.upgrades);assert.deepEqual(fresh.s.daily.claimed,f.s.daily.claimed);
   fresh.call('spawnCurrentWave');assert.equal(fresh.s.running,false,'completed campaign cannot pay completion twice');
   await fresh.call('startCampaign',campaign+1);assert.equal(fresh.s.victory,false);assert.equal(fresh.s.wave,1);assert.equal(fresh.s.coins,engine.getStartingCoins(f.s.upgrades.treasury));assert.deepEqual(fresh.s.upgrades,f.s.upgrades);
  }
  assert.deepEqual(f.s.upgrades,{forge:5,walls:5,treasury:5});const capped={...f.s.upgrades};const gems=f.s.crystals;for(const key of Object.keys(capped))f.call('buyUpgrade',key);assert.deepEqual(f.s.upgrades,capped);assert.equal(f.s.crystals,gems);assert.deepEqual(f.s.daily.claimed.sort(),['merge','recruit','wave']);const snapshot={coins:f.s.coins,gems:f.s.crystals};claims();assert.deepEqual({coins:f.s.coins,gems:f.s.crystals},snapshot);
  assert.deepEqual([...catalog].sort(),['sword','bow','guard','mage'].flatMap(kind=>[1,2,3,4].map(level=>`${kind}:${level}`)).sort());assert.equal(cappedSwap,true);
  await f.call('startCampaign',37);let loops=0;
  while(!f.s.defeat&&loops++<10){f.call('spawnCurrentWave');const clean=f.run('battleTimer.current = window.setInterval');let ticks=0;while(f.s.enemies.length&&ticks++<1000)f.tick(420);clean?.();f.run('const completionReward = getWaveReward');f.tick(260);}
  assert.equal(f.s.defeat,true);assert.equal(f.s.castleHp,0);const team=structuredClone(f.s.units),wallet=f.s.coins;while(f.s.castleHp<100&&f.s.crystals>=2)f.call('heal');const paidHP=f.s.castleHp;assert.ok(paidHP>=100);f.call('retryCurrentWave');assert.equal(f.s.castleHp,paidHP);assert.deepEqual(f.s.units,team);assert.equal(f.s.coins,wallet);
  t.diagnostic(JSON.stringify({catalog:[...catalog].sort(),cappedSwap,naturalDefeatWave:f.s.wave,paidHPBeforeRetry:paidHP,campaigns:f.s.stats.campaignsWon,upgrades:f.s.upgrades,quests:f.s.daily.claimed,battles:waves.length,defeats:waves.filter(w=>w.defeat).length,final:waves.at(-1),notes:'No injected resources; All upgrade costs paid only with initial8gems, natural quest2gems and campaign completions; deterministic RNG; not UI'}));
 }finally{Math.random=random;}
});
