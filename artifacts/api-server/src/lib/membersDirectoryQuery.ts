export type DirectoryRole = "member" | "leader" | "super_admin";

export interface MembersDirectoryQuery {
  search: string | undefined;
  role: DirectoryRole | undefined;
  page: number;
  limit: number;
  offset: number;
}

const ALLOWED_ROLES: DirectoryRole[] = ["member", "leader", "super_admin"];

export function parseMembersDirectoryQuery(
  q: Record<string, unknown>,
): MembersDirectoryQuery {
  const rawSearch = typeof q.search === "string" ? q.search.trim() : "";
  const search = rawSearch.length > 0 ? rawSearch : undefined;

  const roleStr = typeof q.role === "string" ? q.role : "";
  const role = (ALLOWED_ROLES as string[]).includes(roleStr)
    ? (roleStr as DirectoryRole)
    : undefined;

  const page = Math.max(1, parseInt(String(q.page ?? "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(q.limit ?? "50"), 10) || 50));
  const offset = (page - 1) * limit;

  return { search, role, page, limit, offset };
}
