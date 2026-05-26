import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/messages.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
