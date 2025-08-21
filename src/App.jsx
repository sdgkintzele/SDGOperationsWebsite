// src/App.jsx
import React, { useEffect, useState } from "react";
import { Routes, Route, NavLink } from "react-router-dom";

import Home from "./Home";
import BreachBoard from "./pages/BreachBoard.jsx";
import AuthGate from "./components/AuthGate.jsx";
import LogViolation from "./pages/LogViolation.jsx";

import Violations from "./pages/Violations.jsx";
import ViolationDetail from "./pages/ViolationDetail.jsx";
import PendingDocs from "./pages/PendingDocs.jsx";
import WeeklyReview from "./pages/WeeklyReview";

// NEW: Users pages
import Users from "./pages/Users.jsx";
import UserDetail from "./pages/UserDetail.jsx";

function GateAuditPlaceholder() {
  return (
    <div className="container py-8">
      <div className="card p-6">
        <div className="frame-accent mb-4" />
        <h1 className="font-heading text-2xl">Gate Audit</h1>
        <p className="mt-2 text-sdg-slate">Coming soon…</p>
      </div>
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "dark" || saved === "light") return saved;
    } catch {}
    const prefersDark =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    return prefersDark ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("theme", theme);
    } catch {}
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const navLink = ({ isActive }) =>
    `sidebar-link whitespace-nowrap ${isActive ? "sidebar-link-active" : ""}`;

  return (
    <div className="min-h-screen">
      {/* Top brand/header */}
      <header className="border-b border-sdg-dark/10 bg-white dark:border-white/10 dark:bg-[#0f1215]">
        <div className="container flex items-center justify-between py-5 md:py-6 gap-4">
          <div className="leading-tight">
            <h1 className="font-heading text-3xl md:text-4xl lg:text-5xl tracking-tight">
              Salient Defense Group
            </h1>
            <p className="text-sdg-slate dark:text-white/70 mt-1">Operations</p>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            className="btn btn-ghost"
            title={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
          >
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>

        {/* Primary nav */}
        <div className="container pb-4">
          <nav className="flex gap-2 overflow-x-auto">
            <NavLink to="/" end className={navLink} title="Home">
              Home
            </NavLink>

            <NavLink
              to="/hr/violations/new"
              className={navLink}
              title="Report a violation"
            >
              Report Violation
            </NavLink>

            <NavLink
              to="/hr/violations"
              className={navLink}
              title="Browse violation data"
            >
              Violation Data
            </NavLink>

            {/* NEW: Users */}
            <NavLink
              to="/hr/users"
              className={navLink}
              title="Roster & Profiles"
            >
              Users
            </NavLink>

            <NavLink
              to="/hr/weekly-review"
              className={navLink}
              title="Weekly analysis (previous Sun–Sat)"
            >
              Weekly Review
            </NavLink>

            <NavLink
              to="/hr/docs"
              className={navLink}
              title="Callouts & Early Departures awaiting documentation"
            >
              Pending Docs
            </NavLink>

            <NavLink to="/audit" className={navLink} title="Gate audit">
              Gate Audit
            </NavLink>

            <NavLink to="/breaches" className={navLink} title="Breach board">
              Breach Board
            </NavLink>
          </nav>
        </div>

        {/* Brand accent */}
        <div className="h-1.5 bg-sdg-gold" />
      </header>

      {/* Routed pages */}
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/audit" element={<GateAuditPlaceholder />} />
          <Route path="/breaches" element={<BreachBoard />} />

          {/* HR → Violations */}
          <Route
            path="/hr/violations/new"
            element={
              <AuthGate>
                <LogViolation />
              </AuthGate>
            }
          />
          <Route
            path="/hr/violations"
            element={
              <AuthGate>
                <Violations />
              </AuthGate>
            }
          />
          <Route
            path="/hr/violations/:id"
            element={
              <AuthGate>
                <ViolationDetail />
              </AuthGate>
            }
          />

          {/* NEW: HR → Users / Profiles */}
          <Route
            path="/hr/users"
            element={
              <AuthGate>
                <Users />
              </AuthGate>
            }
          />
          <Route
            path="/hr/users/:id"
            element={
              <AuthGate>
                <UserDetail />
              </AuthGate>
            }
          />

          {/* HR → Weekly Review */}
          <Route
            path="/hr/weekly-review"
            element={
              <AuthGate>
                <WeeklyReview />
              </AuthGate>
            }
          />

          {/* HR → Pending documentation */}
          <Route
            path="/hr/docs"
            element={
              <AuthGate>
                <PendingDocs />
              </AuthGate>
            }
          />

          {/* fallback */}
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
    </div>
  );
}
