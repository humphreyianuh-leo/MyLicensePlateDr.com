import puppeteer from "puppeteer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "temporary screenshots");

const url = process.argv[2] || "http://localhost:3000";
const label = process.argv[3];

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const existing = fs
  .readdirSync(OUT_DIR)
  .map((f) => f.match(/^screenshot-(\d+)/))
  .filter(Boolean)
  .map((m) => parseInt(m[1], 10));
const next = existing.length ? Math.max(...existing) + 1 : 1;
const fileName = `screenshot-${next}${label ? "-" + label : ""}.png`;
const outPath = path.join(OUT_DIR, fileName);

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(url, { waitUntil: "networkidle0" });

// Scroll through the full page first so any scroll-triggered
// (IntersectionObserver) reveal animations have fired before capture.
await page.evaluate(async () => {
  const prevBehavior = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = "auto";
  const distance = 400;
  const delay = 60;
  let scrolled = 0;
  const scrollHeight = document.body.scrollHeight;
  while (scrolled < scrollHeight) {
    window.scrollTo(0, scrolled);
    scrolled += distance;
    await new Promise((r) => setTimeout(r, delay));
  }
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 200));
  document.documentElement.style.scrollBehavior = prevBehavior;
});

await page.screenshot({ path: outPath, fullPage: true });
await browser.close();

console.log(`Saved ${outPath}`);
