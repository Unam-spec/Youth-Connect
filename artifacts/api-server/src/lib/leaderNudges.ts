import type { PushPayload } from "./pushLogic";

/**
 * Pushes that tell JG Youth leaders there's messaging to do. Leaders send
 * the messages themselves from the Messages tab; these just make sure they
 * know when.
 */

/** When the daily "messages waiting" reminder goes out (SAST). */
export const PENDING_FOLLOWUPS_TIME = "12:00";

/** An hour before check-in closes: send the one check-in message to the group. */
export function checkinGroupNudgePayload(): PushPayload {
  return {
    title: "JG Youth · Leaders",
    body: "⏰ Check-in closes in an hour. Tap to send the check-in reminder to the group.",
    url: "/dashboard/follow-ups?send=checkin",
  };
}

/** The weekly follow-up list was just made: who's been away for weeks. */
export function newFollowUpsPayload(count: number): PushPayload {
  const who = count === 1 ? "1 person has" : `${count} people have`;
  return {
    title: "JG Youth · Leaders",
    body: `📨 ${who} been away for weeks. Open Messages to follow up.`,
    url: "/dashboard/follow-ups",
  };
}

/** Daily while follow-up messages are still waiting to be sent. */
export function pendingFollowUpsPayload(count: number): PushPayload {
  const what = count === 1 ? "1 follow-up message" : `${count} follow-up messages`;
  return {
    title: "JG Youth · Leaders",
    body: `📨 You have ${what} waiting to be sent. Open Messages to send them.`,
    url: "/dashboard/follow-ups",
  };
}
