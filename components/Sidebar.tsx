"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  ScanLine,
  History,
  Printer,
  Table2,
  Package,
  Users,
  Truck,
  Settings,
  LogOut,
  X,
  ChevronRight,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard",    icon: <LayoutDashboard className="w-5 h-5" /> },
  { href: "/scan",      label: "Scan Retur",   icon: <ScanLine        className="w-5 h-5" /> },
  { href: "/history",   label: "History",      icon: <History         className="w-5 h-5" /> },
  { href: "/print",     label: "Print",        icon: <Printer         className="w-5 h-5" /> },
  { href: "/data",      label: "Data & Export", icon: <Table2         className="w-5 h-5" /> },
];

const adminItems: NavItem[] = [
  { href: "/claim",          label: "Kelola Claim",   icon: <Package  className="w-5 h-5" />, adminOnly: true },
  { href: "/admin/users",    label: "Kelola User",    icon: <Users    className="w-5 h-5" />, adminOnly: true },
  { href: "/admin/expedisi", label: "Master Expedisi",icon: <Truck    className="w-5 h-5" />, adminOnly: true },
  { href: "/admin/settings", label: "Pengaturan",     icon: <Settings className="w-5 h-5" />, adminOnly: true },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { appUser, signOut } = useAuth();

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(href));

  return (
    <>
      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-30 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-0 left-0 h-full w-64 bg-slate-900 flex flex-col z-40 transition-transform duration-300",
          "lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-green-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <ScanLine className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-semibold text-white text-sm">Scan Retur</p>
              <p className="text-slate-400 text-xs">PT. IEG</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden text-slate-400 hover:text-white p-1 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* User info */}
        <div className="px-4 py-3 mx-3 mt-3 bg-slate-800 rounded-xl">
          <p className="text-white text-sm font-medium truncate">{appUser?.name}</p>
          <p className="text-slate-400 text-xs truncate">{appUser?.email}</p>
          <span className={cn(
            "inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium",
            appUser?.role === "admin"
              ? "bg-amber-900 text-amber-300"
              : "bg-green-900 text-green-300"
          )}>
            {appUser?.role === "admin" ? "Admin" : "Operator"}
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
                isActive(item.href)
                  ? "bg-green-600 text-white shadow-sm"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              )}
            >
              {item.icon}
              <span className="flex-1">{item.label}</span>
              {isActive(item.href) && <ChevronRight className="w-4 h-4 opacity-60" />}
            </Link>
          ))}

          {appUser?.role === "admin" && (
            <>
              <div className="pt-4 pb-1">
                <p className="text-slate-500 text-xs uppercase tracking-wider px-3 font-medium">
                  Admin
                </p>
              </div>
              {adminItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
                    isActive(item.href)
                      ? "bg-green-600 text-white"
                      : "text-slate-300 hover:bg-slate-800 hover:text-white"
                  )}
                >
                  {item.icon}
                  <span className="flex-1">{item.label}</span>
                  {isActive(item.href) && <ChevronRight className="w-4 h-4 opacity-60" />}
                </Link>
              ))}
            </>
          )}
        </nav>

        {/* Sign out */}
        <div className="px-3 pb-4">
          <button
            onClick={signOut}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium
                       text-slate-300 hover:bg-red-900/50 hover:text-red-300 transition-all"
          >
            <LogOut className="w-5 h-5" />
            Keluar
          </button>
        </div>
      </aside>
    </>
  );
}
