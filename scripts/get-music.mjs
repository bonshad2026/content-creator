// Downloads a starter background-music library: CC0 (public domain) tracks from Wikimedia Commons.
// Free forever, commercial use OK, no credit required. Run once: npm run music
// Files land in assets/music/<mood>/ ; the folder name is the mood the AI can pick.
import fs from "node:fs";
import path from "node:path";

const LIBRARY = {
  energetic: ["Loyalty Freak Music - 10 - Everyone is so alive.ogg", "Loyalty Freak Music - 08 - Yippee .ogg", "Loyalty Freak Music - 03 - After Party.ogg", "Komiku - 04 - Action Chasing.ogg"],
  chill: ["Loyalty Freak Music - 06 - Softly.ogg", "Loyalty Freak Music - 01 - Sweet You.ogg", "Loyalty Freak Music - 08 - Beach.ogg"],
  emotional: ["Relaxing-piano-music-351844.wav", "Komiku - 15 - Ambiant Inconvenient Truth.ogg"],
  funny: ["Loyalty Freak Music - 01 - Monster Parade.ogg", "Loyalty Freak Music - 09 - Shoepop.ogg"],
  epic: ["Komiku - 19 - Action Decisive Move.ogg", "Komiku - 17 - Action Fight.ogg"],
};
const UA = { "User-Agent": "content-creator-expert/0.1 (music library setup script)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// polite + patient: Wikimedia rate-limits bursts, so wait between requests and retry with back-off
async function get(url, kind) {
  url = url.replace(/\?utm_.*$/, "");
  for (let i = 0; i < 6; i++) {
    await sleep(i === 0 ? 6000 : 40000 * i);
    const res = await fetch(url, { headers: UA });
    const buf = Buffer.from(await res.arrayBuffer());
    if (res.ok && (kind === "json" ? buf[0] === 0x7b : /^(OggS|RIFF|fLaC|ID3)/.test(buf.subarray(0, 4).toString("latin1")))) return kind === "json" ? JSON.parse(buf) : buf;
    console.warn(`  retry (${res.status})`);
  }
  throw new Error(`could not download ${url}`);
}
const credits = ["Background music: CC0 / public domain, from Wikimedia Commons (https://commons.wikimedia.org).", ""];

for (const [mood, titles] of Object.entries(LIBRARY)) {
  const dir = path.resolve("assets/music", mood);
  fs.mkdirSync(dir, { recursive: true });
  for (const title of titles) {
    const api = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent("File:" + title)}&prop=imageinfo&iiprop=url|size|extmetadata&iiextmetadatafilter=LicenseShortName|Artist&format=json`;
    const page = Object.values((await get(api, "json")).query.pages)[0];
    const info = page.imageinfo?.[0];
    const license = info?.extmetadata?.LicenseShortName?.value || "";
    if (!info || !/CC0|Public domain/i.test(license)) {
      console.warn(`skip ${title}: ${license || "not found"}`);
      continue;
    }
    const file = path.join(dir, title.replace(/\s+\./, ".").replace(/[^\w.\- ]/g, "").replace(/\s+/g, "_"));
    if (!fs.existsSync(file) || fs.statSync(file).size < 50000) {
      const buf = await get(info.url, "audio");
      fs.writeFileSync(file, buf);
      console.log(`${mood}/${path.basename(file)} ${(buf.length / 1e6).toFixed(1)} MB (${license})`);
    }
    credits.push(`${mood}/${path.basename(file)} — ${license} — ${info.descriptionurl || info.url}`);
  }
}
fs.writeFileSync(path.resolve("assets/music/CREDITS.txt"), credits.join("\n") + "\n");
