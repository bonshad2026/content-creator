import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { FITS, PRESETS, type Preset } from "../src/presets";
import { resize, resizeParams } from "../src/tools/resize";
import { makeImage } from "./helpers";

describe("resize tool", () => {
  it.each(Object.keys(PRESETS) as Preset[])("produces the %s preset size", async (preset) => {
    const input = await makeImage(800, 600);
    for (const fit of FITS) {
      const out = await resize(input, resizeParams.parse({ preset, fit }));
      const meta = await sharp(out.data).metadata();
      expect(meta.format).toBe("jpeg");
      expect([meta.width, meta.height]).toEqual([PRESETS[preset].width, PRESETS[preset].height]);
    }
  });

  it("contain fills the bars with the background colour", async () => {
    const input = await makeImage(1000, 1000);
    const out = await resize(input, resizeParams.parse({ preset: "story", fit: "contain", background: "#ff0000" }));
    const pixel = await sharp(out.data).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    expect(pixel[0]).toBeGreaterThan(240);
    expect(pixel[1]).toBeLessThan(15);
  });

  it("flattens transparent PNGs", async () => {
    const input = await makeImage(500, 500, "png", true);
    const out = await resize(input, resizeParams.parse({ preset: "square" }));
    expect((await sharp(out.data).metadata()).hasAlpha).toBe(false);
  });

  it("rejects unknown presets and bad colours", () => {
    expect(resizeParams.safeParse({ preset: "huge" }).success).toBe(false);
    expect(resizeParams.safeParse({ preset: "square", background: "red" }).success).toBe(false);
    expect(resizeParams.parse({ preset: "square" })).toEqual({ preset: "square", fit: "cover", background: "#000000" });
  });
});
