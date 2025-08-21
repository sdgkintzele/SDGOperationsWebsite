// src/pages/Violations.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { downloadCSV } from "../lib/csv";

const DEFAULT_PAGE_SIZE = 25;
const REQUIRES_DOCS = new Set(["callout", "early_departure"]);
const STORAGE_KEY = "violations.filters.v3";
const UI_KEY = "violations.ui.v1";
const LOCAL_VOID_KEY = "violations.localVoid.v1";

export default function Violations() {
  /* ------------------------------- Filters ------------------------------- */
  const [search, setSearch] = useState("");
  const [rawSearch, setRawSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [docFilter, setDocFilter] = useState("all");
  const [typeId, setTypeId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sort, setSort] = useState({ key: "occurred_at", dir: "desc" });

  const [params, setParams] = useSearchParams();

  const [wide, setWide] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(UI_KEY) || "false");
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (wide) document.body.classList.add("wide-page");
    else document.body.classList.remove("wide-page");
    return () => document.body.classList.remove("wide-page");
  }, [wide]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (typeof saved.search === "string") {
        setSearch(saved.search);
        setRawSearch(saved.search);
      }
      if (typeof saved.status === "string") setStatus(saved.status);
      if (typeof saved.docFilter === "string") setDocFilter(saved.docFilter);
      if (typeof saved.typeId === "string") setTypeId(saved.typeId);
      if (typeof saved.fromDate === "string") setFromDate(saved.fromDate);
      if (typeof saved.toDate === "string") setToDate(saved.toDate);
    } catch {}
    const q = params.get("q");
    const st = params.get("status");
    const df = params.get("docs");
    const ty = params.get("type");
    const pg = params.get("page");
    const ps = params.get("ps");
    const fd = params.get("from");
    const td = params.get("to");
    if (q != null) {
      setRawSearch(q);
      setSearch(q);
    }
    if (st) setStatus(st);
    if (df) setDocFilter(df);
    if (ty) setTypeId(ty);
    if (pg && !Number.isNaN(+pg)) setPage(Math.max(1, +pg));
    if (ps && !Number.isNaN(+ps)) setPageSize(Math.max(1, +ps));
    if (fd) setFromDate(fd);
    if (td) setToDate(td);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ search, status, docFilter, typeId, fromDate, toDate })
      );
    } catch {}
  }, [search, status, docFilter, typeId, fromDate, toDate]);
  useEffect(() => {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify(wide));
    } catch {}
  }, [wide]);

  useEffect(() => {
    const id = setTimeout(() => setSearch(rawSearch), 250);
    return () => clearTimeout(id);
  }, [rawSearch]);

  useEffect(() => {
    setParams(
      {
        q: search || "",
        status,
        docs: docFilter,
        type: typeId,
        from: fromDate || "",
        to: toDate || "",
        page: String(page),
        ps: String(pageSize),
      },
      { replace: true }
    );
  }, [
    search,
    status,
    docFilter,
    typeId,
    fromDate,
    toDate,
    page,
    pageSize,
    setParams,
  ]);

  /* -------------------------------- Data -------------------------------- */
  const [types, setTypes] = useState([]);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [hasVoidColumn, setHasVoidColumn] = useState(null);

  const [localVoids, setLocalVoids] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(LOCAL_VOID_KEY) || "[]"));
    } catch {
      return new Set();
    }
  });
  const saveLocalVoids = (set) => {
    try {
      localStorage.setItem(LOCAL_VOID_KEY, JSON.stringify([...set]));
    } catch {}
  };

  const [me, setMe] = useState(null);
  const isManager = String(me?.role || "").toLowerCase() === "manager";

  useEffect(() => {
    (async () => {
      const { data: userResp } = await supabase.auth.getUser();
      const user = userResp?.user;
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", user.id)
        .single();

      setMe({
        id: user.id,
        full_name: profile?.full_name ?? null,
        role: profile?.role ?? null,
      });
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("violation_types")
        .select("id, label, slug")
        .order("label", { ascending: true });
      setTypes(data || []);
    })();
  }, []);

  /* ----------------------------- Fetch rows ----------------------------- */
  const baseSelect = `
    id, occurred_at, shift, post, lane, status, doc_status, breach_days, eligible_return_date, type_id,
    guards:guards ( id, full_name ),
    violation_types:violation_types ( id, label, slug )
  `.trim();

  const fetchRows = useCallback(async () => {
    setLoading(true);

    const tryWithVoided = hasVoidColumn !== false;

    const makeQuery = (withVoided) => {
      const select = withVoided ? `${baseSelect}, voided` : baseSelect;
      let q = supabase
        .from("violations")
        .select(select, { count: "exact" })
        .order("occurred_at", { ascending: false });

      if (status !== "all" && status !== "void") q = q.eq("status", status);

      if (typeId !== "all") {
        const isNumeric = /^\d+$/.test(String(typeId).trim());
        q = q.eq("type_id", isNumeric ? Number(typeId) : String(typeId));
      }

      if (fromDate) q = q.gte("occurred_at", startOfDayUTC(fromDate));
      if (toDate) q = q.lte("occurred_at", endOfDayUTC(toDate));

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      return q.range(from, to);
    };

    let data, error, count;

    if (tryWithVoided) {
      const resp = await makeQuery(true);
      data = resp.data;
      error = resp.error;
      count = resp.count;
      if (error && /column .*voided.* does not exist/i.test(error.message)) {
        setHasVoidColumn(false);
        const resp2 = await makeQuery(false);
        data = resp2.data;
        error = resp2.error;
        count = resp2.count;
      } else if (!error) {
        setHasVoidColumn(true);
      }
    } else {
      const resp = await makeQuery(false);
      data = resp.data;
      error = resp.error;
      count = resp.count;
    }

    if (error) {
      console.error(error);
      setRows([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    let out = data || [];

    if (status === "void") {
      out = out.filter(
        (r) => effectiveStatus(r, hasVoidColumn, localVoids) === "void"
      );
    } else if (status !== "all") {
      out = out.filter(
        (r) => effectiveStatus(r, hasVoidColumn, localVoids) === status
      );
    }

    if (docFilter !== "all") {
      out = out.filter((r) => {
        const requires = REQUIRES_DOCS.has(r.violation_types?.slug || "");
        if (docFilter === "na") return !requires;
        if (!requires) return false;
        if (docFilter === "pending")
          return !r.doc_status || r.doc_status === "pending";
        return r.doc_status === docFilter;
      });
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((r) => {
        const guard = r.guards?.full_name?.toLowerCase() || "";
        const typ = r.violation_types?.label?.toLowerCase() || "";
        const post = r.post?.toLowerCase() || "";
        const lane = (r.lane || "").toString().toLowerCase();
        const st = effectiveStatus(r, hasVoidColumn, localVoids).toLowerCase();
        const docs = r.doc_status?.toLowerCase() || "";
        return [guard, typ, post, lane, st, docs].some((s) => s.includes(q));
      });
    }

    setRows(out);
    setTotal(count || 0);
    setLoading(false);
  }, [
    status,
    typeId,
    docFilter,
    search,
    fromDate,
    toDate,
    page,
    pageSize,
    hasVoidColumn,
    localVoids,
  ]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    setPage(1);
  }, [status, docFilter, typeId, search, pageSize, fromDate, toDate]);

  /* ---------------------- mutations / actions ----------------------- */
  const [savingId, setSavingId] = useState(null);

  const updateCaseStatus = async (row, next) => {
    setSavingId(row.id);
    const { error } = await supabase
      .from("violations")
      .update({ status: next })
      .eq("id", row.id);
    setSavingId(null);
    if (error) return alert(error.message);
    setRows((rs) =>
      rs.map((r) => (r.id === row.id ? { ...r, status: next } : r))
    );
  };

  const setVoid = async (row, makeVoid) => {
    if (hasVoidColumn) {
      setSavingId(row.id);
      const { error } = await supabase
        .from("violations")
        .update({ voided: !!makeVoid })
        .eq("id", row.id);
      setSavingId(null);
      if (error) {
        alert(error.message);
        return;
      }
      setRows((rs) =>
        rs.map((r) => (r.id === row.id ? { ...r, voided: !!makeVoid } : r))
      );
      return;
    }

    setLocalVoids((prev) => {
      const next = new Set(prev);
      if (makeVoid) next.add(row.id);
      else next.delete(row.id);
      saveLocalVoids(next);
      return next;
    });
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r } : r)));
  };

  /* ------------------------------ Export ------------------------------ */
  const exportCSV = () => {
    if (!rows.length) return;
    const items = rows.map((r) => ({
      occurred_at: new Date(r.occurred_at).toLocaleString(),
      guard: r.guards?.full_name ?? "",
      type: r.violation_types?.label ?? "",
      post: r.lane ? `${r.post ?? ""} • lane ${r.lane}` : r.post ?? "",
      shift: r.shift ?? "",
      status: effectiveStatus(r, hasVoidColumn, localVoids),
      docs: REQUIRES_DOCS.has(r.violation_types?.slug || "")
        ? r.doc_status ?? "pending"
        : "N/A",
      breach_days: r.breach_days ?? "",
      eligible_return_date: r.eligible_return_date ?? "",
      id: r.id,
    }));
    downloadCSV(
      `violations_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`,
      items
    );
  };

  /* ------------------------------ Derived ------------------------------ */
  const totalPages = Math.max(1, Math.ceil((total || 0) / pageSize));
  const counts = useMemo(() => {
    const eff = (r) => effectiveStatus(r, hasVoidColumn, localVoids);
    const open = rows.filter((r) => eff(r) === "open").length;
    const closed = rows.filter((r) => eff(r) === "closed").length;
    const voided = rows.filter((r) => eff(r) === "void").length;
    const docsPending = rows.filter((r) => {
      const requires = REQUIRES_DOCS.has(r.violation_types?.slug || "");
      if (!requires) return false;
      return (
        !r.doc_status ||
        r.doc_status === "pending" ||
        r.doc_status === "not_provided"
      );
    }).length;
    return { open, closed, voided, docsPending };
  }, [rows, hasVoidColumn, localVoids]);

  const sortedRows = useMemo(() => {
    const list = [...rows];
    const { key, dir } = sort;
    const cmp = (A, B) =>
      (A > B ? 1 : A < B ? -1 : 0) * (dir === "asc" ? 1 : -1);
    list.sort((a, b) => {
      if (key === "occurred_at")
        return cmp(+new Date(a.occurred_at), +new Date(b.occurred_at));
      if (key === "guard")
        return cmp(
          (a.guards?.full_name || "").toLowerCase(),
          (b.guards?.full_name || "").toLowerCase()
        );
      if (key === "type")
        return cmp(
          (a.violation_types?.label || "").toLowerCase(),
          (b.violation_types?.label || "").toLowerCase()
        );
      if (key === "post") {
        const A = `${a.post || ""}${
          a.lane ? ` • ${a.lane}` : ""
        }`.toLowerCase();
        const B = `${b.post || ""}${
          b.lane ? ` • ${b.lane}` : ""
        }`.toLowerCase();
        return cmp(A, B);
      }
      if (key === "status") {
        const A = effectiveStatus(a, hasVoidColumn, localVoids);
        const B = effectiveStatus(b, hasVoidColumn, localVoids);
        return cmp(A, B);
      }
      if (key === "docs") {
        const norm = (r) =>
          REQUIRES_DOCS.has(r.violation_types?.slug || "")
            ? (r.doc_status || "pending").toLowerCase()
            : "zzz_na";
        return cmp(norm(a), norm(b));
      }
      return 0;
    });
    return list;
  }, [rows, sort, hasVoidColumn, localVoids]);

  /* -------------------------------- UI -------------------------------- */
  const contentWidth = wide ? "max-w-none" : "max-w-[1600px]";
  const contentPad = wide ? "px-4 md:px-6" : "px-2 md:px-4";
  const tableHeight = wide ? "max-h-[88vh]" : "max-h-[80vh]";

  return (
    <div className="py-8">
      <style>{`
        select, input[type="text"], input[type="date"] { background-color: #ffffff; color: #0f172a; }
        option { color: #0f172a; background-color: #ffffff; }
        input[type="date"]::-webkit-calendar-picker-indicator { opacity: 0.9; }

        .dark select, .dark input[type="text"], .dark input[type="date"] {
          background-color: #151a1e !important;
          color: #e5e7eb !important;
          border-color: rgba(255,255,255,0.12) !important;
        }
        .dark option { color: #e5e7eb !important; background-color: #0f1215 !important; }
        .dark input[type="date"]::-webkit-calendar-picker-indicator {
          filter: invert(1) brightness(1.2) contrast(1.1);
        }

        .wide-page .container,
        .wide-page .mx-auto,
        .wide-page [class*="max-w-"] { max-width: 100% !important; }
        .wide-page header, .wide-page nav { padding-left: 0 !important; padding-right: 0 !important; }
      `}</style>

      <div className={`mx-auto ${contentWidth} ${contentPad}`}>
        <header className="mb-4 flex items-start gap-3">
          <div>
            <h1 className="font-heading text-2xl md:text-3xl">
              Violation Data
            </h1>
            <p className="text-sdg-slate mt-1">
              Browse, filter, and manage recorded violations.
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
          </div>
        </header>

        {/* Filters */}
        <section className="frame overflow-hidden mb-3" aria-label="Filters">
          <div className="frame-accent" />
          <div className="p-4 grid gap-3 md:grid-cols-6">
            <div className="md:col-span-6">
              <label
                htmlFor="v-search"
                className="block text-sm font-medium text-sdg-slate mb-1"
              >
                Search
              </label>
              <input
                id="v-search"
                type="text"
                className="w-full rounded-md border border-black/10 dark:border-white/10 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:focus:ring-amber-700"
                placeholder="Search guard, type, post, lane, status…"
                value={rawSearch}
                onChange={(e) => setRawSearch(e.target.value)}
                aria-label="Search"
              />
            </div>

            {/* Date range */}
            <div className="md:col-span-6">
              <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white/60 dark:bg-white/5 p-3.5">
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label
                      htmlFor="v-from"
                      className="block text-sm font-medium text-sdg-slate mb-1"
                    >
                      From (Date)
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="v-from"
                        type="date"
                        className="w-full rounded-md border border-black/10 dark:border-white/10 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:focus:ring-amber-700"
                        value={fromDate}
                        onChange={(e) => setFromDate(e.target.value)}
                        aria-label="From date"
                        max={toDate || undefined}
                      />
                      {fromDate && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setFromDate("")}
                          title="Clear from date"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor="v-to"
                      className="block text-sm font-medium text-sdg-slate mb-1"
                    >
                      To (Date)
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="v-to"
                        type="date"
                        className="w-full rounded-md border border-black/10 dark:border-white/10 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:focus:ring-amber-700"
                        value={toDate}
                        onChange={(e) => setToDate(e.target.value)}
                        aria-label="To date"
                        min={fromDate || undefined}
                      />
                      {toDate && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setToDate("")}
                          title="Clear to date"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Status / Docs / Type */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-sdg-slate mb-1">
                Status
              </label>
              <select
                className="w-full rounded-md border border-black/10 dark:border-white/10 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:focus:ring-amber-700"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                aria-label="Status filter"
              >
                <option value="all">All</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
                <option value="void">Void</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-sdg-slate mb-1">
                Docs
              </label>
              <select
                className="w-full rounded-md border border-black/10 dark:border-white/10 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:focus:ring-amber-700"
                value={docFilter}
                onChange={(e) => setDocFilter(e.target.value)}
                aria-label="Documentation filter"
              >
                <option value="all">All</option>
                <option value="provided">Provided</option>
                <option value="not_provided">Not Provided</option>
                <option value="pending">Pending</option>
                <option value="na">N/A</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-sdg-slate mb-1">
                Type
              </label>
              <select
                className="w-full rounded-md border border-black/10 dark:border-white/10 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:focus:ring-amber-700"
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                aria-label="Type filter"
              >
                <option value="all">All Types</option>
                {types.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-6 flex items-center gap-2 pt-1">
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setRawSearch("");
                  setSearch("");
                  setStatus("all");
                  setDocFilter("all");
                  setTypeId("all");
                  setFromDate("");
                  setToDate("");
                  setPage(1);
                }}
              >
                Reset
              </button>
              <div className="ml-auto flex items-center gap-2">
                <label className="text-sm text-sdg-slate">Rows/page</label>
                <select
                  className="w-[84px] rounded-md border border-black/10 dark:border-white/10 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:focus:ring-amber-700"
                  value={pageSize}
                  onChange={(e) => {
                    setPage(1);
                    setPageSize(Number(e.target.value));
                  }}
                  aria-label="Rows per page"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <button className="btn btn-ghost" onClick={exportCSV}>
                  Export CSV
                </button>
              </div>
            </div>
          </div>

          {/* Quick stats */}
          <div className="px-4 pb-3 flex flex-wrap gap-2 text-xs">
            <button
              className="rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 dark:bg-amber-900/30 dark:text-amber-200"
              onClick={() => setStatus("open")}
              title="Filter: Open"
            >
              Open: {counts.open}
            </button>
            <button
              className="rounded-full bg-emerald-100 text-emerald-900 px-2 py-0.5 dark:bg-emerald-900/30 dark:text-emerald-200"
              onClick={() => setStatus("closed")}
              title="Filter: Closed"
            >
              Closed: {counts.closed}
            </button>
            <button
              className="rounded-full bg-slate-100 text-slate-900 px-2 py-0.5 dark:bg-slate-800/50 dark:text-slate-200"
              onClick={() => setStatus("void")}
              title="Filter: Void"
            >
              Void: {counts.voided}
            </button>
            <button
              className="rounded-full bg-slate-100 text-slate-900 px-2 py-0.5 dark:bg-slate-800/50 dark:text-slate-200"
              onClick={() => setDocFilter("pending")}
              title="Filter: Docs pending"
            >
              Docs pending: {counts.docsPending}
            </button>
          </div>
        </section>

        {/* Table */}
        <section className="frame overflow-hidden" aria-label="Violation table">
          <div className="frame-accent" />
          <div className="p-0">
            <div className={`overflow-y-auto ${tableHeight}`}>
              <table className="min-w-full text-sm table-fixed">
                <colgroup>
                  <col className="w-[12%]" />
                  <col className="w-[11%]" />
                  <col className="w-[11%]" />
                  <col className="w-[22%]" />
                  <col className="w-[12%]" />
                  <col className="w-[10%]" />
                  <col className="w-[14%]" />
                  <col className="w-[8%]" />
                </colgroup>

                <thead className="sticky top-0 z-10 text-left bg-white/90 dark:bg-[#0f1215]/90 backdrop-blur supports-[backdrop-filter]:bg-white/70 dark:supports-[backdrop-filter]:bg-[#0f1215]/70">
                  <tr>
                    <SortableTh
                      label="Date"
                      active={sort.key === "occurred_at"}
                      dir={sort.dir}
                      onClick={() =>
                        setSort((s) => ({
                          key: "occurred_at",
                          dir:
                            s.key === "occurred_at" && s.dir === "asc"
                              ? "desc"
                              : "asc",
                        }))
                      }
                    />
                    <SortableTh
                      className="border-l border-black/5 dark:border-white/10"
                      label="Guard"
                      active={sort.key === "guard"}
                      dir={sort.dir}
                      onClick={() =>
                        setSort((s) => ({
                          key: "guard",
                          dir:
                            s.key === "guard" && s.dir === "asc"
                              ? "desc"
                              : "asc",
                        }))
                      }
                    />
                    <SortableTh
                      className="border-l border-black/5 dark:border-white/10"
                      label="Type"
                      active={sort.key === "type"}
                      dir={sort.dir}
                      onClick={() =>
                        setSort((s) => ({
                          key: "type",
                          dir:
                            s.key === "type" && s.dir === "asc"
                              ? "desc"
                              : "asc",
                        }))
                      }
                    />
                    <SortableTh
                      className="border-l border-black/5 dark:border-white/10"
                      label="Post/Lane"
                      active={sort.key === "post"}
                      dir={sort.dir}
                      onClick={() =>
                        setSort((s) => ({
                          key: "post",
                          dir:
                            s.key === "post" && s.dir === "asc"
                              ? "desc"
                              : "asc",
                        }))
                      }
                    />
                    <SortableTh
                      className="text-center border-l border-black/5 dark:border-white/10"
                      label="Documentation"
                      active={sort.key === "docs"}
                      dir={sort.dir}
                      onClick={() =>
                        setSort((s) => ({
                          key: "docs",
                          dir:
                            s.key === "docs" && s.dir === "asc"
                              ? "desc"
                              : "asc",
                        }))
                      }
                    />
                    <SortableTh
                      className="text-center border-l border-black/5 dark:border-white/10"
                      label="Status"
                      active={sort.key === "status"}
                      dir={sort.dir}
                      onClick={() =>
                        setSort((s) => ({
                          key: "status",
                          dir:
                            s.key === "status" && s.dir === "asc"
                              ? "desc"
                              : "asc",
                        }))
                      }
                    />
                    <Th className="text-center border-l border-black/5 dark:border-white/10">
                      Breach / Return
                    </Th>
                    <Th className="text-center border-l border-black/5 dark:border-white/10">
                      Actions
                    </Th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-black/5 dark:divide-white/10">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="p-4 text-sdg-slate">
                        Loading…
                      </td>
                    </tr>
                  ) : !sortedRows.length ? (
                    <tr>
                      <td colSpan={8} className="p-6 text-sdg-slate">
                        No violations match your filters.
                      </td>
                    </tr>
                  ) : (
                    sortedRows.map((r) => {
                      const requires = REQUIRES_DOCS.has(
                        r.violation_types?.slug || ""
                      );
                      const effStatus = effectiveStatus(
                        r,
                        hasVoidColumn,
                        localVoids
                      );

                      // Build a profile link (fallback to search if no guard_id)
                      const profileHref = r.guards?.id
                        ? `/hr/users/${r.guards.id}`
                        : `/hr/users?q=${encodeURIComponent(
                            r.guards?.full_name || ""
                          )}`;

                      return (
                        <tr
                          key={r.id}
                          className="align-top hover:bg-black/5 dark:hover:bg:white/5 odd:bg-white even:bg-black/[0.02] dark:odd:bg-white/[0.04] dark:even:bg-white/[0.02]"
                        >
                          <Td
                            title={`ID: ${r.id}`}
                            className="whitespace-nowrap"
                          >
                            {new Date(r.occurred_at).toLocaleString()}
                          </Td>

                          {/* GUARD — now links to the guard profile */}
                          <Td className="border-l border-black/5 dark:border-white/10 truncate">
                            <Link
                              to={profileHref}
                              className="underline decoration-dotted underline-offset-[3px] hover:decoration-solid"
                              title="Open guard profile"
                            >
                              <Highlight
                                text={r.guards?.full_name}
                                term={search}
                              />
                            </Link>
                          </Td>

                          <Td className="border-l border-black/5 dark:border-white/10 truncate">
                            <Highlight
                              text={r.violation_types?.label}
                              term={search}
                            />
                          </Td>

                          <Td
                            className="border-l border-black/5 dark:border-white/10"
                            title={`${r.post || "—"}${
                              r.lane ? ` • Lane ${r.lane}` : ""
                            } • Shift: ${cap(r.shift)}`}
                          >
                            <div className="truncate">
                              <Highlight
                                text={`${r.post || "—"}${
                                  r.lane ? ` • Lane ${r.lane}` : ""
                                }`}
                                term={search}
                              />
                            </div>
                            <div className="text-xs text-sdg-slate">
                              Shift: {cap(r.shift)}
                            </div>
                          </Td>

                          <Td className="text-center border-l border-black/5 dark:border-white/10">
                            {requires ? (
                              <Badge
                                tone={
                                  r.doc_status === "provided"
                                    ? "green"
                                    : r.doc_status === "not_provided"
                                    ? "red"
                                    : "slate"
                                }
                              >
                                {cap(r.doc_status ?? "pending")}
                              </Badge>
                            ) : (
                              <span className="text-sdg-slate">N/A</span>
                            )}
                          </Td>

                          <Td className="text-center border-l border-black/5 dark:border-white/10">
                            <Badge
                              tone={
                                effStatus === "open"
                                  ? "amber"
                                  : effStatus === "closed"
                                  ? "green"
                                  : "slate"
                              }
                            >
                              {cap(effStatus)}
                            </Badge>
                          </Td>

                          <Td className="text-center border-l border-black/5 dark:border-white/10">
                            <BreachCell
                              days={r.breach_days}
                              returnDate={r.eligible_return_date}
                            />
                          </Td>

                          <Td className="text-center border-l border-black/5 dark:border-white/10">
                            <div className="inline-flex items-center gap-2">
                              {/* NEW: Profile button */}
                              <Link
                                to={profileHref}
                                className="rounded-lg border px-2.5 py-1 text-[12px] hover:bg-black/5 dark:hover:bg-white/5"
                                title="Open guard profile"
                              >
                                Profile
                              </Link>

                              {isManager ? (
                                <>
                                  {effStatus === "open" && (
                                    <>
                                      <button
                                        className="rounded-lg border px-2.5 py-1 text-[12px] hover:bg-black/5 dark:hover:bg-white/5"
                                        disabled={savingId === r.id}
                                        onClick={() =>
                                          updateCaseStatus(r, "closed")
                                        }
                                        title="Mark case as closed"
                                      >
                                        Report Closed
                                      </button>
                                      <button
                                        className="rounded-lg border px-2.5 py-1 text-[12px] hover:bg-black/5 dark:hover:bg-white/5"
                                        disabled={savingId === r.id}
                                        onClick={() => setVoid(r, true)}
                                        title="Void this violation"
                                      >
                                        Void
                                      </button>
                                    </>
                                  )}

                                  {effStatus === "closed" && (
                                    <>
                                      <button
                                        className="rounded-lg border px-2.5 py-1 text-[12px] hover:bg-black/5 dark:hover:bg-white/5"
                                        disabled={savingId === r.id}
                                        onClick={() =>
                                          updateCaseStatus(r, "open")
                                        }
                                        title="Reopen case"
                                      >
                                        Reopen Case
                                      </button>
                                      <button
                                        className="rounded-lg border px-2.5 py-1 text-[12px] hover:bg-black/5 dark:hover:bg-white/5"
                                        disabled={savingId === r.id}
                                        onClick={() => setVoid(r, true)}
                                        title="Void this violation"
                                      >
                                        Void
                                      </button>
                                    </>
                                  )}

                                  {effStatus === "void" && (
                                    <button
                                      className="rounded-lg border px-2.5 py-1 text-[12px] hover:bg-black/5 dark:hover:bg-white/5"
                                      disabled={savingId === r.id}
                                      onClick={() => setVoid(r, false)}
                                      title="Unvoid by reopening"
                                    >
                                      Reopen Case
                                    </button>
                                  )}
                                </>
                              ) : null}

                              <Link
                                to={`/hr/violations/${r.id}`}
                                className="rounded-lg border px-2.5 py-1 text-[12px] hover:bg-black/5 dark:hover:bg-white/5"
                                title="View details"
                              >
                                View
                              </Link>
                            </div>
                          </Td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="p-3 flex items-center justify-between border-t border-black/5 dark:border-white/10">
              <div className="text-sm text-sdg-slate">
                Page {page} of {totalPages}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="btn btn-ghost"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                >
                  ‹ Prev
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={loading || page >= totalPages}
                >
                  Next ›
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/* -------------------------- Helpers -------------------------- */

function effectiveStatus(row, hasVoidColumn, localVoids) {
  const v = hasVoidColumn ? !!row.voided : localVoids.has(row.id);
  return v ? "void" : row.status || "open";
}

function startOfDayUTC(localDateStr) {
  const [y, m, d] = localDateStr.split("-").map(Number);
  const local = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
  return new Date(
    Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(), 0, 0, 0, 0)
  ).toISOString();
}
function endOfDayUTC(localDateStr) {
  const [y, m, d] = localDateStr.split("-").map(Number);
  const local = new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
  return new Date(
    Date.UTC(
      local.getFullYear(),
      local.getMonth(),
      local.getDate(),
      23,
      59,
      59,
      999
    )
  ).toISOString();
}

function Th({ children, className = "", ...rest }) {
  return (
    <th
      {...rest}
      className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide ${className}`}
    >
      {children}
    </th>
  );
}
function SortableTh({ label, active, dir, onClick, className = "" }) {
  return (
    <Th className={`cursor-pointer select-none ${className}`} onClick={onClick}>
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          <span>{dir === "asc" ? "▲" : "▼"}</span>
        ) : (
          <span className="opacity-40">↕</span>
        )}
      </span>
    </Th>
  );
}
function Td({ children, className = "", title }) {
  return (
    <td className={`px-3 py-3 align-middle ${className}`} title={title}>
      {children}
    </td>
  );
}
function Badge({ tone = "slate", className = "", children }) {
  const theme =
    tone === "green"
      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200 border-green-200/70 dark:border-green-700/40"
      : tone === "red"
      ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200 border-red-200/70 dark:border-red-700/40"
      : tone === "amber"
      ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100 border-amber-200/70 dark:border-amber-700/40"
      : "bg-black/5 text-black/80 dark:bg-white/10 dark:text-white/80 border-black/10 dark:border-white/10";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] ${className} ${theme}`}
    >
      {children}
    </span>
  );
}
function cap(s) {
  return String(s ?? "")
    .replace(/_/g, " ")
    .replace(/^\w/, (m) => m.toUpperCase());
}
function fmtDate(d) {
  try {
    return new Date(d).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return d ?? "";
  }
}
function BreachCell({ days, returnDate }) {
  if (days == null) return <span className="text-sdg-slate">—</span>;
  let tone = "green";
  if (days >= 3) tone = "red";
  else if (days >= 1) tone = "amber";
  const isToday =
    returnDate &&
    new Date(returnDate).toDateString() === new Date().toDateString();
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white/60 px-2.5 py-1.5 dark:border-white/10 dark:bg-white/5 ${
        isToday ? "ring-1 ring-emerald-300" : ""
      }`}
      title={returnDate ? `Eligible return: ${fmtDate(returnDate)}` : undefined}
    >
      <Badge tone={tone} className="justify-center min-w-[70px]">
        {days} day(s)
      </Badge>
      {returnDate ? (
        <div className="text-xs leading-tight text-sdg-slate text-left">
          <div className="uppercase tracking-wide flex items-center gap-1">
            <span>Return</span>
            {isToday && (
              <span className="rounded-full bg-emerald-100 text-emerald-800 px-1.5 py-[1px]">
                Today
              </span>
            )}
          </div>
          <div className="font-medium">{fmtDate(returnDate)}</div>
        </div>
      ) : (
        <div className="text-xs text-sdg-slate">—</div>
      )}
    </div>
  );
}
function Highlight({ text, term }) {
  const value = String(text ?? "");
  const q = String(term ?? "").trim();
  if (!q) return <>{value}</>;
  const lower = value.toLowerCase();
  const t = q.toLowerCase();
  const parts = [];
  let i = 0;
  while (true) {
    const idx = lower.indexOf(t, i);
    if (idx === -1) {
      parts.push(value.slice(i));
      break;
    }
    if (idx > i) parts.push(value.slice(i, idx));
    parts.push(
      <mark
        key={`${idx}-${i}`}
        className="rounded px-0.5 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
      >
        {value.slice(idx, idx + t.length)}
      </mark>
    );
    i = idx + t.length;
  }
  return <>{parts}</>;
}
