// src/pages/BreachBoard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient"; // correct relative path

/**
 * BreachBoard.jsx
 * Read-only board that lists ACTIVE breach periods for 1099 contractors.
 * Shows rows where status='active' AND eligible_return_date >= today.
 */
export default function BreachBoard() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [endingFilter, setEndingFilter] = useState("all"); // all | today | week

  const today = useMemo(() => new Date(), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError("");

      // YYYY-MM-DD for server-side date compare in UTC
      const isoToday = new Date(
        Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
      )
        .toISOString()
        .slice(0, 10);

      const { data, error } = await supabase
        .from("contractor_breaches")
        .select(
          "id, contractor_name, start_date, end_date, eligible_return_date, violation_code, reason, status"
        )
        .eq("status", "active")
        .gte("eligible_return_date", isoToday) // <-- KEY CHANGE
        .order("eligible_return_date", { ascending: true });

      if (!alive) return;
      if (error) setError(error.message || "Failed to load breaches");
      else setRows(Array.isArray(data) ? data : []);
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [today]);

  const tz = "America/Indiana/Indianapolis";
  const fmt = (d) =>
    d
      ? new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          year: "numeric",
          month: "short",
          day: "2-digit",
        }).format(new Date(d))
      : "—";

  const daysLeft = (eligibleReturn) => {
    if (!eligibleReturn) return null;
    const end = new Date(eligibleReturn + "T00:00:00");
    const now = new Date();
    const ms =
      Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  };

  const filtered = useMemo(() => {
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);

    return rows
      .filter((r) =>
        q
          ? r.contractor_name.toLowerCase().includes(q.toLowerCase()) ||
            (r.violation_code || "").toLowerCase().includes(q.toLowerCase()) ||
            (r.reason || "").toLowerCase().includes(q.toLowerCase())
          : true
      )
      .filter((r) => {
        if (endingFilter === "today") {
          const dl = daysLeft(r.eligible_return_date);
          return dl === 0;
        }
        if (endingFilter === "week") {
          const er = new Date(r.eligible_return_date + "T00:00:00");
          return er <= weekEnd;
        }
        return true;
      });
  }, [rows, q, endingFilter, today]);

  const csv = () => {
    const headers = [
      "Contractor",
      "Violation",
      "Start",
      "End",
      "Eligible Return",
      "Days Left",
      "Reason",
    ];
    const body = filtered.map((r) => [
      r.contractor_name,
      r.violation_code || "",
      r.start_date,
      r.end_date,
      r.eligible_return_date,
      String(daysLeft(r.eligible_return_date) ?? ""),
      (r.reason || "").replace(/\n/g, " "),
    ]);
    const text = [headers, ...body]
      .map((row) =>
        row.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(",")
      )
      .join("\n");
    const blob = new Blob([text], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `active-breaches-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyQuickList = async () => {
    const lines = filtered.map(
      (r) =>
        `• ${r.contractor_name} (through ${fmt(r.end_date)} | eligible ${fmt(
          r.eligible_return_date
        )})`
    );
    const text = `DO NOT SCHEDULE (ACTIVE BREACHES)\n${lines.join("\n")}`;
    await navigator.clipboard.writeText(text);
    alert("Copied quick list to clipboard.");
  };

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Active Breach Board (1099)
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, violation, reason…"
            className="w-64 rounded-xl border px-3 py-2"
          />
          <select
            className="rounded-xl border px-3 py-2"
            value={endingFilter}
            onChange={(e) => setEndingFilter(e.target.value)}
            title="Ending"
          >
            <option value="all">All active</option>
            <option value="today">Ending today</option>
            <option value="week">Ending in 7 days</option>
          </select>
          <button
            onClick={copyQuickList}
            className="rounded-xl border px-3 py-2 hover:bg-gray-50"
          >
            Copy quick list
          </button>
          <button
            onClick={csv}
            className="rounded-xl border px-3 py-2 hover:bg-gray-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      {loading && (
        <div className="rounded-xl border p-6">Loading active breaches…</div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error.includes("permission")
            ? "You don't have access. Please sign in with a manager account."
            : error}
        </div>
      )}

      {!loading && !error && (
        <div className="overflow-x-auto rounded-xl border">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <Th>Contractor</Th>
                <Th>Violation</Th>
                <Th>Start</Th>
                <Th>End</Th>
                <Th>Eligible Return</Th>
                <Th>Days Left</Th>
                <Th>Reason / Notes</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-gray-500">
                    No active breach periods.
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
                const dl = daysLeft(r.eligible_return_date);
                const severity =
                  dl === 0 ? "today" : dl <= 2 ? "soon" : "later";
                return (
                  <tr key={r.id} className="border-t">
                    <Td>
                      <div className="font-medium">{r.contractor_name}</div>
                      <div className="text-xs text-gray-500">
                        Status: {r.status}
                      </div>
                    </Td>
                    <Td>{r.violation_code || "—"}</Td>
                    <Td>{fmt(r.start_date)}</Td>
                    <Td>{fmt(r.end_date)}</Td>
                    <Td>{fmt(r.eligible_return_date)}</Td>
                    <Td>
                      <span
                        className={
                          "inline-flex items-center rounded-full px-2 py-1 text-xs " +
                          (severity === "today"
                            ? "bg-yellow-100 text-yellow-800"
                            : severity === "soon"
                            ? "bg-orange-100 text-orange-800"
                            : "bg-gray-100 text-gray-800")
                        }
                      >
                        {dl === 0
                          ? "eligible today"
                          : `${dl} day${dl === 1 ? "" : "s"}`}
                      </span>
                    </Td>
                    <Td>
                      <div className="max-w-[40ch] whitespace-pre-wrap text-gray-700">
                        {r.reason || "—"}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-gray-500">
        Tip: This board only shows entries with <em>status = "active"</em> and
        an <em>eligible_return_date</em> that is today or later. Use the SQL
        policy to restrict visibility to managers.
      </p>
    </div>
  );
}

function Th({ children }) {
  return (
    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
      {children}
    </th>
  );
}
function Td({ children }) {
  return <td className="px-3 py-3 align-top">{children}</td>;
}
