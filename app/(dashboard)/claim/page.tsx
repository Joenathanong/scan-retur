"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import { getSettings, saveSettings } from "@/lib/firestore";
import { cn } from "@/lib/utils";
import {
  Upload, FileSpreadsheet, Check, X, AlertCircle, Loader2,
  ChevronDown, ChevronUp, Edit2, Trash2, Search, RefreshCw,
  Settings2, Database, ArrowUpDown, Package,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedRow {
  noResi:      string;
  barcode:     string;
  noItem:      string;
  sku:         string;
  qty:         string;
  kondisi:     string;
  batch:       string;
  expDate:     string;
  createdBy:   string;
  createdDate: string;
  expedisi?:   string;
}

interface SheetRow extends ParsedRow {
  gsheetRow: number;
  no:        string;
  expedisi:  string;
}

type TabSection = "upload" | "edit";
type SortDir    = "asc" | "desc";

// ─── Excel parser (client-side, uses xlsx already in project) ─────────────────

async function parseExcel(file: File): Promise<ParsedRow[]> {
  const XLSX   = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const wb     = XLSX.read(buffer, { type: "array", cellDates: true });
  const ws     = wb.Sheets[wb.SheetNames[0]];
  const raw    = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

  return raw.map((r) => {
    // Support column names as they appear in the Jubelio export
    const noResi = String(r["No. Pesanan/Resi"] ?? r["No Pesanan"] ?? r["Resi"] ?? "").trim();
    const expDate = formatDate(r["Exp. Date"] ?? r["Exp Date"] ?? "");
    const createdDate = formatDate(r["Created Date"] ?? r["Tanggal"] ?? "");

    return {
      noResi,
      barcode:     String(r["Barcode Scan"] ?? r["Barcode"] ?? "").trim(),
      noItem:      String(r["No. Item"] ?? r["No Item"] ?? "").trim(),
      sku:         String(r["SKU"] ?? "").trim(),
      qty:         String(r["Qty"] ?? r["Quantity"] ?? "").trim(),
      kondisi:     String(r["Kondisi"] ?? "").trim(),
      batch:       String(r["Batch"] ?? "").trim(),
      expDate,
      createdBy:   String(r["Created By"] ?? "").trim(),
      createdDate,
    };
  }).filter((r) => r.noResi); // skip rows without resi
}

function formatDate(val: unknown): string {
  if (!val) return "";
  if (val instanceof Date) return val.toISOString().slice(0, 19).replace("T", " ");
  const d = new Date(String(val));
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 19).replace("T", " ");
  return String(val);
}

// ─── Editable fields config ───────────────────────────────────────────────────

const EDIT_FIELDS: { key: keyof SheetRow; label: string; mono?: boolean }[] = [
  { key: "noResi",      label: "No. Pesanan/Resi", mono: true },
  { key: "barcode",     label: "Barcode",           mono: true },
  { key: "noItem",      label: "No. Item" },
  { key: "sku",         label: "SKU",               mono: true },
  { key: "qty",         label: "Qty" },
  { key: "kondisi",     label: "Kondisi" },
  { key: "batch",       label: "Batch",             mono: true },
  { key: "expDate",     label: "Exp. Date" },
  { key: "createdBy",   label: "Created By" },
  { key: "createdDate", label: "Created Date" },
  { key: "expedisi",    label: "Expedisi" },
];

const EXP_COLORS: Record<string, string> = {
  JX:      "bg-sky-100 text-sky-800",
  SPXID:   "bg-orange-100 text-orange-800",
  GTL:     "bg-emerald-100 text-emerald-800",
  TKP:     "bg-green-100 text-green-800",
  JNE:     "bg-red-100 text-red-800",
  SICEPAT: "bg-purple-100 text-purple-800",
  ALL:     "bg-slate-100 text-slate-700",
};

