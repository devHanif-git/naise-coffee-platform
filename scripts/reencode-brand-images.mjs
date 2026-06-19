// scripts/reencode-brand-images.mjs
// One-off, idempotent re-encode of oversized brand PNGs, in place.
// Run with: node scripts/reencode-brand-images.mjs
// Uses sharp (already present via Next). Not a runtime dependency.
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const BRAND_DIR = path.join(process.cwd(), "public", "brand");

// maxEdge: longest side in px after downscale (null = keep original dimensions).
// The QR keeps a large edge and high compression so it stays sharp/scannable.
const TARGETS = [
  { file: "QRCode.png", maxEdge: 1080 },
  { file: "coffee_with_logo.png", maxEdge: 900 },
  { file: "flash_sales.png", maxEdge: 1080 },
  { file: "latte_art_black_mug.png", maxEdge: 640 },
  { file: "celebration_in_a_cup.png", maxEdge: 640 },
  { file: "badge.png", maxEdge: 512 },
];

for (const { file, maxEdge } of TARGETS) {
  const filePath = path.join(BRAND_DIR, file);
  const input = await readFile(filePath);
  const before = input.length;

  const output = await sharp(input)
    .resize({
      width: maxEdge,
      height: maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9, effort: 10, palette: true, quality: 90 })
    .toBuffer();

  // Safety: never write a result that came out larger than the source.
  if (output.length >= before) {
    console.log(`SKIP  ${file} (re-encode not smaller: ${before} -> ${output.length})`);
    continue;
  }

  await writeFile(filePath, output);
  const pct = Math.round((1 - output.length / before) * 100);
  console.log(`OK    ${file}  ${(before / 1024).toFixed(0)}KB -> ${(output.length / 1024).toFixed(0)}KB  (-${pct}%)`);
}
