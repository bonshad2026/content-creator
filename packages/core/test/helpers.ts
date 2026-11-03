import sharp from "sharp";

/** A solid-colour test image. */
export function makeImage(width: number, height: number, format: "jpeg" | "png" = "jpeg", alpha = false) {
  return sharp({
    create: {
      width,
      height,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: 255, g: 0, b: 0, alpha: 0.5 } : "#3366cc",
    },
  })
    .toFormat(format)
    .toBuffer();
}
