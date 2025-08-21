// src/pages/UserDetail.jsx
import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

/* ---------- tiny helpers ---------- */
const fmtDate = (v) => (!v ? "—" : new Date(v).toLocaleDateString());
const fmtDateTime = (v) => (!v ? "—" : new Date(v).toLocaleString());
const fmtPct = (v) => {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  const s = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${s.replace(/\.0$/, "")}%`;
};
function Badge({ tone = "slate", children }) {
  const theme =
    tone === "green"
      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200 border-green-200/70 dark:border-green-700/40"
      : tone === "amber"
      ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100 border-amber-200/70 dark:border-amber-700/40"
      : "bg-black/5 text-black/80 dark:bg-white/10 dark:text-white/80 border-black/10 dark:border-white/10";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] ${theme}`}
    >
      {children}
    </span>
  );
}

/* ======================================================================= */

export default function UserDetail() {
  const { id } = useParams();

  // current user role (for manager-gated actions)
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

  // page data
  const [guard, setGuard] = useState(null);
  const [stats, setStats] = useState(null);
  const [violations, setViolations] = useState([]);
  const [audits, setAudits] = useState([]);
  const [auditTypes, setAuditTypes] = useState([]);
  const [loading, setLoading] = useState(true);

  // add-audit form
  const [newAudit, setNewAudit] = useState({
    audit_type_id: null,
    occurred_at: new Date().toISOString().slice(0, 16), // yyyy-mm-ddThh:mm
    pass: "",
    score: "",
    notes: "",
  });

  // load everything
  const load = async () => {
    setLoading(true);
    const [{ data: g }, { data: s }, { data: v }, { data: a }, { data: ats }] =
      await Promise.all([
        supabase
          .from("guards")
          .select(
            "id, full_name, employment_type, status, site_id, contact_email, notes"
          )
          .eq("id", id)
          .single(),
        supabase.from("guard_stats_v").select("*").eq("guard_id", id).single(),
        supabase
          .from("violations")
          .select(
            `
          id, occurred_at, shift, post, lane, status, doc_status, breach_days, eligible_return_date,
          violation_types ( label, slug )
        `
          )
          .eq("guard_id", id)
          .order("occurred_at", { ascending: false }),
        supabase
          .from("audits")
          .select(
            `
          id, occurred_at, post, lane, shift, pass, score, notes,
          audit_types ( slug, label )
        `
          )
          .eq("guard_id", id)
          .order("occurred_at", { ascending: false }),
        supabase.from("audit_types").select("id, label, slug").order("label"),
      ]);

    setGuard(g || null);
    setStats(s || null);
    setViolations(v || []);
    setAudits(a || []);
    setAuditTypes(ats || []);
    if ((ats?.length || 0) > 0 && !newAudit.audit_type_id) {
      setNewAudit((na) => ({ ...na, audit_type_id: ats[0].id }));
    }
    setLoading(false);
  };

  useEffect(() => {
    load(); // eslint-disable-next-line
  }, [id]);

  /* ---------- actions ---------- */
  const saveProfile = async () => {
    if (!isManager) return alert("Managers only.");
    const { error } = await supabase
      .from("guards")
      .update({
        full_name: guard.full_name,
        employment_type: guard.employment_type,
        status: guard.status,
        contact_email: guard.contact_email,
        notes: guard.notes,
      })
      .eq("id", id);
    if (error) return alert(error.message);
    alert("Saved.");
    load();
  };

  const archiveToggle = async () => {
    if (!isManager) return alert("Managers only.");
    const nextStatus = guard.status === "inactive" ? "active" : "inactive";
    const { error } = await supabase
      .from("guards")
      .update({ status: nextStatus })
      .eq("id", id);
    if (error) return alert(error.message);
    load();
  };

  const deleteGuard = async () => {
    if (!isManager) return alert("Managers only.");
    if (!confirm("Delete this guard? (Only if they have no violations/audits)"))
      return;
    let error = null;
    try {
      const resp = await supabase.rpc("delete_guard_if_unused", {
        guard_id: id,
      });
      error = resp.error || null;
      if (error && /function .* does not exist/i.test(error.message)) {
        const del = await supabase.from("guards").delete().eq("id", id);
        error = del.error || null;
      }
    } catch (e) {
      error = e;
    }
    if (error) return alert(error.message || String(error));
    alert("Deleted (if unused).");
  };

  const addAudit = async () => {
    if (!isManager) return alert("Managers only.");
    const occurred_at_iso = new Date(newAudit.occurred_at).toISOString();
    const payload = {
      guard_id: id,
      audit_type_id: newAudit.audit_type_id,
      occurred_at: occurred_at_iso,
      pass: newAudit.pass === "" ? null : newAudit.pass,
      score: newAudit.score === "" ? null : Number(newAudit.score),
      notes: newAudit.notes || null,
    };
    const { error } = await supabase.from("audits").insert(payload);
    if (error) return alert(error.message);
    setNewAudit((na) => ({ ...na, notes: "", score: "" }));
    load();
  };

  /* ---------- computed display ---------- */
  const statusTone = guard?.status === "active" ? "green" : "amber";
  const ipPct = fmtPct(stats?.ip_avg_score_pct);
  const tgPct = fmtPct(stats?.tg_avg_score_pct);
  const ipCnt = stats?.ip_audits ?? 0;
  const tgCnt = stats?.tg_audits ?? 0;
  const lastAuditAt = fmtDate(stats?.last_audit_at);

  return (
    <div className="py-8">
      <style>{`
        .page { max-width: 1800px; }
        .card { border: 1px solid rgba(255,255,255,.08); border-radius: 14px; background: transparent; }
        .card-accent { height: 6px; background: var(--sdg-gold, #d4af37); border-top-left-radius: 14px; border-top-right-radius: 14px; }
        .kpi h4 { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--sdg-slate, #9aa4b2); }
        .kpi .value { font-size: 24px; font-weight: 700; }
        .grid-kpis { display: grid; gap: 16px; grid-template-columns: repeat(1,minmax(0,1fr)); }
        @media (min-width: 1024px) { .grid-kpis { grid-template-columns: repeat(4,minmax(0,1fr)); } }
        input, select, textarea {
          background-color: #fff; color: #0f172a; border: 1px solid rgba(0,0,0,.10);
        }
        .dark input, .dark select, .dark textarea {
          background-color: #151a1e !important; color: #e5e7eb !important; border-color: rgba(255,255,255,.12) !important;
        }
        input:focus-visible, select:focus-visible, textarea:focus-visible {
          box-shadow: 0 0 0 3px rgba(212,175,55,.25); border-color: rgba(212,175,55,.45);
        }
        .dark input:focus-visible, .dark select:focus-visible, .dark textarea:focus-visible {
          box-shadow: 0 0 0 3px rgba(212,175,55,.3); border-color: rgba(212,175,55,.55);
        }
        table thead { position: sticky; top: 0; z-index: 5; }
        table thead th { background: rgba(255,255,255,.04); }
        .dark table thead th { background: rgba(255,255,255,.035); }
        tbody tr:nth-child(odd) { background: rgba(255,255,255,.02); }
        .cell { padding: 10px 12px; vertical-align: middle; }
      `}</style>

      <div className="mx-auto page px-4 md:px-6">
        <div className="mb-4">
          <Link
            to="/hr/users"
            className="text-sdg-slate underline underline-offset-2"
          >
            ← Back to Users
          </Link>
        </div>

        {!guard ? (
          <div className="text-sdg-slate">
            {loading ? "Loading…" : "Not found."}
          </div>
        ) : (
          <>
            {/* Top header */}
            <div className="flex flex-wrap items-start gap-3 mb-3">
              <div className="min-w-[260px]">
                <h1 className="font-heading text-3xl leading-tight">
                  {guard.full_name}
                </h1>
                <div className="flex items-center gap-2 mt-1">
                  <Badge tone={statusTone}>{guard.status}</Badge>
                  <span className="text-sdg-slate">•</span>
                  <span className="text-sdg-slate">
                    {guard.employment_type}
                  </span>
                </div>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {isManager && (
                  <>
                    <button className="btn btn-ghost" onClick={saveProfile}>
                      Save
                    </button>
                    <button className="btn btn-ghost" onClick={archiveToggle}>
                      {guard.status === "inactive" ? "Unarchive" : "Archive"}
                    </button>
                    <button className="btn btn-ghost" onClick={deleteGuard}>
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* KPI strip */}
            <div className="grid-kpis mb-6">
              {/* Reports */}
              <div className="card kpi">
                <div className="card-accent" />
                <div className="p-4">
                  <h4>Reports</h4>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                    <div>
                      <div className="value">{stats?.open_violations ?? 0}</div>
                      <div className="text-xs text-sdg-slate">Open</div>
                    </div>
                    <div>
                      <div className="value">
                        {stats?.total_violations ?? 0}
                      </div>
                      <div className="text-xs text-sdg-slate">Total</div>
                    </div>
                    <div>
                      <div className="value">
                        {stats?.early_departures ?? 0}
                      </div>
                      <div className="text-xs text-sdg-slate">Early</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Docs */}
              <div className="card kpi">
                <div className="card-accent" />
                <div className="p-4">
                  <h4>Documentation</h4>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                    <div>
                      <div className="value">{stats?.docs_pending ?? 0}</div>
                      <div className="text-xs text-sdg-slate">Pending</div>
                    </div>
                    <div>
                      <div className="value">{stats?.docs_provided ?? 0}</div>
                      <div className="text-xs text-sdg-slate">Provided</div>
                    </div>
                    <div>
                      <div className="value">
                        {stats?.docs_not_provided ?? 0}
                      </div>
                      <div className="text-xs text-sdg-slate">
                        Not&nbsp;Provided
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Interior Audit */}
              <div className="card kpi">
                <div className="card-accent" />
                <div className="p-4">
                  <h4>Interior Audit</h4>
                  <div className="mt-3 flex items-end gap-3">
                    <div className="value">{ipPct}</div>
                    <div className="text-sdg-slate">( {ipCnt} )</div>
                  </div>
                  <div className="text-xs text-sdg-slate mt-2">
                    Average of graded / pass-fail scores.
                  </div>
                </div>
              </div>

              {/* Truck Gate Audit */}
              <div className="card kpi">
                <div className="card-accent" />
                <div className="p-4">
                  <h4>Truck Gate Audit</h4>
                  <div className="mt-3 flex items-end gap-3">
                    <div className="value">{tgPct}</div>
                    <div className="text-sdg-slate">( {tgCnt} )</div>
                  </div>
                  <div className="text-xs mt-2">
                    <span className="text-sdg-slate">Last audit:</span>{" "}
                    {lastAuditAt}
                  </div>
                </div>
              </div>
            </div>

            {/* Basics + Add Audit side-by-side */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
              {/* Basics */}
              <section className="card overflow-hidden">
                <div className="card-accent" />
                <div className="p-4">
                  <h2 className="font-medium mb-4">Basics</h2>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <label className="block text-sm text-sdg-slate mb-1">
                        Full name
                      </label>
                      <input
                        className="w-full rounded-md px-3 py-2"
                        value={guard.full_name || ""}
                        onChange={(e) =>
                          setGuard((g) => ({ ...g, full_name: e.target.value }))
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-sdg-slate mb-1">
                        Employment
                      </label>
                      <select
                        className="w-full rounded-md px-3 py-2"
                        value={guard.employment_type || "W2"}
                        onChange={(e) =>
                          setGuard((g) => ({
                            ...g,
                            employment_type: e.target.value,
                          }))
                        }
                      >
                        <option>W2</option>
                        <option>1099</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm text-sdg-slate mb-1">
                        Status
                      </label>
                      <select
                        className="w-full rounded-md px-3 py-2"
                        value={guard.status || "active"}
                        onChange={(e) =>
                          setGuard((g) => ({ ...g, status: e.target.value }))
                        }
                      >
                        <option value="active">active</option>
                        <option value="inactive">inactive</option>
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm text-sdg-slate mb-1">
                        Contact email
                      </label>
                      <input
                        className="w-full rounded-md px-3 py-2"
                        value={guard.contact_email || ""}
                        onChange={(e) =>
                          setGuard((g) => ({
                            ...g,
                            contact_email: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm text-sdg-slate mb-1">
                        Notes
                      </label>
                      <input
                        className="w-full rounded-md px-3 py-2"
                        value={guard.notes || ""}
                        onChange={(e) =>
                          setGuard((g) => ({ ...g, notes: e.target.value }))
                        }
                      />
                    </div>
                  </div>
                </div>
              </section>

              {/* Add Audit */}
              <section className="card overflow-hidden">
                <div className="card-accent" />
                <div className="p-4">
                  <h2 className="font-medium mb-4">Add Audit</h2>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="block text-sm text-sdg-slate mb-1">
                        Type
                      </label>
                      <select
                        className="w-full rounded-md px-3 py-2"
                        value={newAudit.audit_type_id || ""}
                        onChange={(e) =>
                          setNewAudit((na) => ({
                            ...na,
                            audit_type_id: Number(e.target.value),
                          }))
                        }
                      >
                        {auditTypes.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm text-sdg-slate mb-1">
                        Date / Time
                      </label>
                      <input
                        type="datetime-local"
                        className="w-full rounded-md px-3 py-2"
                        value={newAudit.occurred_at}
                        onChange={(e) =>
                          setNewAudit((na) => ({
                            ...na,
                            occurred_at: e.target.value,
                          }))
                        }
                      />
                    </div>

                    <div>
                      <label className="block text-sm text-sdg-slate mb-1">
                        Pass / Fail
                      </label>
                      <select
                        className="w-full rounded-md px-3 py-2"
                        value={newAudit.pass ?? ""}
                        onChange={(e) =>
                          setNewAudit((na) => ({
                            ...na,
                            pass:
                              e.target.value === ""
                                ? ""
                                : e.target.value === "true",
                          }))
                        }
                      >
                        <option value="">(optional)</option>
                        <option value="true">Pass</option>
                        <option value="false">Fail</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm text-sdg-slate mb-1">
                        Score (0–100, optional)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        className="w-full rounded-md px-3 py-2"
                        value={newAudit.score}
                        onChange={(e) =>
                          setNewAudit((na) => ({
                            ...na,
                            score: e.target.value,
                          }))
                        }
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm text-sdg-slate mb-1">
                        Notes
                      </label>
                      <input
                        className="w-full rounded-md px-3 py-2"
                        placeholder="Optional"
                        value={newAudit.notes}
                        onChange={(e) =>
                          setNewAudit((na) => ({
                            ...na,
                            notes: e.target.value,
                          }))
                        }
                      />
                    </div>

                    <div className="md:col-span-2">
                      <button
                        className="btn btn-ghost"
                        onClick={addAudit}
                        disabled={!isManager}
                      >
                        Add Audit
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            {/* Tables side-by-side */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* Violations */}
              <section className="card overflow-hidden">
                <div className="card-accent" />
                <div className="p-4">
                  <h2 className="font-medium mb-3">Violations</h2>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr>
                          <th className="cell text-left">Date/Time</th>
                          <th className="cell text-left">Type</th>
                          <th className="cell text-left">Post/Lane</th>
                          <th className="cell text-left">Shift</th>
                          <th className="cell text-center">Status</th>
                          <th className="cell text-center">Docs</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {violations.length === 0 ? (
                          <tr>
                            <td className="cell text-sdg-slate" colSpan={6}>
                              No violations.
                            </td>
                          </tr>
                        ) : (
                          violations.map((r) => {
                            const postLane = r.lane
                              ? `${r.post || "—"} • Lane ${r.lane}`
                              : r.post || "—";
                            const docs =
                              r.doc_status === "provided"
                                ? "Provided"
                                : r.doc_status === "not_provided"
                                ? "Not provided"
                                : r.doc_status === "pending"
                                ? "Pending"
                                : "—";
                            return (
                              <tr key={r.id}>
                                <td className="cell whitespace-nowrap">
                                  {fmtDateTime(r.occurred_at)}
                                </td>
                                <td className="cell">
                                  {r.violation_types?.label}
                                </td>
                                <td className="cell">{postLane}</td>
                                <td className="cell capitalize">
                                  {r.shift || "—"}
                                </td>
                                <td className="cell text-center">
                                  <Badge
                                    tone={
                                      r.status === "open" ? "amber" : "green"
                                    }
                                  >
                                    {r.status}
                                  </Badge>
                                </td>
                                <td className="cell text-center">{docs}</td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>

              {/* Audits */}
              <section className="card overflow-hidden">
                <div className="card-accent" />
                <div className="p-4">
                  <h2 className="font-medium mb-3">Audits</h2>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr>
                          <th className="cell text-left">Date/Time</th>
                          <th className="cell text-left">Type</th>
                          <th className="cell text-left">Pass</th>
                          <th className="cell text-left">Score</th>
                          <th className="cell text-left">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {audits.length === 0 ? (
                          <tr>
                            <td className="cell text-sdg-slate" colSpan={5}>
                              No audits yet.
                            </td>
                          </tr>
                        ) : (
                          audits.map((a) => (
                            <tr key={a.id}>
                              <td className="cell whitespace-nowrap">
                                {fmtDateTime(a.occurred_at)}
                              </td>
                              <td className="cell">{a.audit_types?.label}</td>
                              <td className="cell">
                                {a.pass === null
                                  ? "—"
                                  : a.pass
                                  ? "Pass"
                                  : "Fail"}
                              </td>
                              <td className="cell">
                                {a.score == null ? "—" : fmtPct(a.score)}
                              </td>
                              <td className="cell">{a.notes || "—"}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
