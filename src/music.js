// Background-music library: assets/music/<mood>/*.mp3 (folder name = mood, e.g. energetic, chill, emotional).
// Add any royalty-free tracks you like (Pixabay Music, YouTube Audio Library…). Beat grids are cached.
import fs from "node:fs";
import path from "node:path";
import { beatGrid } from "./media.js";

const MUSIC_DIR = path.resolve("assets/music");
const CACHE = path.resolve(process.env.DATA_DIR || "data", "beats.json");
const AUDIO = /\.(mp3|m4a|aac|wav|ogg)$/i;

const tracksOf = (mood) => {
  try {
    return fs.readdirSync(path.join(MUSIC_DIR, mood)).filter((f) => AUDIO.test(f)).map((f) => path.join(MUSIC_DIR, mood, f));
  } catch {
    return [];
  }
};

/** Moods that have at least one track. */
export function listMoods() {
  try {
    return fs.readdirSync(MUSIC_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && tracksOf(d.name).length).map((d) => d.name);
  } catch {
    return [];
  }
}

/** Small stable hash: the same seed always picks the same item (same plan → same reel). */
export const seeded = (seed) => [...String(seed)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

/** A track of a mood (chosen by `seed`, e.g. the job id: varies between reels, never between renders of one) + its beat grid. */
export async function pickTrack(mood, seed = "") {
  const tracks = tracksOf(mood);
  if (!tracks.length) return null;
  const file = tracks[seeded(`${seed}:${mood}`) % tracks.length];
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  } catch {}
  const key = `${file}|${fs.statSync(file).size}`;
  if (!cache[key]) {
    cache[key] = await beatGrid(file);
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify(cache));
  }
  return { file, mood, ...cache[key] };
}
