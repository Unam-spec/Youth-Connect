/**
 * Worship Team push. A browser has a single push subscription shared by JG
 * Youth and Worship; we register that same subscription with the worship
 * server (its own table) and never unsubscribe the browser itself, so turning
 * worship notifications off doesn't break JG Youth ones.
 */
import { isPushSupported, isIos, isStandalone } from "./pushClient";
import { worshipPost } from "./worship";

export type WorshipPushResult = "subscribed" | "denied" | "unsupported" | "ios-needs-install" | "error";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export async function enableWorshipPush(): Promise<WorshipPushResult> {
  if (!isPushSupported()) return isIos() && !isStandalone() ? "ios-needs-install" : "unsupported";
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const keyRes = await fetch("/api/push/public-key");
      if (!keyRes.ok) return "error";
      const { public_key } = (await keyRes.json()) as { public_key: string };
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(public_key),
      });
    }
    await worshipPost("/push/subscribe", sub.toJSON());
    return "subscribed";
  } catch (err) {
    console.error("enableWorshipPush failed:", err);
    return "error";
  }
}

/** Stops worship pushes to this device (server side only). */
export async function disableWorshipPush(): Promise<void> {
  try {
    if (!isPushSupported()) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await worshipPost("/push/unsubscribe", { endpoint: sub.endpoint });
  } catch (err) {
    console.error("disableWorshipPush failed:", err);
  }
}
