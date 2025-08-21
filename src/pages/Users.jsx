// src/pages/Users.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { downloadCSV } from "../lib/csv";

const UI_KEY = "users.ui.v3.1";

/* ---------- helpers ---------- */
const pick = (r, ...keys) => {
  for (const k of keys) if (r?.[k] != null) return r[k];
  return null;
};
function fmtDate(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return "—";
  }
}
function fmtPct(v) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  const s = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${s.replace(/\.0$/, "")}%`;
}
function Th({ children, className = "", onClick, sorted, dir }) {
  const clickable = !!onClick;
  return (
    <th
      onClick={onClick}
      className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wide select-none ${
        clickable ? "cursor-pointer hover:opacity-80" : ""
      } ${className}`}
    >
      <div className="flex items-center gap-1">
        <span>{children}</span>
        {sorted ? (
          <span className="text-xs opacity-70">
            {dir === "asc" ? "▲" : "▼"}
          </span>
        ) : null}
      </div>
    </th>
  );
}
function Td({ children, className = "", ...rest }) {
  return (
    <td {...rest} className={`px-3 align-middle ${className}`}>
      {children}
    </td>
  );
}
function Badge({ tone = "slate", children }) {
  const theme =
    tone === "green"
      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200 border-green-200/70 dark:border-green-700/40"
      : tone === "amber"
      ? "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700/40"
      : tone === "rose"
      ? "bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-900/40 dark:text-rose-200 dark:border-rose-700/40"
      : "bg-black/5 text-black/80 dark:bg-white/10 dark:text-white/80 border-black/10 dark:border-white/10";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] ${theme}`}
    >
      {children}
    </span>
  );
}

/* ---------- query parser (chips) ---------- */
function parseQuery(input) {
  // Supports: name:"Jane D"  status:active  status:inactive  + free text falls back to name
  const tokens = [];
  const re = /(\w+):"([^"]+)"|(\w+):(\S+)|"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(input))) {
    const [, kq, vq, k, v, quoted, bare] = m;
    if (kq && vq) tokens.push({ key: kq.toLowerCase(), value: vq });
    else if (k && v) tokens.push({ key: k.toLowerCase(), value: v });
    else if (quoted) tokens.push({ key: "name", value: quoted });
    else if (bare) tokens.push({ key: "name", value: bare });
  }
  return tokens;
}

/* ---------- columns config ---------- */
const BASE_COLUMNS = [
  {
    key: "full_name",
    label: "Name",
    width: "w-[20%]",
    sortable: true,
    render: (r) => r.full_name || "—",
    export: (r) => r.full_name,
    always: true,
  },
  {
    key: "roster_status",
    label: "Status",
    width: "w-[7%]",
    sortable: true,
    render: (r) => (
      <Badge tone={String(r.roster_status) === "active" ? "green" : "slate"}>
        {r.roster_status || "—"}
      </Badge>
    ),
    export: (r) => r.roster_status,
  },
  { key: "open_violations", label: "Open", width: "w-[6%]", sortable: true },
  { key: "total_violations", label: "Total", width: "w-[6%]", sortable: true },
  { key: "callouts", label: "Callouts", width: "w-[7%]", sortable: true },
  { key: "early_departures", label: "Early", width: "w-[6%]", sortable: true },
  { key: "docs_pending", label: "Docs Pend", width: "w-[7%]", sortable: true },
  { key: "docs_provided", label: "Docs Prov", width: "w-[7%]", sortable: true },
  {
    key: "docs_not_provided",
    label: "Docs N/P",
    width: "w-[7%]",
    sortable: true,
  },
  {
    key: "last_violation_at",
    label: "Last Violation",
    width: "w-[9%]",
    sortable: true,
    render: (r) => fmtDate(r.last_violation_at),
    export: (r) => fmtDate(r.last_violation_at),
  },
  {
    key: "ip_avg_score_pct",
    label: "Interior Audit",
    width: "w-[9%]",
    sortable: true,
    render: (r) => fmtPct(r.ip_avg_score_pct),
    export: (r) => r.ip_avg_score_pct,
  },
  {
    key: "tg_avg_score_pct",
    label: "Truck Gate Audit", // ← renamed per request
    width: "w-[11%]",
    sortable: true,
    render: (r) => fmtPct(r.tg_avg_score_pct),
    export: (r) => r.tg_avg_score_pct,
  },
];

const ACTION_COLUMNS = [
  {
    key: "__profile",
    label: "Profile",
    width: "w-[7%]",
    always: true,
    render: (r) =>
      r.guard_id ? (
        <Link
          to={`/hr/users/${encodeURIComponent(r.guard_id)}`}
          className="rounded-lg border px-2.5 py-1 hover:bg-black/5 dark:hover:bg-white/5"
        >
          View
        </Link>
      ) : (
        <span className="text-sdg-slate">—</span>
      ),
  },
  {
    key: "__actions",
    label: "Actions",
    width: "w-[12%]",
    always: true,
    render: (r, { onArchive, onDelete, disabled }) => (
      <div className="flex gap-2">
        <button
          className="rounded-full px-3 py-1 text-[12px] border font-medium bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100"
          disabled={disabled}
          onClick={() => onArchive(r)}
          title="Mark Inactive"
        >
          Inactive
        </button>
        <button
          className="rounded-full px-3 py-1 text-[12px] border font-medium bg-rose-50 text-rose-900 border-rose-300 hover:bg-rose-100"
          disabled={disabled}
          onClick={() => onDelete(r)}
        >
          Delete
        </button>
      </div>
    ),
  },
];

/* ======================================================================== */

export default function Users() {
  /* role */
  const [me, setMe] = useState(null);
  const isManager = String(me?.role || "").toLowerCase() === "manager";
  useEffect(() => {
    (async () => {
      const { data: userResp } = await supabase.auth.getUser();
      const user = userResp?.user;
      if (!user) return;
      const { data: p } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      setMe({ role: p?.role ?? null });
    })();
  }, []);

  /* state */
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  const [query, setQuery] = useState("");
  const [chips, setChips] = useState([]); // [{key,value}]
  const [statusFilter, setStatusFilter] = useState("active"); // default hide inactives

  const [wide, setWide] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(UI_KEY) || "{}");
      return saved.wide ?? true;
    } catch {
      return true;
    }
  });
  const [density, setDensity] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(UI_KEY) || "{}");
      return saved.density ?? "comfy"; // or "compact"
    } catch {
      return "comfy";
    }
  });
  const rowPad = density === "compact" ? "py-1.5" : "py-2.5";

  // sorting
  const [sort, setSort] = useState({ key: "full_name", dir: "asc" });

  // visible columns (exclude action columns from toggles)
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(UI_KEY) || "{}");
      return saved.visibleCols || BASE_COLUMNS.map((c) => c.key);
    } catch {
      return BASE_COLUMNS.map((c) => c.key);
    }
  });

  // selection for bulk actions
  const [selected, setSelected] = useState(() => new Set());

  useEffect(() => {
    document.body.classList.toggle("wide-page", wide);
    return () => document.body.classList.remove("wide-page");
  }, [wide]);
  useEffect(() => {
    try {
      localStorage.setItem(
        UI_KEY,
        JSON.stringify({ wide, density, visibleCols })
      );
    } catch {}
  }, [wide, density, visibleCols]);

  /* fetch */
  const fetchRows = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    const { data, error } = await supabase
      .from("guard_stats_v")
      .select("*")
      .order("full_name", { ascending: true });
    if (error) {
      setFetchError(error.message || String(error));
      setRows([]);
    } else setRows(data || []);
    setLoading(false);
  }, []);
  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  /* search chips sync */
  useEffect(() => {
    setChips(parseQuery(query));
  }, [query]);

  /* filters + sorting */
  const filtered = useMemo(() => {
    let out = rows;

    // status dropdown filter
    if (statusFilter !== "all") {
      out = out.filter(
        (r) => String(pick(r, "roster_status") || "") === statusFilter
      );
    }

    // chips: name, status
    if (chips.length) {
      for (const t of chips) {
        if (!t.value) continue;
        if (t.key === "name") {
          const v = t.value.toLowerCase();
          out = out.filter((r) =>
            (pick(r, "full_name") || "").toLowerCase().includes(v)
          );
        } else if (t.key === "status") {
          const v = t.value.toLowerCase();
          out = out.filter(
            (r) => String(pick(r, "roster_status") || "").toLowerCase() === v
          );
        }
      }
    }

    // sort
    if (sort?.key) {
      const { key, dir } = sort;
      const asc = dir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        const va = pick(a, key);
        const vb = pick(b, key);
        if (va == null && vb != null) return -1 * asc;
        if (va != null && vb == null) return 1 * asc;
        if (va == null && vb == null) return 0;
        if (typeof va === "number" && typeof vb === "number")
          return (va - vb) * asc;
        const sa = String(va).toLowerCase();
        const sb = String(vb).toLowerCase();
        if (sa < sb) return -1 * asc;
        if (sa > sb) return 1 * asc;
        return 0;
      });
    }

    return out;
  }, [rows, statusFilter, chips, sort]);

  /* export */
  const doExport = (mode = "visible") => {
    if (!filtered.length) return;
    const cols =
      mode === "all"
        ? [...BASE_COLUMNS]
        : BASE_COLUMNS.filter((c) => visibleCols.includes(c.key));
    const headers = cols.map((c) => c.label);
    const data = filtered.map((r) => {
      const row = {};
      cols.forEach((c) => {
        const raw = c.export ? c.export(r) : r[c.key];
        row[c.label] = c.key === "last_violation_at" ? fmtDate(raw) : raw ?? "";
      });
      return row;
    });
    downloadCSV(
      `users_${mode}_${new Date().toISOString().slice(0, 10)}.csv`,
      data,
      { headers }
    );
  };

  /* single row actions */
  const [actingId, setActingId] = useState(null);

  const archiveOne = async (r) => {
    if (!isManager) return alert("Managers only.");
    if (!r?.guard_id) return;
    setActingId(r.guard_id);
    const { error } = await supabase.rpc("archive_guard", {
      guard_id: r.guard_id,
    });
    setActingId(null);
    if (error) return alert(error.message || String(error));
    fetchRows();
  };
  const deleteOne = async (r) => {
    if (!isManager) return alert("Managers only.");
    if (!r?.guard_id) return;
    if (
      !window.confirm(
        `Delete ${r.full_name}? This only works if they have no violations/audits.`
      )
    )
      return;
    setActingId(r.guard_id);
    const { error } = await supabase.rpc("delete_guard_if_unused", {
      guard_id: r.guard_id,
    });
    setActingId(null);
    if (error) return alert(error.message || String(error));
    fetchRows();
  };

  /* bulk actions */
  const toggleSelectAll = (checked) => {
    if (!checked) return setSelected(new Set());
    const ids = new Set(filtered.map((r) => r.guard_id).filter(Boolean));
    setSelected(ids);
  };
  const toggleSelect = (id, checked) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    setSelected(next);
  };
  const bulkArchive = async () => {
    if (!isManager) return alert("Managers only.");
    if (!selected.size) return;
    if (!window.confirm(`Mark ${selected.size} guard(s) inactive?`)) return;
    const ids = [...selected];
    await Promise.all(
      ids.map((id) => supabase.rpc("archive_guard", { guard_id: id }))
    );
    setSelected(new Set());
    fetchRows();
  };
  const bulkDelete = async () => {
    if (!isManager) return alert("Managers only.");
    if (!selected.size) return;
    if (
      !window.confirm(
        `Delete ${selected.size} guard(s)? Only works if they have no violations/audits.`
      )
    )
      return;
    const ids = [...selected];
    await Promise.all(
      ids.map((id) => supabase.rpc("delete_guard_if_unused", { guard_id: id }))
    );
    setSelected(new Set());
    fetchRows();
  };

  /* UI helpers */
  const visibleColumns = BASE_COLUMNS.filter(
    (c) => c.always || visibleCols.includes(c.key)
  );
  const toggleColumn = (key) => {
    setVisibleCols((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };
  const onHeaderSort = (key, sortable) => {
    if (!sortable) return;
    setSort((s) => {
      if (s.key !== key) return { key, dir: "asc" };
      return { key, dir: s.dir === "asc" ? "desc" : "asc" };
    });
  };

  const headerChecked =
    filtered.length > 0 &&
    filtered.every((r) => r.guard_id && selected.has(r.guard_id));
  const headerIndeterminate =
    filtered.some((r) => r.guard_id && selected.has(r.guard_id)) &&
    !headerChecked;

  /* layout */
  const contentWidth = wide ? "max-w-none" : "max-w-[1600px]";
  const contentPad = wide ? "px-4 md:px-6" : "px-2 md:px-4";

  return (
    <div className="py-8">
      <style>{`
        a { color: inherit; }
        .wide-page .container, .wide-page .mx-auto, .wide-page [class*="max-w-"] { max-width: 100% !important; }

        select, input[type="text"], input[type="email"], textarea {
          background-color: #ffffff; color: #0f172a; border: 1px solid rgba(0,0,0,.10);
        }
        .dark select, .dark input[type="text"], .dark input[type="email"], .dark textarea {
          background-color: #151a1e !important; color: #e5e7eb !important; border-color: rgba(255,255,255,.12) !important;
        }
        select:focus-visible, input[type="text"]:focus-visible {
          box-shadow: 0 0 0 3px rgba(212,175,55,.25); border-color: rgba(212,175,55,.45);
        }
        .dark select:focus-visible, .dark input[type="text"]:focus-visible {
          box-shadow: 0 0 0 3px rgba(212,175,55,.30); border-color: rgba(212,175,55,.55);
        }

        .users-card { border-radius: 14px; border: 1px solid rgba(255,255,255,.08); background: transparent; }
        .users-accent { height: 6px; border-top-left-radius: 14px; border-top-right-radius: 14px; }

        .users-table thead { position: sticky; top: 0; z-index: 5; }
        .users-table thead th { background: rgba(255,255,255,.03); }
        .dark .users-table thead th { background: rgba(255,255,255,.035); }

        /* Stronger, easier-to-read striping */
        .users-table tbody tr:nth-child(odd) { background: rgba(0,0,0,.025); }
        .users-table tbody tr:nth-child(even) { background: transparent; }
        .dark .users-table tbody tr:nth-child(odd) { background: rgba(255,255,255,.04); }

        .users-table tbody tr { border-bottom: 1px solid rgba(0,0,0,.05); }
        .dark .users-table tbody tr { border-bottom-color: rgba(255,255,255,.06); }

        .users-table tbody tr:hover { background: rgba(212,175,55,.12); transition: background .12s ease; }
      `}</style>

      <div className={`mx-auto ${contentWidth} ${contentPad}`}>
        <div className="users-card">
          <div className="users-accent bg-sdg-gold" />

          {/* Header */}
          <div className="p-4 md:p-6 border-b border-white/10">
            <div className="flex items-start gap-3">
              <div>
                <h1 className="font-heading text-2xl">Users</h1>
                <p className="text-sdg-slate">
                  Roster &amp; profiles (guards/contractors)
                </p>
                <p className="text-xs text-sdg-slate mt-1">
                  {loading
                    ? "Loading…"
                    : `Fetched ${rows.length} total • Showing ${filtered.length}`}
                </p>
                {fetchError && (
                  <div className="mt-2 text-[13px] rounded-lg border border-rose-300/40 bg-rose-50/60 px-3 py-2 dark:bg-rose-900/20 dark:border-rose-900/30 text-rose-800 dark:text-rose-200">
                    {fetchError}
                  </div>
                )}
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

                <label className="inline-flex items-center gap-2 text-sm ml-3">
                  <span>Density</span>
                  <select
                    value={density}
                    onChange={(e) => setDensity(e.target.value)}
                    className="rounded-md px-2 py-1 text-sm"
                  >
                    <option value="comfy">Comfy</option>
                    <option value="compact">Compact</option>
                  </select>
                </label>

                {/* Columns toggle */}
                <div className="relative">
                  <details className="group">
                    <summary className="btn btn-ghost inline-flex items-center gap-1 cursor-pointer">
                      Columns
                      <span className="text-xs opacity-60 group-open:hidden">
                        ▼
                      </span>
                      <span className="text-xs opacity-60 hidden group-open:inline">
                        ▲
                      </span>
                    </summary>
                    <div className="absolute right-0 mt-1 w-64 rounded-lg border bg-white dark:bg-[#111] shadow-lg p-3 z-20">
                      <div className="text-xs mb-2 text-sdg-slate">
                        Show/Hide columns
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {BASE_COLUMNS.map((c) => (
                          <label
                            key={c.key}
                            className={`inline-flex items-center gap-2 text-sm ${
                              c.always ? "opacity-50 cursor-not-allowed" : ""
                            }`}
                          >
                            <input
                              type="checkbox"
                              disabled={c.always}
                              checked={c.always || visibleCols.includes(c.key)}
                              onChange={() => toggleColumn(c.key)}
                            />
                            <span>{c.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </details>
                </div>

                {/* Export */}
                <div className="relative">
                  <details className="group">
                    <summary className="btn btn-ghost inline-flex items-center gap-1 cursor-pointer">
                      Export
                      <span className="text-xs opacity-60 group-open:hidden">
                        ▼
                      </span>
                      <span className="text-xs opacity-60 hidden group-open:inline">
                        ▲
                      </span>
                    </summary>
                    <div className="absolute right-0 mt-1 w-60 rounded-lg border bg-white dark:bg-[#111] shadow-lg p-3 z-20">
                      <button
                        className="w-full rounded-md border px-3 py-2 text-left hover:bg-black/5 dark:hover:bg-white/5 mb-2"
                        onClick={() => doExport("visible")}
                      >
                        CSV • Visible Columns
                      </button>
                      <button
                        className="w-full rounded-md border px-3 py-2 text-left hover:bg-black/5 dark:hover:bg-white/5"
                        onClick={() => doExport("all")}
                      >
                        CSV • All Data
                      </button>
                    </div>
                  </details>
                </div>

                <Link
                  to="#"
                  onClick={(e) => {
                    e.preventDefault();
                    alert("Use the Profile page to create new guards.");
                  }}
                  className="btn btn-ghost"
                >
                  New User
                </Link>
              </div>
            </div>

            {/* Filters */}
            <div className="mt-4 grid gap-3 md:grid-cols-12">
              <div className="md:col-span-9">
                <label className="block text-sm font-medium text-sdg-slate mb-1">
                  Search (use chips like <code>name:"Jane"</code> or{" "}
                  <code>status:inactive</code>)
                </label>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`name:"Jane Doe" status:active`}
                  className="w-full rounded-md px-3 py-2"
                />
                {!!chips.length && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {chips.map((c, i) => (
                      <span
                        key={`${c.key}:${c.value}:${i}`}
                        className="inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-[12px] bg-black/5 dark:bg-white/10"
                      >
                        <strong>{c.key}</strong>: {c.value}
                        <button
                          className="opacity-70 hover:opacity-100"
                          onClick={() => {
                            const rebuilt = chips
                              .filter((_, idx) => idx !== i)
                              .map((t) =>
                                t.value.includes(" ")
                                  ? `${t.key}:"${t.value}"`
                                  : `${t.key}:${t.value}`
                              )
                              .join(" ");
                            setQuery(rebuilt);
                          }}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="md:col-span-3">
                <label className="block text-sm font-medium text-sdg-slate mb-1">
                  Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full rounded-md px-3 py-2"
                >
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setQuery("");
                  setChips([]);
                  setStatusFilter("active"); // default hide inactives
                }}
              >
                Reset filters
              </button>
            </div>

            {/* Bulk bar */}
            {selected.size > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-md border px-3 py-2 bg-black/5 dark:bg-white/5">
                <div className="text-sm">
                  Selected: <strong>{selected.size}</strong>
                </div>
                <button
                  className="rounded-full px-3 py-1 text-[12px] border font-medium bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100"
                  onClick={bulkArchive}
                >
                  Mark Inactive
                </button>
                <button
                  className="rounded-full px-3 py-1 text-[12px] border font-medium bg-rose-50 text-rose-900 border-rose-300 hover:bg-rose-100"
                  onClick={bulkDelete}
                >
                  Delete
                </button>
                <button
                  className="rounded-full px-3 py-1 text-[12px] border"
                  onClick={() => setSelected(new Set())}
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {/* Table */}
          <div className="overflow-x-auto p-0">
            <table className="users-table min-w-full text-sm">
              <colgroup>
                <col className="w-[40px]" /> {/* checkbox */}
                {visibleColumns.map((c) => (
                  <col key={c.key} className={c.width || ""} />
                ))}
                {ACTION_COLUMNS.map((c) => (
                  <col key={c.key} className={c.width || ""} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <Th className="text-left">
                    <input
                      type="checkbox"
                      checked={headerChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = headerIndeterminate;
                      }}
                      onChange={(e) => toggleSelectAll(e.target.checked)}
                    />
                  </Th>
                  {visibleColumns.map((c) => (
                    <Th
                      key={c.key}
                      className={
                        c.key === "full_name" ? "text-left" : "text-center"
                      }
                      onClick={() => onHeaderSort(c.key, c.sortable)}
                      sorted={sort.key === c.key}
                      dir={sort.dir}
                    >
                      {c.label}
                    </Th>
                  ))}
                  {ACTION_COLUMNS.map((c) => (
                    <Th
                      key={c.key}
                      className={
                        c.key === "__profile" ? "text-left" : "text-left"
                      }
                    >
                      {c.label}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <Td
                      colSpan={
                        1 + visibleColumns.length + ACTION_COLUMNS.length
                      }
                    >
                      Loading…
                    </Td>
                  </tr>
                ) : !filtered.length ? (
                  <tr>
                    <Td
                      colSpan={
                        1 + visibleColumns.length + ACTION_COLUMNS.length
                      }
                      className="text-sdg-slate"
                    >
                      No users match your filters.
                    </Td>
                  </tr>
                ) : (
                  filtered.map((r) => {
                    const gid = r.guard_id;
                    const isChecked = gid && selected.has(gid);
                    return (
                      <tr key={gid || r.full_name} className={rowPad}>
                        <Td className="text-left">
                          <input
                            type="checkbox"
                            disabled={!gid}
                            checked={!!isChecked}
                            onChange={(e) =>
                              toggleSelect(gid, e.target.checked)
                            }
                          />
                        </Td>

                        {visibleColumns.map((c) => (
                          <Td
                            key={c.key}
                            className={
                              c.key === "full_name"
                                ? "text-left"
                                : "text-center"
                            }
                          >
                            {c.render ? c.render(r) : r[c.key] ?? "—"}
                          </Td>
                        ))}

                        {ACTION_COLUMNS.map((c) => (
                          <Td key={c.key} className="text-left">
                            {c.render &&
                              c.render(r, {
                                onArchive: archiveOne,
                                onDelete: deleteOne,
                                disabled: actingId === r.guard_id,
                              })}
                          </Td>
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
