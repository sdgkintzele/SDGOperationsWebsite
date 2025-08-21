// src/pages/LogViolation.jsx
import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
  memo,
  useRef,
} from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

const SHIFT_OPTIONS = [
  { value: "day", label: "Day" },
  { value: "night", label: "Night" },
];

const UI_KEY = "logViolation.ui.wide.v1";

// ▶ If your team is always Eastern, keep this as "America/New_York".
// ▶ If you prefer the browser’s local timezone, set this to null.
const DEFAULT_TZ = "America/New_York";

/** Build a value for <input type="datetime-local"> as YYYY-MM-DDTHH:mm
 *  using either a specific IANA time zone or the browser local zone.
 */
function nowForInput(tz = DEFAULT_TZ) {
  if (!tz) {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day}T${hh}:${mm}`;
  }

  // Use Intl.DateTimeFormat so we don’t parse strings manually
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date());

  const get = (t) => parts.find((p) => p.type === t)?.value;
  const y = get("year");
  const m = get("month");
  const d = get("day");
  const hh = get("hour");
  const mm = get("minute");

  // IMPORTANT: datetime-local has no timezone. This value is just the literal
  // numbers we show. We’re intentionally seeding them from Eastern.
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

export default function LogViolation() {
  const nav = useNavigate();

  // ---------------- UI / Wide mode ----------------
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

  // ---------------- Options ----------------
  const [guards, setGuards] = useState([]);
  const [types, setTypes] = useState([]);
  const [posts, setPosts] = useState([]);

  // ---------------- Form (controlled except note/sign) ----------------
  const [guardId, setGuardId] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => nowForInput()); // ✅ Eastern by default
  const [shift, setShift] = useState("day");
  const [post, setPost] = useState("");
  const [lane, setLane] = useState("");
  const [typeId, setTypeId] = useState("");
  const [witness, setWitness] = useState("");

  // Uncontrolled fields prevent “one character only” + wiping issues
  const noteRef = useRef(null);
  const signRef = useRef(null);

  // files, state
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  // who am I
  const [uid, setUid] = useState(null);

  /* ----------------------- Load dropdown data ----------------------- */
  useEffect(() => {
    (async () => {
      const [{ data: g }, { data: t }, { data: p }] = await Promise.all([
        supabase
          .from("guards")
          .select("id, full_name")
          .eq("status", "active")
          .order("full_name", { ascending: true }),
        supabase
          .from("violation_types")
          .select("id, label, slug")
          .order("label", { ascending: true }),
        supabase
          .from("posts")
          .select("name")
          .eq("active", true)
          .order("name", { ascending: true }),
      ]);

      setGuards(g || []);
      setTypes(t || []);
      setPosts(p?.map((x) => x.name) || []);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setUid(data?.user?.id || null);
    })();
  }, []);

  /* ----------------------------- Helpers ---------------------------- */
  const requiresDocs = useMemo(() => {
    const vt = types.find((t) => t.id === typeId);
    const slug = vt?.slug || "";
    return slug === "callout" || slug === "early_departure";
  }, [typeId, types]);

  const onPickFiles = useCallback(
    (e) => setFiles(Array.from(e.target.files || [])),
    []
  );

  const validate = useCallback(() => {
    const currentNote = (noteRef.current?.value ?? "").trim();
    const currentSig = (signRef.current?.value ?? "").trim();
    const e = {};
    if (!guardId) e.guardId = "Select a guard.";
    if (!typeId) e.typeId = "Select a violation type.";
    if (!occurredAt) e.occurredAt = "Enter the date/time.";
    if (!currentNote) e.note = "Please enter a brief supervisor note.";
    if (currentSig.length < 2)
      e.signature = "Type your full name to sign/acknowledge.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }, [guardId, occurredAt, typeId]);

  /* ----------------------------- Submit ----------------------------- */
  const onSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      if (!validate() || !uid) return;

      const currentNote = (noteRef.current?.value ?? "").trim();
      const currentSig = (signRef.current?.value ?? "").trim();

      setSubmitting(true);
      try {
        // Convert Eastern-filled local timestamp string to UTC ISO for DB
        const occurredISO = new Date(occurredAt).toISOString();

        // 1) Create violation
        const payload = {
          guard_id: guardId,
          type_id: typeId,
          occurred_at: occurredISO,
          shift,
          post: post || null,
          lane: lane || null,
          supervisor_note: currentNote,
          witness_name: witness || null,
          status: "open",
          supervisor_id: uid,
          created_by: uid,
          supervisor_attested_at: new Date().toISOString(),
          supervisor_signature_name: currentSig,
        };

        const { data: v, error: insErr } = await supabase
          .from("violations")
          .insert(payload)
          .select("id")
          .single();
        if (insErr) throw insErr;
        const violationId = v.id;

        // 2) Upload evidence (optional)
        if (files.length) {
          const uploads = files.map(async (f) => {
            const path = `violation_${violationId}/${Date.now()}_${f.name}`;
            const { error: upErr } = await supabase.storage
              .from("evidence")
              .upload(path, f, { cacheControl: "3600", upsert: false });
            if (upErr) throw upErr;

            const { error: rowErr } = await supabase
              .from("violation_files")
              .insert({
                violation_id: violationId,
                file_path: path,
                uploaded_by: uid,
              });
            if (rowErr) throw rowErr;
          });
          await Promise.all(uploads);
        }

        // 3) Go to detail
        nav(`/hr/violations/${violationId}`);
      } catch (err) {
        console.error(err);
        alert(err.message || "Could not submit violation.");
      } finally {
        setSubmitting(false);
      }
    },
    [
      files,
      guardId,
      lane,
      nav,
      occurredAt,
      post,
      shift,
      supabase,
      typeId,
      uid,
      validate,
      witness,
    ]
  );

  /* ------------------------------ UI -------------------------------- */

  const FieldShell = memo(function FieldShell({
    label,
    required,
    htmlFor,
    hint,
    error,
    children,
  }) {
    return (
      <div className="rounded-xl border border-sdg-dark/15 bg-white/60 p-3.5 dark:bg-white/5 dark:border-white/15">
        {label ? (
          <label
            htmlFor={htmlFor}
            className="block text-sm font-medium text-sdg-slate mb-1"
          >
            {label} {required ? <span className="text-red-600">*</span> : null}
          </label>
        ) : null}
        {children}
        {hint ? <p className="mt-1 text-xs text-sdg-slate">{hint}</p> : null}
        {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
      </div>
    );
  });

  const inputClass =
    "mt-0 w-full bg-transparent border-0 focus:ring-0 p-0 text-[15px]";
  const selectClass =
    "mt-0 w-full bg-transparent border-0 focus:ring-0 p-0 text-[15px]";
  const textareaClass =
    "mt-0 w-full bg-transparent border-0 focus:ring-0 p-0 text-[15px]";

  const contentWidth = wide ? "max-w-none" : "max-w-[1600px]";
  const contentPad = wide ? "px-4 md:px-6" : "px-2 md:px-4";

  return (
    <div className="py-8">
      {/* Dark-mode readability + Wide-mode shell + calendar icon visibility */}
      <style>{`
        /* Light */
        select, input[type="text"], input[type="datetime-local"], textarea {
          background-color: #ffffff; color: #0f172a;
        }
        ::placeholder { color: #64748b; }

        /* Dark */
        .dark select,
        .dark input[type="text"],
        .dark input[type="datetime-local"],
        .dark textarea {
          background-color: #151a1e !important;
          color: #e5e7eb !important;
          border-color: rgba(255,255,255,0.12) !important;
        }
        .dark ::placeholder { color: #9aa4b2 !important; }
        .dark input[type="datetime-local"]::-webkit-calendar-picker-indicator {
          filter: invert(1) brightness(1.2) contrast(1.1);
        }

        /* Wide shell like Violation Data */
        .wide-page .container,
        .wide-page .mx-auto,
        .wide-page [class*="max-w-"] { max-width: 100% !important; }
        .wide-page header, .wide-page nav { padding-left: 0 !important; padding-right: 0 !important; }
      `}</style>

      <div className={`mx-auto ${contentWidth} ${contentPad}`}>
        <header className="mb-4 flex items-start gap-3">
          <div>
            <h1 className="font-heading text-2xl md:text-3xl">
              Report Violation
            </h1>
            <p className="text-sdg-slate mt-1">
              Record an incident, attach evidence, and sign the attestation.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={wide}
                onChange={(e) => setWide(e.target.checked)}
              />
              <span>Wide Mode</span>
            </label>
            <button
              className="underline text-sm"
              onClick={() => nav(-1)}
              type="button"
            >
              &larr; Back
            </button>
          </div>
        </header>

        <section className="frame overflow-hidden">
          <div className="frame-accent" />
          <div className="p-6">
            <form onSubmit={onSubmit} noValidate>
              <div className="grid gap-6 lg:grid-cols-12">
                {/* Incident details */}
                <section className="lg:col-span-12">
                  <h2 className="font-medium mb-4">Incident details</h2>

                  <div className="grid gap-4 md:grid-cols-2">
                    <FieldShell
                      label="Guard"
                      required
                      htmlFor="vi-guard"
                      error={errors.guardId}
                    >
                      <select
                        id="vi-guard"
                        className={selectClass}
                        value={guardId}
                        onChange={(e) => setGuardId(e.target.value)}
                      >
                        <option value="">Select guard</option>
                        {guards.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.full_name}
                          </option>
                        ))}
                      </select>
                    </FieldShell>

                    <FieldShell
                      label="Date/Time"
                      required
                      htmlFor="vi-dt"
                      error={errors.occurredAt}
                    >
                      <input
                        id="vi-dt"
                        type="datetime-local"
                        className={inputClass}
                        value={occurredAt}
                        onChange={(e) => setOccurredAt(e.target.value)}
                      />
                    </FieldShell>

                    <FieldShell label="Shift" htmlFor="vi-shift">
                      <select
                        id="vi-shift"
                        className={selectClass}
                        value={shift}
                        onChange={(e) => setShift(e.target.value)}
                      >
                        {SHIFT_OPTIONS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </FieldShell>

                    <FieldShell label="Post" htmlFor="vi-post">
                      <select
                        id="vi-post"
                        className={selectClass}
                        value={post}
                        onChange={(e) => setPost(e.target.value)}
                      >
                        <option value="">Select post</option>
                        {posts.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </FieldShell>

                    <FieldShell
                      label="Lane"
                      htmlFor="vi-lane"
                      hint="e.g., Lane 3"
                    >
                      <input
                        id="vi-lane"
                        type="text"
                        className={inputClass}
                        placeholder="Lane (optional)"
                        value={lane}
                        onChange={(e) => setLane(e.target.value)}
                      />
                    </FieldShell>

                    <FieldShell
                      label="Violation Type"
                      required
                      htmlFor="vi-type"
                      error={errors.typeId}
                      hint={
                        requiresDocs
                          ? "Docs required; status will be tracked automatically."
                          : undefined
                      }
                    >
                      <select
                        id="vi-type"
                        className={selectClass}
                        value={typeId}
                        onChange={(e) => setTypeId(e.target.value)}
                      >
                        <option value="">Select type</option>
                        {types.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </FieldShell>
                  </div>
                </section>

                {/* Narrative (8) + Evidence (4) */}
                <section className="lg:col-span-8">
                  <h2 className="font-medium mb-4">Narrative</h2>

                  <div className="space-y-4">
                    <FieldShell
                      label="What happened?"
                      required
                      htmlFor="vi-note"
                      error={errors.note}
                    >
                      <textarea
                        id="vi-note"
                        className={textareaClass}
                        rows={6}
                        placeholder="Provide a brief, factual description…"
                        ref={noteRef}
                        defaultValue=""
                        autoCorrect="off"
                        autoCapitalize="sentences"
                        spellCheck={true}
                      />
                    </FieldShell>

                    <FieldShell
                      label="Witness"
                      htmlFor="vi-witness"
                      hint="Name (if any)"
                    >
                      <input
                        id="vi-witness"
                        type="text"
                        className={inputClass}
                        value={witness}
                        onChange={(e) => setWitness(e.target.value)}
                      />
                    </FieldShell>
                  </div>
                </section>

                <section className="lg:col-span-4">
                  <h2 className="font-medium mb-4">Evidence</h2>

                  <input
                    id="evidence-input"
                    type="file"
                    multiple
                    accept=".pdf,image/*"
                    className="sr-only"
                    onChange={onPickFiles}
                  />

                  <label
                    htmlFor="evidence-input"
                    className="group flex h-36 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-sdg-dark/30 bg-white/40 px-4 text-center text-sdg-slate transition hover:bg-white/70 dark:border-white/15 dark:bg-white/5 dark:hover:bg-white/10"
                    title="Click to browse or drag & drop files"
                  >
                    <svg
                      className="h-8 w-8 opacity-70 group-hover:opacity-100"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M7 16a5 5 0 0 1 .9-9.9A6 6 0 0 1 20 10.5" />
                      <path d="M12 12v7" />
                      <path d="m8.5 15.5 3.5-3.5 3.5 3.5" />
                    </svg>

                    <span className="text-sm font-medium text-sdg-charcoal dark:text-gray-100">
                      Drag & drop files here
                    </span>
                    <span className="text-xs">
                      or <span className="underline">click to browse</span> •
                      PDF or images • 10&nbsp;MB max each
                    </span>
                  </label>

                  <p className="mt-2 text-xs text-sdg-slate">
                    {files.length
                      ? `${files.length} file${
                          files.length > 1 ? "s" : ""
                        } selected`
                      : "You can add more evidence later from the violation detail page."}
                  </p>

                  {requiresDocs && (
                    <p className="mt-2 text-xs text-sdg-slate">
                      For Callouts and Early Departure, the first successful
                      upload marks <em>Docs</em> as <strong>Provided</strong>.
                    </p>
                  )}
                </section>

                {/* Signature / Acknowledgement */}
                <section className="lg:col-span-12">
                  <h2 className="font-medium mb-4">Signature</h2>

                  <div className="grid gap-4 md:grid-cols-2">
                    <FieldShell
                      label="Type your name to sign"
                      required
                      htmlFor="vi-sign"
                      error={errors.signature}
                      hint="By signing, you acknowledge the information is accurate to the best of your knowledge."
                    >
                      <input
                        id="vi-sign"
                        type="text"
                        className={inputClass}
                        placeholder="Your full name"
                        ref={signRef}
                        defaultValue=""
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </FieldShell>
                  </div>

                  <div className="mt-6 flex items-center gap-3">
                    <button
                      className="btn btn-primary"
                      type="submit"
                      disabled={submitting}
                      title="Submit violation"
                    >
                      {submitting ? "Saving…" : "Submit Violation"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => nav("/hr/violations")}
                    >
                      Cancel
                    </button>
                  </div>
                </section>
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
