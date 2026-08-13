import { createMiddleware } from "hono/factory";
import type { AuthVariables } from "./auth";

const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export const correlation = createMiddleware<{ Variables: AuthVariables }>(async (context, next) => {
  const supplied = context.req.header("x-correlation-id");
  const correlationId = supplied && SAFE_CORRELATION_ID.test(supplied) ? supplied : crypto.randomUUID();
  context.set("correlationId", correlationId);
  await next();
  context.header("x-correlation-id", correlationId);
});
