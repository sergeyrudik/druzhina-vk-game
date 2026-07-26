import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "moderation", "assets");
const raw = resolve(root, "moderation", "raw");

await mkdir(output, { recursive: true });

const iconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="forest" cx="50%" cy="38%" r="72%">
      <stop offset="0" stop-color="#42694b"/>
      <stop offset="1" stop-color="#173722"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffe29a"/>
      <stop offset=".48" stop-color="#e9ad43"/>
      <stop offset="1" stop-color="#9a5c1e"/>
    </linearGradient>
    <linearGradient id="red" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#d85b3d"/>
      <stop offset="1" stop-color="#9b2f25"/>
    </linearGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="28" stdDeviation="24" flood-color="#0b1c10" flood-opacity=".55"/>
    </filter>
  </defs>
  <rect width="1024" height="1024" fill="url(#forest)"/>
  <circle cx="512" cy="512" r="370" fill="#24442c" stroke="url(#gold)" stroke-width="32"/>
  <circle cx="512" cy="512" r="301" fill="url(#red)" stroke="#ffe29a" stroke-width="22" filter="url(#shadow)"/>
  <text x="512" y="690" text-anchor="middle" fill="#fff0bb"
        font-family="Georgia, 'Times New Roman', serif" font-size="520" font-weight="700">Д</text>
  <path d="M246 194l42 24 47-14-16 47 29 40-50-2-30 40-13-49-47-17 42-28z"
        fill="#efc566" opacity=".8"/>
  <path d="M778 194l-42 24-47-14 16 47-29 40 50-2 30 40 13-49 47-17-42-28z"
        fill="#efc566" opacity=".8"/>
</svg>`;

const iconBase = sharp(Buffer.from(iconSvg));
for (const [filename, size] of [
  ["icon-universal-576.png", 576],
  ["icon-catalog-278.png", 278],
  ["icon-small-150.png", 150],
  ["favicon-32.png", 32],
]) {
  await iconBase.clone().resize(size, size).png({ compressionLevel: 9 }).toFile(resolve(output, filename));
}

await sharp(resolve(root, "public", "og.png"))
  .resize(1120, 630, { fit: "cover", position: "centre" })
  .png({ compressionLevel: 9 })
  .toFile(resolve(output, "big-snippet-1120x630.png"));

const shotLabels = {
  start: { title: "Дружина", subtitle: "Собери дружину!" },
  campaign: { title: "Поход", subtitle: "Волны чудищ и боссы" },
  camp: { title: "Лагерь", subtitle: "Merge воинов и улучшения" },
  quests: { title: "Задания", subtitle: "Ежедневная защита города" },
};

for (const name of ["start", "campaign", "camp", "quests"]) {
  const label = shotLabels[name];
  const plate = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="600" height="1200" viewBox="0 0 600 1200">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#42694b"/>
        <stop offset="1" stop-color="#173722"/>
      </linearGradient>
    </defs>
    <rect width="600" height="1200" fill="url(#bg)"/>
    <text x="300" y="90" text-anchor="middle" fill="#ffe29a" font-family="Georgia, serif" font-size="42" font-weight="700">${label.title}</text>
    <text x="300" y="135" text-anchor="middle" fill="#fff0bb" font-family="Trebuchet MS, sans-serif" font-size="20" font-weight="700">${label.subtitle}</text>
    <rect x="28" y="170" width="544" height="320" rx="24" fill="#0b1c10" stroke="#e9ad43" stroke-width="4"/>
    <text x="300" y="560" text-anchor="middle" fill="#efc566" font-family="Trebuchet MS, sans-serif" font-size="18">Дружина — защита города · VK Mini App</text>
    <text x="300" y="600" text-anchor="middle" fill="#a7c48a" font-family="Trebuchet MS, sans-serif" font-size="16">Вертикальный экран · 600×1200</text>
    <rect x="60" y="660" width="480" height="420" rx="28" fill="#24442c" stroke="#ffe29a" stroke-width="3"/>
    <text x="300" y="820" text-anchor="middle" fill="#fff0bb" font-family="Trebuchet MS, sans-serif" font-size="24" font-weight="700">Merge defense</text>
    <text x="300" y="870" text-anchor="middle" fill="#a7c48a" font-family="Trebuchet MS, sans-serif" font-size="18">отряд · лагерь · волны · задания</text>
  </svg>`);

  const preview = await sharp(resolve(raw, `${name}.jpg`))
    .resize(520, 292, { fit: "cover", position: "centre" })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

  await sharp(plate)
    .composite([{ input: preview, top: 184, left: 40 }])
    .jpeg({ quality: 92, mozjpeg: true })
    .toFile(resolve(output, `screenshot-${name}-600x1200.jpg`));
}

console.log(`VK moderation assets generated in ${output}`);
