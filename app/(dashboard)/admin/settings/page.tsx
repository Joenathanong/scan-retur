"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { getSettings, saveSettings, initSettings } from "@/lib/firestore";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import AuthGuard from "@/components/AuthGuard";
import type { CompanySettings } from "@/types";
import {
  Settings,
  Save,
  Loader2,
  CheckCircle2,
  Building2,
  FileText,
  Sheet,
  ExternalLink,
  Info,
} from "lucide-react";

export default function AdminSettingsPage() {
  const { appUser } = useAuth();
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [namaPerusahaan, setNamaPerusahaan] = useState("");
  const [noteTandaTerima, setNoteTandaTerima] = useState("");
  const [spreadsheetId, setSpreadsheetId] = useState("");

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      setNamaPerusahaan(s.namaPerusahaan);
      setNoteTandaTerima(s.noteTandaTerima);
      setSpreadsheetId(s.spreadsheetId || "");
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    if (!appUser) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      // Use setDoc with merge to handle case where doc doesn't exist
      await setDoc(
        doc(db, "settings", "company"),
        {
          namaPerusahaan,
          noteTandaTerima,
          spreadsheetId,
          updatedAt: new Date(),
          updatedBy: appUser.uid,
        },
        { merge: true }
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
      </div>
    );
  }

  return (
    <AuthGuard adminOnly>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Settings className="w-6 h-6 text-green-600" /> Pengaturan Sistem
          </h1>
          <p className="text-slate-500 mt-1">Konfigurasi aplikasi dan integrasi</p>
        </div>

        {/* Company */}
        <div className="card p-6 space-y-4">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-green-600" /> Informasi Perusahaan
          </h2>
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">
              Nama Perusahaan
            </label>
            <input
              type="text"
              value={namaPerusahaan}
              onChange={(e) => setNamaPerusahaan(e.target.value)}
              className="input-field"
              placeholder="PT. Nama Perusahaan"
            />
            <p className="text-xs text-slate-400 mt-1">
              Akan muncul di tanda terima bagian "Diterima Oleh"
            </p>
          </div>
        </div>

        {/* Tanda terima note */}
        <div className="card p-6 space-y-4">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2">
            <FileText className="w-5 h-5 text-green-600" /> Teks Note Tanda Terima
          </h2>
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">
              Note
            </label>
            <textarea
              value={noteTandaTerima}
              onChange={(e) => setNoteTandaTerima(e.target.value)}
              rows={4}
              className="input-field resize-none"
              placeholder="Teks note yang muncul di bagian bawah tanda terima..."
            />
            <p className="text-xs text-slate-400 mt-1">
              Teks ini muncul di bagian bawah dokumen tanda terima sebelum area tanda tangan.
            </p>
          </div>
          {/* Preview */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-xs font-medium text-amber-700 mb-1">Preview:</p>
            <p className="text-xs text-amber-800">
              <strong>Note : </strong>{noteTandaTerima || "—"}
            </p>
          </div>
        </div>

        {/* Google Sheets */}
        <div className="card p-6 space-y-4">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2">
            <Sheet className="w-5 h-5 text-green-600" /> Integrasi Google Sheets
          </h2>

          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex gap-2">
            <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700">
              Buat satu Google Spreadsheet, lalu share ke service account email yang ada di{" "}
              <code className="bg-blue-100 px-1 rounded">.env.local</code> (
              <code>GOOGLE_SHEETS_CLIENT_EMAIL</code>) dengan role <strong>Editor</strong>.
              Salin Spreadsheet ID dari URL: <code>docs.google.com/spreadsheets/d/
              <strong>[SPREADSHEET_ID]</strong>/edit</code>
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">
              Google Spreadsheet ID
            </label>
            <input
              type="text"
              value={spreadsheetId}
              onChange={(e) => setSpreadsheetId(e.target.value)}
              className="input-field font-mono"
              placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
            />
            <p className="text-xs text-slate-400 mt-1">
              Setiap scan resi akan otomatis ditambahkan ke sheet yang sesuai (format: EKSPEDISI_DD-MM-YYYY).
            </p>
          </div>

          {spreadsheetId && (
            <a
              href={`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-green-600 hover:text-green-800"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Buka Spreadsheet
            </a>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {saved && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Pengaturan berhasil disimpan!
          </div>
        )}

        <div className="flex justify-end">
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Simpan Pengaturan
          </button>
        </div>
      </div>
    </AuthGuard>
  );
}
