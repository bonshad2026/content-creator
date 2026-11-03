import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, config, createImageAsset, createJob, db, getJob, runJob, UserError } from "../src";
import { makeImage } from "./helpers";

afterAll(() => closeDb());

describe("assets", () => {
  it("stores an image and detects its format from the bytes", async () => {
    const asset = await createImageAsset(await makeImage(640, 480, "png"), "upload");
    expect(asset).toMatchObject({ kind: "upload", mime: "image/png", width: 640, height: 480 });
    expect(asset.url).toMatch(/^\/api\/files\/uploads\/[0-9a-f-]{36}\.png$/);
  });

  it("rejects files that are not images", async () => {
    await expect(createImageAsset(Buffer.from("not an image"), "upload")).rejects.toMatchObject({
      code: "unsupported_image",
    });
  });
});

describe("jobs", () => {
  it("runs a resize job end to end", async () => {
    const input = await createImageAsset(await makeImage(1200, 800), "upload");
    const job = await createJob({ assetId: input.id, tool: "resize", params: { preset: "story", fit: "blur" } });
    expect(job).toMatchObject({ status: "queued", output: null, params: { preset: "story", fit: "blur" } });

    await runJob(job.id);
    const done = await getJob(job.id);
    expect(done).toMatchObject({ status: "done", error: null });
    expect(done!.output).toMatchObject({ kind: "output", mime: "image/jpeg", width: 1080, height: 1920 });

    // Running it again is a no-op.
    await runJob(job.id);
    expect((await getJob(job.id))!.output!.id).toBe(done!.output!.id);
  });

  it("validates the request", async () => {
    const input = await createImageAsset(await makeImage(100, 100), "upload");
    const cases: [unknown, string][] = [
      [{ assetId: "nope", tool: "resize" }, "invalid_request"],
      [{ assetId: input.id, tool: "teleport", params: {} }, "invalid_request"],
      [{ assetId: input.id, tool: "resize", params: { preset: "huge" } }, "invalid_params"],
      [{ assetId: "00000000-0000-4000-8000-000000000000", tool: "resize", params: { preset: "square" } }, "asset_not_found"],
    ];
    for (const [body, code] of cases) {
      const err = await createJob(body).catch((e) => e);
      expect(err).toBeInstanceOf(UserError);
      expect(err.code).toBe(code);
    }
  });

  it("does not accept output assets as input", async () => {
    const output = await createImageAsset(await makeImage(100, 100), "output");
    await expect(createJob({ assetId: output.id, tool: "resize", params: { preset: "square" } })).rejects.toMatchObject({
      code: "asset_not_found",
    });
  });

  it("marks the job failed when processing throws", async () => {
    const input = await createImageAsset(await makeImage(100, 100), "upload");
    const job = await createJob({ assetId: input.id, tool: "resize", params: { preset: "square" } });
    // Corrupt the stored file so the tool throws.
    const { rows } = await (await db()).query("SELECT storage_key FROM assets WHERE id = $1", [input.id]);
    await fs.writeFile(path.join(config.storageDir, rows[0].storage_key), "garbage");

    await runJob(job.id);
    expect(await getJob(job.id)).toMatchObject({ status: "failed", output: null, error: expect.any(String) });
  });

  it("returns null for unknown or malformed ids", async () => {
    expect(await getJob("00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await getJob("../../etc/passwd")).toBeNull();
  });
});
