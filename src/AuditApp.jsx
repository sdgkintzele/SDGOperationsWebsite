import React, { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// === Storage Keys ===
const STORAGE_KEY = "sdg_gate_audits_v1";
const SETTINGS_KEY = "sdg_gate_settings_v1";

// === Question Catalog ===
const q = (id, label, weight) => ({ id, label, weight });

// General (applies to both gate types)
const GENERAL_QUESTIONS = [
  q("gen_on_time", "Did the guard arrive on time (within 10 minutes)?", 5),
  q(
    "gen_uniform",
    "Is the guard wearing the proper Salient Defense Group uniform and hi-vis vest?",
    4
  ),
  q(
    "gen_professional",
    "Does the guard interact professionally with drivers?",
    3
  ),
  q("gen_attentive", "Is the guard attentive at their post?", 3),
];

// Inbound specific
const INBOUND_QUESTIONS = [
  // YMS Gate-In – completeness (each field weighted for granularity)
  q("in_yms_driver_name", "YMS Gate-In: Driver Name recorded", 2),
  q("in_yms_driver_phone", "YMS Gate-In: Driver Phone Number recorded", 1),
  q("in_yms_license", "YMS Gate-In: Driver License / Badge Number recorded", 2),
  q("in_yms_trailer", "YMS Gate-In: Trailer Number recorded", 2),
  q("in_yms_tractor", "YMS Gate-In: Tractor Number recorded", 2),
  q("in_yms_scac", "YMS Gate-In: Correct SCAC (Carrier Code) recorded", 2),
  q("in_yms_vehicle_type", "YMS Gate-In: Vehicle Type recorded", 1),
  q("in_yms_vehicle_status", "YMS Gate-In: Vehicle Status recorded", 1),
  q(
    "in_yms_load_type",
    "YMS Gate-In: Understands difference and records Live Load vs Drop Load",
    2
  ),
  q("in_yms_po", "YMS Gate-In: PO Number(s) recorded correctly", 4),
  q("in_yms_seal", "YMS Gate-In: Seal Number recorded correctly", 3),
  q("in_yms_origin_dest", "YMS Gate-In: Origin/Destination recorded", 1),
  q("in_yms_location", "YMS Gate-In: YMS Location on yard recorded", 1),

  q("in_identify_po_on_bol", "Knows where to identify PO numbers on a BOL", 3),
  q(
    "in_input_pos_multiple",
    "Properly inputs single and multiple POs into YMS",
    4
  ),
  q(
    "in_reefer_temp_gauge",
    "Checks reefer temperature gauge and references setpoint from BOL",
    5
  ),
  q(
    "in_understand_temp_range",
    "Understands acceptable reefer temperature range vs setpoint",
    4
  ),
  q(
    "in_check_fuel_and_requirements",
    "Checks fuel level and understands inbound fuel requirements",
    3
  ),
  q(
    "in_check_seal_matches_bol",
    "Checks the seal and verifies it matches the BOL",
    4
  ),
  q(
    "in_one_network_accuracy",
    "Enters all required POs into One Network accurately",
    5
  ),
  q(
    "in_take_required_pics",
    "Accurately takes all required pictures of incoming trailers",
    3
  ),
  q(
    "in_use_cones_or_gate_arms",
    "Utilizes cones or gate arms to stop traffic during processing",
    2
  ),
];

// Outbound specific
const OUTBOUND_QUESTIONS = [
  q(
    "out_lane1_automation_utilize",
    "Understands how to utilize Lane 1 automation",
    3
  ),
  q(
    "out_lane1_only_kroger_delivery",
    "Understands only Kroger Delivery Loads use Lane 1 automation",
    3
  ),
  // YMS Gate-Out – completeness
  q("out_yms_driver_name", "YMS Gate-Out: Driver Name recorded", 2),
  q("out_yms_tractor", "YMS Gate-Out: Tractor Number recorded", 2),
  q("out_yms_seal", "YMS Gate-Out: Seal Number recorded", 3),
  q("out_yms_setpoint", "YMS Gate-Out: Temperature setpoint recorded", 4),
  q(
    "out_yms_physical_temp",
    "YMS Gate-Out: Physical trailer temperature recorded",
    4
  ),
  q("out_yms_seal_intact", "YMS Gate-Out: Seal intact verified", 3),
  q("out_yms_vehicle_status", "YMS Gate-Out: Vehicle Status recorded", 1),
  q("out_yms_load_type", "YMS Gate-Out: Load Type (if applicable) recorded", 1),
  q("out_yms_store_numbers", "YMS Gate-Out: Store Number(s) recorded", 4),
  q("out_yms_route_number", "YMS Gate-Out: Route Number recorded", 4),

  q(
    "out_take_required_pics",
    "Takes all required pictures on outbound in YMS",
    3
  ),
  q(
    "out_check_rear_store_number",
    "Checks rear of trailer to identify store number",
    2
  ),
  q("out_check_fuel_gauge", "Checks fuel gauge", 2),
  q(
    "out_fuel_requirements_kroger_jb",
    "Knows fuel requirements to leave for Kroger & JB Hunt delivery loads",
    3
  ),
  q(
    "out_verify_all_seals_against_trip_sheet",
    "Verifies all seals from driver and cross-references Trip Sheet seals",
    4
  ),
  // Reverse phrasing—pass = no misses
  q(
    "out_no_missed_gate_outs",
    "No trailers failed to be gated out (no misses)",
    5
  ),
];

const GATE_TYPES = ["Inbound", "Outbound"]; // tabs / selector
const SHIFTS = ["Dayshift", "Nightshift"]; // schedule selector

// Build a default weights map from the catalogs
const ALL_QUESTIONS = [
  ...GENERAL_QUESTIONS,
  ...INBOUND_QUESTIONS,
  ...OUTBOUND_QUESTIONS,
];
const DEFAULT_WEIGHTS_MAP = Object.fromEntries(
  ALL_QUESTIONS.map((x) => [x.id, x.weight])
);

// === Default Settings ===
const DEFAULT_SETTINGS = {
  passThresholdPct: 80,
  weightsById: { ...DEFAULT_WEIGHTS_MAP },
};

// === Utilities ===
const nowLocalISOForInput = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
};

