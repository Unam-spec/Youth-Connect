import { getRedis } from "./redis";
import { logger } from "./logger";

const STREAM_KEY = "activity:events";
const MAX_STREAM_LEN = 10_000;

type ActivityType = "check_in" | "registration" | "rsvp" | "membership_request";

interface ActivityEvent {
  type: ActivityType;
  profile_id: string;
  profile_name: string;
  metadata?: Record<string, string>;
}

export async function publishActivity(event: ActivityEvent): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    const fields: Record<string, string> = {
      type: event.type,
      profile_id: event.profile_id,
      profile_name: event.profile_name,
      ts: new Date().toISOString(),
    };

    if (event.metadata) {
      for (const [k, v] of Object.entries(event.metadata)) {
        fields[`meta_${k}`] = v;
      }
    }

    await redis.xadd(STREAM_KEY, "*", fields, {
      trim: { type: "MAXLEN", threshold: MAX_STREAM_LEN, comparison: "~" },
    });
  } catch (err) {
    logger.warn({ err, event }, "Failed to publish activity event");
  }
}

export async function getRecentActivity(
  count = 50,
): Promise<Array<Record<string, string>>> {
  const redis = getRedis();
  if (!redis) return [];

  try {
    const entries = await redis.xrevrange<Record<string, string>>(
      STREAM_KEY,
      "+",
      "-",
      count,
    );

    return Object.values(entries);
  } catch (err) {
    logger.warn({ err }, "Failed to read activity stream");
    return [];
  }
}
