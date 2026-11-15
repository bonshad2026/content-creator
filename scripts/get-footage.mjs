// Downloads CC0 / public-domain test footage from Wikimedia Commons into data/test-fixtures/stock/ (for offline tests only).
// Run: node scripts/get-footage.mjs
import fs from "node:fs";
import path from "node:path";

const FILES = {
  "cookies.ogv": "Baking cookies.ogv",
  "husky.webm": "Howling Husky Dog.webm",
  "bird.webm": "Curious Little Bird Looking at a Camera.webm",
  "walkway.webm": "Airport moving walkway.webm",
  "vw-t2.webm": "Volkswagen T2.webm",
  "vlog.webm": "Video Blog- CBP Super Bowl LII Countdown to Kickoff - Day 4.webm",
};
const UA = { "User-Agent": "content-creator-expert/0.1 (test footage setup script)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = path.resolve("data/test-fixtures/stock");
fs.mkdirSync(dir, { recursive: true });
const credits = [];
for (const [name, title] of Object.entries(FILES)) {
  const out = path.join(dir, name);
  if (fs.existsSync(out) && fs.statSync(out).size > 100000) continue;
  for (let i = 0; i < 6; i++) {
    await sleep(i === 0 ? 8000 : 60000 * i);
    try {
      const api = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent("File:" + title)}&prop=imageinfo&iiprop=url|size|extmetadata&iiextmetadatafilter=LicenseShortName&format=json`;
      const info = Object.values((await (await fetch(api, { headers: UA })).json()).query.pages)[0].imageinfo[0];
      const lic = info.extmetadata?.LicenseShortName?.value || "";
      if (!/CC0|Public domain/i.test(lic)) { console.warn(`skip ${title}: ${lic}`); break; }
      await sleep(4000);
      const res = await fetch(info.url, { headers: UA });
      const buf = Buffer.from(await res.arrayBuffer());
      if (!res.ok || buf.length < 100000) { console.warn(`  retry ${name} (${res.status})`); continue; }
      fs.writeFileSync(out, buf);
      credits.push(`${name} — ${lic} — ${info.descriptionurl}`);
      console.log(`${name} ${(buf.length / 1e6).toFixed(1)} MB (${lic})`);
      break;
    } catch (e) {
      console.warn(`  retry ${name} (${e.message})`);
    }
  }
}
fs.appendFileSync(path.join(dir, "CREDITS.txt"), credits.join("\n") + (credits.length ? "\n" : ""));
