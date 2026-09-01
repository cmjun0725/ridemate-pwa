import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./features.css";
import App from "./App";

if ("serviceWorker" in navigator)
  window.addEventListener("load", () =>
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then(() => {
        if ("Notification" in window && Notification.permission === "granted")
          void import("./push").then(({ listenForForegroundMessages }) =>
            listenForForegroundMessages(),
          );
      })
      .catch(() => undefined),
  );
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
