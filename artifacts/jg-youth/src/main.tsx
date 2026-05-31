import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN ?? "https://0241df048f8dfc506dbaec130d5dd341@o4511190227681280.ingest.de.sentry.io/4511469195362384",
  environment: import.meta.env.MODE,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
  ],
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});

import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

window.addEventListener("unhandledrejection", (event) => {
  if (event.reason?.message?.includes("No session was found")) {
    event.preventDefault();
    window.location.replace("/sign-in");
  }
});
createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary fallback={<p>Something went wrong.</p>}>
    <App />
  </Sentry.ErrorBoundary>
);
