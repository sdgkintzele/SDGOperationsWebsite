import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom"; // Use HashRouter if your host lacks SPA rewrites
import App from "./App";
import { ToasterProvider } from "./lib/toast";

// Tailwind entry (must exist and include @tailwind base/components/utilities)
import "./styles.css";

/**
 * (Optional) Re-apply dark mode in JS too.
 * Index.html already sets it ASAP, but this keeps parity if theme changes at runtime.
 */
(function applyThemeClass() {
  try {
    const saved = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle(
      "dark",
      saved === "dark" || (!saved && prefersDark)
    );
  } catch {
    /* no-op */
  }
})();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

createRoot(rootEl).render(
  <React.StrictMode>
    <ToasterProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ToasterProvider>
  </React.StrictMode>
);

/* If deploying to a static host without SPA rewrites, switch to HashRouter:

import { HashRouter } from "react-router-dom";
createRoot(rootEl).render(
  <React.StrictMode>
    <ToasterProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </ToasterProvider>
  </React.StrictMode>
);

*/
