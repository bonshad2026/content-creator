import { getJob, UserError } from "@cc/core";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  try {
    const { id } = await ctx.params;
    const job = await getJob(id);
    if (!job) throw new UserError("job_not_found", "کار پیدا نشد.", 404);
    return Response.json({ job });
  } catch (err) {
    return errorResponse(err);
  }
}
