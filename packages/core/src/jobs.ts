import { z } from "zod";
import { createImageAsset, getAssetRow, toAsset, type Asset } from "./assets";
import { db } from "./db";
import { UserError } from "./errors";
import { storage } from "./storage";
import { toolNames, tools, type ToolName } from "./tools";

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface Job {
  id: string;
  tool: ToolName;
  params: unknown;
  status: JobStatus;
  error: string | null;
  input: Asset;
  output: Asset | null;
  createdAt: string;
  finishedAt: string | null;
}

export const createJobInput = z.object({
  assetId: z.uuid(),
  tool: z.enum(toolNames),
  params: z.unknown().optional(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates the request and stores a queued job. Enqueueing is the caller's job (see queue.ts). */
export async function createJob(body: unknown): Promise<Job> {
  const parsed = createJobInput.safeParse(body);
  if (!parsed.success) throw new UserError("invalid_request", "درخواست نامعتبر است.");
  const { assetId, tool } = parsed.data;

  const params = tools[tool].params.safeParse(parsed.data.params ?? {});
  if (!params.success) throw new UserError("invalid_params", "تنظیمات ابزار نامعتبر است.");

  const asset = await getAssetRow(assetId);
  if (!asset || asset.kind !== "upload") throw new UserError("asset_not_found", "فایل پیدا نشد.", 404);

  const pool = await db();
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO jobs (tool, params, input_asset_id) VALUES ($1, $2, $3) RETURNING id",
    [tool, JSON.stringify(params.data), assetId],
  );
  return (await getJob(rows[0].id))!;
}

export async function getJob(id: string): Promise<Job | null> {
  if (!UUID_RE.test(id)) return null;
  const pool = await db();
  const { rows } = await pool.query(
    `SELECT j.*, row_to_json(i) AS input, row_to_json(o) AS output
       FROM jobs j
       JOIN assets i ON i.id = j.input_asset_id
       LEFT JOIN assets o ON o.id = j.output_asset_id
      WHERE j.id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    tool: r.tool,
    params: r.params,
    status: r.status,
    error: r.error,
    input: toAsset(r.input),
    output: r.output ? toAsset(r.output) : null,
    createdAt: r.created_at.toISOString(),
    finishedAt: r.finished_at?.toISOString() ?? null,
  };
}

export async function failJob(id: string, error: string): Promise<void> {
  const pool = await db();
  await pool.query(
    "UPDATE jobs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1 AND status IN ('queued', 'running')",
    [id, error],
  );
}

/** Runs a queued job. Safe to call twice: only the call that moves it to "running" does the work. */
export async function runJob(id: string): Promise<void> {
  const pool = await db();
  const { rows } = await pool.query(
    `UPDATE jobs SET status = 'running', started_at = now()
      WHERE id = $1 AND status = 'queued'
      RETURNING tool, params, input_asset_id`,
    [id],
  );
  const job = rows[0];
  if (!job) return;

  try {
    const input = await getAssetRow(job.input_asset_id);
    if (!input) throw new Error("input asset missing");
    const tool = tools[job.tool as ToolName];
    if (!tool) throw new Error(`unknown tool: ${job.tool}`);
    const result = await tool.run(await storage.get(input.storage_key), tool.params.parse(job.params));
    const output = await createImageAsset(result.data, "output");
    await pool.query(
      "UPDATE jobs SET status = 'done', output_asset_id = $2, finished_at = now() WHERE id = $1",
      [id, output.id],
    );
  } catch (err) {
    console.error(`job ${id} failed:`, err);
    await failJob(id, err instanceof UserError ? err.message : "پردازش ناموفق بود.");
  }
}
