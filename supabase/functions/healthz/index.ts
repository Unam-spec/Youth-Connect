import { createApp } from "../_shared/router.ts";

const app = createApp();

app.get("/healthz", (c) => c.json({ ok: true }));

Deno.serve(app.fetch);
