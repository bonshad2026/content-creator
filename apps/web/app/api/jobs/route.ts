import { createJob, enqueueJob, failJob, getJob, UserError } from "@cc/core";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const job = await createJob(body);
    try {
      await enqueueJob(job.id);
    } catch (err) {
      console.error("enqueue failed:", err);
      await failJob(job.id, "صف پردازش در دسترس نیست.");
      throw new UserError("queue_unavailable", "صف پردازش در دسترس نیست. کمی بعد دوباره امتحان کنید.", 503);
    }
    return Response.json({ job: (await getJob(job.id)) ?? job }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
