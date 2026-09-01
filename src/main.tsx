import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ErrorBoundary from "./ErrorBoundary";
import "./styles.css";
import "./features.css";
import App from "./App";

if ("serviceWorker" in navigator)
  window.addEventListener("load", () => {
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((registration) => {
        void registration.update();
        if ("Notification" in window && Notification.permission === "granted")
          void import("./push").then(({ listenForForegroundMessages }) =>
            listenForForegroundMessages(),
          );
      })
      .catch(() => undefined);
  });
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
