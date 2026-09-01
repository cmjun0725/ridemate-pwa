import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./features.css";
import App from "./App";

if ("serviceWorker" in navigator)
  window.addEventListener("load", () =>
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => undefined),
  );
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