const loadAudits = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};
const saveAudits = (audits) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(audits));
};

const loadSettings = () => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    const weights = parsed.weightsById || { ...DEFAULT_WEIGHTS_MAP };
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      weightsById: { ...DEFAULT_WEIGHTS_MAP, ...weights },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
};
const saveSettings = (settings) => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
};

function questionSet(gateType, weightsMap) {
  const base =
    gateType === "Inbound"
      ? [...GENERAL_QUESTIONS, ...INBOUND_QUESTIONS]
      : [...GENERAL_QUESTIONS, ...OUTBOUND_QUESTIONS];
  return base.map((it) => ({
    ...it,
    weight: Number(weightsMap?.[it.id] ?? it.weight),
  }));
}

function maxScoreFor(gateType, weightsMap, answers = {}) {
  // For display only: show max considering NA removed? We'll keep full max here.
  return questionSet(gateType, weightsMap).reduce(
    (sum, it) => sum + Number(it.weight || 0),
    0
  );
}

function computeScorePct(answers, gateType, weightsMap) {
  const set = questionSet(gateType, weightsMap);
  const { earned, total } = set.reduce(
    (acc, it) => {
      const v = answers[it.id];
      if (v === "na") return acc; // exclude from denominator
      const w = Number(it.weight || 0);
      acc.total += w;
      if (v === true) acc.earned += w;
      return acc;
    },
    { earned: 0, total: 0 }
  );
  const pct = total > 0 ? Math.round((earned / total) * 100) : 0;
  return { earned, total, pct };
}

function groupBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const k = keyFn(item);
    acc[k] = acc[k] || [];
    acc[k].push(item);
    return acc;
  }, {});
}

// CSV helper
function toCSV(rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    // Quote if value contains comma, quote, or newline (CR/LF)
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  if (!rows.length) return "";
  const header = Object.keys(rows[0]).map(esc).join(",");
  const body = rows
    .map((r) => Object.values(r).map(esc).join(","))
    .join("\r\n"); // CRLF for Excel compatibility
  return header + (body ? "\r\n" + body : "");
}

