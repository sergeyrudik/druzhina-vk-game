import assert from "node:assert/strict";
import test from "node:test";
import { createVkBridge, readStoredValue, writeStoredValue } from "../app/vk-runtime.ts";

test("optional VK requests time out instead of blocking startup", async () => {
  const client = createVkBridge({ send: () => new Promise(() => {}) }, 5);
  for (const method of ["VKWebAppSetViewSettings", "VKWebAppGetUserInfo", "VKWebAppStorageGet"]) {
    await assert.rejects(client.send(method), /timeout/);
  }
});

test("only one native advertisement can be open and cancellation permits a retry", async () => {
  let finish;
  let calls = 0;
  const client = createVkBridge({ send: () => {
    calls += 1;
    return new Promise((resolve) => { finish = resolve; });
  } }, 5);
  const first = client.send("VKWebAppShowNativeAds", { ad_format: "reward" });
  await assert.rejects(client.send("VKWebAppShowNativeAds", { ad_format: "reward" }), /already open/);
  assert.equal(calls, 1);
  finish({ result: false });
  assert.deepEqual(await first, { result: false });
  const retry = client.send("VKWebAppShowNativeAds", { ad_format: "reward" });
  finish({ result: true });
  assert.deepEqual(await retry, { result: true });
  assert.equal(calls, 2);
});

test("native ads are not cut off by the startup request timeout", async () => {
  const client = createVkBridge({ send: () => new Promise((resolve) => {
    setTimeout(() => resolve({ result: true }), 20);
  }) }, 5);
  assert.deepEqual(await client.send("VKWebAppShowNativeAds"), { result: true });
});

test("blocked browser storage does not prevent playing", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() { throw new Error("Storage disabled"); },
  });
  try {
    assert.equal(readStoredValue("save"), null);
    assert.equal(writeStoredValue("save", "{}"), false);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete globalThis.localStorage;
  }
});
test("cloud writes are serialized and only the latest queued save is sent", async () => {
  const calls = [];
  const finish = [];
  const client = createVkBridge({ send: (method, params) => {
    calls.push(params.value);
    return new Promise((resolve) => { finish.push(resolve); });
  } }, 100);
  const first = client.send("VKWebAppStorageSet", { key: "save", value: "first" });
  const second = client.send("VKWebAppStorageSet", { key: "save", value: "second" });
  const third = client.send("VKWebAppStorageSet", { key: "save", value: "latest" });
  assert.deepEqual(calls, ["first"]);
  finish[0]({ result: true });
  await first;
  assert.deepEqual(calls, ["first", "latest"]);
  finish[1]({ result: true });
  await Promise.all([second, third]);
});

test("a UI timeout never allows a late write to overtake a newer save", async () => {
  const calls = [];
  const finish = [];
  const client = createVkBridge({ send: (method, params) => {
    calls.push(params.value);
    return new Promise((resolve) => { finish.push(resolve); });
  } }, 10);
  await assert.rejects(client.send("VKWebAppStorageSet", { key: "save", value: "old" }), /timeout/);
  const latest = client.send("VKWebAppStorageSet", { key: "save", value: "new" });
  assert.deepEqual(calls, ["old"]);
  finish[0]({ result: true });
  await Promise.resolve();
  assert.deepEqual(calls, ["old", "new"]);
  finish[1]({ result: true });
  await latest;
});

test("cloud failures release the queue and independent keys do not block each other", async () => {
  const calls = [];
  const complete = [];
  const client = createVkBridge({ send: (method, params) => {
    calls.push(params.key);
    return new Promise((resolve, reject) => { complete.push({ resolve, reject }); });
  } }, 100);
  const first = client.send("VKWebAppStorageSet", { key: "a", value: "old" });
  const rejection = assert.rejects(first, /failed/);
  const latest = client.send("VKWebAppStorageSet", { key: "a", value: "new" });
  const independent = client.send("VKWebAppStorageSet", { key: "b", value: "other" });
  assert.deepEqual(calls, ["a", "b"]);
  complete[0].reject(new Error("failed"));
  await rejection;
  assert.deepEqual(calls, ["a", "b", "a"]);
  complete[1].resolve({ result: true });
  complete[2].resolve({ result: true });
  await Promise.all([latest, independent]);
});
