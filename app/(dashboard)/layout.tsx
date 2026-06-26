"use client";

import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import AuthGuard from "@/components/AuthGuard";
import { Menu } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { appUser } = useAuth();

  return (
    <AuthGuard>
      <div className="min-h-screen bg-slate-50">
        <div className="no-print"><Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} /></div>

        {/* Main content area — offset for sidebar on desktop */}
        <div className="lg:pl-64 min-h-screen flex flex-col print:pl-0">
          {/* Top bar */}
          <header className="no-print sticky top-0 z-20 bg-white border-b border-slate-200 px-4 lg:px-6 py-3 flex items-center gap-3">
            <button
              className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex-1" />
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-500 hidden sm:block">
                {appUser?.name}
              </span>
              <div className="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center text-white text-sm font-semibold">
                {appUser?.name?.charAt(0).toUpperCase()}
              </div>
            </div>
          </header>

          {/* Page content */}
          <main className="flex-1 p-4 lg:p-6">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}
