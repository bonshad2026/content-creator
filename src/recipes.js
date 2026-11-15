// Editing recipes: the "20 years of experience" part lives here, in code, not in the prompt.
// The AI only names the recipe (one word); the code applies its rules exactly, every time:
// which transitions / text animations fit, how long a still may stay on screen, music mood, sound design, pacing.
export const RECIPES = {
  quiz: {
    about: "question → countdown → answer reveal (repeat); ends asking viewers to comment",
    transitions: ["zoom", "flash", "whip-left", "slide-up"], anims: ["highlight", "bounce", "pop", "words"],
    maxStill: 3.5, music: "energetic", risers: true,
  },
  list: {
    about: "'3 things…' — one numbered point per shot",
    transitions: ["push-left", "slide-left", "whip-left"], anims: ["slide-right", "pop", "bounce"],
    maxStill: 3, music: "energetic", risers: false,
  },
  "before-after": {
    about: "the 'before', then a dramatic reveal of the 'after'",
    transitions: ["wind", "flash", "circle"], anims: ["wipe", "highlight", "words"],
    maxStill: 3, music: "epic", risers: true,
  },
  tutorial: {
    about: "step-by-step how-to, clear and calm, steps labelled",
    transitions: ["slide-left", "fade", "push-left"], anims: ["slide-up", "pop", "highlight"],
    maxStill: 4, music: "chill", risers: false,
  },
  story: {
    about: "a personal story; emotion first, few effects, soft transitions",
    transitions: ["fade", "dip", "blur"], anims: ["words", "wipe"],
    maxStill: 4.5, music: "emotional", risers: false, calm: true,
  },
  hook: {
    about: "hook → problem → solution → call to action (tips, advice, opinions)",
    transitions: ["whip-left", "zoom", "slide-up"], anims: ["words", "highlight", "pop", "shake"],
    maxStill: 3, music: "energetic", risers: true,
  },
  promo: {
    about: "showcase a product / place / app / game with fast cuts on the beat",
    transitions: ["whip-right", "slice", "zoom", "push-left", "flash"], anims: ["bounce", "shake", "pop", "highlight"],
    maxStill: 2.5, music: "energetic", risers: true, onBeat: true,
  },
  cinematic: {
    about: "cinematic short film: slow and moody, mostly hard cuts with a soft dip at scene changes, clean film-style text, slow motion on the key moment, film grain; no stickers or effects",
    transitions: ["cut"], anims: ["fade"],
    maxStill: 4.5, music: "emotional", risers: false, calm: true, minimal: true, film: true,
  },
  talk: {
    about: "talking head: the person's words carry it (jump cuts, karaoke subtitles, few overlays)",
    transitions: ["cut", "zoom"], anims: ["words", "highlight"],
    maxStill: 3, music: "chill", risers: false, calm: true,
  },
};
export const RECIPE_NAMES = Object.keys(RECIPES);

/** The recipe the AI picked, or a sensible guess from the material. */
export function pickRecipe(name, { hasSpeech, onlyPhotos }) {
  if (RECIPES[name]) return { name, ...RECIPES[name] };
  const guess = hasSpeech ? "talk" : onlyPhotos ? "list" : "promo";
  return { name: guess, ...RECIPES[guess] };
}

/**
 * Fill in / clean up the transitions with the recipe's family: missing or unknown ones get the recipe's choice,
 * and one fancy transition is never used more than twice in a row (pros vary them).
 */
export function recipeTransitions(recipe, wanted, count, known) {
  const fam = recipe.transitions;
  const out = [];
  for (let k = 0; k < count; k++) {
    let t = known.includes(wanted[k]) ? wanted[k] : fam[k % fam.length];
    if (t !== "cut" && out.length >= 2 && out[out.length - 1] === t && out[out.length - 2] === t) t = fam.find((x) => x !== t) || t;
    out.push(t);
  }
  return out;
}

/** Text animation: the AI's choice if valid; otherwise the hook uses "words" and the rest rotate through the recipe's family. */
export function recipeAnim(recipe, wanted, index, known) {
  if (known.includes(wanted)) return wanted;
  if (index === 0) return "words";
  return recipe.anims[index % recipe.anims.length];
}
