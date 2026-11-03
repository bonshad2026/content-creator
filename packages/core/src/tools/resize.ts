import sharp from "sharp";
import { z } from "zod";
import { FITS, PRESETS, type Preset } from "../presets";
import type { ToolOutput } from "./types";

export const resizeParams = z.object({
  preset: z.enum(Object.keys(PRESETS) as [Preset, ...Preset[]]),
  fit: z.enum(FITS).default("cover"),
  background: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#000000"),
});

export type ResizeParams = z.infer<typeof resizeParams>;

export async function resize(input: Buffer, params: ResizeParams): Promise<ToolOutput> {
  const { width, height } = PRESETS[params.preset];
  const background = params.background;
  // rotate() with no arguments applies the EXIF orientation from phone cameras.
  const base = () => sharp(input).rotate();

  let out: ReturnType<typeof sharp>;
  if (params.fit === "cover") {
    out = base().resize(width, height, { fit: "cover", position: sharp.strategy.attention });
  } else if (params.fit === "contain") {
    out = base().resize(width, height, { fit: "contain", background });
  } else {
    const backdrop = await base()
      .resize(width, height, { fit: "cover" })
      .blur(40)
      .modulate({ brightness: 0.8 })
      .toBuffer();
    const front = await base().resize(width, height, { fit: "inside" }).toBuffer();
    out = sharp(backdrop).composite([{ input: front, gravity: "center" }]);
  }

  const data = await out.flatten({ background }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  return { data, mime: "image/jpeg", width, height };
}
