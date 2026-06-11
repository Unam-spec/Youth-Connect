import { useAuth } from "@clerk/react";
import { getLeaderSession } from "./auth";
import { getPinSession } from "./pinSession";

interface ClerkGlobal {
  loaded?: boolean;
  load?: () => Promise<void>;
  session?: { getToken?: () => Promise<string | null> };
}

export async function apiFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  // This is a client-side utility, so we can't use hooks here.
  // Use Clerk's global object, ensuring it is fully loaded before requesting a
  // token (the session isn't available until Clerk finishes loading).
  let token = "";

  if (typeof window !== "undefined") {
    const clerk = (window as unknown as { Clerk?: ClerkGlobal }).Clerk;
    if (clerk) {
      try {
        if (!clerk.loaded && typeof clerk.load === "function") {
          await clerk.load();
        }
        token = (await clerk.session?.getToken?.()) ?? "";
      } catch (error) {
        console.error("Failed to get Clerk token:", error);
      }
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // Attach a PIN session header: leaders use the leader session; username+PIN
  // kids use the pin session. The backend validates either against
  // profiles.session_token.
  const leaderSession = getLeaderSession();
  if (leaderSession) {
    headers["x-leader-session"] = JSON.stringify(leaderSession);
  } else {
    const pinSession = getPinSession();
    if (pinSession) {
      headers["x-leader-session"] = JSON.stringify({
        profile_id: pinSession.profile_id,
        session_token: pinSession.session_token,
        expires_at: pinSession.expires_at,
      });
    }
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

    // Attach a PIN session header: leaders use the leader session; username+PIN
    // kids use the pin session. The backend validates either against
    // profiles.session_token.
    const leaderSession = getLeaderSession();
    if (leaderSession) {
      headers["x-leader-session"] = JSON.stringify(leaderSession);
    } else {
      const pinSession = getPinSession();
      if (pinSession) {
        headers["x-leader-session"] = JSON.stringify({
          profile_id: pinSession.profile_id,
          session_token: pinSession.session_token,
          expires_at: pinSession.expires_at,
        });
      }
    }

    return fetch(url, {
      ...options,
      headers,
    });
  };
}
