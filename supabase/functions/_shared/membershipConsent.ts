// Mirrors artifacts/api-server/src/lib/membershipConsent.ts (single source of truth).
export interface ConsentSubject {
  role: string;
  age: number | null;
  parent_phone: string | null;
  parent_name: string | null;
}

export type ConsentResult = { ok: true } | { ok: false; error: string };

export const CONSENT_AGE = 13; // under 13 requires parental consent (COPPA line)

function nonBlank(v: string | null): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Decides whether a visitor may be promoted to member.
 * - Only `role === "visitor"` accounts can be promoted.
 * - age >= 13: allowed unconditionally.
 * - age < 13 or age unknown: requires parent_phone + parent_name present AND
 *   the leader explicitly confirming consent (`consentProvided`).
 */
export function canGrantMembership(
  subject: ConsentSubject,
  consentProvided: boolean,
): ConsentResult {
  if (subject.role !== "visitor") {
    return { ok: false, error: "Only visitor accounts can be promoted to member." };
  }
  const needsConsent = subject.age === null || subject.age < CONSENT_AGE;
  if (!needsConsent) return { ok: true };

  if (!nonBlank(subject.parent_phone) || !nonBlank(subject.parent_name)) {
    return {
      ok: false,
      error: "Parent name and phone are required to make an under-13 a member.",
    };
  }
  if (!consentProvided) {
    return { ok: false, error: "Parental consent must be confirmed for under-13s." };
  }
  return { ok: true };
}
