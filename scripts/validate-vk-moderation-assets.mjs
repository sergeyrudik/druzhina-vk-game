import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const assets = resolve(import.meta.dirname, "..", "moderation", "assets");
const expected = {
  "icon-universal-576.png": [576, 576],
  "icon-catalog-278.png": [278, 278],
  "icon-small-150.png": [150, 150],
  "favicon-32.png": [32, 32],
  "big-snippet-1120x630.png": [1120, 630],
  "screenshot-start-1200x600.jpg": [1200, 600],
  "screenshot-campaign-1200x600.jpg": [1200, 600],
  "screenshot-camp-1200x600.jpg": [1200, 600],
  "screenshot-quests-1200x600.jpg": [1200, 600],
};

for (const [filename, [width, height]] of Object.entries(expected)) {
  const path = resolve(assets, filename);
  const metadata = await sharp(path).metadata();
  const details = await stat(path);

  if (metadata.width !== width || metadata.height !== height) {
    throw new Error(
      `${filename}: expected ${width}x${height}, got ${metadata.width}x${metadata.height}`,
    );
  }
  if (details.size > 5 * 1024 * 1024) {
    throw new Error(`${filename}: exceeds the 5 MB upload limit`);
  }

  console.log(`✓ ${filename}: ${width}x${height}, ${Math.ceil(details.size / 1024)} KB`);
}
