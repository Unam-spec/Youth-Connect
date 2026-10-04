/**
 * Where to reopen the app. We remember the last area someone was in (member
 * dashboard, PIN account, leader dashboard, worship) and, when the app is
 * opened fresh, send them back there if they're still signed in to it —
 * otherwise they get the landing page, never a login screen.
 */
import { useEffect } from "react";
import { getLeaderSession } from "./auth";
import { getPinSession } from "./pinSession";
import { getWorshipSession } from "./worship";

type Area = "member" | "account" | "leader" | "worship";

const AREA_KEY = "jg_last_area";
const LAUNCH_KEY = "jg_launched";

function areaFor(path: string): Area | null {
  if (path === "/my" || path.startsWith("/my/")) return "member";
  if (path === "/account") return "account";
  if (path.startsWith("/dashboard")) return "leader";
  if (path.startsWith("/worship")) return "worship";
  return null;
}

/** Records the area of the current page (call on every route change). */
export function useRememberArea(path: string): void {
  useEffect(() => {
    const area = areaFor(path);
    if (!area) return;
    try {
      localStorage.setItem(AREA_KEY, area);
    } catch {
      /* storage blocked — just don't remember */
    }
  }, [path]);
}

/**
 * True only for the first landing-page render after the app is opened (a new
 * page load). Later visits to "/" — e.g. tapping "JG Youth" from worship —
 * show the landing page as normal.
 */
export function isFreshLaunch(): boolean {
  try {
    if (sessionStorage.getItem(LAUNCH_KEY)) return false;
    sessionStorage.setItem(LAUNCH_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

/** The page to reopen, given whether there's an email (Clerk) sign-in. */
export function resumePath(clerkSignedIn: boolean): string | null {
  let last: string | null = null;
  try {
    last = localStorage.getItem(AREA_KEY);
  } catch {
    /* ignore */
  }
  const available: Record<Area, string | null> = {
    member: clerkSignedIn ? "/my" : null,
    account: getPinSession() ? "/account" : null,
    leader: getLeaderSession() ? "/dashboard" : null,
    worship: getWorshipSession() ? "/worship" : null,
  };
  if (last && last in available && available[last as Area]) return available[last as Area];
  // No usable last area: fall back to whichever sign-in this device has.
  return available.member ?? available.account ?? available.leader ?? null;
}
