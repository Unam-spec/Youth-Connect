import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? "https://0241df048f8dfc506dbaec130d5dd341@o4511190227681280.ingest.de.sentry.io/4511469195362384",
  environment: process.env.NODE_ENV ?? "production",
  tracesSampleRate: 1.0,
});

import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import router from "./routes";
import { logger } from "./lib/logger";
import { serverTiming } from "./lib/serverTiming";

const app: Express = express();
app.set("trust proxy", 1);
app.use(serverTiming);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ limit: "2mb", extended: true }));

// Map query parameters to headers for direct EventSource compatibility (as EventSource does not support custom headers natively)
app.use((req, res, next) => {
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  if (req.query.leader_session && !req.headers["x-leader-session"]) {
    req.headers["x-leader-session"] = String(req.query.leader_session);
  }
  next();
});

app.use(clerkMiddleware());

app.use("/api", router);

// Register Sentry error handler
Sentry.setupExpressErrorHandler(app);

// Generic 500 error handler
app.use((err: any, req: any, res: any, next: any) => {
  req.log.error(err);
  res.status(500).json({ error: "Internal server error" });
});

export default app;
