import { useAuth } from "@clerk/react";
import { getLeaderSession } from "./auth";

export async function apiFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  // This is a client-side utility, so we can't use hooks here
  // Instead, we'll use Clerk's getToken from the window object if available
  let token = "";

  if (typeof window !== "undefined" && (window as any).Clerk) {
    try {
      const clerk = (window as any).Clerk;
      token = await clerk.session?.getToken();
    } catch (error) {
      console.error("Failed to get Clerk token:", error);
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // Add leader session for super admin authentication
  const leaderSession = getLeaderSession();
  if (leaderSession) {
    headers["x-leader-session"] = JSON.stringify(leaderSession);
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

// React hook version for use in components
export function useApiFetch() {
  const { getToken } = useAuth();

  return async (url: string, options: RequestInit = {}): Promise<Response> => {
    const token = await getToken();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // Add leader session for super admin authentication
    const leaderSession = getLeaderSession();
    if (leaderSession) {
      headers["x-leader-session"] = JSON.stringify(leaderSession);
    }

    return fetch(url, {
      ...options,
      headers,
    });
  };
}
