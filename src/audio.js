// Audio class per video input: "speech" | "music_or_mixed" | "silent".
// Decides every later audio choice (voice filters, ducking, keeping or muting the source). Local + free:
// the Whisper stats are already paid for, the level / noise floor come from one ffmpeg astats pass.
import { ffmpegScan } from "./media.js";

// Whisper's own fallback thresholds (openai/whisper transcribe.py): a line worse than these is not trusted
const MAX_NO_SPEECH = 0.6, MIN_LOGPROB = -1.0, MAX_COMPRESSION = 2.4;
// share of the analysed audio that trusted lines must cover to call the input "speech"
export const MIN_COVERAGE = 0.2;
// below this RMS level the clip has no meaningful sound
const SILENT_DB = -50;
// noise reduction only when the measured noise floor is above this (talk-long: -49, a clean mix: -60 and below)
export const NOISY_FLOOR_DB = -50;

const ARABIC = /[؀-ۿ]/g, LATIN = /[A-Za-z]/g;
const RTL_LANGS = new Set(["persian", "arabic", "urdu", "pashto", "fa", "ar", "ur", "ps"]);

/**
 * Is a Whisper line trustworthy? Rejects: low confidence, looping text, "words" with zero length,
 * and text whose script does not match the detected language (the mixed-language junk seen on Arcane).
 */
export function trustedLine(s, language = "") {
  if ((s.noSpeech ?? 0) >= MAX_NO_SPEECH) return false;
  if (s.logprob != null && s.logprob < MIN_LOGPROB) return false;
  if (s.compression != null && s.compression > MAX_COMPRESSION) return false;
  const words = s.words || [];
  // Whisper stacks invented words on one instant: most words 0 s long → not real speech
  if (words.length >= 3 && words.filter((w) => w.end - w.start < 0.02).length / words.length > 0.5) return false;
  const ar = (s.text.match(ARABIC) || []).length, la = (s.text.match(LATIN) || []).length;
  if (ar && la && Math.min(ar, la) / (ar + la) > 0.2) return false; // half Persian, half English nonsense
  const lang = String(language).toLowerCase();
  if (lang && ar + la > 0) {
    if (RTL_LANGS.has(lang) && la / (ar + la) > 0.6) return false;
    if (!RTL_LANGS.has(lang) && ar / (ar + la) > 0.6) return false;
  }
  return true;
}

/** Seconds covered by the given lines (overlaps counted once). */
export function coveredSeconds(lines) {
  const iv = lines.map((s) => [s.start, s.end]).sort((a, b) => a[0] - b[0]);
  let sum = 0, cur = null;
  for (const [a, b] of iv) {
    if (!cur || a > cur[1]) { if (cur) sum += cur[1] - cur[0]; cur = [a, b]; }
    else cur[1] = Math.max(cur[1], b);
  }
  return cur ? sum + cur[1] - cur[0] : sum;
}

/**
 * lines: this input's transcript lines (already through trustedLine) · analysedSec: how much audio was transcribed
 * level: {rms, floor} from measureAudio (dB, NaN = no signal) · hasAudio: the file has an audio stream
 */
export function classifyAudio({ lines = [], analysedSec = 0, level = {}, hasAudio = true }) {
  if (!hasAudio || !(level.rms > SILENT_DB)) return "silent";
  const coverage = analysedSec > 0 ? coveredSeconds(lines) / analysedSec : 0;
  return coverage >= MIN_COVERAGE ? "speech" : "music_or_mixed";
}

/** RMS level and noise floor (dB) of the first `maxSec` seconds. NaN when there is no signal. */
export async function measureAudio(file, maxSec = 300) {
  const log = await ffmpegScan(["-t", String(maxSec), "-i", file, "-vn", "-af", "astats=measure_perchannel=none:measure_overall=RMS_level+Noise_floor", "-f", "null", "-"], /RMS level|Noise floor/).catch(() => "");
  const num = (re) => {
    const m = log.match(re);
    return m && /^-?\d/.test(m[1]) ? +m[1] : NaN;
  };
  return { rms: num(/RMS level dB: (\S+)/), floor: num(/Noise floor dB: (\S+)/) };
}
