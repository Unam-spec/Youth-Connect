/**
 * WhatsApp invite a super admin sends a leader so they can start using the
 * app on their own phone: link, login details and "add to home screen".
 */
export function buildLeaderInviteMessage(opts: {
  fullName: string | null;
  phone: string;
  pin: string;
  appUrl: string;
}): string {
  const first = (opts.fullName ?? "").trim().split(/\s+/)[0] || "there";
  return [
    `Hi ${first}! 👋 You're a leader on the JG Youth app — take attendance, see who's been missing and follow up, all from your phone.`,
    "",
    `1. Open ${opts.appUrl}/leader-login`,
    `2. Log in with your phone number ${opts.phone} and PIN ${opts.pin}`,
    "3. Tap Share (or ⋮) → Add to Home Screen, so it's one tap away next time",
    "",
    "You'll stay logged in for 30 days. See you Friday! 🙌",
  ].join("\n");
}
