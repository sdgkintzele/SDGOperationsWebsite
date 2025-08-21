import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { downloadCSV } from "../lib/csv";

const UI_KEY = "pendingDocs.ui.wide.v1";

export default function PendingDocs() {
  const nav = useNavigate();

  /* ---------------- Wide mode ---------------- */
  const [wide, setWide] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(UI_KEY) || "true");
    } catch {
      return true;
    }
  });
  useEffect(() => {
    if (wide) document.body.classList.add("wide-page");
    else document.body.classList.remove("wide-page");
    return () => document.body.classList.remove("wide-page");
  }, [wide]);
  useEffect(() => {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify(wide));
    } catch {}
  }, [wide]);

  /* ---------------- Data ---------------- */
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ key: "documentation_due_at", dir: "asc" });

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("violations")
        .select(
          `
          id, occurred_at, documentation_due_at, doc_status,
          guards:guards(full_name),
          violation_types:violation_types(label, slug)
        `
        )
        .in("doc_status", ["pending"])
        .order("documentation_due_at", { ascending: true });
      if (!error) setRows(data ?? []);
      setLoading(false);
    })();
  }, []);

  /* ---------------- Derived ---------------- */
  const filtered = useMemo(() => {
    let out = rows
      // only types that actually require docs
      .filter((r) =>
        ["callout", "early_departure"].includes(r.violation_types?.slug)
      )
      // remain pending (so optimistic updates disappear immediately)
      .filter((r) => r.doc_status === "pending")
      .map((r) => ({
        id: r.id,
        guard: r.guards?.full_name ?? "—",
        type: r.violation_types?.label ?? "—",
        occurred_at: r.occurred_at,
        due_at: r.documentation_due_at,
        raw: r,
      }));

    if (q.trim()) {
      const t = q.trim().toLowerCase();
      out = out.filter((r) => `${r.guard} ${r.type}`.toLowerCase().includes(t));
    }

    out.sort((a, b) => {
      const av = new Date(a[sort.key] || 0).getTime();
      const bv = new Date(b[sort.key] || 0).getTime();
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.dir === "asc" ? cmp : -cmp;
    });

    return out;
  }, [rows, q, sort]);

  /* ---------------- Actions ---------------- */
  const mark = async (id, doc_status) => {
    // optimistic UI
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, doc_status } : r)));
    const { error } = await supabase
      .from("violations")
      .update({ doc_status })
      .eq("id", id);
    if (error) setRows(prev);
  };

  const exportCSV = () =>
    downloadCSV(
      `pending_docs_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`,
      filtered.map((r) => ({
        guard: r.guard,
        type: r.type,
        occurred_at: new Date(r.occurred_at).toLocaleString(),
        due_at: r.due_at ? new Date(r.due_at).toLocaleString() : "",
      }))
    );

  /* ---------------- Layout helpers ---------------- */
  const contentWidth = wide ? "max-w-none" : "max-w-[1600px]";
  const contentPad = wide ? "px-4 md:px-6" : "px-2 md:px-4";

  return (
    <div className="py-8">
      {/* Theming + brand accent + dark inputs */}
      <style>{`
        .surface {
          border-radius: 1rem;
          border: 1px solid rgba(0,0,0,.08);
          background: rgba(255,255,255,.7);
        }
        .dark .surface {
          border-color: rgba(255,255,255,.12);
          background: rgba(255,255,255,.06);
        }

        /* Accent stripe (brand) */
        .accent {
          height: 3px;
          background: linear-gradient(
            90deg,
            var(--sdg-accent-1, #E4B851),
            var(--sdg-accent-2, #F59E0B) 50%,
            var(--sdg-accent-1, #E4B851)
          );
          border-radius: 9999px;
          opacity: .8;
        }
        .dark .accent { opacity: .55; }

        /* Inputs: contrast in dark */
        input[type="text"] {
          background-color: #ffffff; color: #0f172a;
        }
        .dark input[type="text"] {
          background-color: #151a1e !important;
          color: #e5e7eb !important;
          border-color: rgba(255,255,255,0.12) !important;
        }
        ::placeholder { color: #64748b; }
        .dark ::placeholder { color: #9aa4b2 !important; }

        /* Wide shell */
        .wide-page .container,
        .wide-page .mx-auto,
        .wide-page [class*="max-w-"] { max-width: 100% !important; }
        .wide-page header, .wide-page nav { padding-left: 0 !important; padding-right: 0 !important; }
      `}</style>

      <div className={`mx-auto ${contentWidth} ${contentPad}`}>
        {/* Header */}
        <div className="mb-4 flex items-start gap-3">
          <div>
            <h1 className="font-heading text-2xl md:text-3xl">Pending Docs</h1>
            <p className="text-sdg-slate dark:text-white/70">
              Callouts and Early Departures awaiting documentation.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={wide}
                onChange={(e) => setWide(e.target.checked)}
              />
              <span>Wide Mode</span>
            </label>
            <button
              onClick={exportCSV}
              className="rounded-lg border border-black/10 dark:border-white/10 px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
            >
              Export CSV
            </button>
          </div>
        </div>

        <div className="accent mb-6" />

        {/* Controls row */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="text-sm text-sdg-slate">
            {loading ? "Loading…" : `${filtered.length} pending`}
          </span>
          <div className="ml-auto w-full sm:w-auto">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search guard / type…"
              aria-label="Search pending docs"
              className="w-full sm:w-80 rounded-xl border border-black/10 dark:border-white/10 px-3 py-2"
              type="text"
            />
          </div>
        </div>

        {/* Table */}
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left bg-black/[0.03] dark:bg-white/[0.03]">
                <tr>
                  <SortableTh
                    active={sort.key === "documentation_due_at"}
                    dir={sort.dir}
                    onClick={() =>
                      toggleSort(setSort, sort, "documentation_due_at")
                    }
                  >
                    Due
                  </SortableTh>
                  <Th>Guard</Th>
                  <Th>Type</Th>
                  <SortableTh
                    active={sort.key === "occurred_at"}
                    dir={sort.dir}
                    onClick={() => toggleSort(setSort, sort, "occurred_at")}
                  >
                    Occurred
                  </SortableTh>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>

              <tbody className="divide-y divide-black/5 dark:divide-white/10">
                {loading ? (
                  <tr>
                    <Td colSpan={5} className="py-6 text-sdg-slate">
                      Loading…
                    </Td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <Td colSpan={5} className="py-8 text-sdg-slate">
                      Nothing pending right now.
                    </Td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr
                      key={r.id}
                      className="odd:bg-white/40 dark:odd:bg-white/[0.03]"
                    >
                      <Td>
                        <DuePill dt={r.due_at} />
                      </Td>
                      <Td className="font-medium">{r.guard}</Td>
                      <Td>{r.type}</Td>
                      <Td>{new Date(r.occurred_at).toLocaleString()}</Td>
                      <Td className="text-right">
                        <div className="inline-flex gap-2">
                          <Btn onClick={() => mark(r.id, "provided")}>
                            Mark Provided
                          </Btn>
                          <Btn onClick={() => mark(r.id, "not_provided")}>
                            Not Provided
                          </Btn>
                          <Btn onClick={() => nav(`/hr/violations/${r.id}`)}>
                            Open
                          </Btn>
                        </div>
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Small UI helpers ---------------- */

function Th({ children, className = "", ...props }) {
  return (
    <th
      {...props}
      className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-sdg-slate ${className}`}
    >
      {children}
    </th>
  );
}
function SortableTh({ children, active, dir, onClick, className = "" }) {
  return (
    <Th
      onClick={onClick}
      className={`cursor-pointer select-none ${className}`}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {active ? (
          <span>{dir === "asc" ? "▲" : "▼"}</span>
        ) : (
          <span className="opacity-40">↕</span>
        )}
      </span>
    </Th>
  );
}
function Td({ children, className = "", ...props }) {
  return (
    <td {...props} className={`px-4 py-3 align-middle ${className}`}>
      {children}
    </td>
  );
}
function Btn({ children, className = "", ...props }) {
  return (
    <button
      className={`rounded-lg border border-black/10 dark:border-white/10 px-2.5 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/5 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function toggleSort(setSort, sort, key) {
  setSort((s) =>
    s.key === key
      ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
      : { key, dir: "asc" }
  );
}

function DuePill({ dt }) {
  const { label, cls } = dueBadge(dt);
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] ${cls}`}
    >
      {label}
    </span>
  );
}

function dueBadge(dt) {
  if (!dt)
    return {
      label: "—",
      cls: "bg-slate-100 text-slate-900 dark:bg-slate-800/50 dark:text-slate-200 border border-black/10 dark:border-white/10",
    };
  const ms = new Date(dt).getTime() - Date.now();
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const past = ms < 0;
  return past
    ? {
        label: `overdue`,
        cls: "bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200 border border-rose-200/60 dark:border-rose-800/40",
      }
    : {
        label: d > 0 ? `due in ${d}d` : `due in ${h}h`,
        cls: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100 border border-amber-200/70 dark:border-amber-800/40",
      };
}
