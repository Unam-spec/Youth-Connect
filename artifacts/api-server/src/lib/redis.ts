import { Redis } from "@upstash/redis";
import { logger } from "./logger";

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  redis = new Redis({ url, token });
  return redis;
}

export async function getCache<T>(key: string): Promise<T | null> {
  const client = getRedis();
  if (!client) return null;

  try {
    return await client.get<T>(key);
  } catch (err) {
    logger.warn({ err, key }, "Redis cache get failed");
    return null;
  }
}

export async function setCache(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  const client = getRedis();
  if (!client) return;

  try {
    await client.set(key, JSON.stringify(value), { ex: ttlSeconds });
  } catch (err) {
    logger.warn({ err, key }, "Redis cache set failed");
  }
}

export async function invalidateCache(...keys: string[]): Promise<void> {
  const client = getRedis();
  if (!client || keys.length === 0) return;

  try {
    await client.del(...keys);
  } catch (err) {
    logger.warn({ err, keys }, "Redis cache invalidation failed");
  }
}

export { getRedis };
