"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  getKarung,
  lockKarung,
  getSettings,
  isKarungLocked,
  getKarungHistory,
  getExpedisiById,
} from "@/lib/firestore";
import { todayString, formatDate, sheetTabName } from "@/lib/utils";
import type { Karung, CompanySettings } from "@/types";
import {
  Printer,
  ArrowLeft,
  Loader2,
  Lock,
  Package,
  FileText,
  CheckSquare,
  Square,
  Truck,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

const ROWS_PER_PAGE = 30;

export default function PrintPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center items-center min-h-[300px]">
        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
      </div>
    }>
      <PrintPageInner />
    </Suspense>
  );
}

interface ExpedisiGroup {
  expedisiId: string;
  expedisiName: string;
  karungList: Karung[];
}

// ─── Main component ──────────────────────────────────────────────────────────

function PrintPageInner() {
  const { appUser } = useAuth();
  const params = useSearchParams();
  const router = useRouter();

  const karungIdSingle = params.get("karungId");
  const karungIdsParam = params.get("karungIds");
  const activeIds: string[] = karungIdsParam
    ? karungIdsParam.split(",").filter(Boolean)
    : karungIdSingle
    ? [karungIdSingle]
    : [];

  const today = todayString();

  // ── Print view state ──────────────────────────────────────────────────────
  const [karungList, setKarungList]     = useState<Karung[]>([]);
  const [sheetRows, setSheetRows]       = useState<string[][]>([]);
  const [sheetError, setSheetError]     = useState("");
  const [sheetName, setSheetName]       = useState("");
  const [settings, setSettings]         = useState<CompanySettings | null>(null);
  const [loading, setLoading]           = useState(false);
  const [printing, setPrinting]         = useState(false);
  const [locking, setLocking]           = useState(false);

  // ── Selector state ────────────────────────────────────────────────────────
  const [selectorDate, setSelectorDate]     = useState(today);
  const [expedisiGroups, setExpedisiGroups] = useState<ExpedisiGroup[]>([]);
  const [selectorLoading, setSelectorLoading] = useState(false);
  const [selectedIds, setSelectedIds]       = useState<Set<string>>(new Set());
  const [activeExpedisi, setActiveExpedisi] = useState<string | null>(null);

  // ── Load settings ─────────────────────────────────────────────────────────
  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  // ── Load data for print view ──────────────────────────────────────────────
  useEffect(() => {
    if (activeIds.length === 0) return;
    setLoading(true);
    setSheetError("");
    setSheetRows([]);

    const run = async () => {
      // 1. Load karung docs from Firestore (metadata + lock status)
      const karungDocs = await Promise.all(activeIds.map((id) => getKarung(id)));
      const karung = karungDocs.filter(Boolean) as Karung[];
      setKarungList(karung);

      if (karung.length === 0) { setLoading(false); return; }

      // 2. Load settings for spreadsheetId + company info
      const cfg = await getSettings();
      setSettings(cfg);
      const spreadsheetId = cfg?.spreadsheetId;
      if (!spreadsheetId) {
        setSheetError("Spreadsheet ID belum dikonfigurasi. Buka menu Settings → isi Spreadsheet ID.");
        setLoading(false);
        return;
      }

      // 3. Get expedisi code (for sheet tab name)
      const expedisi = await getExpedisiById(karung[0].expedisiId);
      const expedisiCode =
        expedisi?.code ??
        karung[0].expedisiName.toUpperCase().replace(/\s+/g, "_").slice(0, 20);

      // 4. Fetch scan rows from G-Sheet
      const date = karung[0].date;
      const karungNomors = karung.map((k) => k.nomorKarung).join(",");
      const url = `/api/gsheet/read?spreadsheetId=${encodeURIComponent(spreadsheetId)}&expedisiCode=${encodeURIComponent(expedisiCode)}&date=${date}&karungNomors=${encodeURIComponent(karungNomors)}`;

      const res = await fetch(url);
      const data = await res.json();

      if (data.notFound) {
        const expectedTab = sheetTabName(expedisiCode, date);
        setSheetError(`Sheet tab "${expectedTab}" tidak ditemukan. Pastikan sudah ada scan yang tersinkron ke Google Sheets.`);
      } else if (data.error) {
        setSheetError(data.error);
      } else {
        setSheetRows(data.rows ?? []);
        setSheetName(data.sheetName ?? "");
      }

      setLoading(false);
    };

    run().catch((err) => {
      setSheetError(String(err));
      setLoading(false);
    });
  }, [karungIdsParam, karungIdSingle]); // eslint-disable-line

  // ── Load selector karung list ─────────────────────────────────────────────
  useEffect(() => {
    if (activeIds.length > 0) return;
    loadSelectorKarung(today);
  }, []); // eslint-disable-line

  const loadSelectorKarung = async (date: string) => {
    setSelectorLoading(true);
    setSelectedIds(new Set());
    setActiveExpedisi(null);
    const list = await getKarungHistory(date, date);
    const groups: Record<string, ExpedisiGroup> = {};
    for (const k of list) {
      if (!groups[k.expedisiId]) {
        groups[k.expedisiId] = {
          expedisiId: k.expedisiId,
          expedisiName: k.expedisiName,
          karungList: [],
        };
      }
      groups[k.expedisiId].karungList.push(k);
    }
    setExpedisiGroups(
      Object.values(groups).sort((a, b) =>
        a.expedisiName.localeCompare(b.expedisiName, "id")
      )
    );
    setSelectorLoading(false);
  };

  // ── Checkbox — single expedisi only ──────────────────────────────────────
  const toggleKarung = (karung: Karung) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(karung.id)) {
      newSet.delete(karung.id);
      if (newSet.size === 0) setActiveExpedisi(null);
    } else {
      if (activeExpedisi && activeExpedisi !== karung.expedisiId) newSet.clear();
      newSet.add(karung.id);
      setActiveExpedisi(karung.expedisiId);
    }
    setSelectedIds(newSet);
  };

  const toggleAllInExpedisi = (group: ExpedisiGroup) => {
    const allSelected = group.karungList.every((k) => selectedIds.has(k.id));
    const newSet = new Set(selectedIds);
    if (allSelected) {
      group.karungList.forEach((k) => newSet.delete(k.id));
      if (newSet.size === 0) setActiveExpedisi(null);
    } else {
      if (activeExpedisi && activeExpedisi !== group.expedisiId) newSet.clear();
      group.karungList.forEach((k) => newSet.add(k.id));
      setActiveExpedisi(group.expedisiId);
    }
    setSelectedIds(newSet);
  };

  const handlePrintSelected = () => {
    if (selectedIds.size === 0) return;
    router.push(`/print?karungIds=${Array.from(selectedIds).join(",")}`);
  };

  // ── Print — lock all unlocked karung ─────────────────────────────────────
  const handlePrint = async () => {
    if (!appUser || karungList.length === 0) return;
    const unlocked = karungList.filter((k) => !isKarungLocked(k));
    if (unlocked.length > 0) {
      setLocking(true);
      await Promise.all(
        unlocked.map((k) => lockKarung(k.id, appUser.uid, appUser.name))
      );
      setKarungList((prev) =>
        prev.map((k) =>
          unlocked.some((u) => u.id === k.id) ? { ...k, status: "locked" } : k
        )
      );
      setLocking(false);
    }
    setPrinting(true);
    setTimeout(() => { window.print(); setPrinting(false); }, 300);
  };

  // ── Derived print vars ────────────────────────────────────────────────────
  const expedisiName     = karungList[0]?.expedisiName ?? "";
  const karungNomors     = karungList.map((k) => `#${k.nomorKarung}`).join(", ");
  const printDate        = karungList[0]?.date ?? today;
  const namaPerusahaan   = settings?.namaPerusahaan || "PT. IEG";
  const noteTandaTerima  = settings?.noteTandaTerima ||
    "Seluruh karung yang diserahkan sudah di scan dan disaksikan oleh pihak yang menyerahkan barang. tanda terima ini menjadi bukti yang sah, untuk tanda terima barang dari expedisi ke PT. IEG";
  const anyLocked        = karungList.some((k) => isKarungLocked(k));

  const totalPages  = Math.max(1, Math.ceil(sheetRows.length / ROWS_PER_PAGE));
  const pages       = Array.from({ length: totalPages }, (_, i) =>
    sheetRows.slice(i * ROWS_PER_PAGE, (i + 1) * ROWS_PER_PAGE)
  );

  // ════════════════════════════════════════════════════════════════════════════
  // SELECTOR VIEW
  // ════════════════════════════════════════════════════════════════════════════
  if (activeIds.length === 0) {
    return (
      <div className="max-w-2xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Printer className="w-6 h-6 text-green-600" /> Print Tanda Terima
          </h1>
          <p className="text-slate-500 mt-1">
            Pilih karung per expedisi — bisa pilih beberapa sekaligus
          </p>
        </div>

        <div className="card p-4">
          <label className="text-xs text-slate-500 mb-1 block">Tanggal</label>
          <input
            type="date"
            value={selectorDate}
            onChange={(e) => { setSelectorDate(e.target.value); loadSelectorKarung(e.target.value); }}
            className="input-field max-w-xs"
          />
        </div>

        {selectedIds.size > 0 && (
          <div className="sticky top-4 z-20 bg-green-600 text-white rounded-2xl px-5 py-3 flex items-center justify-between shadow-lg shadow-green-200">
            <span className="text-sm font-medium">
              {selectedIds.size} karung dipilih ·{" "}
              {expedisiGroups.find((g) => g.expedisiId === activeExpedisi)?.expedisiName}
            </span>
            <button
              onClick={handlePrintSelected}
              className="bg-white text-green-700 font-semibold text-sm px-4 py-1.5 rounded-xl flex items-center gap-2 hover:bg-green-50 transition-colors"
            >
              <Printer className="w-4 h-4" /> Print Gabungan
            </button>
          </div>
        )}

        {selectorLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-green-600" />
          </div>
        ) : expedisiGroups.length === 0 ? (
          <div className="card p-8 text-center text-slate-400">
            <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Tidak ada karung untuk tanggal ini</p>
          </div>
        ) : (
          <div className="space-y-4">
            {expedisiGroups.map((group) => {
              const allSel = group.karungList.every((k) => selectedIds.has(k.id));
              const someSel = group.karungList.some((k) => selectedIds.has(k.id));
              const isDisabled = activeExpedisi !== null && activeExpedisi !== group.expedisiId;

              return (
                <div key={group.expedisiId} className={`card overflow-hidden transition-all ${isDisabled ? "opacity-40" : ""}`}>
                  <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
                    <div className="flex items-center gap-2.5">
                      <Truck className="w-4 h-4 text-slate-500" />
                      <span className="font-semibold text-slate-800">{group.expedisiName}</span>
                      <span className="badge-info text-xs">{group.karungList.length} karung</span>
                    </div>
                    {!isDisabled && (
                      <button
                        onClick={() => toggleAllInExpedisi(group)}
                        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-green-700 transition-colors"
                      >
                        {allSel
                          ? <CheckSquare className="w-4 h-4 text-green-600" />
                          : <Square className="w-4 h-4" />
                        }
                        {allSel ? "Batalkan semua" : "Pilih semua"}
                      </button>
                    )}
                  </div>

                  <div className="divide-y divide-slate-100">
                    {group.karungList.map((k) => {
                      const checked = selectedIds.has(k.id);
                      return (
                        <label
                          key={k.id}
                          className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors select-none
                            ${isDisabled ? "cursor-not-allowed" : "hover:bg-slate-50"}
                            ${checked ? "bg-green-50" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isDisabled}
                            onChange={() => !isDisabled && toggleKarung(k)}
                            className="sr-only"
                          />
                          <div className={`w-5 h-5 flex-shrink-0 rounded flex items-center justify-center border-2 transition-colors
                            ${checked ? "bg-green-600 border-green-600" : "border-slate-300"}`}>
                            {checked && (
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                          <div className="flex-1">
                            <p className="font-medium text-slate-800 text-sm">Karung #{k.nomorKarung}</p>
                            <p className="text-xs text-slate-400">{k.totalResi} resi</p>
                          </div>
                          {isKarungLocked(k) && (
                            <span className="badge-warning flex items-center gap-1 text-xs">
                              <Lock className="w-3 h-3" /> Terkunci
                            </span>
                          )}
                          <button
                            onClick={(e) => { e.preventDefault(); router.push(`/print?karungId=${k.id}`); }}
                            className="btn-ghost px-2.5 py-1.5 text-xs text-slate-400 hover:text-green-700"
                            title="Print karung ini saja"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                        </label>
                      );
                    })}
                  </div>

                  {someSel && (
                    <div className="px-4 py-3 bg-green-50 border-t border-green-100">
                      <button onClick={handlePrintSelected} className="btn-primary w-full text-sm">
                        <Printer className="w-4 h-4" />
                        Print Gabungan {selectedIds.size} Karung ({group.expedisiName})
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PRINT VIEW
  // ════════════════════════════════════════════════════════════════════════════

  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center min-h-[300px] gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
        <p className="text-sm text-slate-400">Mengambil data dari Google Sheets...</p>
      </div>
    );
  }

  if (karungList.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>Karung tidak ditemukan</p>
        <button onClick={() => router.push("/print")} className="btn-secondary mt-4">Kembali</button>
      </div>
    );
  }

  return (
    <>
      {/* Action bar */}
      <div className="no-print max-w-5xl mx-auto mb-6 flex flex-wrap gap-3 items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/print")} className="btn-ghost">
            <ArrowLeft className="w-4 h-4" /> Kembali
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Preview Tanda Terima</h1>
            <p className="text-sm text-slate-500">
              {expedisiName} · Karung {karungNomors} · {sheetRows.length} resi
              {sheetName && <span className="ml-2 text-slate-400">(Sheet: {sheetName})</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {anyLocked && (
            <span className="badge-warning flex items-center gap-1">
              <Lock className="w-3 h-3" /> Ada karung terkunci
            </span>
          )}
          <button
            onClick={handlePrint}
            disabled={printing || locking || !!sheetError}
            className="btn-primary"
          >
            {printing || locking
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Printer className="w-4 h-4" />
            }
            {locking ? "Mengunci karung..." : "Print Tanda Terima"}
          </button>
        </div>
      </div>

      {/* G-Sheet error */}
      {sheetError && (
        <div className="no-print max-w-5xl mx-auto mb-6 bg-red-50 border border-red-200 rounded-xl px-5 py-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-red-700 text-sm">Gagal memuat data dari Google Sheets</p>
            <p className="text-red-600 text-xs mt-1">{sheetError}</p>
          </div>
          <button
            onClick={() => { setSheetError(""); setLoading(true); router.refresh(); }}
            className="btn-ghost text-xs text-red-600"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Coba lagi
          </button>
        </div>
      )}

      {/* Print pages */}
      {!sheetError && (
        <div className="print-container max-w-4xl mx-auto space-y-6">
          {pages.map((pageRows, pageIndex) => (
            <div
              key={pageIndex}
              className={`bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden print:border-none print:rounded-none print:shadow-none ${
                pageIndex > 0 ? "print:break-before-page" : ""
              }`}
            >
              <div style={{ padding: "32px 36px", fontFamily: "Arial, sans-serif" }}>

                {/* ── Document Header ── */}
                {pageIndex === 0 ? (
                  <>
                    {/* Top bar: company left, document type right */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
                      <div>
                        <div style={{ fontSize: "18px", fontWeight: "700", color: "#0f172a", letterSpacing: "-0.3px" }}>
                          {namaPerusahaan}
                        </div>
                        <div style={{ fontSize: "10px", color: "#64748b", marginTop: "2px" }}>
                          Sistem Manajemen Retur Barang
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                          TANDA TERIMA
                        </div>
                        <div style={{ fontSize: "10px", color: "#64748b", marginTop: "2px" }}>
                          Barang Retur dari Ekspedisi
                        </div>
                      </div>
                    </div>

                    {/* Divider */}
                    <div style={{ height: "3px", background: "linear-gradient(to right, #0f172a, #334155)", borderRadius: "2px", margin: "12px 0 16px" }} />

                    {/* Info grid */}
                    <div style={{
                      display: "grid", gridTemplateColumns: "1fr 1fr",
                      border: "1px solid #e2e8f0", borderRadius: "6px",
                      overflow: "hidden", marginBottom: "20px", fontSize: "12px",
                    }}>
                      {[
                        ["Ekspedisi", expedisiName],
                        ["Tanggal", formatDate(printDate)],
                        ["No. Karung", karungList.map((k) => k.nomorKarung).join(", ")],
                        ["Total Resi", `${sheetRows.length} item`],
                      ].map(([label, value], i) => (
                        <div key={i} style={{
                          padding: "8px 14px",
                          borderRight: i % 2 === 0 ? "1px solid #e2e8f0" : "none",
                          borderBottom: i < 2 ? "1px solid #e2e8f0" : "none",
                          backgroundColor: i % 2 === 0 ? "#f8fafc" : "#ffffff",
                        }}>
                          <span style={{ color: "#94a3b8", fontSize: "10px", display: "block", marginBottom: "2px" }}>{label}</span>
                          <span style={{ fontWeight: "600", color: "#0f172a" }}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  /* Continuation page — compact header */
                  <div style={{ marginBottom: "16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>
                        {namaPerusahaan} — TANDA TERIMA <span style={{ fontWeight: "400", color: "#64748b" }}>(Lanjutan)</span>
                      </div>
                      <div style={{ fontSize: "11px", color: "#64748b" }}>
                        {expedisiName} · {formatDate(printDate)} · Hal. {pageIndex + 1}/{totalPages}
                      </div>
                    </div>
                    <div style={{ height: "2px", background: "#e2e8f0", margin: "10px 0 16px" }} />
                  </div>
                )}

                {/* ── Table ── */}
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", marginBottom: "16px" }}>
                  <thead>
                    <tr style={{ backgroundColor: "#0f172a" }}>
                      {["No.", "Kode Resi", "No. Karung", "Di Scan Oleh", "Tanggal", "Jam"].map((h, i) => (
                        <th key={i} style={{
                          padding: "9px 10px",
                          color: "#ffffff",
                          fontWeight: "600",
                          fontSize: "11px",
                          border: "1px solid #1e293b",
                          textAlign: i === 0 || i >= 4 ? "center" : "left",
                          whiteSpace: "nowrap",
                          ...(i === 0 ? { width: "36px" } : {}),
                          ...(i === 2 ? { width: "80px" } : {}),
                          ...(i === 3 ? { width: "120px" } : {}),
                          ...(i === 4 ? { width: "90px" } : {}),
                          ...(i === 5 ? { width: "62px" } : {}),
                        }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row, i) => {
                      const globalNo = pageIndex * ROWS_PER_PAGE + i + 1;
                      const isEven = i % 2 === 0;
                      return (
                        <tr key={i} style={{ backgroundColor: isEven ? "#ffffff" : "#f8fafc" }}>
                          <td style={{ padding: "6px 10px", border: "1px solid #e2e8f0", textAlign: "center", color: "#94a3b8", fontSize: "10px" }}>{globalNo}</td>
                          <td style={{ padding: "6px 10px", border: "1px solid #e2e8f0", fontFamily: "monospace", fontWeight: "600", color: "#0f172a", fontSize: "11px" }}>{row[1]}</td>
                          <td style={{ padding: "6px 10px", border: "1px solid #e2e8f0", textAlign: "center", color: "#334155" }}>{row[2]}</td>
                          <td style={{ padding: "6px 10px", border: "1px solid #e2e8f0", color: "#334155" }}>{row[3]}</td>
                          <td style={{ padding: "6px 10px", border: "1px solid #e2e8f0", textAlign: "center", color: "#475569" }}>{row[4]}</td>
                          <td style={{ padding: "6px 10px", border: "1px solid #e2e8f0", textAlign: "center", color: "#475569" }}>{row[5]}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {/* Total row on last page */}
                  {pageIndex === totalPages - 1 && (
                    <tfoot>
                      <tr style={{ backgroundColor: "#f1f5f9" }}>
                        <td colSpan={6} style={{ padding: "7px 10px", border: "1px solid #e2e8f0", textAlign: "right", fontWeight: "700", fontSize: "11px", color: "#0f172a" }}>
                          Total Keseluruhan : {sheetRows.length} resi
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>

                {/* ── Footer — last page only ── */}
                {pageIndex === totalPages - 1 && (
                  <>
                    {/* Note */}
                    <div style={{
                      border: "1px solid #fcd34d",
                      borderLeft: "4px solid #f59e0b",
                      borderRadius: "4px",
                      padding: "10px 14px",
                      marginBottom: "28px",
                      backgroundColor: "#fffbeb",
                      fontSize: "10px",
                      color: "#78350f",
                      lineHeight: "1.5",
                    }}>
                      <span style={{ fontWeight: "700", color: "#92400e" }}>Keterangan : </span>
                      {noteTandaTerima}
                    </div>

                    {/* Signatures */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "60px" }}>
                      {[
                        { label: "Yang Menyerahkan,", sub: expedisiName },
                        { label: "Yang Menerima,",    sub: namaPerusahaan },
                      ].map((sig, i) => (
                        <div key={i} style={{ textAlign: "center" }}>
                          <div style={{ fontSize: "11px", fontWeight: "600", color: "#334155", marginBottom: "64px" }}>
                            {sig.label}
                          </div>
                          <div style={{ borderTop: "1.5px solid #94a3b8", paddingTop: "8px" }}>
                            <div style={{ fontSize: "10px", color: "#94a3b8" }}>(Nama &amp; Tanda Tangan)</div>
                            <div style={{ fontSize: "11px", fontWeight: "600", color: "#334155", marginTop: "3px" }}>{sig.sub}</div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Document footer */}
                    <div style={{
                      marginTop: "24px",
                      paddingTop: "10px",
                      borderTop: "1px solid #e2e8f0",
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "9px",
                      color: "#cbd5e1",
                    }}>
                      <span>Dokumen ini dicetak secara otomatis oleh sistem</span>
                      <span>{namaPerusahaan} · Dicetak: {new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })}</span>
                    </div>
                  </>
                )}

                {/* Page number (all pages) */}
                {totalPages > 1 && (
                  <div style={{ marginTop: "12px", textAlign: "right", fontSize: "9px", color: "#cbd5e1" }}>
                    Halaman {pageIndex + 1} dari {totalPages}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; margin: 0; padding: 0; }
          .print-container { max-width: 100% !important; margin: 0 !important; padding: 0 !important; }
          .print-container > div { box-shadow: none !important; border: none !important; border-radius: 0 !important; margin: 0 !important; }
          @page { margin: 1.2cm 1.5cm; size: A4 portrait; }
        }
      `}</style>
    </>
  );
}
