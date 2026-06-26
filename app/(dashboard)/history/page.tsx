"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import {
  getKarungHistory,
  getScansByKarung,
  lockKarung,
  unlockKarung,
  relockKarung,
  isKarungLocked,
  getAuditLogs,
  updateKarungNomor,
} from "@/lib/firestore";
import { todayString, formatDate, formatDateTime, cn } from "@/lib/utils";
import type { Karung, AuditLog } from "@/types";
import {
  History,
  Package,
  Truck,
  Lock,
  Printer,
  ChevronDown,
  ChevronUp,
  Calendar,
  Loader2,
  Search,
  Eye,
  FileText,
  LockOpen,
  Edit2,
  Check,
  X,
} from "lucide-react";

export default function HistoryPage() {
  const { appUser } = useAuth();
  const router = useRouter();
  const today = todayString();

  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [karungList, setKarungList] = useState<Karung[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedScans, setExpandedScans] = useState<Record<string, { noResi: string; scannedByName: string; scannedAt: Date }[]>>({});
  const [loadingScans, setLoadingScans] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [editingNomor, setEditingNomor] = useState<string | null>(null);
  const [editNomorValue, setEditNomorValue] = useState("");
  const [savingNomor, setSavingNomor] = useState(false);
  const [tab, setTab] = useState<"karung" | "audit">("karung");
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [search, setSearch] = useState("");

  const isAdmin = appUser?.role === "admin";

  const loadKarung = async () => {
    setLoading(true);
    const list = await getKarungHistory(dateFrom, dateTo);
    setKarungList(list);
    setLoading(false);
  };

  useEffect(() => { loadKarung(); }, []); // eslint-disable-line

  const handleSearch = () => loadKarung();

  const toggleExpand = async (karungId: string) => {
    if (expandedId === karungId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(karungId);
    if (!expandedScans[karungId]) {
      setLoadingScans(karungId);
      const scans = await getScansByKarung(karungId);
      setExpandedScans((prev) => ({
        ...prev,
        [karungId]: scans.map((s) => ({
          noResi: s.noResi,
          scannedByName: s.scannedByName,
          scannedAt: s.scannedAt?.toDate?.() || new Date(),
        })),
      }));
      setLoadingScans(null);
    }
  };

  const handleUnlock = async (k: Karung) => {
    if (!appUser) return;
    setActionLoading(k.id);
    await unlockKarung(k.id, appUser.uid, appUser.name);
    await loadKarung();
    setActionLoading(null);
  };

  const handleRelock = async (k: Karung) => {
    if (!appUser) return;
    setActionLoading(k.id);
    await relockKarung(k.id, appUser.uid, appUser.name);
    await loadKarung();
    setActionLoading(null);
  };

  const startEditNomor = (k: Karung) => {
    setEditingNomor(k.id);
    setEditNomorValue(k.nomorKarung);
  };

  const cancelEditNomor = () => {
    setEditingNomor(null);
    setEditNomorValue("");
  };

  const saveNomor = async (k: Karung) => {
    if (!appUser || !editNomorValue.trim()) return;
    setSavingNomor(true);
    await updateKarungNomor(k.id, editNomorValue.trim(), appUser.uid, appUser.name);
    setKarungList((prev) =>
      prev.map((item) =>
        item.id === k.id ? { ...item, nomorKarung: editNomorValue.trim() } : item
      )
    );
    setEditingNomor(null);
    setSavingNomor(false);
  };

  const loadAudit = async () => {
    setAuditLoading(true);
    const logs = await getAuditLogs(200);
    setAuditLogs(logs);
    setAuditLoading(false);
  };

  useEffect(() => {
    if (tab === "audit") loadAudit();
  }, [tab]);

  const filteredKarung = karungList.filter((k) =>
    !search ||
    k.nomorKarung.toLowerCase().includes(search.toLowerCase()) ||
    k.expedisiName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <History className="w-6 h-6 text-green-600" /> History Scan
        </h1>
        <p className="text-slate-500 mt-1">Riwayat scan dan audit log</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {[
          { key: "karung", label: "Riwayat Karung", icon: <Package className="w-4 h-4" /> },
          { key: "audit",  label: "Audit Log",      icon: <FileText className="w-4 h-4" /> },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as "karung" | "audit")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              tab === t.key
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "karung" && (
        <>
          {/* Filters */}
          <div className="card p-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Dari Tanggal</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field" />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Sampai Tanggal</label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field" />
              </div>
              <div className="flex-1 min-w-[180px]">
                <label className="text-xs text-slate-500 mb-1 block">Cari</label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="input-field pl-9"
                    placeholder="No. karung / ekspedisi"
                  />
                </div>
              </div>
              <button onClick={handleSearch} disabled={loading} className="btn-primary">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Cari
              </button>
            </div>
          </div>

          {/* Karung list */}
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-green-600" />
            </div>
          ) : filteredKarung.length === 0 ? (
            <div className="card p-12 text-center text-slate-400">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Tidak ada data karung untuk filter yang dipilih</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredKarung.map((k) => {
                const locked = isKarungLocked(k);
                const scans = expandedScans[k.id];
                const isExpanded = expandedId === k.id;

                return (
                  <div key={k.id} className="card overflow-hidden">
                    {/* Karung row */}
                    <div className="p-4 flex flex-wrap items-center gap-3">
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                        locked ? "bg-amber-100" : "bg-green-100"
                      )}>
                        {locked ? <Lock className="w-5 h-5 text-amber-600" /> : <Package className="w-5 h-5 text-green-700" />}
                      </div>

                      <div className="flex-1 min-w-[160px]">
                        <div className="flex items-center gap-2 flex-wrap">
                          {editingNomor === k.id ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-slate-500 font-semibold text-sm">Karung #</span>
                              <input
                                autoFocus
                                value={editNomorValue}
                                onChange={(e) => setEditNomorValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveNomor(k);
                                  if (e.key === "Escape") cancelEditNomor();
                                }}
                                className="border border-green-400 rounded-lg px-2 py-0.5 text-sm font-semibold w-24 focus:outline-none focus:ring-2 focus:ring-green-400"
                              />
                              <button
                                onClick={() => saveNomor(k)}
                                disabled={savingNomor}
                                className="p-1 text-green-600 hover:bg-green-50 rounded"
                              >
                                {savingNomor ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                onClick={cancelEditNomor}
                                className="p-1 text-slate-400 hover:bg-slate-100 rounded"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <p className="font-semibold text-slate-800">Karung #{k.nomorKarung}</p>
                              {isAdmin && (
                                <button
                                  onClick={() => startEditNomor(k)}
                                  className="p-1 text-slate-300 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                                  title="Edit nomor karung"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          )}
                          {locked ? (
                            k.status === "admin_unlocked"
                              ? <span className="badge-warning">Admin Unlock</span>
                              : <span className="badge-warning">Terkunci</span>
                          ) : (
                            <span className="badge-success">Terbuka</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
                          <span className="flex items-center gap-1">
                            <Truck className="w-3 h-3" /> {k.expedisiName}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" /> {formatDate(k.date)}
                          </span>
                          <span>{k.totalResi} resi</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {/* Print */}
                        <button
                          onClick={() => router.push(`/print?karungId=${k.id}`)}
                          className="btn-ghost text-xs px-2.5 py-1.5"
                        >
                          <Printer className="w-3.5 h-3.5" /> Print
                        </button>

                        {/* Admin lock/unlock */}
                        {isAdmin && (
                          actionLoading === k.id ? (
                            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                          ) : locked && k.status !== "admin_unlocked" ? (
                            <button
                              onClick={() => handleUnlock(k)}
                              className="btn-secondary text-xs px-2.5 py-1.5 text-amber-600 border-amber-200 hover:bg-amber-50"
                            >
                              <LockOpen className="w-3.5 h-3.5" /> Buka Kunci
                            </button>
                          ) : k.status === "admin_unlocked" ? (
                            <button
                              onClick={() => handleRelock(k)}
                              className="btn-secondary text-xs px-2.5 py-1.5 text-red-600 border-red-200 hover:bg-red-50"
                            >
                              <Lock className="w-3.5 h-3.5" /> Re-Lock
                            </button>
                          ) : null
                        )}

                        {/* Expand */}
                        <button
                          onClick={() => toggleExpand(k.id)}
                          className="btn-ghost text-xs px-2.5 py-1.5"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                      </div>
                    </div>

                    {/* Expanded scans */}
                    {isExpanded && (
                      <div className="border-t border-slate-100 bg-slate-50 p-4">
                        {loadingScans === k.id ? (
                          <div className="flex justify-center py-4">
                            <Loader2 className="w-5 h-5 animate-spin text-green-600" />
                          </div>
                        ) : !scans || scans.length === 0 ? (
                          <p className="text-slate-400 text-sm text-center py-2">Tidak ada resi</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                                  <th className="pb-2 pr-4">No.</th>
                                  <th className="pb-2 pr-4">Kode Resi</th>
                                  <th className="pb-2 pr-4">Di Scan Oleh</th>
                                  <th className="pb-2">Waktu Scan</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {scans.map((s, i) => (
                                  <tr key={i} className="text-slate-700">
                                    <td className="py-1.5 pr-4 text-slate-400">{i + 1}</td>
                                    <td className="py-1.5 pr-4 font-mono text-xs">{s.noResi}</td>
                                    <td className="py-1.5 pr-4">{s.scannedByName}</td>
                                    <td className="py-1.5 text-xs text-slate-400">
                                      {formatDateTime(s.scannedAt)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === "audit" && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">Audit Log</h2>
            <button onClick={loadAudit} className="btn-ghost text-xs">
              <Loader2 className={cn("w-3.5 h-3.5", auditLoading && "animate-spin")} />
              Refresh
            </button>
          </div>
          {auditLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-green-600" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3">Waktu</th>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Aksi</th>
                    <th className="px-4 py-3">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-xs text-slate-400 whitespace-nowrap">
                        {log.timestamp?.toDate
                          ? formatDateTime(log.timestamp.toDate())
                          : "-"}
                      </td>
                      <td className="px-4 py-2.5 font-medium">{log.userName}</td>
                      <td className="px-4 py-2.5">
                        <span className="badge-info font-mono text-xs">{log.action}</span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 text-xs">{log.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
