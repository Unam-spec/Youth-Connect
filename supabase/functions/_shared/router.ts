import { Hono } from "npm:hono@4";
import { cors } from "npm:hono@4/cors";

/**
 * Builds a Hono app preconfigured with permissive CORS (the frontend sends a
 * Clerk Bearer token and/or x-leader-session header) and a JSON 500 handler that
 * mirrors the old Express error handler.
 */
export function createApp(): Hono {
  const app = new Hono();
  app.use(
    "*",
    cors({
      origin: (o) => o ?? "*",
      allowHeaders: ["authorization", "x-leader-session", "content-type", "x-client-info", "apikey"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    }),
  );
  app.onError((err, c) => {
    console.error("[edge] unhandled error:", err);
    return c.json({ error: "Internal server error" }, 500);
  });
  return app;
}
