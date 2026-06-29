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

// ── Single-column constants (A4, margin 1.4cm 1.8cm 2cm, font 10px, row padding 3px) ──
const SC_ONLY   = 22; // 1 halaman: big header + rows + footer
const SC_FIRST  = 30; // halaman pertama multi-page: big header, tanpa footer
const SC_MIDDLE = 38; // halaman tengah: compact header, tanpa footer
const SC_LAST   = 22; // halaman terakhir: compact header + footer

// ── Two-column constants (rows PER COLUMN per physical page) ──
// Font 9px, padding 2px → ~14-15px per row. A4 usable height ~1017px.
// First page  (big header ~165px + table head ~18px) : (1017-183)/14.5 ≈ 58 → use 44
// Middle page (compact header ~45px + table head)    : (1017-63)/14.5  ≈ 66 → use 48
// Last page max = TC_MIDDLE per column (48 rows) + footer (~180px) = 939px < 993px → fits
const TC_FIRST  = 44; // rows per column, halaman pertama
const TC_MIDDLE = 48; // rows per column, halaman tengah (dan terakhir — verif: 48×14.5+footer=939px<993px)

// Threshold: pakai 1 kolom jika seluruh data muat di 1 halaman
const SC_THRESHOLD = SC_ONLY;

interface PageResult { pages: string[][][]; twoCol: boolean; }

/**
 * Bangun slice halaman dengan kapasitas maksimal.
 * - ≤ SC_THRESHOLD baris  → 1 kolom, 1 halaman
 * - > SC_THRESHOLD baris  → 2 kolom
 *
 * Prinsip: setiap halaman NON-TERAKHIR diisi penuh (TC_FIRST / TC_MIDDLE × 2).
 * Halaman terakhir mengambil sisa baris, berapa pun jumlahnya.
 * Tidak ada penggalan "middle page setengah kosong" karena sisa muat di last page.
 */
