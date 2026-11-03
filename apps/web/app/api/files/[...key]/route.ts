import { Readable } from "node:stream";
import { isValidKey, storage } from "@cc/core";

export const runtime = "nodejs";

const MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

export async function GET(_req: Request, ctx: RouteContext<"/api/files/[...key]">) {
  const key = (await ctx.params).key.join("/");
  if (!isValidKey(key)) return new Response("Not found", { status: 404 });
  const file = await storage.open(key);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(Readable.toWeb(file.stream as Readable) as ReadableStream, {
    headers: {
      "Content-Type": MIME[key.split(".").pop()!],
      "Content-Length": String(file.size),
      // Keys are random UUIDs and files never change.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
