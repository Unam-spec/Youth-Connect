export type ProfileRole = "super_admin" | "leader" | "member" | "visitor";
export type DirectorySort = "name" | "newest" | "oldest";

export interface DirectoryListParams {
  roles: ProfileRole[] | undefined;
  sort: DirectorySort;
  search: string | undefined;
  page: number;
  pageSize: number;
  offset: number;
}

const ALL_ROLES: ProfileRole[] = ["super_admin", "leader", "member", "visitor"];

/**
 * Resolves the directory listing query into a role filter + sort + pagination.
 * `group` ("leaders" | "members") takes precedence over a legacy single `role`.
 */
export function resolveDirectoryListParams(
  q: Record<string, unknown>,
): DirectoryListParams {
  const rawSearch = typeof q.search === "string" ? q.search.trim() : "";
  const search = rawSearch.length > 0 ? rawSearch : undefined;

  const group = typeof q.group === "string" ? q.group : "";
  let roles: ProfileRole[] | undefined;
  if (group === "leaders") roles = ["leader", "super_admin"];
  else if (group === "members") roles = ["member", "visitor"];
  else {
    const role = typeof q.role === "string" ? q.role : "";
    roles = (ALL_ROLES as string[]).includes(role) ? [role as ProfileRole] : undefined;
  }

  const sortRaw = typeof q.sort === "string" ? q.sort : "";
  const sort: DirectorySort =
    sortRaw === "newest" ? "newest" : sortRaw === "oldest" ? "oldest" : "name";

  const page = Math.max(1, parseInt(String(q.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(q.pageSize ?? "50"), 10) || 50));
  const offset = (page - 1) * pageSize;

  return { roles, sort, search, page, pageSize, offset };
}