function buildPages(rows: string[][]): PageResult {
  if (rows.length === 0) return { pages: [[]], twoCol: false };

  // Cukup 1 halaman dengan 1 kolom
  if (rows.length <= SC_THRESHOLD) return { pages: [rows], twoCol: false };

  // Mode 2 kolom
  const FIRST  = TC_FIRST  * 2;
  const MIDDLE = TC_MIDDLE * 2;

  const pages: string[][][] = [];
  let pos = 0;

  while (pos < rows.length) {
    const isFirst  = pages.length === 0;
    const capacity = isFirst ? FIRST : MIDDLE;
    const remaining = rows.length - pos;

    if (remaining <= capacity) {
      // Sisa baris muat dalam 1 halaman → jadikan halaman terakhir
      pages.push(rows.slice(pos));
      break;
    }

    // Isi halaman ini sampai penuh, lanjut iterasi
    pages.push(rows.slice(pos, pos + capacity));
    pos += capacity;
  }

  return { pages, twoCol: true };
}

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
      const karung = (karungDocs.filter(Boolean) as Karung[]).sort((a, b) => {
        const na = parseInt(a.nomorKarung, 10);
        const nb = parseInt(b.nomorKarung, 10);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.nomorKarung.localeCompare(b.nomorKarung);
      });
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

  const { pages, twoCol } = buildPages(sheetRows);
  const totalPages = Math.max(1, pages.length);

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
              className={`bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden print:border-none print:rounded-none print:shadow-none print:overflow-visible ${
                pageIndex > 0 ? "print:break-before-page" : ""
              }`}
            style={pageIndex < totalPages - 1 ? { pageBreakAfter: "always", breakAfter: "page" } : {}}
            >
              <div style={{ padding: "20px 24px", fontFamily: "Arial, sans-serif" }}>

                {/* ── Document Header ── */}
                {pageIndex === 0 ? (
                  <>
                    {/* Top bar: logo left, document type right */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      {/* Logo — simpan file ke public/logo.png (atau public/logo.jpg) */}
                      <div style={{ display: "flex", alignItems: "center" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src="/logo.png"
                          onError={(e) => {
                            const img = e.currentTarget;
                            if (!img.src.endsWith("/logo.jpg")) img.src = "/logo.jpg";
                          }}
                          alt={namaPerusahaan}
                          style={{ height: "48px", maxWidth: "160px", objectFit: "contain" }}
                        />
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
                    <div style={{ height: "3px", background: "linear-gradient(to right, #0f172a, #334155)", borderRadius: "2px", margin: "8px 0 10px" }} />

                    {/* Info grid — compact */}
                    <div style={{
                      display: "grid", gridTemplateColumns: "1fr 1fr",
                      border: "1px solid #e2e8f0", borderRadius: "6px",
                      overflow: "hidden", marginBottom: "12px", fontSize: "11px",
                    }}>
                      {[
                        ["Ekspedisi", expedisiName],
                        ["Tanggal", formatDate(printDate)],
                        ["No. Karung", karungList.map((k) => k.nomorKarung).join(", ")],
                        ["Total Resi", `${sheetRows.length} item`],
                      ].map(([label, value], i) => (
                        <div key={i} style={{
                          padding: "5px 12px",
                          borderRight: i % 2 === 0 ? "1px solid #e2e8f0" : "none",
                          borderBottom: i < 2 ? "1px solid #e2e8f0" : "none",
                          backgroundColor: i % 2 === 0 ? "#f8fafc" : "#ffffff",
                        }}>
                          <span style={{ color: "#94a3b8", fontSize: "9px", display: "block", marginBottom: "1px" }}>{label}</span>
                          <span style={{ fontWeight: "600", color: "#0f172a" }}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  /* Continuation page — compact header with small logo */
                  <div style={{ marginBottom: "10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src="/logo.png"
                          onError={(e) => {
                            const img = e.currentTarget;
                            if (!img.src.endsWith("/logo.jpg")) img.src = "/logo.jpg";
                          }}
                          alt={namaPerusahaan}
                          style={{ height: "28px", maxWidth: "90px", objectFit: "contain" }}
                        />
                        <span style={{ fontSize: "12px", fontWeight: "700", color: "#0f172a" }}>
                          TANDA TERIMA <span style={{ fontWeight: "400", color: "#64748b" }}>(Lanjutan)</span>
                        </span>
                      </div>
                      <div style={{ fontSize: "10px", color: "#64748b" }}>
                        {expedisiName} · {formatDate(printDate)} · Hal. {pageIndex + 1}/{totalPages}
                      </div>
                    </div>
                    <div style={{ height: "2px", background: "#e2e8f0", margin: "8px 0 10px" }} />
                  </div>
                )}

                {/* ── Table ── */}
                {twoCol ? (
                  /* ── 2-column layout ──────────────────────────────────────────
                     Baris dibagi dua: kiri dan kanan. Kolom Tanggal dihilangkan
                     karena semua baris dalam 1 dokumen punya tanggal yang sama.  */
                  (() => {
                    const mid      = Math.ceil(pageRows.length / 2);
                    const leftRows = pageRows.slice(0, mid);
                    const rightRows = pageRows.slice(mid);

                    const TD_STYLE: React.CSSProperties = {
                      padding: "2px 4px", border: "1px solid #e2e8f0",
                    };
                    const TH_STYLE: React.CSSProperties = {
                      padding: "4px 4px", color: "#fff", fontWeight: "600",
                      fontSize: "9px", border: "1px solid #1e293b", whiteSpace: "nowrap",
                    };

                    const ColTable = ({ colRows }: { colRows: string[][] }) => (
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "9px" }}>
                        <thead>
                          <tr style={{ backgroundColor: "#0f172a" }}>
                            <th style={{ ...TH_STYLE, width: "22px",  textAlign: "center" }}>No.</th>
                            <th style={{ ...TH_STYLE, width: "98px",  textAlign: "left"   }}>Kode Resi</th>
                            <th style={{ ...TH_STYLE, width: "44px",  textAlign: "center" }}>No.Krg</th>
                            <th style={{ ...TH_STYLE,                 textAlign: "left"   }}>Di Scan Oleh</th>
                            <th style={{ ...TH_STYLE, width: "42px",  textAlign: "center" }}>Jam</th>
                          </tr>
                        </thead>
                        <tbody>
                          {colRows.map((row, i) => (
                            <tr key={i} style={{ backgroundColor: i % 2 === 0 ? "#ffffff" : "#f8fafc" }}>
                              <td style={{ ...TD_STYLE, textAlign: "center", color: "#94a3b8", fontSize: "8px" }}>{row[0]}</td>
                              <td style={{ ...TD_STYLE, fontFamily: "monospace", fontWeight: "600", color: "#0f172a" }}>{row[1]}</td>
                              <td style={{ ...TD_STYLE, textAlign: "center", color: "#334155" }}>{row[2]}</td>
                              <td style={{ ...TD_STYLE, color: "#334155" }}>{row[3]}</td>
                              <td style={{ ...TD_STYLE, textAlign: "center", color: "#475569" }}>{row[5]}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    );

                    return (
                      <div style={{ display: "flex", gap: "6px", alignItems: "flex-start", marginBottom: "8px" }}>
                        <div style={{ flex: 1, minWidth: 0 }}><ColTable colRows={leftRows} /></div>
                        <div style={{ flex: 1, minWidth: 0 }}><ColTable colRows={rightRows} /></div>
                      </div>
                    );
                  })()
                ) : (
                  /* ── 1-column layout (data cukup 1 halaman) ── */
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10px", marginBottom: "10px" }}>
                    <thead>
                      <tr style={{ backgroundColor: "#0f172a" }}>
                        {["No.", "Kode Resi", "No. Karung", "Di Scan Oleh", "Tanggal", "Jam"].map((h, i) => (
                          <th key={i} style={{
                            padding: "5px 6px", color: "#ffffff", fontWeight: "600", fontSize: "10px",
                            border: "1px solid #1e293b",
                            textAlign: i === 0 || i >= 4 ? "center" : "left",
                            whiteSpace: "nowrap",
                            ...(i === 0 ? { width: "30px"  } : {}),
                            ...(i === 1 ? { width: "120px" } : {}),
                            ...(i === 2 ? { width: "65px"  } : {}),
                            ...(i === 3 ? { width: "155px" } : {}),
                            ...(i === 4 ? { width: "72px"  } : {}),
                            ...(i === 5 ? { width: "52px"  } : {}),
                          }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((row, i) => (
                        <tr key={i} style={{ backgroundColor: i % 2 === 0 ? "#ffffff" : "#f8fafc" }}>
                          <td style={{ padding: "3px 6px", border: "1px solid #e2e8f0", textAlign: "center", color: "#94a3b8", fontSize: "9px" }}>{row[0]}</td>
                          <td style={{ padding: "3px 6px", border: "1px solid #e2e8f0", fontFamily: "monospace", fontWeight: "600", color: "#0f172a", fontSize: "10px" }}>{row[1]}</td>
                          <td style={{ padding: "3px 6px", border: "1px solid #e2e8f0", textAlign: "center", color: "#334155" }}>{row[2]}</td>
                          <td style={{ padding: "3px 6px", border: "1px solid #e2e8f0", color: "#334155" }}>{row[3]}</td>
                          <td style={{ padding: "3px 6px", border: "1px solid #e2e8f0", textAlign: "center", color: "#475569" }}>{row[4]}</td>
                          <td style={{ padding: "3px 6px", border: "1px solid #e2e8f0", textAlign: "center", color: "#475569" }}>{row[5]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* Total — halaman terakhir */}
                {pageIndex === totalPages - 1 && (
                  <div style={{ textAlign: "right", fontWeight: "700", fontSize: "10px", color: "#0f172a", padding: "4px 6px", backgroundColor: "#f1f5f9", border: "1px solid #e2e8f0", marginBottom: "10px" }}>
                    Total Keseluruhan : {sheetRows.length} resi
                  </div>
                )}

                {/* ── Footer — last page only ── */}
                {pageIndex === totalPages - 1 && (
                  <>
                    {/* Note */}
                    <div style={{
                      border: "1px solid #fcd34d",
                      borderLeft: "4px solid #f59e0b",
                      borderRadius: "4px",
                      padding: "7px 12px",
                      marginBottom: "18px",
                      backgroundColor: "#fffbeb",
                      fontSize: "9px",
                      color: "#78350f",
                      lineHeight: "1.4",
                    }}>
                      <span style={{ fontWeight: "700", color: "#92400e" }}>Keterangan : </span>
                      {noteTandaTerima}
                    </div>

                    {/* Signatures */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "48px" }}>
                      {[
                        { label: "Yang Menyerahkan,", sub: expedisiName },
                        { label: "Yang Menerima,",    sub: namaPerusahaan },
                      ].map((sig, i) => (
                        <div key={i} style={{ textAlign: "center" }}>
                          <div style={{ fontSize: "10px", fontWeight: "600", color: "#334155", marginBottom: "52px" }}>
                            {sig.label}
                          </div>
                          <div style={{ borderTop: "1.5px solid #94a3b8", paddingTop: "6px" }}>
                            <div style={{ fontSize: "9px", color: "#94a3b8" }}>(Nama &amp; Tanda Tangan)</div>
                            <div style={{ fontSize: "10px", fontWeight: "600", color: "#334155", marginTop: "2px" }}>{sig.sub}</div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Document footer */}
                    <div style={{
                      marginTop: "16px",
                      paddingTop: "8px",
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
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .no-print { display: none !important; }
          body { background: white !important; margin: 0 !important; padding: 0 !important; }
          main { padding: 0 !important; margin: 0 !important; }
          .print-container {
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .print-container > div {
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          @page {
            size: 210mm 297mm portrait;
            margin: 1.4cm 1.8cm 2cm 1.8cm;
          }
        }
      `}</style>
    </>
  );
}
