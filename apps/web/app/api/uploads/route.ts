import { config, createImageAsset, UserError } from "@cc/core";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";

const tooLarge = () =>
  new UserError("too_large", `حجم فایل بیشتر از ${Math.round(config.maxUploadBytes / 1024 / 1024)} مگابایت است.`, 413);

export async function POST(req: Request) {
  try {
    // Reject early from the header; the multipart overhead is small.
    if (Number(req.headers.get("content-length") ?? 0) > config.maxUploadBytes + 64 * 1024) throw tooLarge();
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new UserError("no_file", "فایلی انتخاب نشده است.");
    if (file.size > config.maxUploadBytes) throw tooLarge();

    const asset = await createImageAsset(Buffer.from(await file.arrayBuffer()), "upload");
    return Response.json({ asset }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
