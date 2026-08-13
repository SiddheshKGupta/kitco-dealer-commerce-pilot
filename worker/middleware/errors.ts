import type { Context } from "hono";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function handleApiError(error: Error, context: Context) {
  const correlationId = context.get("correlationId" as never) as string | undefined;
  if (error instanceof ApiError) {
    return context.json({ error: { code: error.code, message: error.message, details: error.details, correlationId } }, error.status);
  }
  if (error instanceof ZodError) {
    return context.json({ error: { code: "INVALID_REQUEST", message: "Request validation failed", details: error.issues, correlationId } }, 400);
  }
  console.error(JSON.stringify({ level: "error", correlationId, event: "unhandled_api_error", message: error.message }));
  return context.json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred", correlationId } }, 500);
}
