import { UserError } from "@cc/core";

export function errorResponse(err: unknown): Response {
  if (err instanceof UserError) {
    return Response.json({ error: err.code, message: err.message }, { status: err.status });
  }
  console.error(err);
  return Response.json({ error: "internal", message: "خطای داخلی سرور." }, { status: 500 });
}
