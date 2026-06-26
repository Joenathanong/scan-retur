"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import {
  getExpedisiList,
  createExpedisi,
  findExpedisiByName,
  getTodayKarungByExpedisi,
  createKarung,
  checkDuplicateResi,
  addScanRecord,
  subscribeKarungScans,
  isKarungLocked,
  getSettings,
} from "@/lib/firestore";
import { syncToSheet } from "@/lib/gsheet";
import { playSuccess, playFailed } from "@/lib/audio";
import { todayString, formatDateTime, cn } from "@/lib/utils";
import { Timestamp, doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Expedisi, Karung, ScanRecord, CompanySettings } from "@/types";
import {
  ScanLine,
  ChevronRight,
  Plus,
  RefreshCw,
  Package,
  CheckCircle2,
  XCircle,
  Lock,
  ArrowLeft,
  Truck,
  Loader2,
  Printer,
} from "lucide-react";

type Step = "select-expedisi" | "select-karung" | "scanning";
type ScanFeedback = "idle" | "success" | "failed" | "duplicate";

/** Resi kurang dari ini dianggap partial scan (barcode tidak terbaca sempurna). */
const MIN_RESI_LENGTH = 6;

/**
 * Bersihkan hasil scan dari kontaminasi scanner HID:
 *
 * Kasus utama — repeated-prefix suffix:
 *   "JX9730214994JX" → prefix "JX" muncul lagi di pos 12 → trim → "JX9730214994"
 *   Terjadi karena scanner sudah mulai mengetik barcode berikutnya sebelum
 *   Enter dari barcode sebelumnya selesai diproses.
 */
function cleanResi(raw: string): string {
  const s = raw.toUpperCase().trim();
  if (s.length < 4) return s;

  // Deteksi prefix 2-huruf yang muncul lagi setelah minimal 6 karakter
  if (/^[A-Z]{2}/.test(s)) {
    const prefix = s.slice(0, 2);
    const repeatIdx = s.indexOf(prefix, 6);
    if (repeatIdx > 0) {
      return s.slice(0, repeatIdx);
    }
  }

  return s;
}

