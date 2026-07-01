/**
 * Whether a (possibly gender-targeted) event should be shown to a viewer.
 *
 * - `target_gender` null/undefined → everyone sees it.
 * - `target_gender` set → only viewers of that gender see it. Anonymous viewers
 *   (no gender) therefore don't see gender-targeted events.
 */
export function isEventVisibleTo(
  event: { target_gender?: string | null },
  viewerGender: string | null | undefined,
): boolean {
  if (!event.target_gender) return true;
  return event.target_gender === viewerGender;
}