// === Main Component ===
export default function SDGGateAuditApp() {
  const [tab, setTab] = useState("Audit");
  const [gateType, setGateType] = useState("Inbound");
  const [shift, setShift] = useState("Dayshift");
  const [dateTime, setDateTime] = useState(nowLocalISOForInput());
  const [guardName, setGuardName] = useState("");
  const [auditorName, setAuditorName] = useState("");
  const [notes, setNotes] = useState("");
  const [answers, setAnswers] = useState({}); // values: true | false | "na"
  const [itemNotes, setItemNotes] = useState({}); // per-question notes
  const [openNotes, setOpenNotes] = useState({}); // UI toggle per item
  const [audits, setAudits] = useState(loadAudits());
  const [settings, setSettings] = useState(loadSettings());

  // Filters (Stats/Leader/Data + exports)
  const [filterStart, setFilterStart] = useState(""); // YYYY-MM-DD
  const [filterEnd, setFilterEnd] = useState("");
  const [filterShift, setFilterShift] = useState("All");
  const [filterGate, setFilterGate] = useState("All");
  const [filterAuditor, setFilterAuditor] = useState("");
  const [filterGuard, setFilterGuard] = useState("");

  // Keep storage in sync
  useEffect(() => saveAudits(audits), [audits]);
  useEffect(() => saveSettings(settings), [settings]);

  // Reset answers when gate type changes
  useEffect(() => {
    setAnswers({});
    setItemNotes({});
    setOpenNotes({});
  }, [gateType]);

  const weightsMap = settings.weightsById || DEFAULT_WEIGHTS_MAP;
  const qs = useMemo(
    () => questionSet(gateType, weightsMap),
    [gateType, weightsMap]
  );
  const score = useMemo(
    () => computeScorePct(answers, gateType, weightsMap),
    [answers, gateType, weightsMap]
  );

  // Filtered audits
  const filteredAudits = useMemo(() => {
    const start = filterStart ? new Date(filterStart + "T00:00:00") : null;
    const end = filterEnd ? new Date(filterEnd + "T23:59:59.999") : null;
    return audits.filter((a) => {
      const dt = new Date(a.dateTimeISO);
      if (start && dt < start) return false;
      if (end && dt > end) return false;
      if (filterShift !== "All" && a.shift !== filterShift) return false;
      if (filterGate !== "All" && a.gateType !== filterGate) return false;
      if (
        filterAuditor &&
        !a.auditorName.toLowerCase().includes(filterAuditor.toLowerCase())
      )
        return false;
      if (
        filterGuard &&
        !a.guardName.toLowerCase().includes(filterGuard.toLowerCase())
      )
        return false;
      return true;
    });
  }, [
    audits,
    filterStart,
    filterEnd,
    filterShift,
    filterGate,
    filterAuditor,
    filterGuard,
  ]);

  // Stats (on filtered)
  const stats = useMemo(() => {
    if (filteredAudits.length === 0) return null;
    const allPct = Math.round(
      filteredAudits.reduce((s, a) => s + a.scorePct, 0) / filteredAudits.length
    );
    const passRate = Math.round(
      (filteredAudits.filter((a) => a.passed).length / filteredAudits.length) *
        100
    );
    const inbound = filteredAudits.filter((a) => a.gateType === "Inbound");
    const outbound = filteredAudits.filter((a) => a.gateType === "Outbound");
    const inboundPass = inbound.length
      ? Math.round(
          (inbound.filter((a) => a.passed).length / inbound.length) * 100
        )
      : 0;
    const outboundPass = outbound.length
      ? Math.round(
          (outbound.filter((a) => a.passed).length / outbound.length) * 100
        )
      : 0;

    const failCounts = {};
    filteredAudits.forEach((a) => {
      const w = a.weightsAtSave || weightsMap;
      const set = questionSet(a.gateType, w);
      set.forEach((q) => {
        if (a.answers[q.id] === false)
          failCounts[q.id] = (failCounts[q.id] || 0) + 1;
      });
    });
    const topMisses = Object.entries(failCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id, count]) => ({ id, count, label: findLabel(id) }));

    return {
      allPct,
      passRate,
      inboundPass,
      outboundPass,
      topMisses,
      totalAudits: filteredAudits.length,
    };
  }, [filteredAudits, weightsMap]);

  // Leaderboard (on filtered)
  const guardsAgg = useMemo(() => {
    const byGuard = groupBy(
      filteredAudits,
      (a) => a.guardName.trim() || "(Unspecified)"
    );
    const rows = Object.entries(byGuard).map(([guard, items]) => {
      const avgPct = Math.round(
        items.reduce((s, a) => s + a.scorePct, 0) / items.length
      );
      const passRate = Math.round(
        (items.filter((a) => a.passed).length / items.length) * 100
      );
      const last = items
        .slice()
        .sort((a, b) => new Date(b.dateTimeISO) - new Date(a.dateTimeISO))[0];
      return {
        guard,
        count: items.length,
        avgPct,
        passRate,
        lastGate: last?.gateType,
        lastWhen: new Date(last?.dateTimeISO || Date.now()).toLocaleString(),
      };
    });
    return rows.sort((a, b) => b.avgPct - a.avgPct);
  }, [filteredAudits]);

  const topPerformers = guardsAgg
    .filter((g) => g.count >= 2 && g.avgPct >= 85)
    .slice(0, 5);
  const underPerformers = guardsAgg
    .filter((g) => g.count >= 2 && g.avgPct < 75)
    .slice(-5)
    .sort((a, b) => a.avgPct - b.avgPct);

  function findLabel(id) {
    const all = [
      ...GENERAL_QUESTIONS,
      ...INBOUND_QUESTIONS,
      ...OUTBOUND_QUESTIONS,
    ];
    return all.find((x) => x.id === id)?.label || id;
  }

  // Handlers
  const setAnswer = (id, val) => setAnswers((prev) => ({ ...prev, [id]: val }));
  const setItemNote = (id, val) =>
    setItemNotes((prev) => ({ ...prev, [id]: val }));
  const toggleNote = (id) =>
    setOpenNotes((prev) => ({ ...prev, [id]: !prev[id] }));

  const markAll = (val) => {
    const next = {};
    qs.forEach((it) => (next[it.id] = val));
    setAnswers(next);
  };

  const resetForm = () => {
    setDateTime(nowLocalISOForInput());
    setGuardName("");
    setAuditorName("");
    setNotes("");
    setAnswers({});
    setItemNotes({});
    setOpenNotes({});
  };

  const saveAudit = () => {
    if (!guardName.trim()) return alert("Please enter the guard's name.");
    if (!auditorName.trim()) return alert("Please enter the auditor's name.");

    // ensure every question is answered (true/false/"na")
    const unanswered = qs.filter((q) => !(q.id in answers));
    if (unanswered.length) {
      return alert(
        `Please answer all questions (missing: ${unanswered
          .slice(0, 3)
          .map((u) => u.label)
          .join(", ")}${unanswered.length > 3 ? ", ..." : ""}).`
      );
    }

    const { earned, total, pct } = computeScorePct(
      answers,
      gateType,
      weightsMap
    );
    const passed =
      pct >= (settings.passThresholdPct || DEFAULT_SETTINGS.passThresholdPct);

    const record = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      dateTimeISO: new Date(dateTime).toISOString(),
      guardName: guardName.trim(),
      auditorName: auditorName.trim(),
      shift,
      gateType,
      notes: notes.trim(),
      answers,
      itemNotes,
      scoreEarned: earned,
      scoreTotal: total,
      scorePct: pct,
      passed,
      weightsAtSave: { ...weightsMap },
    };

    setAudits((prev) => [record, ...prev]);
    alert("Audit saved.");
    resetForm();
  };

  const resetAllAudits = () => {
    if (window.confirm("Delete all saved audits?")) {
      setAudits([]);
      localStorage.removeItem(STORAGE_KEY);
      alert("All audits deleted.");
    }
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(filteredAudits, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sdg_gate_audits_${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    // Build detailed CSV: core fields + per-question result (1/0/NA)
    const allIds = Array.from(new Set(ALL_QUESTIONS.map((q) => q.id)));
    const header = {
      dateTime: "Date/Time",
      guardName: "Guard",
      auditorName: "Auditor",
      shift: "Shift",
      gateType: "Gate",
      scorePct: "Score%",
      passed: "Pass",
      notes: "Notes",
    };
    const rows = filteredAudits.map((a) => {
      const base = {
        [header.dateTime]: new Date(a.dateTimeISO).toLocaleString(),
        [header.guardName]: a.guardName,
        [header.auditorName]: a.auditorName,
        [header.shift]: a.shift,
        [header.gateType]: a.gateType,
        [header.scorePct]: a.scorePct,
        [header.passed]: a.passed ? 1 : 0,
        [header.notes]: a.notes,
      };
      const qCols = {};
      allIds.forEach((id) => {
        const v = a.answers[id];
        qCols[id] = v === true ? 1 : v === false ? 0 : v === "na" ? "NA" : "";
      });
      return { ...base, ...qCols };
    });
    const csv = toCSV(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sdg_gate_audits_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportSiteSummaryPDF = () => {
    const doc = new jsPDF();
    const title = "SDG Gate Audit – Site Summary";
    doc.setFontSize(14);
    doc.text(title, 14, 16);
    doc.setFontSize(10);
    const when = new Date().toLocaleString();
    doc.text(`Generated: ${when}`, 14, 22);

    const s = stats || {
      allPct: 0,
      passRate: 0,
      inboundPass: 0,
      outboundPass: 0,
      totalAudits: 0,
      topMisses: [],
    };

    autoTable(doc, {
      head: [
        [
          "Total Audits",
          "Avg Score",
          "Pass Rate",
          "Inbound Pass",
          "Outbound Pass",
        ],
      ],
      body: [
        [
          s.totalAudits,
          `${s.allPct}%`,
          `${s.passRate}%`,
          `${s.inboundPass}%`,
          `${s.outboundPass}%`,
        ],
      ],
      startY: 30,
      styles: { fontSize: 9 },
    });

    const misses = (s.topMisses || []).map((m) => [m.label, m.count]);
    if (misses.length) {
      autoTable(doc, {
        head: [["Top Misses", "Count"]],
        body: misses,
        startY: doc.lastAutoTable.finalY + 8,
        styles: { fontSize: 9 },
      });
    }

    doc.save(`sdg_site_summary_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const exportAuditPDF = (a) => {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text("SDG Gate Audit – Detail", 14, 16);

    doc.setFontSize(10);
    const info = [
      ["Date/Time", new Date(a.dateTimeISO).toLocaleString()],
      ["Guard", a.guardName],
      ["Auditor", a.auditorName],
      ["Shift", a.shift],
      ["Gate", a.gateType],
      ["Score", `${a.scorePct}% (${a.scoreEarned}/${a.scoreTotal})`],
      ["Result", a.passed ? "PASS" : "FAIL"],
    ];
    autoTable(doc, {
      body: info,
      theme: "plain",
      styles: { fontSize: 10, cellPadding: 1 },
      startY: 22,
      columnStyles: { 0: { fontStyle: "bold" } },
    });

    const w = a.weightsAtSave || weightsMap;
    const set = questionSet(a.gateType, w);
    const rows = set.map((q) => [
      q.label,
      w[q.id] ?? q.weight ?? "",
      a.answers[q.id] === true
        ? "Pass"
        : a.answers[q.id] === false
        ? "Fail"
        : "N/A",
      a.itemNotes?.[q.id] ? String(a.itemNotes[q.id]) : "",
    ]);

    autoTable(doc, {
      head: [["Checklist Item", "Weight", "Result", "Note"]],
      body: rows,
      startY: doc.lastAutoTable.finalY + 6,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [240, 240, 240] },
      columnStyles: { 3: { cellWidth: 100 } },
    });

    if (a.notes) {
      autoTable(doc, {
        head: [["Overall Notes"]],
        body: [[a.notes]],
        startY: doc.lastAutoTable.finalY + 6,
        styles: { fontSize: 9 },
      });
    }

    const safeGuard = a.guardName.replace(/[^a-z0-9_-]+/gi, "_");
    const date = new Date(a.dateTimeISO).toISOString().slice(0, 10);
    doc.save(`sdg_audit_${safeGuard}_${date}.pdf`);
  };

  // Settings helpers for weight editor
  const updateWeight = (id, value) => {
    const v = Math.max(0, Math.min(10, Number(value || 0)));
    setSettings((prev) => ({
      ...prev,
      weightsById: { ...prev.weightsById, [id]: v },
    }));
  };
  const resetWeights = () => {
    if (window.confirm("Reset all weights to defaults?")) {
      setSettings((prev) => ({
        ...prev,
        weightsById: { ...DEFAULT_WEIGHTS_MAP },
      }));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl sm:text-2xl font-semibold">SDG Gate Audit</h1>
          <nav className="flex gap-2 text-sm">
            {[
              { k: "Audit", label: "New Audit" },
              { k: "Stats", label: "Site Stats" },
              { k: "Leader", label: "Leaderboard" },
              { k: "Settings", label: "Settings" },
              { k: "Data", label: "Data" },
            ].map((t) => (
              <button
                key={t.k}
                onClick={() => setTab(t.k)}
                className={`px-3 py-2 rounded-full border ${
                  tab === t.k
                    ? "bg-black text-white"
                    : "bg-white hover:bg-gray-100"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {tab === "Audit" && (
          <section className="space-y-6">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="bg-white rounded-2xl p-4 shadow">
                <h2 className="font-semibold mb-3">Audit Details</h2>
                <div className="grid gap-3">
                  <label className="grid gap-1">
                    <span className="text-sm">Date & Time</span>
                    <input
                      type="datetime-local"
                      className="border rounded-lg px-3 py-2"
                      value={dateTime}
                      onChange={(e) => setDateTime(e.target.value)}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-sm">Guard Name</span>
                    <input
                      className="border rounded-lg px-3 py-2"
                      placeholder="e.g., John Doe"
                      value={guardName}
                      onChange={(e) => setGuardName(e.target.value)}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-sm">Auditor Name</span>
                    <input
                      className="border rounded-lg px-3 py-2"
                      placeholder="e.g., Site Manager"
                      value={auditorName}
                      onChange={(e) => setAuditorName(e.target.value)}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-sm">Shift</span>
                    <select
                      className="border rounded-lg px-3 py-2"
                      value={shift}
                      onChange={(e) => setShift(e.target.value)}
                    >
                      {SHIFTS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <span className="text-sm">Gate Type</span>
                    <select
                      className="border rounded-lg px-3 py-2"
                      value={gateType}
                      onChange={(e) => setGateType(e.target.value)}
                    >
                      {GATE_TYPES.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <span className="text-sm">Notes</span>
                    <textarea
                      rows={4}
                      className="border rounded-lg px-3 py-2"
                      placeholder="Observations, coaching items, context…"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </label>
                </div>
              </div>

              <div className="bg-white rounded-2xl p-4 shadow flex flex-col justify-between">
                <div>
                  <h2 className="font-semibold mb-2">Score</h2>
                  <div className="text-4xl font-bold">{score.pct}%</div>
                  <div className="text-sm text-gray-600">
                    {score.earned} / {score.total} weighted points
                  </div>
                  <div className="mt-3">
                    <span
                      className={`inline-block px-2.5 py-1 rounded-full text-sm ${
                        score.pct >= settings.passThresholdPct
                          ? "bg-green-100 text-green-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      {score.pct >= settings.passThresholdPct ? "PASS" : "FAIL"}
                    </span>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-3 gap-2 text-sm">
                  <button
                    onClick={() => markAll(true)}
                    className="border rounded-lg px-3 py-2 hover:bg-gray-50"
                  >
                    Mark All Pass
                  </button>
                  <button
                    onClick={() => markAll(false)}
                    className="border rounded-lg px-3 py-2 hover:bg-gray-50"
                  >
                    Mark All Fail
                  </button>
                  <button
                    onClick={() => markAll("na")}
                    className="border rounded-lg px-3 py-2 hover:bg-gray-50"
                  >
                    Mark All N/A
                  </button>
                  <button
                    onClick={saveAudit}
                    className="col-span-3 bg-black text-white rounded-lg px-4 py-2 font-medium"
                  >
                    Save Audit
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-4 shadow">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">Checklist – {gateType}</h2>
                <div className="text-sm text-gray-600">
                  Weighted max: {maxScoreFor(gateType, weightsMap)} pts
                </div>
              </div>

              <ol className="space-y-3 list-decimal pl-6">
                {qs.map((item) => (
                  <li key={item.id} className="border rounded-xl p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="font-medium flex items-center gap-2">
                          <span>{item.label}</span>
                          <button
                            title="Add note"
                            onClick={() => toggleNote(item.id)}
                            className="text-xs px-2 py-0.5 border rounded-lg hover:bg-gray-50"
                          >
                            📝 Note
                          </button>
                        </div>
                        <div className="text-xs text-gray-500">
                          Weight: {item.weight} pts
                        </div>
                        {openNotes[item.id] && (
                          <div className="mt-2">
                            <textarea
                              rows={2}
                              placeholder="Add context for this item…"
                              className="w-full border rounded-lg px-2 py-1 text-sm"
                              value={itemNotes[item.id] || ""}
                              onChange={(e) =>
                                setItemNote(item.id, e.target.value)
                              }
                            />
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="radio"
                            name={item.id}
                            checked={answers[item.id] === true}
                            onChange={() => setAnswer(item.id, true)}
                          />
                          <span>Pass</span>
                        </label>
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="radio"
                            name={item.id}
                            checked={answers[item.id] === false}
                            onChange={() => setAnswer(item.id, false)}
                          />
                          <span>Fail</span>
                        </label>
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="radio"
                            name={item.id}
                            checked={answers[item.id] === "na"}
                            onChange={() => setAnswer(item.id, "na")}
                          />
                          <span>N/A</span>
                        </label>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        )}

        {tab === "Stats" && (
          <section className="space-y-6">
            <FilterBar
              {...{
                filterStart,
                setFilterStart,
                filterEnd,
                setFilterEnd,
                filterShift,
                setFilterShift,
                filterGate,
                setFilterGate,
                filterAuditor,
                setFilterAuditor,
                filterGuard,
                setFilterGuard,
              }}
              total={audits.length}
              shown={filteredAudits.length}
            />

            <div className="grid sm:grid-cols-4 gap-4">
              <StatCard
                title="Total Audits (shown)"
                value={filteredAudits.length}
              />
              <StatCard title="Avg Score" value={`${stats?.allPct ?? 0}%`} />
              <StatCard title="Pass Rate" value={`${stats?.passRate ?? 0}%`} />
              <StatCard
                title="Inbound / Outbound Pass"
                value={`${stats?.inboundPass ?? 0}% / ${
                  stats?.outboundPass ?? 0
                }%`}
              />
            </div>

            <div className="bg-white rounded-2xl p-4 shadow">
              <h3 className="font-semibold mb-3">Top Misses</h3>
              {stats && stats.topMisses?.length ? (
                <ul className="divide-y">
                  {stats.topMisses.map((m) => (
                    <li
                      key={m.id}
                      className="py-2 flex items-center justify-between"
                    >
                      <div className="pr-4">{m.label}</div>
                      <div className="text-sm text-gray-600">
                        {m.count} misses
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-gray-500">No data yet.</div>
              )}
            </div>
          </section>
        )}

        {tab === "Leader" && (
          <section className="space-y-6">
            <FilterBar
              {...{
                filterStart,
                setFilterStart,
                filterEnd,
                setFilterEnd,
                filterShift,
                setFilterShift,
                filterGate,
                setFilterGate,
                filterAuditor,
                setFilterAuditor,
                filterGuard,
                setFilterGuard,
              }}
              total={audits.length}
              shown={filteredAudits.length}
            />

            <div className="bg-white rounded-2xl p-4 shadow">
              <h3 className="font-semibold mb-3">
                Guard Leaderboard (Filtered)
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-600">
                      <th className="py-2 pr-4">Guard</th>
                      <th className="py-2 pr-4">Audits</th>
                      <th className="py-2 pr-4">Avg Score</th>
                      <th className="py-2 pr-4">Pass Rate</th>
                      <th className="py-2 pr-4">Last (Gate / When)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {guardsAgg.map((g) => (
                      <tr key={g.guard}>
                        <td className="py-2 pr-4 font-medium">{g.guard}</td>
                        <td className="py-2 pr-4">{g.count}</td>
                        <td className="py-2 pr-4">{g.avgPct}%</td>
                        <td className="py-2 pr-4">{g.passRate}%</td>
                        <td className="py-2 pr-4 text-gray-600">
                          {g.lastGate} · {g.lastWhen}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="bg-white rounded-2xl p-4 shadow">
                <h4 className="font-semibold mb-2">
                  Top Performers (≥2 audits, ≥85%)
                </h4>
                <ul className="text-sm divide-y">
                  {topPerformers.length ? (
                    topPerformers.map((g) => (
                      <li key={g.guard} className="py-2 flex justify-between">
                        <span className="font-medium">{g.guard}</span>
                        <span>
                          {g.avgPct}% · {g.count} audits
                        </span>
                      </li>
                    ))
                  ) : (
                    <li className="py-2 text-gray-500">No data yet.</li>
                  )}
                </ul>
              </div>
              <div className="bg-white rounded-2xl p-4 shadow">
                <h4 className="font-semibold mb-2">
                  Underperformers (≥2 audits, &lt;75%)
                </h4>
                <ul className="text-sm divide-y">
                  {underPerformers.length ? (
                    underPerformers.map((g) => (
                      <li key={g.guard} className="py-2 flex justify-between">
                        <span className="font-medium">{g.guard}</span>
                        <span>
                          {g.avgPct}% · {g.count} audits
                        </span>
                      </li>
                    ))
                  ) : (
                    <li className="py-2 text-gray-500">No data yet.</li>
                  )}
                </ul>
              </div>
            </div>
          </section>
        )}

        {tab === "Settings" && (
          <section className="space-y-6">
            <div className="bg-white rounded-2xl p-4 shadow">
              <h3 className="font-semibold mb-3">Scoring</h3>
              <div className="grid sm:grid-cols-2 gap-4 items-end">
                <label className="grid gap-1">
                  <span className="text-sm">Overall Pass Threshold (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={settings.passThresholdPct}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        passThresholdPct: Number(e.target.value || 0),
                      })
                    }
                    className="border rounded-lg px-3 py-2 w-40"
                  />
                </label>
                <div className="text-xs text-gray-600">
                  A guard passes the audit if their weighted score percentage
                  (N/A excluded) meets or exceeds this threshold.
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-4 shadow">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold mb-3">Weights – Editable</h3>
                <div className="flex gap-2">
                  <button
                    onClick={resetWeights}
                    className="border rounded-lg px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    Reset to Defaults
                  </button>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-6 text-sm">
                <div>
                  <h4 className="font-medium mb-2">General</h4>
                  <WeightEditorList
                    list={GENERAL_QUESTIONS}
                    weights={weightsMap}
                    onChange={updateWeight}
                  />
                </div>
                <div>
                  <h4 className="font-medium mb-2">Inbound</h4>
                  <WeightEditorList
                    list={INBOUND_QUESTIONS}
                    weights={weightsMap}
                    onChange={updateWeight}
                  />
                </div>
                <div>
                  <h4 className="font-medium mb-2">Outbound</h4>
                  <WeightEditorList
                    list={OUTBOUND_QUESTIONS}
                    weights={weightsMap}
                    onChange={updateWeight}
                  />
                </div>
              </div>

              <p className="text-xs text-gray-500 mt-4">
                Weights save automatically to this browser.
              </p>
            </div>
          </section>
        )}

        {tab === "Data" && (
          <section className="space-y-6">
            <FilterBar
              {...{
                filterStart,
                setFilterStart,
                filterEnd,
                setFilterEnd,
                filterShift,
                setFilterShift,
                filterGate,
                setFilterGate,
                filterAuditor,
                setFilterAuditor,
                filterGuard,
                setFilterGuard,
              }}
              total={audits.length}
              shown={filteredAudits.length}
            />

            <div className="bg-white rounded-2xl p-4 shadow flex flex-wrap gap-2 items-center">
              <button
                onClick={exportJSON}
                className="border rounded-lg px-3 py-2 hover:bg-gray-50"
              >
                Export JSON (filtered)
              </button>
              <button
                onClick={exportCSV}
                className="border rounded-lg px-3 py-2 hover:bg-gray-50"
              >
                Export CSV (filtered)
              </button>
              <button
                onClick={exportSiteSummaryPDF}
                className="border rounded-lg px-3 py-2 hover:bg-gray-50"
              >
                Export Site Summary PDF
              </button>
              <div className="text-sm text-gray-600 ml-auto">
                {filteredAudits.length} of {audits.length} records shown
              </div>
            </div>

            <div className="bg-white rounded-2xl p-4 shadow overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-2 pr-4">Date/Time</th>
                    <th className="py-2 pr-4">Guard</th>
                    <th className="py-2 pr-4">Auditor</th>
                    <th className="py-2 pr-4">Shift</th>
                    <th className="py-2 pr-4">Gate</th>
                    <th className="py-2 pr-4">Score</th>
                    <th className="py-2 pr-4">Pass</th>
                    <th className="py-2 pr-4">Notes</th>
                    <th className="py-2 pr-4">PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredAudits.map((a) => (
                    <tr key={a.id}>
                      <td className="py-2 pr-4">
                        {new Date(a.dateTimeISO).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4">{a.guardName}</td>
                      <td className="py-2 pr-4">{a.auditorName}</td>
                      <td className="py-2 pr-4">{a.shift}</td>
                      <td className="py-2 pr-4">{a.gateType}</td>
                      <td className="py-2 pr-4">{a.scorePct}%</td>
                      <td className="py-2 pr-4">{a.passed ? "Yes" : "No"}</td>
                      <td
                        className="py-2 pr-4 max-w-lg truncate"
                        title={a.notes}
                      >
                        {a.notes}
                      </td>
                      <td className="py-2 pr-4">
                        <button
                          onClick={() => exportAuditPDF(a)}
                          className="border rounded px-2 py-1"
                        >
                          PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredAudits.length === 0 && (
                <div className="text-sm text-gray-500">
                  No data in the current filter.
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl p-4 shadow">
              <button
                onClick={resetAllAudits}
                className="border rounded-lg px-3 py-2 hover:bg-gray-50"
              >
                Reset All Audits
              </button>
            </div>
          </section>
        )}
      </main>

      <footer className="max-w-6xl mx-auto px-4 pb-8 text-xs text-gray-500">
        Local-only storage. For multi-user/cloud, I can wire this to a database
        (Supabase/Firebase) and add login & role-based access.
      </footer>
    </div>
  );
}

function StatCard({ title, value }) {
  return (
    <div className="bg-white rounded-2xl p-4 shadow">
      <div className="text-sm text-gray-600">{title}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

function WeightEditorList({ list, weights, onChange }) {
  return (
    <ul className="space-y-2">
      {list.map((x) => (
        <li key={x.id} className="flex items-center justify-between gap-3">
          <span className="flex-1 pr-3">{x.label}</span>
          <input
            type="number"
            min={0}
            max={10}
            value={Number(weights?.[x.id] ?? x.weight)}
            onChange={(e) => onChange(x.id, e.target.value)}
            className="border rounded-lg px-2 py-1 w-20 text-right"
          />
        </li>
      ))}
    </ul>
  );
}

function FilterBar(props) {
  const {
    filterStart,
    setFilterStart,
    filterEnd,
    setFilterEnd,
    filterShift,
    setFilterShift,
    filterGate,
    setFilterGate,
    filterAuditor,
    setFilterAuditor,
    filterGuard,
    setFilterGuard,
    total,
    shown,
  } = props;
  return (
    <div className="bg-white rounded-2xl p-4 shadow grid md:grid-cols-5 gap-3 items-end">
      <label className="grid gap-1 text-sm">
        <span>Date From</span>
        <input
          type="date"
          value={filterStart}
          onChange={(e) => setFilterStart(e.target.value)}
          className="border rounded-lg px-3 py-2"
        />
      </label>
      <label className="grid gap-1 text-sm">
        <span>Date To</span>
        <input
          type="date"
          value={filterEnd}
          onChange={(e) => setFilterEnd(e.target.value)}
          className="border rounded-lg px-3 py-2"
        />
      </label>
      <label className="grid gap-1 text-sm">
        <span>Shift</span>
        <select
          value={filterShift}
          onChange={(e) => setFilterShift(e.target.value)}
          className="border rounded-lg px-3 py-2"
        >
          {["All", ...SHIFTS].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        <span>Gate</span>
        <select
          value={filterGate}
          onChange={(e) => setFilterGate(e.target.value)}
          className="border rounded-lg px-3 py-2"
        >
          {["All", ...GATE_TYPES].map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3 md:col-span-2 text-sm">
        <label className="grid gap-1">
          <span>Auditor</span>
          <input
            value={filterAuditor}
            onChange={(e) => setFilterAuditor(e.target.value)}
            className="border rounded-lg px-3 py-2"
            placeholder="Search name"
          />
        </label>
        <label className="grid gap-1">
          <span>Guard</span>
          <input
            value={filterGuard}
            onChange={(e) => setFilterGuard(e.target.value)}
            className="border rounded-lg px-3 py-2"
            placeholder="Search name"
          />
        </label>
      </div>
      <div className="text-xs text-gray-600 md:col-span-5">
        Showing {shown} of {total} records.
      </div>
    </div>
  );
}
