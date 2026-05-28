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

const app: Express = express();

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(clerkMiddleware());

app.use("/api", router);

export default app;
