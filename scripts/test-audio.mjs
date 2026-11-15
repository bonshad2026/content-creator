// Audio class unit tests (fast, 0 tokens, no render): src/audio.js against saved real Whisper output and fixtures.
// Usage: npm run test:audio
import fs from "node:fs";
import path from "node:path";
import { trustedLine, classifyAudio, measureAudio } from "../src/audio.js";

const FX = path.resolve("data/test-fixtures");
const results = [];
const check = (name, ok, note = "") => results.push({ case: name, ok: ok ? "PASS" : "FAIL", note });

// real Whisper junk from Arcane run 2 (290 s fight + film score): 4 lines, words stacked on one instant
const arcanePlan = path.resolve("data/test-out/arcane-plan2.json");
if (fs.existsSync(arcanePlan)) {
  const lines = JSON.parse(fs.readFileSync(arcanePlan, "utf8")).transcript;
  const kept = lines.filter((s) => trustedLine(s, "persian"));
  check("arcane: junk lines dropped", kept.length <= 2, `${kept.length}/${lines.length} kept`);
  const cls = classifyAudio({ lines, analysedSec: 290, level: { rms: -23, floor: -47 } });
  check("arcane: even all 4 lines → music_or_mixed", cls === "music_or_mixed", cls);
} else check("arcane", true, "skipped: no saved plan");

// Whisper confidence fields
const ok = { start: 0, end: 3, text: "سلام به همگی", words: [] };
check("good line trusted", trustedLine({ ...ok, noSpeech: 0.1, logprob: -0.3, compression: 1.4 }, "persian"));
check("no_speech_prob 0.8 rejected", !trustedLine({ ...ok, noSpeech: 0.8 }, "persian"));
check("avg_logprob -1.4 rejected", !trustedLine({ ...ok, logprob: -1.4 }, "persian"));
check("compression 3 rejected", !trustedLine({ ...ok, compression: 3 }, "persian"));
check("Persian text with an English loanword kept", trustedLine({ ...ok, text: "این app رو دانلود کنین" }, "persian"));
check("English text labelled persian rejected", !trustedLine({ ...ok, text: "this is the end of everything" }, "persian"));
check("Persian text labelled english rejected", !trustedLine({ ...ok, text: "این آخر همه چیزه" }, "english"));

// coverage: talk-long (48 s, ~45 s of speech) vs a single short line in a long clip
check("talk: high coverage → speech", classifyAudio({ lines: [{ start: 0.5, end: 47 }], analysedSec: 48, level: { rms: -27 } }) === "speech");
check("one line in 60 s → music_or_mixed", classifyAudio({ lines: [{ start: 3, end: 5 }], analysedSec: 60, level: { rms: -25 } }) === "music_or_mixed");
check("no audio stream → silent", classifyAudio({ hasAudio: false }) === "silent");

// local measurement on real files
for (const [f, want] of [["silent.mp4", "silent"], ["talk-long.mp4", "loud"], ["arcane.mp4", "loud"]]) {
  if (!fs.existsSync(path.join(FX, f))) { check(`level ${f}`, true, "skipped"); continue; }
  const lv = await measureAudio(path.join(FX, f), 60);
  const silent = classifyAudio({ lines: [], analysedSec: 60, level: lv }) === "silent";
  check(`level ${f} → ${want}`, want === "silent" ? silent : !silent, `rms ${lv.rms} floor ${lv.floor}`);
}

console.table(results);
process.exit(results.every((r) => r.ok === "PASS") ? 0 : 1);
