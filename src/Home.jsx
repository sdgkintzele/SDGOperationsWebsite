// src/Home.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import AnnouncementForm from "./components/AnnouncementForm";

const quickLinks = [
  {
    id: "belfry",
    label: "Belfry",
    url: "https://www.belfrysoftware.com/",
    ext: true,
  },
  { id: "yms", label: "YMS", url: "https://bgdc.ymshub.com/login", ext: true },
];

function LinksList({ query, setQuery, filtered }) {
  return (
    <div className="space-y-3">
      <h3 className="font-heading text-sm uppercase tracking-wide text-sdg-slate dark:text-white/60">
        Links
      </h3>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search links…"
        className="w-full rounded-xl border border-sdg-dark/10 dark:border-white/15 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sdg-dark/20 bg-white dark:bg-transparent"
      />
      <ul className="divide-y divide-sdg-dark/10 dark:divide-white/10">
        {filtered.map((link) => (
          <li key={link.id} className="py-2 flex items-center justify-between">
            <span className="text-sm">{link.label}</span>
            {link.ext ? (
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium hover:underline"
              >
                Open
              </a>
            ) : (
              <Link
                to={link.url}
                className="text-sm font-medium hover:underline"
              >
                Open
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let dead = false;
    (async () => {
      setLoading(true);
      setErr("");
      const { data, error } = await supabase
        .from("announcements")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(25);
      if (!dead) {
        if (error) setErr(error.message);
        setPosts(data ?? []);
        setLoading(false);
      }
    })();
    return () => void (dead = true);
  }, []);

  const handlePosted = (row) => setPosts((prev) => [row, ...prev]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return quickLinks;
    return quickLinks.filter((x) => x.label.toLowerCase().includes(q));
  }, [query]);

  return (
    <main className="container py-6">
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        {/* Left column: Toolbar + Links inside a single sticky frame */}
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <div className="frame overflow-hidden">
              <div className="frame-accent" />
              <div className="p-3">
                {/* Toolbar */}
                <nav aria-label="Sidebar" className="space-y-1 mb-4">
                  {[
                    { to: "/", label: "Home" },
                    { to: "/interior-audit", label: "Interior Audit" },
                    { to: "/audit", label: "Gate Audit" },
                    { to: "/breaches", label: "Active Breach Periods" },
                    { to: "/audit-stats", label: "Audit Stats" },
                    { to: "/stats", label: "Site Stats" },
                  ].map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) =>
                        "block rounded-xl px-3 py-2 text-sm font-medium transition " +
                        (isActive
                          ? "bg-white dark:bg-[#12161b] text-sdg-charcoal dark:text-white shadow-soft border border-sdg-dark/10 dark:border-white/10"
                          : "text-sdg-charcoal/80 dark:text-white/70 hover:text-sdg-charcoal dark:hover:text-white hover:bg-white/60 dark:hover:bg-white/[0.04]")
                      }
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </nav>

                {/* Divider */}
                <div className="h-px w-full bg-sdg-dark/10 dark:bg-white/10 my-3" />

                {/* Links section inside the same frame */}
                <LinksList
                  query={query}
                  setQuery={setQuery}
                  filtered={filtered}
                />
              </div>
            </div>
          </div>
        </aside>

        {/* Right column: content */}
        <section className="space-y-6">
          {/* Mobile-only Links at top (since sidebar is hidden on mobile) */}
          <div className="lg:hidden">
            <div className="frame overflow-hidden">
              <div className="frame-accent" />
              <div className="p-5">
                <LinksList
                  query={query}
                  setQuery={setQuery}
                  filtered={filtered}
                />
              </div>
            </div>
          </div>

          {/* Post + Board side-by-side on large screens */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Post form */}
            <div className="frame overflow-hidden">
              <div className="frame-accent" />
              <div className="p-5">
                <h2 className="font-heading text-lg">Post to Bulletin Board</h2>
                <p className="text-xs text-sdg-slate dark:text-white/60">
                  Keep it brief—quick notifications for the team.
                </p>
                <div className="mt-4">
                  <AnnouncementForm onPosted={handlePosted} />
                </div>
              </div>
            </div>

            {/* Bulletin Board */}
            <div className="frame overflow-hidden">
              <div className="frame-accent" />
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-heading text-lg">Bulletin Board</h2>
                  <span className="text-xs text-sdg-slate dark:text-white/60">
                    {posts.length} {posts.length === 1 ? "post" : "posts"}
                  </span>
                </div>

                <div className="mt-3">
                  {loading && (
                    <div className="text-sm opacity-70">Loading…</div>
                  )}
                  {err && (
                    <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded-xl px-3 py-2">
                      {err}
                    </div>
                  )}
                  {!loading && !err && posts.length === 0 && (
                    <div className="text-sm opacity-70">No posts yet.</div>
                  )}

                  <ul className="space-y-4">
                    {posts.map((p) => (
                      <li
                        key={p.id}
                        className="border border-sdg-dark/10 dark:border-white/10 rounded-xl p-3"
                      >
                        <div className="font-heading">{p.title}</div>
                        <div className="mt-1 text-sm whitespace-pre-line">
                          {p.body}
                        </div>
                        <div className="mt-1 text-xs opacity-70">
                          {new Date(p.created_at).toLocaleString()}{" "}
                          {p.author ? "• " + p.author : ""}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
