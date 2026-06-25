"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import {
  getKarungHistory,
  getScansByDate,
  getAllExpedisi,
} from "@/lib/firestore";
import { todayString, formatDate, cn } from "@/lib/utils";
import type { Karung, ScanRecord, Expedisi } from "@/types";
import {
  ScanLine,
  Package,
  CheckCircle2,
  Truck,
  TrendingUp,
  ArrowRight,
  Calendar,
  Loader2,
  Clock,
} from "lucide-react";

interface DayStats {
  date: string;
  totalResi: number;
  totalKarung: number;
}

export default function DashboardPage() {
  const { appUser } = useAuth();
  const router = useRouter();
  const today = todayString();

  const [loading, setLoading] = useState(true);
  const [todayScans, setTodayScans] = useState<ScanRecord[]>([]);
  const [todayKarung, setTodayKarung] = useState<Karung[]>([]);
  const [expedisiList, setExpedisiList] = useState<Expedisi[]>([]);
  const [weekStats, setWeekStats] = useState<DayStats[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [scans, allKarung, expList] = await Promise.all([
          getScansByDate(today),
          getKarungHistory(today, today),
          getAllExpedisi(),
        ]);
        setTodayScans(scans);
        setTodayKarung(allKarung);
        setExpedisiList(expList);

        // Load last 7 days
        const stats: DayStats[] = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const dateStr = d.toISOString().split("T")[0];
          const [dScans, dKarung] = await Promise.all([
            getScansByDate(dateStr),
            getKarungHistory(dateStr, dateStr),
          ]);
          stats.push({ date: dateStr, totalResi: dScans.length, totalKarung: dKarung.length });
        }
        setWeekStats(stats);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [today]);

  // Stats by expedisi today
  const expedisiStats = expedisiList.map((exp) => ({
    expedisi: exp,
    karung: todayKarung.filter((k) => k.expedisiId === exp.id),
    resi: todayScans.filter((s) => s.expedisiId === exp.id).length,
  })).filter((e) => e.karung.length > 0 || e.resi > 0);

  const maxResi = Math.max(...weekStats.map((s) => s.totalResi), 1);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Selamat datang, {appUser?.name?.split(" ")[0]} 👋
        </h1>
        <p className="text-slate-500 mt-1 flex items-center gap-1.5">
          <Calendar className="w-4 h-4" /> {formatDate(today)}
        </p>
      </div>

      {/* Quick action */}
      <button
        onClick={() => router.push("/scan")}
        className="w-full flex items-center justify-between bg-green-600 hover:bg-green-700 text-white
                   rounded-2xl px-6 py-5 shadow-lg shadow-green-200 transition-all active:scale-[0.99]"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
            <ScanLine className="w-6 h-6" />
          </div>
          <div className="text-left">
            <p className="font-bold text-lg">Mulai Scan Retur</p>
            <p className="text-green-100 text-sm">Tap untuk scan barang retur</p>
          </div>
        </div>
        <ArrowRight className="w-6 h-6 opacity-80" />
      </button>

      {/* Today stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard
          icon={<CheckCircle2 className="w-5 h-5 text-green-600" />}
          label="Resi Hari Ini"
          value={todayScans.length}
          color="green"
        />
        <StatCard
          icon={<Package className="w-5 h-5 text-blue-600" />}
          label="Karung Hari Ini"
          value={todayKarung.length}
          color="blue"
        />
        <StatCard
          icon={<Truck className="w-5 h-5 text-purple-600" />}
          label="Ekspedisi Aktif"
          value={expedisiStats.length}
          color="purple"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 7-day chart */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-5">
            <TrendingUp className="w-5 h-5 text-green-600" />
            <h2 className="font-semibold text-slate-800">Resi 7 Hari Terakhir</h2>
          </div>
          <div className="flex items-end gap-2 h-36">
            {weekStats.map((s) => {
              const height = maxResi > 0 ? (s.totalResi / maxResi) * 100 : 0;
              const isToday = s.date === today;
              return (
                <div key={s.date} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-slate-500">{s.totalResi || ""}</span>
                  <div className="w-full flex items-end" style={{ height: "80px" }}>
                    <div
                      className={cn(
                        "w-full rounded-t-lg transition-all",
                        isToday ? "bg-green-500" : "bg-green-200"
                      )}
                      style={{ height: `${Math.max(height, s.totalResi > 0 ? 8 : 2)}%` }}
                    />
                  </div>
                  <span className={cn(
                    "text-xs",
                    isToday ? "text-green-600 font-bold" : "text-slate-400"
                  )}>
                    {new Date(s.date + "T00:00:00").toLocaleDateString("id-ID", { weekday: "short" })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Today per expedisi */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Truck className="w-5 h-5 text-green-600" />
            <h2 className="font-semibold text-slate-800">Rekap Hari Ini per Ekspedisi</h2>
          </div>
          {expedisiStats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-slate-400">
              <Clock className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm">Belum ada scan hari ini</p>
            </div>
          ) : (
            <div className="space-y-3">
              {expedisiStats.map(({ expedisi, karung, resi }) => (
                <div key={expedisi.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <div className="w-9 h-9 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Truck className="w-4 h-4 text-green-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 text-sm truncate">{expedisi.name}</p>
                    <p className="text-xs text-slate-400">{karung.length} karung</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-green-600 text-lg leading-none">{resi}</p>
                    <p className="text-xs text-slate-400">resi</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: "green" | "blue" | "purple";
}) {
  const colors = {
    green:  "bg-green-50 border-green-100",
    blue:   "bg-blue-50 border-blue-100",
    purple: "bg-purple-50 border-purple-100",
  };
  return (
    <div className={cn("card p-4 border", colors[color])}>
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs text-slate-500">{label}</span></div>
      <p className="text-3xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
