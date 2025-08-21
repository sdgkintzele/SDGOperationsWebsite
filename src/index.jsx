import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom"; // use HashRouter if you don't add a SPA redirect
import App from "./App";
import { ToasterProvider } from "./lib/toast";
import "./styles.css"; // Tailwind entry (must include @tailwind base/components/utilities)

/**
 * (Optional) Re-apply dark mode in JS too.
 * index.html already sets it ASAP; this keeps parity if theme changes at runtime.
 */
(function applyThemeClass() {
  try {
    const saved = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle(
      "dark",
      saved === "dark" || (!saved && prefersDark)
    );
  } catch {}
})();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ToasterProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ToasterProvider>
  </React.StrictMode>
);
