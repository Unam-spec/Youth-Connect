/**
 * Broadcast a newly-created event to opted-in members over WhatsApp.
 *
 * Fetches the `event_creation` template from `whatsapp_templates`, fills its
 * placeholders ([User], [Event], [Date], [Time], [Location]), and sends to every
 * profile with `whatsapp_opt_in = true` and a phone number. Never throws — it
 * logs a summary so a messaging hiccup can't break event creation.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, profilesTable, whatsappTemplatesTable } from "@workspace/db";
import { logger } from "./logger";
import { isTwilioConfigured, sendWhatsAppFromTemplate } from "./twilio";

interface BroadcastEvent {
  id: string;
  title: string;
  date: string;
  time: string;
  location: string;
}

function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

function friendlyDate(date: string): string {
  try {
    return new Date(`${date}T00:00:00`).toLocaleDateString("en-ZA", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  } catch {
    return date;
  }
}

export async function sendEventCreationBroadcast(
  event: BroadcastEvent,
): Promise<void> {
  if (!isTwilioConfigured) {
    logger.warn(
      { eventId: event.id },
      "Skipping event WhatsApp broadcast — Twilio not configured",
    );
    return;
  }

  const template = await db.query.whatsappTemplatesTable.findFirst({
    where: eq(whatsappTemplatesTable.template_type, "event_creation"),
  });
  if (!template) {
    logger.warn(
      { eventId: event.id },
      "Skipping event WhatsApp broadcast — no 'event_creation' template",
    );
    return;
  }

  const recipients = await db
    .select({ full_name: profilesTable.full_name, phone: profilesTable.phone })
    .from(profilesTable)
    .where(
      and(
        eq(profilesTable.whatsapp_opt_in, true),
        isNotNull(profilesTable.phone),
        sql`btrim(${profilesTable.phone}) <> ''`,
      ),
    );

  if (recipients.length === 0) {
    logger.info({ eventId: event.id }, "Event WhatsApp broadcast — no opted-in recipients");
    return;
  }

  const dateLabel = friendlyDate(event.date);

  const results = await Promise.allSettled(
    recipients.map((r) =>
      sendWhatsAppFromTemplate({
        to: r.phone as string,
        template,
        vars: {
          User: firstName(r.full_name),
          Event: event.title,
          Date: dateLabel,
          Time: event.time,
          Location: event.location,
        },
      }),
    ),
  );

  const sent = results.filter((x) => x.status === "fulfilled").length;
  const failed = results.length - sent;
  logger.info(
    { eventId: event.id, sent, failed, total: results.length },
    "Event WhatsApp broadcast complete",
  );
}
