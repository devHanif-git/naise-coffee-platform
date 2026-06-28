// Generates PWA icons from the brand logo using sharp.
// Run: node scripts/generate-pwa-icons.mjs
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "public/brand/logo_transparent.png");
const OUT = path.join(ROOT, "public/icons");
const BG = "#171717"; // matches manifest theme_color

async function transparentIcon(size) {
  // Logo on transparent canvas with ~10% padding, for purpose: "any".
  const inner = Math.round(size * 0.8);
  const logo = await sharp(SRC)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: logo, gravity: "center" }])
    .png();
}

async function solidIcon(size, scale) {
  // Logo centered on solid BG, for maskable + apple-touch (no transparency).
  const inner = Math.round(size * scale);
  const logo = await sharp(SRC)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: logo, gravity: "center" }])
    .png();
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await (await transparentIcon(192)).toFile(path.join(OUT, "icon-192.png"));
  await (await transparentIcon(512)).toFile(path.join(OUT, "icon-512.png"));
  // Maskable: logo at 70% so it survives platform mask cropping (safe zone).
  await (await solidIcon(512, 0.7)).toFile(path.join(OUT, "icon-maskable-512.png"));
  await (await solidIcon(180, 0.8)).toFile(path.join(OUT, "apple-touch-icon.png"));
  console.log("PWA icons written to public/icons/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
