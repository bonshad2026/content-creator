// Downloads a small set of colour emoji stickers (Google Noto Emoji, Apache License 2.0: free forever, commercial use OK)
// into assets/stickers/<name>.png. Run once: npm run stickers
import fs from "node:fs";
import path from "node:path";

const STICKERS = {
  fire: "1f525", laugh: "1f602", shock: "1f631", mindblown: "1f92f", eyes: "1f440", heart: "2764",
  thumbsup: "1f44d", party: "1f389", hundred: "1f4af", football: "26bd", trophy: "1f3c6", question: "2753",
  check: "2705", cross: "274c", "point-right": "1f449", "point-down": "1f447", star: "2b50", idea: "1f4a1",
  game: "1f3ae", clock: "23f0", rocket: "1f680", money: "1f4b0", cool: "1f60e", think: "1f914",
};
const BASE = "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/2D/png/512";
const dir = path.resolve("assets/stickers");
fs.mkdirSync(dir, { recursive: true });

for (const [name, code] of Object.entries(STICKERS)) {
  const out = path.join(dir, `${name}.png`);
  if (fs.existsSync(out)) continue;
  const res = await fetch(`${BASE}/emoji_u${code}.png`);
  const buf = Buffer.from(await res.arrayBuffer());
  // only keep real PNG files
  if (!res.ok || buf.subarray(1, 4).toString() !== "PNG") {
    console.warn(`skip ${name}: HTTP ${res.status}`);
    continue;
  }
  fs.writeFileSync(out, buf);
  console.log(`${name}.png ${(buf.length / 1024).toFixed(0)} KB`);
}
fs.writeFileSync(
  path.join(dir, "LICENSE-noto-emoji.txt"),
  "Emoji images from Google Noto Emoji (https://github.com/googlefonts/noto-emoji), Apache License 2.0.\n" +
    "Free for personal and commercial use. https://www.apache.org/licenses/LICENSE-2.0\n"
);
