/**
 * Role-aware follow-up ladders and template plumbing.
 *
 * Members/visitors are flagged at 2/4/6/8 weeks absent. Leaders and super
 * admins are expected weekly, so they sit on a stricter 1/2/4-week ladder
 * (4 is terminal). Each audience has its own whatsapp_templates
 * `template_type` so the message tone can differ per role.
 */

export function isStaffRole(role: string): boolean {
  return role === "leader" || role === "super_admin";
}

/** Follow-up stage (in weeks) for a role + weeks absent, or null if not due. */
export function stageForRole(
  role: string,
  weeks: number | null | undefined,
): number | null {
  if (weeks == null) return null;
  if (isStaffRole(role)) {
    if (weeks >= 4) return 4;
    if (weeks >= 2) return 2;
    if (weeks >= 1) return 1;
    return null;
  }
  if (weeks >= 8) return 8;
  if (weeks >= 6) return 6;
  if (weeks >= 4) return 4;
  if (weeks >= 2) return 2;
  return null;
}

/** whatsapp_templates.template_type holding a given role's follow-up set. */
export function templateTypeForRole(role: string): string {
  if (role === "leader") return "follow_up_leader";
  if (role === "super_admin") return "follow_up_super_admin";
  return "follow_up";
}

/** All follow-up template types the generator must load. */
export const FOLLOW_UP_TEMPLATE_TYPES = [
  "follow_up",
  "follow_up_leader",
  "follow_up_super_admin",
];

/**
 * Replace template placeholders. Templates are documented with the
 * square-bracket form ([User], [Leader]); the curly form ({{User}}) is kept
 * for any live templates hand-edited to the old generator syntax.
 */
export function applyTemplateVars(
  text: string,
  vars: Record<string, string>,
): string {
  let result = text;
  for (const [k, v] of Object.entries(vars)) {
    result = result.split(`[${k}]`).join(v).split(`{{${k}}}`).join(v);
  }
  return result;
}

/** Built-in fallback when no template exists for a role + stage. */
export function defaultFollowUpMessage(
  role: string,
  stage: number,
  firstName: string,
): string {
  if (isStaffRole(role)) {
    return `Follow-up (${stage}w): Hi ${firstName}, we've missed you at JG Youth — the team isn't the same without you!`;
  }
  return `Follow-up (${stage}w): Hi ${firstName}, we miss you at JG Youth!`;
}
