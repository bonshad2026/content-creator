import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { config } from "./config";

// Local-disk driver. Keys look like "uploads/<uuid>.jpg"; anything else is rejected,
// which also rules out path traversal from /api/files/<key>.
const KEY_RE = /^(uploads|outputs)\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

export function isValidKey(key: string): boolean {
  return KEY_RE.test(key);
}

function filePath(key: string): string {
  if (!isValidKey(key)) throw new Error(`invalid storage key: ${key}`);
  return path.join(config.storageDir, ...key.split("/"));
}

export const storage = {
  async put(key: string, data: Buffer): Promise<void> {
    const file = filePath(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
  },
  async get(key: string): Promise<Buffer> {
    return fs.readFile(filePath(key));
  },
  /** Returns null when the file doesn't exist. */
  async open(key: string): Promise<{ stream: NodeJS.ReadableStream; size: number } | null> {
    const file = filePath(key);
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile()) return null;
    return { stream: createReadStream(file), size: stat.size };
  },
};

export function publicUrl(key: string): string {
  return `/api/files/${key}`;
}
