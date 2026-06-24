import "dotenv/config";
import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "./db";
import { startEmailProcessor, stopEmailProcessor } from "./jobs/emailProcessor";
import { startFollowUpGenerator, stopFollowUpGenerator } from "./jobs/followUpGenerator";

process.on("SIGTERM", () => {
  logger.info("Received SIGTERM, shutting down gracefully");
  stopEmailProcessor();
  stopFollowUpGenerator();
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer() {
  await runMigrations();
  startEmailProcessor();
  startFollowUpGenerator();

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

startServer().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});

