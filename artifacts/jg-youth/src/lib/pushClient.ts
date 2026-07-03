/**
 * Browser-side web push helpers. Platform notes:
 * - Android/desktop Chrome: PushManager available in the normal tab.
 * - iOS 16.4+: PushManager exists ONLY when running installed to the home
 *   screen (standalone). In a plain Safari tab isPushSupported() is false.
 * - iOS < 16.4: never supported.
 */
import { apiFetch } from "./api";

export type PushSetupState =
  | "unsupported" // no push here, and not an iOS-install candidate
  | "ios-needs-install" // iOS Safari tab: push works after Add to Home Screen
  | "blocked" // user denied the permission prompt
  | "ready" // can subscribe now
  | "subscribed"; // this device already has an active subscription

export function isPushSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export async function getPushSetupState(): Promise<PushSetupState> {
  if (!isPushSupported()) {
    return isIos() && !isStandalone() ? "ios-needs-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission === "granted") {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) return "subscribed";
  }
  return "ready";
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export async function subscribeToPush(): Promise<
  "subscribed" | "denied" | "error"
> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";

    const keyRes = await apiFetch("/api/push/public-key");
    if (!keyRes.ok) return "error";
    const { public_key } = (await keyRes.json()) as { public_key: string };

    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key),
    });

    const save = await apiFetch("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify(sub.toJSON()),
    });
    if (!save.ok) {
      await sub.unsubscribe().catch(() => {});
      return "error";
    }
    return "subscribed";
  } catch (err) {
    console.error("subscribeToPush failed:", err);
    return "error";
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await apiFetch("/api/push/unsubscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    await sub.unsubscribe();
  } catch (err) {
    console.error("unsubscribeFromPush failed:", err);
  }
}
