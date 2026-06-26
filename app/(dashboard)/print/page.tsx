"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  getKarung,
  getScansByKarung,
  lockKarung,
  getSettings,
  isKarungLocked,
  getKarungHistory,
} from "@/lib/firestore";
import { todayString, formatDate } from "@/lib/utils";
import type { Karung, ScanRecord, CompanySettings } from "@/types";
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

// ── Types ────────────────────────────────────────────────────────────────────

interface ExpedisiGroup {
  expedisiId: string;
  expedisiName: string;
  karungList: Karung[];
}

// ── Inner component ──────────────────────────────────────────────────────────

function PrintPageInner() {
  const { appUser } = useAuth();
  const params = useSearchParams();
  const router = useRouter();

  // Support both legacy ?karungId=x and new ?karungIds=x,y,z
  const karungIdSingle = params.get("karungId");
  const karungIdsParam = params.get("karungIds");
  const activeIds: string[] = karungIdsParam
    ? karungIdsParam.split(",").filter(Boolean)
    : karungIdSingle
    ? [karungIdSingle]
    : [];

  const today = todayString();

  // ── Print view state ──────────────────────────────────────────────────────
  const [karungList, setKarungList] = useState<Karung[]>([]);
  const [allScans, setAllScans] = useState<ScanRecord[]>([]);
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [locking, setLocking] = useState(false);

  // ── Selector state ────────────────────────────────────────────────────────
  const [selectorDate, setSelectorDate] = useState(today);
  const [expedisiGroups, setExpedisiGroups] = useState<ExpedisiGroup[]>([]);
  const [selectorLoading, setSelectorLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeExpedisi, setActiveExpedisi] = useState<string | null>(null);

  // ── Load settings always ──────────────────────────────────────────────────
  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  // ── Load karung for print view ────────────────────────────────────────────
  useEffect(() => {
    if (activeIds.length === 0) return;
    setLoading(true);
    Promise.all(
      activeIds.map((id) =>
        Promise.all([getKarung(id), getScansByKarung(id)])
      )
    ).then((results) => {
      const karung = results.map(([k]) => k).filter(Boolean) as Karung[];
      const scans = results.flatMap(([, s]) => s as ScanRecord[]).sort((a, b) => {
        // Sort by karung order first, then by scan time
        const ai = karung.findIndex((k) => k.id === a.karungId);
        const bi = karung.findIndex((k) => k.id === b.karungId);
        if (ai !== bi) return ai - bi;
        const ta = (a.scannedAt as { seconds: number })?.seconds ?? 0;
        const tb = (b.scannedAt as { seconds: number })?.seconds ?? 0;
        return ta - tb;
      });
      setKarungList(karung);
      setAllScans(scans);
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

    // Group by expedisi
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
    setExpedisiGroups(Object.values(groups).sort((a, b) =>
      a.expedisiName.localeCompare(b.expedisiName, "id")
    ));
    setSelectorLoading(false);
  };

  // ── Checkbox logic — only allow selection within one expedisi ─────────────
  const toggleKarung = (karung: Karung) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(karung.id)) {
      newSet.delete(karung.id);
      if (newSet.size === 0) setActiveExpedisi(null);
    } else {
      // If switching expedisi, clear previous selection
      if (activeExpedisi && activeExpedisi !== karung.expedisiId) {
        newSet.clear();
      }
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
      // Clear other expedisi first
      if (activeExpedisi && activeExpedisi !== group.expedisiId) newSet.clear();
      group.karungList.forEach((k) => newSet.add(k.id));
      setActiveExpedisi(group.expedisiId);
    }
    setSelectedIds(newSet);
  };

  const handlePrintSelected = () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds).join(",");
    router.push(`/print?karungIds=${ids}`);
  };

  // ── Print handler ─────────────────────────────────────────────────────────
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
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 300);
  };

  // ── Derived print data ────────────────────────────────────────────────────
  const expedisiName = karungList[0]?.expedisiName ?? "";
  const karungNomors = karungList.map((k) => `#${k.nomorKarung}`).join(", ");
  const printDate = karungList[0]?.date ?? today;
  const namaPerusahaan = settings?.namaPerusahaan || "PT. IEG";
  const noteTandaTerima =
    settings?.noteTandaTerima ||
    "Seluruh karung yang diserahkan sudah di scan dan disaksikan oleh pihak yang menyerahkan barang. tanda terima ini menjadi bukti yang sah, untuk tanda terima barang dari expedisi ke PT. IEG";

  const totalPages = Math.max(1, Math.ceil(allScans.length / ROWS_PER_PAGE));
  const pages: ScanRecord[][] = Array.from({ length: totalPages }, (_, i) =>
    allScans.slice(i * ROWS_PER_PAGE, (i + 1) * ROWS_PER_PAGE)
  );
  const anyLocked = karungList.some((k) => isKarungLocked(k));

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

        {/* Date picker */}
        <div className="card p-4">
          <label className="text-xs text-slate-500 mb-1 block">Tanggal</label>
          <input
            type="date"
            value={selectorDate}
            onChange={(e) => {
              setSelectorDate(e.target.value);
              loadSelectorKarung(e.target.value);
            }}
            className="input-field max-w-xs"
          />
        </div>

        {/* Print selected floating bar */}
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

        {/* Karung list grouped by expedisi */}
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
              const isDisabled =
                activeExpedisi !== null && activeExpedisi !== group.expedisiId;

              return (
                <div
                  key={group.expedisiId}
                  className={`card overflow-hidden transition-all ${isDisabled ? "opacity-40" : ""}`}
                >
                  {/* Expedisi header */}
                  <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
                    <div className="flex items-center gap-2.5">
                      <Truck className="w-4 h-4 text-slate-500" />
                      <span className="font-semibold text-slate-800">
                        {group.expedisiName}
                      </span>
                      <span className="badge-info text-xs">
                        {group.karungList.length} karung
                      </span>
                    </div>
                    {!isDisabled && (
                      <button
                        onClick={() => toggleAllInExpedisi(group)}
                        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-green-700 transition-colors"
                      >
                        {allSel ? (
                          <CheckSquare className="w-4 h-4 text-green-600" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                        {allSel ? "Batalkan semua" : "Pilih semua"}
                      </button>
                    )}
                  </div>

                  {/* Karung rows */}
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
                            <p className="font-medium text-slate-800 text-sm">
                              Karung #{k.nomorKarung}
                            </p>
                            <p className="text-xs text-slate-400">
                              {k.totalResi} resi
                            </p>
                          </div>
                          {isKarungLocked(k) && (
                            <span className="badge-warning flex items-center gap-1 text-xs">
                              <Lock className="w-3 h-3" /> Terkunci
                            </span>
                          )}
                          {/* Single print button */}
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              router.push(`/print?karungId=${k.id}`);
                            }}
                            className="btn-ghost px-2.5 py-1.5 text-xs text-slate-400 hover:text-green-700"
                            title="Print karung ini saja"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                        </label>
                      );
                    })}
                  </div>

                  {/* Per-expedisi print button when some selected */}
                  {someSel && (
                    <div className="px-4 py-3 bg-green-50 border-t border-green-100">
                      <button
                        onClick={handlePrintSelected}
                        className="btn-primary w-full text-sm"
                      >
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
      <div className="flex justify-center items-center min-h-[300px]">
        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
      </div>
    );
  }

  if (karungList.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>Karung tidak ditemukan</p>
        <button onClick={() => router.push("/print")} className="btn-secondary mt-4">
          Kembali
        </button>
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
            <h1 className="text-xl font-bold text-slate-900">
              Preview Tanda Terima
            </h1>
            <p className="text-sm text-slate-500">
              {expedisiName} · Karung {karungNomors} · {allScans.length} resi total
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
            disabled={printing || locking}
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

      {/* Print pages */}
      <div className="print-container max-w-5xl mx-auto space-y-8">
        {pages.map((pageScans, pageIndex) => (
          <div
            key={pageIndex}
            className={`bg-white border border-slate-200 rounded-xl overflow-hidden print:border-none print:rounded-none print:shadow-none ${
              pageIndex > 0 ? "print:break-before-page" : ""
            }`}
          >
            {/* Page indicator */}
            {totalPages > 1 && (
              <div className="bg-slate-800 text-white text-xs px-6 py-2 text-right no-print">
                Halaman {pageIndex + 1} dari {totalPages}
              </div>
            )}

            <div className="p-8">
              {/* Header */}
              <div className="text-center mb-6 border-b-2 border-slate-800 pb-4">
                <h1 className="text-xl font-bold text-slate-900 uppercase tracking-wide">
                  TANDA TERIMA DARI EKSPEDISI {expedisiName.toUpperCase()}
                </h1>
                <div className="flex flex-wrap justify-center gap-6 mt-3 text-sm text-slate-600">
                  <span><strong>Tanggal:</strong> {formatDate(printDate)}</span>
                  <span>
                    <strong>No. Karung:</strong>{" "}
                    {karungList.map((k) => k.nomorKarung).join(", ")}
                  </span>
                  <span><strong>Total Resi:</strong> {allScans.length}</span>
                  {totalPages > 1 && (
                    <span className="text-slate-400">
                      Hal. {pageIndex + 1}/{totalPages}
                    </span>
                  )}
                </div>
              </div>

              {/* Table */}
              <table className="w-full text-sm border-collapse mb-6">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="px-3 py-2.5 text-left border border-slate-600 w-10">No.</th>
                    <th className="px-3 py-2.5 text-left border border-slate-600">Kode Resi</th>
                    <th className="px-3 py-2.5 text-left border border-slate-600 w-24">No. Karung</th>
                    <th className="px-3 py-2.5 text-left border border-slate-600 w-36">Di Scan Oleh</th>
                    <th className="px-3 py-2.5 text-left border border-slate-600 w-24">Tanggal</th>
                    <th className="px-3 py-2.5 text-left border border-slate-600 w-20">Jam</th>
                  </tr>
                </thead>
                <tbody>
                  {pageScans.map((scan, i) => {
                    const rowNum = pageIndex * ROWS_PER_PAGE + i + 1;
                    const scanDate = (scan.scannedAt as { toDate?: () => Date })?.toDate?.() || new Date();
                    return (
                      <tr key={scan.id} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                        <td className="px-3 py-2 border border-slate-200 text-slate-500 text-center">
                          {rowNum}
                        </td>
                        <td className="px-3 py-2 border border-slate-200 font-mono font-medium text-slate-900">
                          {scan.noResi}
                        </td>
                        <td className="px-3 py-2 border border-slate-200 text-slate-600">
                          {scan.nomorKarung}
                        </td>
                        <td className="px-3 py-2 border border-slate-200 text-slate-600">
                          {scan.scannedByName}
                        </td>
                        <td className="px-3 py-2 border border-slate-200 text-slate-600 text-xs">
                          {scanDate.toLocaleDateString("id-ID", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          })}
                        </td>
                        <td className="px-3 py-2 border border-slate-200 text-slate-600 text-xs">
                          {scanDate.toLocaleTimeString("id-ID", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Footer — last page only */}
              {pageIndex === totalPages - 1 && (
                <>
                  <div className="border border-slate-300 rounded-lg px-4 py-3 mb-8 bg-amber-50">
                    <p className="text-xs text-slate-700">
                      <strong>Note : </strong>{noteTandaTerima}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-16 mt-4">
                    <div className="text-center">
                      <p className="text-sm font-medium text-slate-700 mb-16">Diserahkan Oleh :</p>
                      <div className="border-t border-slate-400 pt-2">
                        <p className="text-xs text-slate-500">(Nama &amp; Tanda Tangan)</p>
                        <p className="text-xs text-slate-500">{expedisiName}</p>
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-slate-700 mb-16">Diterima Oleh :</p>
                      <div className="border-t border-slate-400 pt-2">
                        <p className="text-xs text-slate-500">(Nama &amp; Tanda Tangan)</p>
                        <p className="text-xs text-slate-500">{namaPerusahaan}</p>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; margin: 0; }
          .print-container { max-width: 100% !important; margin: 0 !important; }
          @page { margin: 1cm; size: A4; }
        }
      `}</style>
    </>
  );
}
