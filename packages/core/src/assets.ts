import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db } from "./db";
import { UserError } from "./errors";
import { publicUrl, storage } from "./storage";

const FORMAT_EXT: Record<string, { ext: string; mime: string }> = {
  jpeg: { ext: "jpg", mime: "image/jpeg" },
  png: { ext: "png", mime: "image/png" },
  webp: { ext: "webp", mime: "image/webp" },
};

export interface Asset {
  id: string;
  kind: "upload" | "output";
  mime: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  url: string;
}

interface AssetRow {
  id: string;
  kind: "upload" | "output";
  storage_key: string;
  mime: string;
  width: number | null;
  height: number | null;
  size_bytes: number;
}

export function toAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    kind: row.kind,
    mime: row.mime,
    width: row.width,
    height: row.height,
    sizeBytes: row.size_bytes,
    url: publicUrl(row.storage_key),
  };
}

/** Stores an image. The format is detected from the bytes, never from the file name or client MIME type. */
export async function createImageAsset(data: Buffer, kind: Asset["kind"]): Promise<Asset> {
  const meta = await sharp(data)
    .metadata()
    .catch(() => null);
  const format = meta?.format ? FORMAT_EXT[meta.format] : undefined;
  if (!meta || !format) {
    throw new UserError("unsupported_image", "فقط عکس JPEG، PNG یا WebP پشتیبانی می‌شود.");
  }
  // EXIF orientations 5–8 swap width and height.
  const swap = (meta.orientation ?? 1) >= 5;
  const width = (swap ? meta.height : meta.width) ?? null;
  const height = (swap ? meta.width : meta.height) ?? null;

  const id = randomUUID();
  const key = `${kind}s/${id}.${format.ext}`;
  await storage.put(key, data);
  const pool = await db();
  const { rows } = await pool.query<AssetRow>(
    `INSERT INTO assets (id, kind, storage_key, mime, width, height, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [id, kind, key, format.mime, width, height, data.length],
  );
  return toAsset(rows[0]);
}

export async function getAssetRow(id: string): Promise<AssetRow | null> {
  const pool = await db();
  const { rows } = await pool.query<AssetRow>("SELECT * FROM assets WHERE id = $1", [id]);
  return rows[0] ?? null;
}