export default function ScanPage() {
  const { appUser } = useAuth();
  const router = useRouter();

  // ── Steps ────────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("select-expedisi");

  // ── Expedisi ─────────────────────────────────────────────────────────────
  const [expedisiList, setExpedisiList] = useState<Expedisi[]>([]);
  const [selectedExpedisi, setSelectedExpedisi] = useState<Expedisi | null>(null);
  const [newExpedisiName, setNewExpedisiName] = useState("");
  const [addingExpedisi, setAddingExpedisi] = useState(false);
  const [expedisiLoading, setExpedisiLoading] = useState(true);
  const [expedisiError, setExpedisiError] = useState("");
  const [expedisiExistMsg, setExpedisiExistMsg] = useState("");

  // ── Karung ───────────────────────────────────────────────────────────────
  const [karungList, setKarungList] = useState<Karung[]>([]);
  const [selectedKarung, setSelectedKarung] = useState<Karung | null>(null);
  const [newKarungNo, setNewKarungNo] = useState("");
  const [karungLoading, setKarungLoading] = useState(false);
  const [creatingKarung, setCreatingKarung] = useState(false);

  // ── Scan ─────────────────────────────────────────────────────────────────
  const [scanInput, setScanInput] = useState("");
  const [feedback, setFeedback] = useState<ScanFeedback>("idle");
  const [lastResi, setLastResi] = useState("");
  const [recentScans, setRecentScans] = useState<ScanRecord[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState("");
  const [settings, setSettings] = useState<CompanySettings | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const feedbackTimer = useRef<NodeJS.Timeout | null>(null);

  const today = todayString();

  // ── Load expedisi list ───────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const [list] = await Promise.all([
          getExpedisiList(),
          getSettings().then(setSettings).catch(() => {}),
        ]);
        setExpedisiList(list);
      } catch (err) {
        setExpedisiError("Gagal memuat data ekspedisi. Periksa koneksi internet atau izin Firestore.");
        console.error("getExpedisiList error:", err);
      } finally {
        setExpedisiLoading(false);
      }
    };
    load();
  }, []);

  // ── Load karung when expedisi selected ──────────────────────────────────
  useEffect(() => {
    if (!selectedExpedisi) return;
    setKarungLoading(true);
    getTodayKarungByExpedisi(selectedExpedisi.id, today)
      .then((list) => setKarungList(list))
      .catch((err) => console.error("getTodayKarung error:", err))
      .finally(() => setKarungLoading(false));
  }, [selectedExpedisi, today]);

  // ── Subscribe to live scan count for selected karung ────────────────────
  useEffect(() => {
    if (!selectedKarung) return;
    const unsub = subscribeKarungScans(selectedKarung.id, (scans) => {
      setRecentScans(scans.slice(0, 10));
      setTotalCount(scans.length);
    });
    return unsub;
  }, [selectedKarung]);

  // ── Auto-focus scan input ────────────────────────────────────────────────
  useEffect(() => {
    if (step === "scanning") {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [step, feedback]);

  const resetFeedback = useCallback(() => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => {
      setFeedback("idle");
      setScanInput("");
      setDuplicateInfo("");
      inputRef.current?.focus();
    }, 1500);
  }, []);

  // ── Handle scan submit ───────────────────────────────────────────────────
  const handleScan = useCallback(
    async (value: string) => {
      const resi = value.trim().toUpperCase();
      if (!resi || processing || !selectedKarung || !appUser) return;

      // Tolak partial scan — barcode tidak terbaca sempurna
      if (resi.length < MIN_RESI_LENGTH) {
        setFeedback("failed");
        setLastResi(`SCAN TIDAK LENGKAP (${resi.length} karakter)`);
        await playFailed();
        resetFeedback();
        return;
      }

      // Check if karung is locked
      if (isKarungLocked(selectedKarung)) {
        setFeedback("failed");
        setLastResi("KARUNG TERKUNCI");
        await playFailed();
        resetFeedback();
        return;
      }

      setProcessing(true);

      const { isDuplicate, karungInfo } = await checkDuplicateResi(selectedKarung.id, resi);

      if (isDuplicate) {
        setFeedback("duplicate");
        setLastResi(resi);
        setDuplicateInfo(karungInfo ?? "");
        await playFailed();
        resetFeedback();
        setProcessing(false);
        return;
      }

      const now = new Date();
      const scan: Omit<ScanRecord, "id"> = {
        karungId: selectedKarung.id,
        expedisiId: selectedExpedisi!.id,
        expedisiName: selectedExpedisi!.name,
        nomorKarung: selectedKarung.nomorKarung,
        noResi: resi,
        scannedBy: appUser.uid,
        scannedByName: appUser.name,
        scannedAt: Timestamp.fromDate(now),
        date: today,
        status: "success",
        syncedToSheet: false,
      };

      const saved = await addScanRecord(scan);
      setFeedback("success");
      setLastResi(resi);
      await playSuccess();

      // Sync to Google Sheets in background
      if (settings?.spreadsheetId) {
        syncToSheet({
          scanId: saved.id,
          noResi: resi,
          nomorKarung: selectedKarung.nomorKarung,
          expedisiName: selectedExpedisi!.name,
          expedisiCode: selectedExpedisi!.code,
          scannedByName: appUser.name,
          scannedAt: now.toISOString(),
          date: today,
          spreadsheetId: settings.spreadsheetId,
        });
      }

      resetFeedback();
      setProcessing(false);
    },
    [
      processing,
      selectedKarung,
      selectedExpedisi,
      appUser,
      today,
      settings,
      resetFeedback,
    ]
  );

  // PDT / barcode gun — tangkap nilai SAAT Enter ditekan (T=0),
  // bukan setelah 50ms. Setelah 50ms, scanner sudah bisa mulai mengetik
  // barcode BERIKUTNYA sehingga terjadi kontaminasi (misal "JX9730214994JX").
  // Input langsung di-clear agar karakter barcode berikutnya tidak tersisa.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !processing) {
        e.preventDefault();

        // Tangkap nilai dari DOM sekarang — paling akurat untuk HID scanner
        const captured = (inputRef.current?.value ?? "").trim();

        // Segera bersihkan input supaya scan berikutnya mulai dari kosong
        if (inputRef.current) inputRef.current.value = "";
        setScanInput("");

        // Delay pendek (30ms) untuk karakter akhir barcode ini yang masih
        // dalam perjalanan, tapi jauh lebih singkat dari sebelumnya agar
        // tidak menangkap karakter dari barcode berikutnya.
        setTimeout(() => {
          const cleaned = cleanResi(captured);
          if (cleaned) handleScan(cleaned);
        }, 30);
      }
    },
    [processing, handleScan]
  );

  // ── Add new expedisi (dengan cek duplikat) ──────────────────────────────
  const handleAddExpedisi = async () => {
    if (!newExpedisiName.trim() || !appUser) return;
    setAddingExpedisi(true);
    setExpedisiExistMsg("");

    // Cek apakah nama sudah ada (aktif maupun tidak)
    const existing = await findExpedisiByName(newExpedisiName.trim());
    if (existing) {
      // Gunakan yang sudah ada
      if (!existing.active) {
        // Aktifkan kembali jika nonaktif
        await updateDoc(doc(db, "expedisi", existing.id), { active: true });
        existing.active = true;
      }
      setExpedisiExistMsg(
        `Ekspedisi "${existing.name}" sudah ada di master data — langsung digunakan.`
      );
      // Pastikan ada di list
      setExpedisiList((prev) =>
        prev.find((e) => e.id === existing.id)
          ? prev
          : [...prev, existing].sort((a, b) => a.name.localeCompare(b.name, "id"))
      );
      setSelectedExpedisi(existing);
      setNewExpedisiName("");
      setAddingExpedisi(false);
      setStep("select-karung");
      return;
    }

    // Buat baru
    const exp = await createExpedisi(newExpedisiName.trim(), appUser.uid, appUser.name);
    setExpedisiList((prev) =>
      [...prev, exp].sort((a, b) => a.name.localeCompare(b.name, "id"))
    );
    setSelectedExpedisi(exp);
    setNewExpedisiName("");
    setAddingExpedisi(false);
    setStep("select-karung");
  };

  // ── Create new karung ────────────────────────────────────────────────────
  const handleCreateKarung = async () => {
    if (!newKarungNo.trim() || !selectedExpedisi || !appUser) return;
    setCreatingKarung(true);
    const karung = await createKarung(
      selectedExpedisi.id,
      selectedExpedisi.name,
      newKarungNo.trim(),
      today,
      appUser.uid,
      appUser.name
    );
    setSelectedKarung(karung);
    setNewKarungNo("");
    setCreatingKarung(false);
    setStep("scanning");
  };

  // ── Feedback colors / labels ─────────────────────────────────────────────
  const feedbackConfig = {
    idle:      { bg: "bg-white",     border: "border-slate-200", text: "text-slate-400",   label: "Siap Scan — Arahkan barcode scanner ke resi" },
    success:   { bg: "bg-green-50",  border: "border-green-400", text: "text-green-700",   label: "✓ SUKSES" },
    failed:    { bg: "bg-red-50",    border: "border-red-400",   text: "text-red-700",     label: "✗ GAGAL" },
    duplicate: { bg: "bg-red-50",    border: "border-red-400",   text: "text-red-700",     label: "✗ DUPLIKAT — Resi sudah pernah di-scan" },
  }[feedback];

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 1: Select Expedisi
  // ═══════════════════════════════════════════════════════════════════════
  if (step === "select-expedisi") {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ScanLine className="w-6 h-6 text-green-600" /> Scan Retur
          </h1>
          <p className="text-slate-500 mt-1">Pilih ekspedisi yang akan di-scan</p>
        </div>

        <div className="card p-6">
          <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <Truck className="w-5 h-5 text-green-600" /> Pilih Ekspedisi
          </h2>

          {expedisiError && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              ⚠️ {expedisiError}
            </div>
          )}

          {expedisiLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-green-600" />
            </div>
          ) : (
            <div className="space-y-2 mb-6">
              {expedisiList.length === 0 && !expedisiError && (
                <p className="text-slate-400 text-sm text-center py-4">
                  Belum ada data ekspedisi. Tambahkan di bawah.
                </p>
              )}
              {expedisiList.map((exp) => (
                <button
                  key={exp.id}
                  onClick={() => {
                    setSelectedExpedisi(exp);
                    setStep("select-karung");
                  }}
                  className="w-full flex items-center justify-between p-4 rounded-xl border-2 border-slate-200
                             hover:border-green-500 hover:bg-green-50 transition-all text-left group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                      <Truck className="w-5 h-5 text-green-700" />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-800">{exp.name}</p>
                      <p className="text-xs text-slate-400">Kode: {exp.code}</p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-green-600 transition-colors" />
                </button>
              ))}
            </div>
          )}

          {/* Add new expedisi */}
          <div className="border-t border-slate-100 pt-4">
            <p className="text-sm font-medium text-slate-600 mb-3">
              + Tambah Ekspedisi Baru
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={newExpedisiName}
                onChange={(e) => setNewExpedisiName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddExpedisi()}
                className="input-field flex-1"
                placeholder="Nama ekspedisi (misal: JNE, TIKI, SICEPAT)"
              />
              <button
                onClick={handleAddExpedisi}
                disabled={!newExpedisiName.trim() || addingExpedisi}
                className="btn-primary flex-shrink-0"
              >
                {addingExpedisi ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Gunakan
              </button>
            </div>
            {expedisiExistMsg && (
              <p className="mt-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                ℹ️ {expedisiExistMsg}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 2: Select / Create Karung
  // ═══════════════════════════════════════════════════════════════════════
  if (step === "select-karung") {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <button
            onClick={() => { setStep("select-expedisi"); setSelectedExpedisi(null); }}
            className="btn-ghost mb-3 -ml-2"
          >
            <ArrowLeft className="w-4 h-4" /> Ganti Ekspedisi
          </button>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Package className="w-6 h-6 text-green-600" /> Pilih Karung
          </h1>
          <p className="text-slate-500 mt-1">
            Ekspedisi: <strong>{selectedExpedisi?.name}</strong> — {today}
          </p>
        </div>

        <div className="card p-6">
          {/* Today's karung */}
          <h2 className="font-semibold text-slate-800 mb-3">Karung Hari Ini</h2>
          {karungLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-6 h-6 animate-spin text-green-600" />
            </div>
          ) : karungList.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-4 mb-4">
              Belum ada karung untuk hari ini.
            </p>
          ) : (
            <div className="space-y-2 mb-5">
              {karungList.map((k) => {
                const locked = isKarungLocked(k);
                return (
                  <button
                    key={k.id}
                    onClick={() => {
                      if (locked) return;
                      setSelectedKarung(k);
                      setStep("scanning");
                    }}
                    disabled={locked}
                    className={cn(
                      "w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left group",
                      locked
                        ? "border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed"
                        : "border-slate-200 hover:border-green-500 hover:bg-green-50 cursor-pointer"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center",
                        locked ? "bg-slate-200" : "bg-green-100"
                      )}>
                        {locked
                          ? <Lock className="w-5 h-5 text-slate-400" />
                          : <Package className="w-5 h-5 text-green-700" />
                        }
                      </div>
                      <div>
                        <p className="font-semibold text-slate-800">
                          Karung #{k.nomorKarung}
                        </p>
                        <p className="text-xs text-slate-400">
                          {k.totalResi} resi · dibuat oleh {k.createdByName}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {locked
                        ? <span className="badge-warning">Terkunci</span>
                        : <span className="badge-success">Lanjut Scan</span>
                      }
                      {!locked && <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-green-600" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Create new karung */}
          <div className="border-t border-slate-100 pt-4">
            <p className="text-sm font-medium text-slate-600 mb-3">
              + Buat Karung Baru
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={newKarungNo}
                onChange={(e) => setNewKarungNo(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateKarung()}
                className="input-field flex-1"
                placeholder="Nomor karung (misal: 001, A-01)"
                autoFocus
              />
              <button
                onClick={handleCreateKarung}
                disabled={!newKarungNo.trim() || creatingKarung}
                className="btn-primary flex-shrink-0"
              >
                {creatingKarung ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Buat
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 3: Scanning
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <button
            onClick={() => { setStep("select-karung"); setSelectedKarung(null); setRecentScans([]); setFeedback("idle"); }}
            className="btn-ghost mb-1 -ml-2"
          >
            <ArrowLeft className="w-4 h-4" /> Ganti Karung
          </button>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <ScanLine className="w-5 h-5 text-green-600" />
            {selectedExpedisi?.name} — Karung #{selectedKarung?.nomorKarung}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">{today} · Operator: {appUser?.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <p className="text-3xl font-bold text-green-600">{totalCount}</p>
            <p className="text-xs text-slate-400">Total Resi</p>
          </div>
          <button
            onClick={() => router.push(`/print?karungId=${selectedKarung?.id}`)}
            className="btn-secondary"
          >
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Scan area — takes 2 cols on desktop */}
        <div className="lg:col-span-2">
          <div
            className={cn(
              "card p-6 transition-all duration-300 border-2",
              feedbackConfig.border,
              feedbackConfig.bg
            )}
          >
            {/* Feedback indicator */}
            <div className="flex items-center justify-between mb-4">
              <p className={cn("font-semibold text-sm", feedbackConfig.text)}>
                {feedbackConfig.label}
              </p>
              {processing && <Loader2 className="w-5 h-5 animate-spin text-green-600" />}
            </div>

            {/* Last scanned resi */}
            {lastResi && feedback !== "idle" && (
              <div className={cn(
                "rounded-xl p-4 mb-4 flex items-center gap-3",
                feedback === "success" ? "bg-green-100" : "bg-red-100"
              )}>
                {feedback === "success"
                  ? <CheckCircle2 className="w-8 h-8 text-green-600 flex-shrink-0" />
                  : <XCircle       className="w-8 h-8 text-red-600 flex-shrink-0"   />
                }
                <div>
                  <p className={cn(
                    "font-bold text-xl font-mono tracking-wider",
                    feedback === "success" ? "text-green-800" : "text-red-800"
                  )}>
                    {lastResi}
                  </p>
                  <p className={cn(
                    "text-sm",
                    feedback === "success" ? "text-green-600" : "text-red-600"
                  )}>
                    {feedback === "success"
                      ? "Berhasil disimpan"
                      : feedback === "duplicate"
                      ? <>Sudah di-scan sebelumnya{duplicateInfo && <span className="block text-xs mt-0.5 opacity-80">📦 {duplicateInfo}</span>}</>
                      : "Gagal"}
                  </p>
                </div>
              </div>
            )}

            {/* Input field */}
            <input
              ref={inputRef}
              type="text"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={processing || isKarungLocked(selectedKarung!)}
              className={cn(
                "w-full px-4 py-5 rounded-xl border-2 text-2xl font-mono tracking-widest",
                "focus:outline-none focus:ring-4 transition-all",
                "placeholder:text-slate-300 placeholder:text-lg placeholder:font-sans placeholder:tracking-normal",
                isKarungLocked(selectedKarung!)
                  ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed"
                  : feedback === "success"
                    ? "border-green-400 bg-green-50 focus:ring-green-200 text-green-900"
                    : feedback === "failed" || feedback === "duplicate"
                      ? "border-red-400 bg-red-50 focus:ring-red-200 text-red-900"
                      : "border-slate-300 bg-white focus:ring-green-200 focus:border-green-400 text-slate-900"
              )}
              placeholder={
                isKarungLocked(selectedKarung!)
                  ? "⛔ Karung terkunci"
                  : "Scan barcode di sini..."
              }
              autoComplete="off"
              spellCheck={false}
            />

            {isKarungLocked(selectedKarung!) && (
              <div className="mt-3 flex items-center gap-2 text-amber-700 bg-amber-50 rounded-lg px-4 py-3 text-sm">
                <Lock className="w-4 h-4 flex-shrink-0" />
                Karung ini sudah terkunci karena tanda terima sudah dicetak. Hubungi admin untuk membuka kunci.
              </div>
            )}

            {/* Re-focus button (useful on some PDTs where focus drops) */}
            {!isKarungLocked(selectedKarung!) && (
              <button
                onClick={() => inputRef.current?.focus()}
                className="mt-3 text-xs text-slate-400 hover:text-green-600 flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" /> Klik di sini jika cursor hilang dari scan field
              </button>
            )}
          </div>
        </div>

        {/* Recent scans list */}
        <div className="card p-4">
          <h3 className="font-semibold text-slate-700 text-sm mb-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            Resi Terbaru
          </h3>
          {recentScans.length === 0 ? (
            <p className="text-slate-400 text-xs text-center py-6">
              Belum ada resi yang di-scan
            </p>
          ) : (
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {recentScans.map((s, i) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 border border-green-100"
                >
                  <span className="text-xs text-slate-400 w-5 text-right flex-shrink-0">
                    {totalCount - i}
                  </span>
                  <span className="font-mono text-xs text-green-800 flex-1 truncate">
                    {s.noResi}
                  </span>
                  <span className="text-xs text-slate-400 flex-shrink-0">
                    {s.scannedAt?.toDate
                      ? s.scannedAt.toDate().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                      : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
