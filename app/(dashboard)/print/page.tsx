"use client";

import { useEffect, useState, useRef, Suspense } from "react";
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
import { todayString, formatDate, cn } from "@/lib/utils";
import type { Karung, ScanRecord, CompanySettings } from "@/types";
import {
  Printer,
  ArrowLeft,
  Loader2,
  Lock,
  Package,
  FileText,
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

function PrintPageInner() {
  const { appUser } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const karungId = params.get("karungId");
  const today = todayString();

  const [karung, setKarung] = useState<Karung | null>(null);
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [locking, setLocking] = useState(false);

  // If no karungId in URL, show selector
  const [selectorDate, setSelectorDate] = useState(today);
  const [selectorKarungList, setSelectorKarungList] = useState<Karung[]>([]);
  const [selectorLoading, setSelectorLoading] = useState(false);

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  useEffect(() => {
    if (!karungId) {
      // Load today's karung
      loadSelectorKarung(selectorDate);
      return;
    }
    setLoading(true);
    Promise.all([
      getKarung(karungId),
      getScansByKarung(karungId),
    ]).then(([k, s]) => {
      setKarung(k);
      setScans(s);
      setLoading(false);
    });
  }, [karungId]); // eslint-disable-line

  const loadSelectorKarung = async (date: string) => {
    setSelectorLoading(true);
    const list = await getKarungHistory(date, date);
    setSelectorKarungList(list);
    setSelectorLoading(false);
  };

  const handlePrint = async () => {
    if (!karung || !appUser) return;

    // Lock the karung after printing
    if (!isKarungLocked(karung)) {
      setLocking(true);
      await lockKarung(karung.id, appUser.uid, appUser.name);
      setKarung((prev) => prev ? { ...prev, status: "locked" } : null);
      setLocking(false);
    }

    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 300);
  };

  // ── Pagination ──────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(scans.length / ROWS_PER_PAGE));

  const pages: ScanRecord[][] = Array.from({ length: totalPages }, (_, i) =>
    scans.slice(i * ROWS_PER_PAGE, (i + 1) * ROWS_PER_PAGE)
  );

  // ── Selector view ───────────────────────────────────────────────────────
  if (!karungId) {
    return (
      <div className="max-w-2xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Printer className="w-6 h-6 text-green-600" /> Print Tanda Terima
          </h1>
          <p className="text-slate-500 mt-1">Pilih karung yang akan dicetak tanda terimanya</p>
        </div>

        <div className="card p-5">
          <div className="flex gap-3 mb-4">
            <div className="flex-1">
              <label className="text-xs text-slate-500 mb-1 block">Tanggal</label>
              <input
                type="date"
                value={selectorDate}
                onChange={(e) => { setSelectorDate(e.target.value); loadSelectorKarung(e.target.value); }}
                className="input-field"
              />
            </div>
          </div>

          {selectorLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-green-600" />
            </div>
          ) : selectorKarungList.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Tidak ada karung untuk tanggal ini</p>
            </div>
          ) : (
            <div className="space-y-2">
              {selectorKarungList.map((k) => (
                <button
                  key={k.id}
                  onClick={() => router.push(`/print?karungId=${k.id}`)}
                  className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-slate-200
                             hover:border-green-500 hover:bg-green-50 transition-all text-left"
                >
                  <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Package className="w-5 h-5 text-green-700" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-slate-800">Karung #{k.nomorKarung}</p>
                    <p className="text-xs text-slate-400">
                      {k.expedisiName} · {k.totalResi} resi
                    </p>
                  </div>
                  {isKarungLocked(k) && (
                    <span className="badge-warning flex items-center gap-1">
                      <Lock className="w-3 h-3" /> Terkunci
                    </span>
                  )}
                  <Printer className="w-4 h-4 text-slate-400" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[300px]">
        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
      </div>
    );
  }

  if (!karung) {
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

  const namaPerusahaan = settings?.namaPerusahaan || "PT. IEG";
  const noteTandaTerima =
    settings?.noteTandaTerima ||
    "Seluruh karung yang diserahkan sudah di scan dan disaksikan oleh pihak yang menyerahkan barang. tanda terima ini menjadi bukti yang sah, untuk tanda terima barang dari expedisi ke PT. IEG";

  return (
    <>
      {/* Action bar — hidden during print */}
      <div className="no-print max-w-5xl mx-auto mb-6 flex flex-wrap gap-3 items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="btn-ghost">
            <ArrowLeft className="w-4 h-4" /> Kembali
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              Preview Tanda Terima
            </h1>
            <p className="text-sm text-slate-500">
              {karung.expedisiName} · Karung #{karung.nomorKarung} · {scans.length} resi
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isKarungLocked(karung) && (
            <span className="badge-warning flex items-center gap-1">
              <Lock className="w-3 h-3" /> Karung Terkunci
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
            className={cn(
              "bg-white border border-slate-200 rounded-xl overflow-hidden",
              "print:border-none print:rounded-none print:shadow-none",
              pageIndex > 0 && "print:break-before-page"
            )}
          >
            {/* Page indicator */}
            {totalPages > 1 && (
              <div className="bg-slate-800 text-white text-xs px-6 py-2 text-right">
                Page {pageIndex + 1} of {totalPages}
              </div>
            )}

            <div className="p-8">
              {/* Header */}
              <div className="text-center mb-6 border-b-2 border-slate-800 pb-4">
                <h1 className="text-xl font-bold text-slate-900 uppercase tracking-wide">
                  TANDA TERIMA DARI EKSPEDISI {karung.expedisiName.toUpperCase()}
                </h1>
                <div className="flex justify-center gap-8 mt-3 text-sm text-slate-600">
                  <span><strong>Tanggal:</strong> {formatDate(karung.date)}</span>
                  <span><strong>No. Karung:</strong> {karung.nomorKarung}</span>
                  <span><strong>Total Resi:</strong> {scans.length}</span>
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
                    const scanDate = scan.scannedAt?.toDate?.() || new Date();
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
                          {scanDate.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" })}
                        </td>
                        <td className="px-3 py-2 border border-slate-200 text-slate-600 text-xs">
                          {scanDate.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Footer — only on last page */}
              {pageIndex === totalPages - 1 && (
                <>
                  {/* Note */}
                  <div className="border border-slate-300 rounded-lg px-4 py-3 mb-8 bg-amber-50">
                    <p className="text-xs text-slate-700">
                      <strong>Note : </strong>{noteTandaTerima}
                    </p>
                  </div>

                  {/* Signature area */}
                  <div className="grid grid-cols-2 gap-16 mt-4">
                    <div className="text-center">
                      <p className="text-sm font-medium text-slate-700 mb-16">Diserahkan Oleh :</p>
                      <div className="border-t border-slate-400 pt-2">
                        <p className="text-xs text-slate-500">(Nama & Tanda Tangan)</p>
                        <p className="text-xs text-slate-500">{karung.expedisiName}</p>
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-slate-700 mb-16">Diterima Oleh :</p>
                      <div className="border-t border-slate-400 pt-2">
                        <p className="text-xs text-slate-500">(Nama & Tanda Tangan)</p>
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

      {/* Print-specific styles */}
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
