// src/pages/ViolationDetail.jsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

const UI_KEY = "violationDetail.ui.wide.v1";
const REQUIRES_DOCS = new Set(["callout", "early_departure"]);

export default function ViolationDetail() {
  const { id } = useParams();
  const nav = useNavigate();

  /* ---------------- Wide Mode ---------------- */
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
  const [row, setRow] = useState(null);
  const [files, setFiles] = useState([]);
  const [links, setLinks] = useState({});
  const [saving, setSaving] = useState(false);
  const [upLoading, setUpLoading] = useState(false);

  // Who am I?
  const [me, setMe] = useState(null); // { id, full_name, role }
  const isManager = String(me?.role || "").toLowerCase() === "manager";
  const canAction = true; // RLS enforces on server

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

  // Load violation row
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("violations")
        .select(
          `
          id, occurred_at, shift, post, lane, status, doc_status, supervisor_note,
          breach_days, eligible_return_date, witness_name, supervisor_signature_name,
          approved_by,
          approved_by_profile:profiles!violations_approved_by_fkey ( full_name ),
          guards:guards ( full_name ),
          violation_types:violation_types ( label, slug )
        `
        )
        .eq("id", id)
        .single();
      if (!error) setRow(data);
    })();
  }, [id]);

  // Evidence list
  const refetchFiles = useCallback(async () => {
    const { data } = await supabase
      .from("violation_files")
      .select(`id, file_path, uploaded_at, uploaded_by:profiles(full_name)`)
      .eq("violation_id", id)
      .order("uploaded_at", { ascending: false });
    setFiles(data || []);
  }, [id]);

  useEffect(() => {
    refetchFiles();
  }, [id, refetchFiles]);

  // Signed URLs
  useEffect(() => {
    (async () => {
      const out = {};
      for (const f of files) {
        const { data, error } = await supabase.storage
          .from("evidence")
          .createSignedUrl(f.file_path, 3600);
        out[f.id] = error ? null : data?.signedUrl ?? null;
      }
      setLinks(out);
    })();
  }, [files]);

  const actionsDisabled = useMemo(() => saving || !row, [saving, row]);

  /* ---------------- Mutations ---------------- */
  const updateDoc = async (doc_status) => {
    setSaving(true);
    const { error } = await supabase
      .from("violations")
      .update({ doc_status })
      .eq("id", id);
    setSaving(false);
    if (error) return alert(error.message);
    setRow((r) => ({ ...r, doc_status }));
  };

  const setStatus = async (status) => {
    setSaving(true);
    const { error } = await supabase
      .from("violations")
      .update({ status })
      .eq("id", id);
    setSaving(false);
    if (error) return alert(error.message);

    // Optimistic: reflect approver locally
    setRow((r) => {
      if (!r) return r;
      if (status === "closed") {
        return {
          ...r,
          status,
          approved_by: me?.id ?? r.approved_by,
          approved_by_profile: {
            full_name: me?.full_name ?? r.approved_by_profile?.full_name,
          },
        };
      }
      return { ...r, status, approved_by: null, approved_by_profile: null };
    });
  };

  const handleUpload = async (event) => {
    const filesToUpload = [...event.target.files];
    if (!filesToUpload.length || !row) return;

    setUpLoading(true);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess?.session?.user?.id;
    let didUpload = false;

    for (const file of filesToUpload) {
      const path = `violation_${row.id}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage
        .from("evidence")
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (!upErr) {
        didUpload = true;
        await supabase.from("violation_files").insert({
          violation_id: row.id,
          file_path: path,
          uploaded_by: uid,
        });
      }
    }

    if (didUpload) {
      await refetchFiles();
      const needsDocs = REQUIRES_DOCS.has(row.violation_types?.slug);
      if (needsDocs && row.doc_status !== "provided") {
        await updateDoc("provided");
      }
    }
    setUpLoading(false);
    event.target.value = "";
  };

  // Manager-only delete
  const [deletingId, setDeletingId] = useState(null);
  const handleDeleteEvidence = async (fileRow) => {
    if (!isManager) return;
    const ok = window.confirm("Delete this evidence file permanently?");
    if (!ok) return;

    setDeletingId(fileRow.id);
    try {
      const { error: removeErr } = await supabase.storage
        .from("evidence")
        .remove([fileRow.file_path]);
      if (removeErr) throw removeErr;

      const { error: delErr } = await supabase
        .from("violation_files")
        .delete()
        .eq("id", fileRow.id);
      if (delErr) throw delErr;

      await refetchFiles();
    } catch (e) {
      console.error(e);
      alert("Could not delete evidence.");
    } finally {
      setDeletingId(null);
    }
  };

  /* ---------------- UI ---------------- */
  if (!row) {
    return (
      <div className="py-8">
        <div className="mx-auto max-w-3xl rounded-2xl border border-black/10 bg-white/60 p-4 dark:bg-white/5 dark:border-white/10">
          Loading…
        </div>
      </div>
    );
  }

  const needsDocs = REQUIRES_DOCS.has(row.violation_types?.slug);
  const contentWidth = wide ? "max-w-none" : "max-w-[1600px]";
  const contentPad = wide ? "px-4 md:px-6" : "px-2 md:px-4";

  return (
    <div className="py-8">
      <style>{`
        /* Surfaces (cards) */
        .surface {
          border-radius: 1rem;
          border: 1px solid rgba(0,0,0,.08);
          background: rgba(255,255,255,.7);
          box-shadow: 0 1px 0 rgba(0,0,0,.02);
        }
        .dark .surface {
          border-color: rgba(255,255,255,.12);
          background: rgba(255,255,255,.06);
          box-shadow: 0 1px 0 rgba(0,0,0,.35) inset;
        }

        /* BRAND accent stripe — uses CSS vars with fallbacks */
        /* Set these once in your theme to match the app brand:
           :root { --sdg-accent-1:#E4B851; --sdg-accent-2:#F59E0B; } */
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

        /* Quiet links in dark */
        .link-quiet { text-decoration: underline; text-underline-offset: 2px; }
        .dark .link-quiet { color: #fde68a; }
        .dark .link-quiet:hover { color: #fff; }

        /* Make app shell wide when Wide Mode is on */
        .wide-page .container,
        .wide-page .mx-auto,
        .wide-page [class*="max-w-"] { max-width: 100% !important; }
        .wide-page header, .wide-page nav { padding-left: 0 !important; padding-right: 0 !important; }
      `}</style>

      <div className={`mx-auto ${contentWidth} ${contentPad}`}>
        {/* Top controls */}
        <div className="mb-3 flex items-center gap-3">
          <button className="underline text-sm" onClick={() => nav(-1)}>
            &larr; Back
          </button>
          <div className="ml-auto inline-flex items-center gap-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={wide}
                onChange={(e) => setWide(e.target.checked)}
              />
              <span>Wide Mode</span>
            </label>
          </div>
        </div>

        {/* Page header */}
        <header className="mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-2xl md:text-3xl">
              {row.violation_types?.label} • {row.guards?.full_name}
            </h1>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Badge tone={row.status === "open" ? "amber" : "green"}>
                {cap(row.status)}
              </Badge>
              <Badge
                tone={
                  needsDocs
                    ? row.doc_status === "provided"
                      ? "green"
                      : row.doc_status === "not_provided"
                      ? "red"
                      : "slate"
                    : "slate"
                }
              >
                {needsDocs ? cap(row.doc_status ?? "pending") : "Docs: N/A"}
              </Badge>
            </div>
          </div>

          {/* Meta row */}
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm text-sdg-slate dark:text-white/70">
            <Meta icon="calendar">
              {new Date(row.occurred_at).toLocaleString()}
            </Meta>
            <Meta icon="pin">
              Post: {row.post ?? "—"}
              {row.lane ? ` • Lane ${row.lane}` : ""}
            </Meta>
            <Meta icon="clock">Shift: {cap(row.shift)}</Meta>
          </div>

          <div className="mt-4 accent" />
        </header>

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Supervisor Note */}
          <section className="surface p-6">
            <h2 className="font-medium mb-3">Supervisor Note</h2>
            <p className="whitespace-pre-wrap leading-relaxed">
              {row.supervisor_note}
            </p>
            {row.witness_name && (
              <p className="mt-3">
                <span className="font-medium">Witness:</span> {row.witness_name}
              </p>
            )}
            <p className="mt-3">
              <span className="font-medium">Signed:</span>{" "}
              {row.supervisor_signature_name}
            </p>
          </section>

          {/* Status & Actions */}
          <section className="surface p-6">
            <h2 className="font-medium mb-3">Status</h2>
            <div className="space-y-2">
              <Line label="Violation">
                <Badge tone={row.status === "open" ? "amber" : "green"}>
                  {cap(row.status)}
                </Badge>
              </Line>

              <Line label="Docs">
                {needsDocs ? (
                  <Badge
                    tone={
                      row.doc_status === "not_provided"
                        ? "red"
                        : row.doc_status === "provided"
                        ? "green"
                        : "slate"
                    }
                  >
                    {cap(row.doc_status ?? "pending")}
                  </Badge>
                ) : (
                  <span className="text-sdg-slate dark:text-white/60">N/A</span>
                )}
              </Line>

              <Line label="Breach">
                {row.breach_days == null ? (
                  <span className="text-sdg-slate">—</span>
                ) : (
                  <>
                    {row.breach_days} day(s)
                    {row.eligible_return_date ? (
                      <span className="text-sdg-slate">
                        {" "}
                        • return {row.eligible_return_date}
                      </span>
                    ) : null}
                  </>
                )}
              </Line>

              {row.status === "closed" &&
                row.approved_by_profile?.full_name && (
                  <Line label="Closed by">
                    <span>{row.approved_by_profile.full_name}</span>
                  </Line>
                )}
            </div>

            {canAction && (
              <div className="mt-4 flex flex-wrap gap-2">
                {needsDocs && (
                  <>
                    <Btn
                      disabled={actionsDisabled}
                      onClick={() => updateDoc("provided")}
                      title="Marks documents provided (reasonable; no breach)"
                    >
                      Mark Docs Provided
                    </Btn>
                    <Btn
                      disabled={actionsDisabled}
                      onClick={() => updateDoc("not_provided")}
                      title="Marks not provided (unreasonable; breach applied)"
                    >
                      Mark Not Provided
                    </Btn>
                  </>
                )}

                {row.status === "open" ? (
                  <Btn
                    disabled={actionsDisabled}
                    onClick={() => setStatus("closed")}
                    title="Close this violation"
                  >
                    Close Case
                  </Btn>
                ) : (
                  <Btn
                    disabled={actionsDisabled}
                    onClick={() => setStatus("open")}
                    title="Reopen this violation"
                  >
                    Reopen Case
                  </Btn>
                )}
              </div>
            )}
          </section>

          {/* Evidence */}
          <section className="surface p-6 lg:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-medium">Evidence</h2>

              {needsDocs ? (
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="file"
                    accept=".pdf,image/*"
                    multiple
                    onChange={handleUpload}
                    disabled={upLoading}
                    className="hidden"
                    id="evidence-input"
                  />
                  <span
                    className={`rounded-lg border border-black/10 dark:border-white/10 px-3 py-2 cursor-pointer ${
                      upLoading
                        ? "opacity-50 cursor-not-allowed"
                        : "hover:bg-black/5 dark:hover:bg-white/5"
                    }`}
                    onClick={() =>
                      !upLoading &&
                      document.getElementById("evidence-input").click()
                    }
                  >
                    {upLoading ? "Uploading…" : "Upload"}
                  </span>
                </label>
              ) : (
                <span className="text-sm text-sdg-slate dark:text-white/60">
                  Evidence not required
                </span>
              )}
            </div>

            {!files.length ? (
              <p className="mt-3 text-sdg-slate">No files.</p>
            ) : (
              <ul className="mt-4 divide-y divide-black/5 dark:divide-white/10">
                {files.map((f) => {
                  const filename = f.file_path.split("/").pop();
                  const ext = (filename.split(".").pop() || "").toUpperCase();
                  return (
                    <li
                      key={f.id}
                      className="py-3 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex items-center gap-3">
                        <span className="rounded-md border border-black/10 dark:border-white/10 px-2 py-0.5 text-[11px]">
                          {ext || "FILE"}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{filename}</div>
                          <div className="text-xs text-sdg-slate dark:text-white/70">
                            Uploaded {new Date(f.uploaded_at).toLocaleString()}
                            {f.uploaded_by?.full_name
                              ? ` • by ${f.uploaded_by.full_name}`
                              : ""}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {links[f.id] ? (
                          <a
                            className="link-quiet text-sm"
                            href={links[f.id]}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open
                          </a>
                        ) : (
                          <span className="text-xs">linking…</span>
                        )}

                        {isManager && (
                          <button
                            onClick={() => handleDeleteEvidence(f)}
                            disabled={deletingId === f.id}
                            className="text-sm text-red-600 hover:underline disabled:opacity-50"
                            title="Delete evidence (manager only)"
                          >
                            {deletingId === f.id ? "Deleting…" : "Delete"}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <p className="mt-3 text-xs text-sdg-slate">
              {needsDocs ? (
                <>
                  Uploads are restricted to supervisors/managers. For Callouts
                  and Early Departure, the first successful upload automatically
                  sets <i>Docs</i> to <b>provided</b>.
                </>
              ) : (
                <>Evidence is not required for this violation type.</>
              )}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Small UI helpers ---------------- */

function Meta({ icon, children }) {
  const I =
    icon === "calendar" ? CalendarIcon : icon === "pin" ? PinIcon : ClockIcon;
  return (
    <div className="flex items-center gap-2">
      <I className="w-4 h-4 opacity-70" />
      <span className="truncate">{children}</span>
    </div>
  );
}

function Line({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-sdg-slate dark:text-white/70">{label}:</span>
      <div className="text-right">{children}</div>
    </div>
  );
}

function Btn({ children, className = "", ...rest }) {
  return (
    <button
      className={`rounded-lg border border-black/10 dark:border-white/10 px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

function Badge({ tone = "slate", children }) {
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
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] ${theme}`}
    >
      {children}
    </span>
  );
}

/* tiny inline icons */
function CalendarIcon({ className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <path d="M8 3v3M16 3v3M3 10h18" />
    </svg>
  );
}
function PinIcon({ className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
function ClockIcon({ className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function cap(s) {
  return String(s ?? "")
    .replace(/_/g, " ")
    .replace(/^\w/, (m) => m.toUpperCase());
}
