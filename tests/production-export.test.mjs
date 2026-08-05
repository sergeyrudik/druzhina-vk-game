import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const outputRoot = new URL("../out/", import.meta.url);
const outputExists = existsSync(outputRoot);

test(
  "production export contains the playable Russian game shell",
  { skip: outputExists ? false : "run `pnpm build` before the production smoke test" },
  async () => {
    const html = await readFile(new URL("index.html", outputRoot), "utf8");

    assert.match(html, /<html[^>]*\blang=["']ru["']/i);
    assert.match(html, /<title>Дружина — защита города<\/title>/i);
    assert.match(html, /ДРУЖИНА/);
    assert.match(html, /ЗАЩИТА ГОРОДА/);
    assert.match(html, /class=["']start-play["']/);
    assert.match(html, /НАЧАТЬ ИГРУ/);
    assert.doesNotMatch(html, /<button class=["']start-play["'][^>]*disabled/);
    assert.match(html, /Как играть/);
    assert.match(html, /Волна/);
    assert.match(html, /Собери дружину/);
    assert.doesNotMatch(html, /Your site is taking shape|Building your site/i);
  },
);

test(
  "production export includes local JavaScript and stylesheet assets",
  { skip: outputExists ? false : "run `pnpm build` before the production smoke test" },
  async () => {
    const [html, staticEntries] = await Promise.all([
      readFile(new URL("index.html", outputRoot), "utf8"),
      readdir(new URL("_next/static/", outputRoot), { recursive: true }),
    ]);

    assert.match(html, /\/_next\/static\/[^"']+\.js/);
    assert.match(html, /\/_next\/static\/[^"']+\.css/);
    assert.ok(staticEntries.some((entry) => entry.endsWith(".js")));
    assert.ok(staticEntries.some((entry) => entry.endsWith(".css")));
  },
);
