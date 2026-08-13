import { Hono } from "hono";
import { createAuthApp } from "./auth/app";
import type { Env } from "./env";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (context) => context.json({ status: "ok" }));
app.all("/api/activation/*", (context) =>
  createAuthApp(context.env).fetch(context.req.raw, context.env, context.executionCtx),
);
app.all("/api/login/*", (context) =>
  createAuthApp(context.env).fetch(context.req.raw, context.env, context.executionCtx),
);
app.all("/api/otp/*", (context) =>
  createAuthApp(context.env).fetch(context.req.raw, context.env, context.executionCtx),
);

export default app;
