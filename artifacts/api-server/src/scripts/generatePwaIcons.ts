/**
 * One-off: rasterize the jg-youth favicon.svg into PWA icons.
 * Run: pnpm --filter=@workspace/api-server exec tsx src/scripts/generatePwaIcons.ts
 */
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "../../../jg-youth/public");
const svg = fs.readFileSync(path.join(publicDir, "favicon.svg"));

for (const size of [192, 512]) {
  await sharp(svg, { density: 512 })
    .resize(size, size, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toFile(path.join(publicDir, `icon-${size}.png`));
  console.log(`icon-${size}.png written`);
}
