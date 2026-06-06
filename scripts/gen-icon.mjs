// Rasterize the vector app icon (public/icon.svg) into PNGs for PWA / iOS.
// Run on demand (sharp is not a project dependency):
//   npm i sharp --no-save && node scripts/gen-icon.mjs
import sharp from "sharp";
import { readFileSync } from "node:fs";

const svg = readFileSync("public/icon.svg");
const targets = {
  "public/icon-512.png": 512,
  "public/icon-192.png": 192,
  "public/apple-touch-icon.png": 180,
};

for (const [out, size] of Object.entries(targets)) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(out);
  console.log("wrote", out);
}
