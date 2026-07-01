"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import { getSettings, getAllExpedisi } from "@/lib/firestore";
import { todayString, cn } from "@/lib/utils";
import type { CompanySettings, Expedisi } from "@/types";
import {
  Table2,
  Download,
  Search,
  Loader2,
  Filter,
  ChevronDown,
  Edit2,
  Check,
  X,
  AlertCircle,
  FileSpreadsheet,
  RefreshCw,
} from "lucide-react";

interface SheetRow {
  no: string;
  kodeResi: string;
  noKarung: string;
  diScanOleh: string;
  tanggal: string;
  jam: string;
  sheetName: string;
  expedisiCode: string;
  gsheetRow: number;
}

type DisplayRow = SheetRow & { displayNo: number };

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Pastel palette for expedisi colour coding
const EXP_COLORS = [
  "bg-blue-100 text-blue-800",
  "bg-purple-100 text-purple-800",
  "bg-orange-100 text-orange-800",
  "bg-pink-100 text-pink-800",
  "bg-teal-100 text-teal-800",
  "bg-indigo-100 text-indigo-800",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-800",
];

export default function DataPage() {
  const { appUser } = useAuth();
  const today = todayString();

  const [settings, setSettings]           = useState<CompanySettings | null>(null);
  const [expedisiList, setExpedisiList]   = useState<Expedisi[]>([]);
  const [dateFrom, setDateFrom]           = useState(daysAgo(6));
  const [dateTo, setDateTo]               = useState(today);
  const [selectedExp, setSelectedExp]     = useState<Set<string>>(new Set());
  const [showExpDrop, setShowExpDrop]     = useState(false);
  const [karungFilter, setKarungFilter]   = useState<Set<string>>(new Set());
  const [searchText, setSearchText]       = useState("");

  const [loading, setLoading]             = useState(false);
  const [rows, setRows]                   = useState<SheetRow[]>([]);
  const [error, setError]                 = useState("");

  // Inline edit
  const [editCell, setEditCell]           = useState<{ idx: number; field: string } | null>(null);
  const [editValue, setEditValue]         = useState("");
  const [saving, setSaving]               = useState(false);
  const [saveError, setSaveError]         = useState("");

  const isAdmin = appUser?.role === "admin";
  const expDropRef = useRef<HTMLDivElement>(null);

  // Load settings + expedisi on mount
  useEffect(() => {
    Promise.all([getSettings(), getAllExpedisi()]).then(([cfg, exps]) => {
      setSettings(cfg);
      setExpedisiList(exps.filter((e) => e.active));
    });
  }, []);

  // Close expedisi dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (expDropRef.current && !expDropRef.current.contains(e.target as Node)) {
        setShowExpDrop(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetchData = async () => {
    if (!settings?.spreadsheetId) {
      setError("Spreadsheet ID belum dikonfigurasi. Buka menu Pengaturan.");
      return;
    }
    setLoading(true);
    setError("");
    setRows([]);
    setEditCell(null);
    setKarungFilter(new Set());
    setSearchText("");

    try {
      const params = new URLSearchParams({
        spreadsheetId: settings.spreadsheetId,
        dateFrom,
        dateTo,
      });
      if (selectedExp.size > 0) {
        params.set("expedisiCodes", Array.from(selectedExp).join(","));
      }

      const res  = await fetch(`/api/gsheet/multi-read?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal fetch data");
      setRows(data.rows ?? []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  // ── Derived data ─────────────────────────────────────────────────────────

  // Unique karung numbers from loaded rows
  const uniqueKarungs = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => { if (r.noKarung) s.add(r.noKarung); });
    return Array.from(s).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  }, [rows]);

  // Unique expedisi codes from loaded rows (for colour map)
  const expedisiCodes = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => s.add(r.expedisiCode));
    return Array.from(s).sort();
  }, [rows]);

  const expColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    expedisiCodes.forEach((code, i) => {
      map[code] = EXP_COLORS[i % EXP_COLORS.length];
    });
    return map;
  }, [expedisiCodes]);

  // Client-side filtered + searched rows
  const filteredRows = useMemo(() => {
    let r = rows;
    if (karungFilter.size > 0) r = r.filter((row) => karungFilter.has(row.noKarung));
    if (searchText.trim()) {
      const q = searchText.trim().toUpperCase();
      r = r.filter(
        (row) =>
          row.kodeResi.toUpperCase().includes(q) ||
          row.noKarung.includes(q) ||
          row.diScanOleh.toUpperCase().includes(q)
      );
    }
    return r;
  }, [rows, karungFilter, searchText]);

  const displayRows: DisplayRow[] = useMemo(
    () => filteredRows.map((r, i) => ({ ...r, displayNo: i + 1 })),
    [filteredRows]
  );

  // Per-expedisi stats for summary bar
  const expStats = useMemo(() => {
    const map: Record<string, number> = {};
    filteredRows.forEach((r) => {
      map[r.expedisiCode] = (map[r.expedisiCode] ?? 0) + 1;
    });
    return map;
  }, [filteredRows]);

  // ── Inline edit ──────────────────────────────────────────────────────────
  const startEdit = (idx: number, field: string, val: string) => {
    if (!isAdmin) return;
    setSaveError("");
    setEditCell({ idx, field });
    setEditValue(val);
  };

  const cancelEdit = () => { setEditCell(null); setEditValue(""); setSaveError(""); };

  const saveEdit = async () => {
    if (!editCell || !settings?.spreadsheetId) return;
    const row = displayRows[editCell.idx];
    if (!row) return;
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/gsheet/update-row", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spreadsheetId: settings.spreadsheetId,
          sheetName:     row.sheetName,
          gsheetRow:     row.gsheetRow,
          field:         editCell.field,
          value:         editValue.trim(),
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Update gagal");
      }
      // Update local state
      const { sheetName, gsheetRow } = row;
      const field = editCell.field;
      const val   = editValue.trim();
      setRows((prev) =>
        prev.map((r) =>
          r.sheetName === sheetName && r.gsheetRow === gsheetRow
            ? { ...r, [field]: val }
            : r
        )
      );
      setEditCell(null);
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  };

  // ── Export Excel ─────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);

  // Refs — always up-to-date regardless of closure timing
  const displayRowsRef = useRef<DisplayRow[]>([]);
  const expStatsRef    = useRef<Record<string, number>>({});
  const dateFromRef    = useRef(dateFrom);
  const dateToRef      = useRef(dateTo);
  const karungFilterRef = useRef<Set<string>>(new Set());
  const searchTextRef  = useRef("");
  const selectedExpRef = useRef<Set<string>>(new Set());

  useEffect(() => { displayRowsRef.current  = displayRows;  }, [displayRows]);
  useEffect(() => { expStatsRef.current     = expStats;     }, [expStats]);
  useEffect(() => { dateFromRef.current     = dateFrom;     }, [dateFrom]);
  useEffect(() => { dateToRef.current       = dateTo;       }, [dateTo]);
  useEffect(() => { karungFilterRef.current = karungFilter; }, [karungFilter]);
  useEffect(() => { searchTextRef.current   = searchText;   }, [searchText]);
  useEffect(() => { selectedExpRef.current  = selectedExp;  }, [selectedExp]);

  const exportExcel = async () => {
    const rows    = displayRowsRef.current;
    const stats   = expStatsRef.current;
    const dFrom   = dateFromRef.current;
    const dTo     = dateToRef.current;
    const kFilter = karungFilterRef.current;
    const sText   = searchTextRef.current;
    const sExp    = selectedExpRef.current;

    if (rows.length === 0) return;
    setExporting(true);
    try {
      const XLSX = await import("xlsx");

      // ── Filter info rows (shown above table) ──────────────────────────
      const filterLines: string[][] = [];
      filterLines.push(["Data Retur — Export Google Sheets", "", "", "", "", "", ""]);
      filterLines.push([`Periode: ${dFrom} s.d. ${dTo}`, "", "", "", "", "", ""]);
      if (sExp.size > 0)    filterLines.push([`Expedisi: ${Array.from(sExp).join(", ")}`, "", "", "", "", "", ""]);
      if (kFilter.size > 0) filterLines.push([`Karung: #${Array.from(kFilter).sort().join(", #")}`, "", "", "", "", "", ""]);
      if (sText.trim())     filterLines.push([`Pencarian: "${sText.trim()}"`, "", "", "", "", "", ""]);
      filterLines.push([]); // blank separator

      const INFO_ROWS = filterLines.length; // number of rows before header

      // ── Table data ────────────────────────────────────────────────────
      const headers = ["No.", "Expedisi", "Kode Resi", "No. Karung", "Di Scan Oleh", "Tanggal", "Jam"];
      const dataRows = rows.map((r) => [
        r.displayNo,
        r.expedisiCode,
        r.kodeResi,
        r.noKarung,
        r.diScanOleh,
        r.tanggal,
        r.jam,
      ]);

      // Summary row at bottom
      const summaryParts = Object.entries(stats)
        .sort((a, b) => b[1] - a[1])
        .map(([code, cnt]) => `${code}: ${cnt}`)
        .join("  |  ");
      const summaryRow = [`Total: ${rows.length} resi`, summaryParts, "", "", "", "", ""];

      const wsData = [...filterLines, headers, ...dataRows, [], summaryRow];

      // ── Create worksheet ──────────────────────────────────────────────
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // ── Column widths ─────────────────────────────────────────────────
      ws["!cols"] = [
        { wch: 5  },  // No.
        { wch: 12 },  // Expedisi
        { wch: 28 },  // Kode Resi
        { wch: 10 },  // No. Karung
        { wch: 18 },  // Di Scan Oleh
        { wch: 14 },  // Tanggal
        { wch: 10 },  // Jam
      ];

      // ── Style helpers ─────────────────────────────────────────────────
      const colLetters  = ["A", "B", "C", "D", "E", "F", "G"];
      const headerFill  = { patternType: "solid", fgColor: { rgb: "1E293B" } };
      const headerFont  = { bold: true, color: { rgb: "FFFFFF" }, sz: 10 };
      const titleFont   = { bold: true, sz: 11, color: { rgb: "0F172A" } };
      const infoFont    = { sz: 9, color: { rgb: "475569" } };
      const centerAlign = { horizontal: "center" as const, vertical: "center" as const };
      const leftAlign   = { horizontal: "left"   as const, vertical: "center" as const };
      const monoFont    = { name: "Courier New", sz: 9, bold: true };
      const normalFont  = { sz: 9 };
      const altFill     = { patternType: "solid", fgColor: { rgb: "F8FAFC" } };
      const summaryFill = { patternType: "solid", fgColor: { rgb: "F1F5F9" } };
      const summaryFont = { bold: true, sz: 9, color: { rgb: "334155" } };
      const thinBorder  = {
        top:    { style: "thin", color: { rgb: "E2E8F0" } },
        bottom: { style: "thin", color: { rgb: "E2E8F0" } },
        left:   { style: "thin", color: { rgb: "E2E8F0" } },
        right:  { style: "thin", color: { rgb: "E2E8F0" } },
      };

      // Style info / title rows
      filterLines.forEach((line, i) => {
        const ref = `A${i + 1}`;
        if (!ws[ref]) return;
        ws[ref].s = {
          font:      i === 0 ? titleFont : infoFont,
          alignment: leftAlign,
        };
      });

      const headerRowNum = INFO_ROWS + 1; // 1-based

      // Style header row
      colLetters.forEach((col, ci) => {
        const ref = `${col}${headerRowNum}`;
        if (!ws[ref]) return;
        ws[ref].s = {
          fill:      headerFill,
          font:      headerFont,
          alignment: ci === 0 || ci === 3 || ci === 5 || ci === 6 ? centerAlign : leftAlign,
          border:    thinBorder,
        };
      });

      // Style data rows
      dataRows.forEach((_, i) => {
        const rowNum = INFO_ROWS + 1 + i + 1; // headerRow + 1 + data offset
        const isAlt  = i % 2 === 1;
        colLetters.forEach((col, ci) => {
          const ref = `${col}${rowNum}`;
          if (!ws[ref]) ws[ref] = { t: "s", v: "" };
          const isCenter = ci === 0 || ci === 3 || ci === 5 || ci === 6;
          ws[ref].s = {
            fill:      isAlt ? altFill : { patternType: "none" },
            font:      ci === 2 ? monoFont : normalFont,
            alignment: isCenter ? centerAlign : leftAlign,
            border:    thinBorder,
          };
        });
      });

      // Style summary row
      const summaryRowNum = INFO_ROWS + 1 + dataRows.length + 2; // +1 header +1 blank +1
      ["A", "B"].forEach((col) => {
        const ref = `${col}${summaryRowNum}`;
        if (!ws[ref]) ws[ref] = { t: "s", v: "" };
        ws[ref].s = {
          fill:      summaryFill,
          font:      summaryFont,
          alignment: leftAlign,
          border: {
            top:    { style: "medium", color: { rgb: "CBD5E1" } },
            bottom: { style: "medium", color: { rgb: "CBD5E1" } },
            left:   { style: "thin",   color: { rgb: "E2E8F0" } },
            right:  { style: "thin",   color: { rgb: "E2E8F0" } },
          },
        };
      });

      // Auto-filter on header row only
      ws["!autofilter"] = { ref: `A${headerRowNum}:G${headerRowNum}` };

      // ── Create workbook & download ────────────────────────────────────
      const wb = XLSX.utils.book_new();
      const sheetLabel = `${dFrom} sd ${dTo}`.replace(/[:\\\/\?\*\[\]]/g, "-").slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetLabel);

      const fileName = `retur_${dFrom}_sd_${dTo}.xlsx`;
      XLSX.writeFile(wb, fileName, { bookType: "xlsx", type: "binary", cellStyles: true });
    } finally {
      setExporting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Table2 className="w-6 h-6 text-green-600" /> Data &amp; Export
        </h1>
        <p className="text-slate-500 mt-1">Lihat, edit, dan export data resi dari Google Sheets</p>
      </div>

      {/* ── Filter card ── */}
      <div className="card p-4 space-y-3">
        {/* Row 1: date range + expedisi + fetch button */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Dari Tanggal</label>
            <input
              type="date" value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="input-field"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Sampai Tanggal</label>
            <input
              type="date" value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="input-field"
            />
          </div>

          {/* Expedisi multi-select dropdown */}
          <div className="relative" ref={expDropRef}>
            <label className="text-xs text-slate-500 mb-1 block">Expedisi</label>
            <button
              type="button"
              onClick={() => setShowExpDrop((v) => !v)}
              className="input-field flex items-center gap-2 min-w-[170px] text-left cursor-pointer"
            >
              <Filter className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <span className="flex-1 text-sm text-slate-700">
                {selectedExp.size === 0 ? "Semua Expedisi" : `${selectedExp.size} dipilih`}
              </span>
              <ChevronDown className={cn("w-4 h-4 text-slate-400 transition-transform", showExpDrop && "rotate-180")} />
            </button>

            {showExpDrop && (
              <div className="absolute top-full mt-1 left-0 z-20 bg-white border border-slate-200 rounded-xl shadow-lg min-w-[220px] py-2">
                <button
                  onClick={() => { setSelectedExp(new Set()); setShowExpDrop(false); }}
                  className="w-full text-left px-4 py-2 text-sm text-slate-500 hover:bg-slate-50"
                >
                  Semua Expedisi
                </button>
                <div className="border-t border-slate-100 mt-1 pt-1">
                  {expedisiList.map((exp) => (
                    <label
                      key={exp.id}
                      className="flex items-center gap-2.5 px-4 py-2 hover:bg-slate-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedExp.has(exp.code)}
                        onChange={(e) => {
                          const s = new Set(selectedExp);
                          e.target.checked ? s.add(exp.code) : s.delete(exp.code);
                          setSelectedExp(s);
                        }}
                        className="rounded"
                      />
                      <span className="text-sm text-slate-700">{exp.name}</span>
                      <span className="text-xs text-slate-400 ml-auto">{exp.code}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={fetchData}
            disabled={loading}
            className="btn-primary"
          >
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Search className="w-4 h-4" />}
            Tampilkan
          </button>

          {rows.length > 0 && (
            <button onClick={fetchData} disabled={loading} className="btn-secondary" title="Refresh data">
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </button>
          )}
        </div>

        {/* Row 2: karung filter chips + search + export (only after data loaded) */}
        {rows.length > 0 && (
          <div className="flex flex-wrap gap-3 items-end pt-2 border-t border-slate-100">
            {/* Karung chips */}
            <div className="flex-1">
              <p className="text-xs text-slate-500 mb-1.5">Filter Karung/Bag</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setKarungFilter(new Set())}
                  className={cn(
                    "px-3 py-1 text-xs rounded-full border font-medium transition-colors",
                    karungFilter.size === 0
                      ? "bg-green-600 text-white border-green-600"
                      : "border-slate-200 text-slate-500 hover:bg-slate-50"
                  )}
                >
                  Semua
                </button>
                {uniqueKarungs.map((k) => (
                  <button
                    key={k}
                    onClick={() => {
                      const s = new Set(karungFilter);
                      s.has(k) ? s.delete(k) : s.add(k);
                      setKarungFilter(s);
                    }}
                    className={cn(
                      "px-3 py-1 text-xs rounded-full border font-medium transition-colors",
                      karungFilter.has(k)
                        ? "bg-green-600 text-white border-green-600"
                        : "border-slate-200 text-slate-500 hover:bg-slate-50"
                    )}
                  >
                    #{k}
                  </button>
                ))}
              </div>
            </div>

            {/* Search */}
            <div className="min-w-[200px]">
              <p className="text-xs text-slate-500 mb-1.5">Cari</p>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Kode resi / scan oleh..."
                  className="input-field pl-9"
                />
                {searchText && (
                  <button
                    onClick={() => setSearchText("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Export */}
            <button onClick={exportExcel} disabled={exporting} className="btn-secondary">
              {exporting
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Download className="w-4 h-4" />}
              Export Excel
            </button>
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError("")} className="text-red-400 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Save error */}
      {saveError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-3 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{saveError}</span>
          <button onClick={() => setSaveError("")} className="text-red-400 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Summary chips */}
      {displayRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">
            {displayRows.length} resi
            {displayRows.length !== rows.length && (
              <span className="text-slate-400 font-normal"> (dari {rows.length} total)</span>
            )}
          </span>
          {Object.entries(expStats)
            .sort((a, b) => b[1] - a[1])
            .map(([code, count]) => (
              <span
                key={code}
                className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium", expColorMap[code])}
              >
                {code}: {count}
              </span>
            ))}
        </div>
      )}

      {/* ── Table ── */}
      {loading ? (
        <div className="card flex flex-col justify-center items-center py-20 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-green-600" />
          <p className="text-sm text-slate-400">Mengambil data dari Google Sheets...</p>
        </div>
      ) : displayRows.length > 0 ? (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800 text-white text-xs">
                  <th className="px-3 py-3 text-center w-10">No.</th>
                  <th className="px-3 py-3 text-left w-24">Expedisi</th>
                  <th className="px-3 py-3 text-left">Kode Resi</th>
                  <th className="px-3 py-3 text-center w-24">No. Karung</th>
                  <th className="px-3 py-3 text-left">Di Scan Oleh</th>
                  <th className="px-3 py-3 text-center w-28">Tanggal</th>
                  <th className="px-3 py-3 text-center w-20">Jam</th>
                  {isAdmin && <th className="px-2 py-3 w-10"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayRows.map((row, idx) => {
                  const editingResi   = editCell?.idx === idx && editCell.field === "kodeResi";
                  const editingKarung = editCell?.idx === idx && editCell.field === "noKarung";
                  const rowKey        = `${row.sheetName}-${row.gsheetRow}`;

                  return (
                    <tr
                      key={rowKey}
                      className={cn(
                        "transition-colors",
                        idx % 2 === 0 ? "bg-white" : "bg-slate-50/50",
                        "hover:bg-green-50/40"
                      )}
                    >
                      {/* No. */}
                      <td className="px-3 py-2 text-center text-slate-400 text-xs tabular-nums">
                        {row.displayNo}
                      </td>

                      {/* Expedisi badge */}
                      <td className="px-3 py-2">
                        <span className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                          expColorMap[row.expedisiCode] ?? "bg-slate-100 text-slate-700"
                        )}>
                          {row.expedisiCode}
                        </span>
                      </td>

                      {/* Kode Resi — double-click to edit (admin only) */}
                      <td className="px-3 py-2 font-mono font-semibold text-slate-800 text-xs">
                        {editingResi ? (
                          <InlineEditInput
                            value={editValue}
                            onChange={setEditValue}
                            onSave={saveEdit}
                            onCancel={cancelEdit}
                            saving={saving}
                            className="w-52"
                          />
                        ) : (
                          <span
                            className={cn(isAdmin && "cursor-pointer hover:text-green-700")}
                            onDoubleClick={() => isAdmin && startEdit(idx, "kodeResi", row.kodeResi)}
                            title={isAdmin ? "Double-click untuk edit" : undefined}
                          >
                            {row.kodeResi}
                          </span>
                        )}
                      </td>

                      {/* No. Karung — double-click to edit (admin only) */}
                      <td className="px-3 py-2 text-center text-slate-600">
                        {editingKarung ? (
                          <InlineEditInput
                            value={editValue}
                            onChange={setEditValue}
                            onSave={saveEdit}
                            onCancel={cancelEdit}
                            saving={saving}
                            className="w-16 text-center"
                          />
                        ) : (
                          <span
                            className={cn(isAdmin && "cursor-pointer hover:text-green-700")}
                            onDoubleClick={() => isAdmin && startEdit(idx, "noKarung", row.noKarung)}
                            title={isAdmin ? "Double-click untuk edit" : undefined}
                          >
                            {row.noKarung}
                          </span>
                        )}
                      </td>

                      <td className="px-3 py-2 text-slate-600 text-xs">{row.diScanOleh}</td>
                      <td className="px-3 py-2 text-center text-slate-400 text-xs tabular-nums">{row.tanggal}</td>
                      <td className="px-3 py-2 text-center text-slate-400 text-xs tabular-nums">{row.jam}</td>

                      {/* Edit icon button (admin only) */}
                      {isAdmin && (
                        <td className="px-2 py-2">
                          <button
                            onClick={() => startEdit(idx, "kodeResi", row.kodeResi)}
                            className="p-1.5 rounded text-slate-300 hover:text-green-600 hover:bg-green-50 transition-colors"
                            title="Edit kode resi"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Table footer */}
          <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50 flex justify-between items-center text-xs text-slate-400">
            <span>Total {displayRows.length} resi ditampilkan</span>
            {isAdmin && (
              <span>Double-click kolom <strong>Kode Resi</strong> atau <strong>No. Karung</strong> untuk edit langsung</span>
            )}
          </div>
        </div>
      ) : !loading && !error ? (
        /* Empty state */
        <div className="card p-16 text-center">
          <FileSpreadsheet className="w-14 h-14 mx-auto mb-4 text-slate-200" />
          <p className="font-semibold text-slate-500">Pilih tanggal dan klik Tampilkan</p>
          <p className="text-sm text-slate-400 mt-1">Data akan diambil langsung dari Google Sheets</p>
        </div>
      ) : null}
    </div>
  );
}

// ── Inline edit input component ───────────────────────────────────────────
interface InlineEditInputProps {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  className?: string;
}

function InlineEditInput({ value, onChange, onSave, onCancel, saving, className }: InlineEditInputProps) {
  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter")  { e.preventDefault(); onSave();   }
          if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
        className={cn(
          "border border-green-400 rounded px-2 py-0.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-green-400",
          className
        )}
      />
      <button
        onClick={onSave}
        disabled={saving}
        className="p-1 text-green-600 hover:bg-green-50 rounded disabled:opacity-50"
        title="Simpan (Enter)"
      >
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
      </button>
      <button
        onClick={onCancel}
        disabled={saving}
        className="p-1 text-slate-400 hover:bg-slate-100 rounded"
        title="Batal (Esc)"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
