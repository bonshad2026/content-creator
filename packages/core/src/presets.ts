// Client-safe constants (no Node-only imports): the web UI imports this file directly.

// Output sizes for social-media formats.
export const PRESETS = {
  square: { width: 1080, height: 1080 }, // post 1:1
  portrait: { width: 1080, height: 1350 }, // post 4:5
  story: { width: 1080, height: 1920 }, // story / reel 9:16
  landscape: { width: 1920, height: 1080 }, // 16:9
} as const;

export type Preset = keyof typeof PRESETS;

// cover: crop to fill · contain: fit with solid bars · blur: fit over a blurred copy of the photo
export const FITS = ["cover", "contain", "blur"] as const;
export type Fit = (typeof FITS)[number];