function expColor(code: string) {
  return EXP_COLORS[code] ?? "bg-indigo-100 text-indigo-800";
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ClaimPage() {
  const { appUser } = useAuth();
  const isAdmin = appUser?.role === "admin";

  const [tab, setTab]                   = useState<TabSection>("upload");
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [savingId, setSavingId]         = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Load claim spreadsheet ID from settings
  useEffect(() => {
    getSettings().then((s) => {
      setSpreadsheetId(s.claimSpreadsheetId ?? "");
      setSettingsLoaded(true);
    });
  }, []);

  const handleSaveId = async () => {
    if (!appUser) return;
    setSavingId(true);
    await saveSettings({ claimSpreadsheetId: spreadsheetId.trim() }, appUser.uid);
    setSavingId(false);
  };

  if (!isAdmin) {
    return (
      <div className="card p-16 text-center">
        <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-300" />
        <p className="font-semibold text-slate-600">Akses ditolak. Halaman ini khusus Admin.</p>
      </div>
    );
  }

  return (
    <div className="max-w-full mx-auto space-y-5">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Package className="w-6 h-6 text-green-600" /> Kelola Claim
        </h1>
        <p className="text-slate-500 mt-1">Import data retur dari Jubelio, distribusi otomatis ke Google Sheets per expedisi</p>
      </div>

      {/* Spreadsheet ID setup */}
      {settingsLoaded && (
        <div className="card p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[280px]">
              <label className="text-xs text-slate-500 mb-1 block flex items-center gap-1">
                <Settings2 className="w-3 h-3" /> Claim Google Sheets ID
              </label>
              <input
                type="text"
                value={spreadsheetId}
                onChange={(e) => setSpreadsheetId(e.target.value)}
                placeholder="Paste Spreadsheet ID di sini (dari URL Google Sheets)"
                className="input-field w-full font-mono text-xs"
              />
            </div>
            <button
              onClick={handleSaveId}
              disabled={savingId || !spreadsheetId.trim()}
              className="btn-primary"
            >
              {savingId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Simpan
            </button>
          </div>
          {!spreadsheetId && (
            <p className="text-xs text-amber-600 mt-2">
              ⚠ Belum ada Spreadsheet ID. Buat Google Sheet baru, lalu salin ID dari URL-nya dan simpan di sini.
            </p>
          )}
        </div>
      )}

      {/* Tab switcher */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {(["upload", "edit"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-5 py-2 rounded-lg text-sm font-medium transition-all",
              tab === t
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            )}
          >
            {t === "upload" ? (
              <span className="flex items-center gap-1.5"><Upload className="w-4 h-4" />Upload Data</span>
            ) : (
              <span className="flex items-center gap-1.5"><Database className="w-4 h-4" />Edit Data</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "upload" ? (
        <UploadTab spreadsheetId={spreadsheetId} />
      ) : (
        <EditTab spreadsheetId={spreadsheetId} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPLOAD TAB
// ═══════════════════════════════════════════════════════════════════════════════

function UploadTab({ spreadsheetId }: { spreadsheetId: string }) {
  const [file, setFile]             = useState<File | null>(null);
  const [preview, setPreview]       = useState<ParsedRow[]>([]);
  const [parsing, setParsing]       = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [result, setResult]         = useState<{
    added: number; skipped: number; expedisiSummary: Record<string, number>; total: number
  } | null>(null);
  const [error, setError]           = useState("");
  const [allRows, setAllRows]       = useState<ParsedRow[]>([]);
  const fileInputRef                = useRef<HTMLInputElement>(null);

  const handleFile = async (f: File) => {
    if (!f) return;
    setFile(f);
    setResult(null);
    setError("");
    setParsing(true);
    try {
      const rows = await parseExcel(f);
      setAllRows(rows);
      setPreview(rows.slice(0, 10));
    } catch (err) {
      setError("Gagal membaca file: " + String(err));
    } finally {
      setParsing(false);
    }
  };

  const handleUpload = async () => {
    if (!spreadsheetId) { setError("Spreadsheet ID belum dikonfigurasi."); return; }
    if (allRows.length === 0) return;
    setUploading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/claim/upload", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ spreadsheetId, rows: allRows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload gagal");
      setResult(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Drop zone */}
      <div
        className={cn(
          "card p-8 border-2 border-dashed text-center transition-all cursor-pointer",
          file ? "border-green-400 bg-green-50/40" : "border-slate-200 hover:border-green-300 hover:bg-slate-50"
        )}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        {parsing ? (
          <Loader2 className="w-10 h-10 mx-auto mb-3 text-green-500 animate-spin" />
        ) : file ? (
          <FileSpreadsheet className="w-10 h-10 mx-auto mb-3 text-green-600" />
        ) : (
          <Upload className="w-10 h-10 mx-auto mb-3 text-slate-300" />
        )}
        {file ? (
          <>
            <p className="font-semibold text-slate-700">{file.name}</p>
            <p className="text-sm text-slate-400 mt-1">{allRows.length} baris ditemukan · klik untuk ganti file</p>
          </>
        ) : (
          <>
            <p className="font-semibold text-slate-600">Klik atau drag file Excel di sini</p>
            <p className="text-sm text-slate-400 mt-1">Format: .xlsx atau .xls dari Jubelio</p>
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-3 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError("")}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="font-semibold text-green-800 flex items-center gap-2">
            <Check className="w-5 h-5" /> Upload selesai
          </p>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div className="bg-white rounded-xl p-3 border border-green-100">
              <p className="text-2xl font-bold text-green-600">{result.added}</p>
              <p className="text-xs text-slate-500 mt-0.5">Baris ditambahkan</p>
            </div>
            <div className="bg-white rounded-xl p-3 border border-slate-100">
              <p className="text-2xl font-bold text-slate-400">{result.skipped}</p>
              <p className="text-xs text-slate-500 mt-0.5">Sudah ada (dilewati)</p>
            </div>
            <div className="bg-white rounded-xl p-3 border border-slate-100">
              <p className="text-2xl font-bold text-slate-600">{result.total}</p>
              <p className="text-xs text-slate-500 mt-0.5">Total baris Excel</p>
            </div>
          </div>
          {Object.keys(result.expedisiSummary).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(result.expedisiSummary)
                .sort((a, b) => b[1] - a[1])
                .map(([code, cnt]) => (
                  <span key={code} className={cn("px-2.5 py-1 rounded-full text-xs font-medium", expColor(code))}>
                    {code}: {cnt} baris
                  </span>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Preview table */}
      {preview.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <p className="font-semibold text-slate-700 text-sm">
              Preview data ({allRows.length} baris total, menampilkan 10 pertama)
            </p>
            <button
              onClick={handleUpload}
              disabled={uploading || !spreadsheetId}
              className="btn-primary"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? "Memproses..." : `Proses & Simpan (${allRows.length} baris)`}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="px-3 py-2 text-left whitespace-nowrap">No. Pesanan/Resi</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">SKU</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">Qty</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Kondisi</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Batch</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Exp. Date</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Created By</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Created Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.map((r, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                    <td className="px-3 py-2 font-mono font-semibold text-slate-800 whitespace-nowrap">{r.noResi}</td>
                    <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">{r.sku}</td>
                    <td className="px-3 py-2 text-center text-slate-600">{r.qty}</td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.kondisi}</td>
                    <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap">{r.batch}</td>
                    <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{r.expDate?.slice(0, 10)}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.createdBy}</td>
                    <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{r.createdDate?.slice(0, 16)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {allRows.length > 10 && (
            <div className="px-4 py-2 text-xs text-slate-400 border-t border-slate-100 bg-slate-50">
              + {allRows.length - 10} baris lainnya tidak ditampilkan
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EDIT TAB
// ═══════════════════════════════════════════════════════════════════════════════

function EditTab({ spreadsheetId }: { spreadsheetId: string }) {
  const [tabs, setTabs]           = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("ALL");
  const [sortDir, setSortDir]     = useState<SortDir>("desc");
  const [search, setSearch]       = useState("");
  const [loading, setLoading]     = useState(false);
  const [rows, setRows]           = useState<SheetRow[]>([]);
  const [error, setError]         = useState("");

  // Inline edit
  const [editCell, setEditCell]   = useState<{ idx: number; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState("");

  // Delete
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [deleting, setDeleting]           = useState<number | null>(null);
  const [deleteError, setDeleteError]     = useState("");

  // Load tab list
  useEffect(() => {
    if (!spreadsheetId) return;
    fetch(`/api/claim/tabs?spreadsheetId=${encodeURIComponent(spreadsheetId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.tabs) {
          setTabs(d.tabs);
          if (!d.tabs.includes(activeTab)) setActiveTab(d.tabs[0] ?? "ALL");
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spreadsheetId]);

  const fetchRows = useCallback(async () => {
    if (!spreadsheetId) return;
    setLoading(true);
    setError("");
    setEditCell(null);
    setDeleteConfirm(null);
    try {
      const params = new URLSearchParams({
        spreadsheetId,
        tab:     activeTab,
        sortDir,
        search,
      });
      const res  = await fetch(`/api/claim/read?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal fetch");
      setRows(data.rows ?? []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [spreadsheetId, activeTab, sortDir, search]);

  // Auto-fetch when tab / sort changes
  useEffect(() => {
    if (spreadsheetId && activeTab) fetchRows();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, sortDir, spreadsheetId]);

  // ── Inline edit helpers ─────────────────────────────────────────────────
  const startEdit = (idx: number, field: string, val: string) => {
    setSaveError("");
    setDeleteConfirm(null);
    setEditCell({ idx, field });
    setEditValue(val);
  };
  const cancelEdit = () => { setEditCell(null); setEditValue(""); setSaveError(""); };

  const saveEdit = async () => {
    if (!editCell || !spreadsheetId) return;
    const row = rows[editCell.idx];
    if (!row) return;
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/claim/update-row", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          spreadsheetId,
          tab:      activeTab,
          gsheetRow: row.gsheetRow,
          field:    editCell.field,
          value:    editValue.trim(),
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setRows((prev) =>
        prev.map((r, i) =>
          i === editCell.idx ? { ...r, [editCell.field]: editValue.trim() } : r
        )
      );
      setEditCell(null);
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  };

  // ── Delete helpers ──────────────────────────────────────────────────────
  const handleDelete = async (idx: number) => {
    const row = rows[idx];
    if (!row || !spreadsheetId) return;
    setDeleting(idx);
    setDeleteError("");
    try {
      const res = await fetch("/api/claim/delete-row", {
        method:  "DELETE",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ spreadsheetId, tab: activeTab, gsheetRow: row.gsheetRow }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setRows((prev) =>
        prev
          .filter((_, i) => i !== idx)
          .map((r, i) => ({ ...r, no: String(i + 1) }))
      );
      setDeleteConfirm(null);
    } catch (err) {
      setDeleteError(String(err));
    } finally {
      setDeleting(null);
    }
  };

  // ── Derived ──────────────────────────────────────────────────────────────
  const expStats = useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach((r) => { m[r.expedisi] = (m[r.expedisi] ?? 0) + 1; });
    return m;
  }, [rows]);

  if (!spreadsheetId) {
    return (
      <div className="card p-12 text-center">
        <Settings2 className="w-12 h-12 mx-auto mb-4 text-slate-200" />
        <p className="font-semibold text-slate-500">Konfigurasi Spreadsheet ID terlebih dahulu</p>
        <p className="text-sm text-slate-400 mt-1">Isi ID di atas lalu klik Simpan</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="card p-4 space-y-3">
        {/* Expedisi tabs */}
        {tabs.length > 0 && (
          <div>
            <p className="text-xs text-slate-500 mb-2">Pilih Expedisi / Tab</p>
            <div className="flex flex-wrap gap-1.5">
              {tabs.map((t) => (
                <button
                  key={t}
                  onClick={() => setActiveTab(t)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all",
                    activeTab === t
                      ? cn("border-transparent", expColor(t))
                      : "border-slate-200 text-slate-500 hover:bg-slate-50"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Search + Sort + Refresh */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fetchRows()}
              placeholder="Cari resi, SKU, kondisi..."
              className="input-field pl-9 w-full"
            />
            {search && (
              <button onClick={() => { setSearch(""); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            onClick={() => setSortDir((d) => d === "desc" ? "asc" : "desc")}
            className="btn-secondary flex items-center gap-1.5"
            title="Toggle urutan tanggal"
          >
            <ArrowUpDown className="w-4 h-4" />
            {sortDir === "desc" ? "Terbaru dulu" : "Terlama dulu"}
          </button>

          <button onClick={fetchRows} disabled={loading} className="btn-secondary">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>

          <button onClick={fetchRows} disabled={loading} className="btn-primary">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Tampilkan
          </button>
        </div>
      </div>

      {/* Error banners */}
      {[{ msg: error, clear: () => setError("") }, { msg: saveError, clear: () => setSaveError("") }, { msg: deleteError, clear: () => setDeleteError("") }]
        .filter((e) => e.msg)
        .map((e, i) => (
          <div key={i} className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-3 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">{e.msg}</span>
            <button onClick={e.clear}><X className="w-4 h-4" /></button>
          </div>
        ))}

      {/* Summary chips */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">{rows.length} baris</span>
          {Object.entries(expStats).sort((a, b) => b[1] - a[1]).map(([code, cnt]) => (
            <span key={code} className={cn("px-2.5 py-0.5 rounded-full text-xs font-medium", expColor(code))}>
              {code}: {cnt}
            </span>
          ))}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="card flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-green-600" />
          <p className="text-sm text-slate-400">Mengambil data dari Google Sheets...</p>
        </div>
      ) : rows.length > 0 ? (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs whitespace-nowrap">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="px-3 py-3 text-center w-10 sticky left-0 bg-slate-800 z-10">No.</th>
                  {activeTab === "ALL" && <th className="px-3 py-3 text-center w-20">Expedisi</th>}
                  <th className="px-3 py-3 text-left min-w-[160px]">No. Pesanan/Resi</th>
                  <th className="px-3 py-3 text-left min-w-[180px]">SKU</th>
                  <th className="px-3 py-3 text-center w-12">Qty</th>
                  <th className="px-3 py-3 text-left w-28">Kondisi</th>
                  <th className="px-3 py-3 text-left w-28">Batch</th>
                  <th className="px-3 py-3 text-center w-24">Exp. Date</th>
                  <th className="px-3 py-3 text-left w-32">Created By</th>
                  <th className="px-3 py-3 text-center w-36">
                    <button onClick={() => setSortDir((d) => d === "desc" ? "asc" : "desc")} className="flex items-center gap-1 mx-auto hover:text-green-300">
                      Created Date {sortDir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                    </button>
                  </th>
                  <th className="px-2 py-3 w-16 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, idx) => {
                  const isDelConfirm = deleteConfirm === idx;
                  const isDeleting   = deleting === idx;

                  return (
                    <tr
                      key={`${row.gsheetRow}-${idx}`}
                      className={cn(
                        "transition-colors",
                        isDelConfirm ? "bg-red-50" : idx % 2 === 0 ? "bg-white" : "bg-slate-50/50",
                        "hover:bg-green-50/30"
                      )}
                    >
                      <td className="px-3 py-2 text-center text-slate-400 sticky left-0 bg-inherit z-10">{row.no || idx + 1}</td>

                      {activeTab === "ALL" && (
                        <td className="px-3 py-2 text-center">
                          <span className={cn("px-2 py-0.5 rounded text-xs font-semibold", expColor(row.expedisi))}>
                            {row.expedisi}
                          </span>
                        </td>
                      )}

                      {/* Editable cells */}
                      {(["noResi", "sku", "qty", "kondisi", "batch", "expDate", "createdBy", "createdDate"] as (keyof SheetRow)[]).map((field) => {
                        const isEditing = editCell?.idx === idx && editCell?.field === field;
                        const isMono    = ["noResi", "sku", "batch"].includes(field);
                        const isCenter  = ["qty", "expDate", "createdDate"].includes(field);

                        return (
                          <td key={field} className={cn("px-3 py-2", isCenter && "text-center")}>
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <input
                                  autoFocus
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") { e.preventDefault(); saveEdit(); }
                                    if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                                  }}
                                  className="border border-green-400 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-400 w-32 font-mono"
                                />
                                <button onClick={saveEdit} disabled={saving} className="p-1 text-green-600 hover:bg-green-50 rounded">
                                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                </button>
                                <button onClick={cancelEdit} className="p-1 text-slate-400 hover:bg-slate-100 rounded">
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <span
                                className={cn(
                                  "cursor-pointer hover:text-green-700",
                                  isMono    && "font-mono font-semibold text-slate-800",
                                  !isMono   && "text-slate-600",
                                  field === "noResi" && "text-slate-900"
                                )}
                                onDoubleClick={() => startEdit(idx, field, String(row[field]))}
                                title="Double-click untuk edit"
                              >
                                {field === "expDate" || field === "createdDate"
                                  ? String(row[field]).slice(0, 10)
                                  : String(row[field])}
                              </span>
                            )}
                          </td>
                        );
                      })}

                      {/* Action: edit + delete */}
                      <td className="px-2 py-2 text-center">
                        {isDelConfirm ? (
                          <div className="flex items-center justify-center gap-0.5">
                            <span className="text-xs text-red-600 mr-0.5">Hapus?</span>
                            <button
                              onClick={() => handleDelete(idx)}
                              disabled={isDeleting}
                              className="p-1 rounded text-red-600 hover:bg-red-100 transition-colors disabled:opacity-50"
                            >
                              {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="p-1 rounded text-slate-400 hover:bg-slate-100"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-0.5">
                            <button
                              onClick={() => startEdit(idx, "noResi", row.noResi)}
                              className="p-1.5 rounded text-slate-300 hover:text-green-600 hover:bg-green-50 transition-colors"
                              title="Edit baris"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => { setDeleteConfirm(idx); setEditCell(null); }}
                              className="p-1.5 rounded text-slate-300 hover:text-red-600 hover:bg-red-50 transition-colors"
                              title="Hapus baris dari Google Sheets"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50 flex justify-between items-center text-xs text-slate-400">
            <span>{rows.length} baris ditampilkan — tab: <strong>{activeTab}</strong></span>
            <span>Double-click sel untuk edit · 🗑 untuk hapus dari Google Sheets</span>
          </div>
        </div>
      ) : !loading ? (
        <div className="card p-16 text-center">
          <FileSpreadsheet className="w-12 h-12 mx-auto mb-4 text-slate-200" />
          <p className="font-semibold text-slate-500">
            {tabs.length === 0 ? "Belum ada data — upload Excel terlebih dahulu" : "Klik Tampilkan untuk muat data"}
          </p>
        </div>
      ) : null}
    </div>
  );
}
