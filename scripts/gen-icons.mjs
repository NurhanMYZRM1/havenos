/**
 * Rasterizes assets/*.svg into the PWA icon set + the 1024px source that
 * `npx @capacitor/assets generate` expands into every iOS/Android size.
 *
 * Run: node scripts/gen-icons.mjs   (needs `npm i -D sharp`)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const outWeb = path.join(root, "public/icons");
const outNative = path.join(root, "assets");

const icon = await readFile(path.join(root, "assets/icon.svg"));
const maskable = await readFile(path.join(root, "assets/icon-maskable.svg"));

await mkdir(outWeb, { recursive: true });

const jobs = [
  [icon, path.join(outWeb, "icon-192.png"), 192],
  [icon, path.join(outWeb, "icon-512.png"), 512],
  [maskable, path.join(outWeb, "icon-maskable-512.png"), 512],
  [icon, path.join(outWeb, "apple-touch-icon.png"), 180],
  [icon, path.join(outWeb, "favicon-32.png"), 32],
  // @capacitor/assets sources
  [icon, path.join(outNative, "icon-only.png"), 1024],
  [icon, path.join(outNative, "icon-foreground.png"), 1024],
];

for (const [svg, file, size] of jobs) {
  await sharp(svg, { density: 400 }).resize(size, size).png().toFile(file);
  console.log(`✓ ${path.relative(root, file)} (${size}px)`);
}

// Flat background plate for the Android adaptive icon.
await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: "#09090b" },
})
  .png()
  .toFile(path.join(outNative, "icon-background.png"));
console.log("✓ assets/icon-background.png (1024px)");

// Splash screens: the mark centred on the app background.
for (const [name, w, h] of [
  ["splash.png", 2732, 2732],
  ["splash-dark.png", 2732, 2732],
]) {
  const mark = await sharp(icon, { density: 400 }).resize(640, 640).png().toBuffer();
  await sharp({
    create: { width: w, height: h, channels: 4, background: "#09090b" },
  })
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toFile(path.join(outNative, name));
  console.log(`✓ assets/${name} (${w}×${h})`);
}

// favicon.ico equivalent — modern browsers accept PNG at /favicon.ico
await writeFile(
  path.join(root, "public/favicon.ico"),
  await sharp(icon, { density: 400 }).resize(48, 48).png().toBuffer(),
);
console.log("✓ public/favicon.ico (48px)");
