"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  getUsers,
  updateUser,
  toggleUserActive,
  addAuditLog,
} from "@/lib/firestore";
import { auth } from "@/lib/firebase";
import { sendPasswordResetEmail } from "firebase/auth";
import AuthGuard from "@/components/AuthGuard";
import type { AppUser, UserRole } from "@/types";
import {
  Users,
  Plus,
  Loader2,
  Check,
  X,
  Edit2,
  UserX,
  UserCheck,
  Eye,
  EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface UserForm {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

const defaultForm: UserForm = { name: "", email: "", password: "", role: "operator" };

export default function AdminUsersPage() {
  const { appUser } = useAuth();

  const [users, setUsers]               = useState<AppUser[]>([]);
  const [loading, setLoading]           = useState(true);
  const [showModal, setShowModal]       = useState(false);
  const [editUser, setEditUser]         = useState<AppUser | null>(null);
  const [form, setForm]                 = useState<UserForm>(defaultForm);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState("");
  const [showPw, setShowPw]             = useState(false);
  const [successMsg, setSuccessMsg]     = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    setUsers(await getUsers());
    setLoading(false);
  };

  useEffect(() => { loadUsers(); }, []);

  const openCreate = () => {
    setEditUser(null);
    setForm(defaultForm);
    setError("");
    setShowModal(true);
  };

  const openEdit = (u: AppUser) => {
    setEditUser(u);
    setForm({ name: u.name, email: u.email, password: "", role: u.role });
    setError("");
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.email.trim()) {
      setError("Nama dan email wajib diisi");
      return;
    }
    if (!editUser && !form.password) {
      setError("Password wajib diisi untuk user baru");
      return;
    }
    if (form.password && form.password.length < 6) {
      setError("Password minimal 6 karakter");
      return;
    }
    if (!appUser) return;

    setSaving(true);
    setError("");

    try {
      if (editUser) {
        // ── Edit mode ─────────────────────────────────────────────────────
        await updateUser(editUser.uid, { name: form.name.trim(), role: form.role });
        if (form.password) {
          await sendPasswordResetEmail(auth, editUser.email);
          setSuccessMsg(`Email reset password dikirim ke ${editUser.email}`);
        }
        await addAuditLog(
          appUser.uid,
          appUser.name,
          "UPDATE_USER",
          `Update user: ${editUser.email} → role: ${form.role}`
        );
      } else {
        // ── Create mode: gunakan API route (Admin SDK, tidak ubah sesi) ───
        const res = await fetch("/api/admin/create-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name:      form.name.trim(),
            email:     form.email.trim(),
            password:  form.password,
            role:      form.role,
            createdBy: appUser.uid,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Gagal membuat user");
          setSaving(false);
          return;
        }

        setSuccessMsg(`User ${form.email} berhasil dibuat!`);
      }

      setShowModal(false);
      // Reload list setelah create/update
      await loadUsers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (u: AppUser) => {
    if (!appUser) return;
    setActionLoading(u.uid);
    await toggleUserActive(u.uid, !u.active);
    await addAuditLog(
      appUser.uid,
      appUser.name,
      u.active ? "DEACTIVATE_USER" : "ACTIVATE_USER",
      `${u.active ? "Nonaktifkan" : "Aktifkan"} user: ${u.email}`
    );
    await loadUsers();
    setActionLoading(null);
  };

  return (
    <AuthGuard adminOnly>
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Users className="w-6 h-6 text-green-600" /> Kelola User
            </h1>
            <p className="text-slate-500 mt-1">Manajemen akun pengguna sistem</p>
          </div>
          <button onClick={openCreate} className="btn-primary">
            <Plus className="w-4 h-4" /> Tambah User
          </button>
        </div>

        {/* Success message */}
        {successMsg && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-800 flex items-center justify-between">
            <span>{successMsg}</span>
            <button onClick={() => setSuccessMsg("")} className="text-green-600 hover:text-green-800">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="card overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-green-600" />
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Belum ada user terdaftar</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="px-4 py-3">Nama</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => (
                    <tr key={u.uid} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-semibold text-sm flex-shrink-0">
                            {u.name.charAt(0).toUpperCase()}
                          </div>
                          <span>{u.name}</span>
                          {u.uid === appUser?.uid && (
                            <span className="badge-info text-xs">Anda</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{u.email}</td>
                      <td className="px-4 py-3">
                        <span className={u.role === "admin" ? "badge-warning" : "badge-success"}>
                          {u.role === "admin" ? "Admin" : "Operator"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={u.active ? "badge-success" : "badge-danger"}>
                          {u.active ? "Aktif" : "Nonaktif"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 justify-end">
                          <button
                            onClick={() => openEdit(u)}
                            className="btn-ghost px-2.5 py-1.5 text-xs"
                            title="Edit user"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          {u.uid !== appUser?.uid && (
                            actionLoading === u.uid ? (
                              <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                            ) : (
                              <button
                                onClick={() => handleToggleActive(u)}
                                className={cn(
                                  "btn-ghost px-2.5 py-1.5 text-xs",
                                  u.active
                                    ? "text-red-500 hover:bg-red-50"
                                    : "text-green-600 hover:bg-green-50"
                                )}
                              >
                                {u.active
                                  ? <><UserX className="w-3.5 h-3.5" /> Nonaktifkan</>
                                  : <><UserCheck className="w-3.5 h-3.5" /> Aktifkan</>
                                }
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="font-semibold text-slate-800">
                  {editUser ? "Edit User" : "Tambah User Baru"}
                </h2>
                <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                    Nama Lengkap
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="input-field"
                    placeholder="Nama lengkap"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                    Email
                  </label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="input-field"
                    placeholder="email@perusahaan.com"
                    disabled={!!editUser}
                  />
                  {editUser && (
                    <p className="text-xs text-slate-400 mt-1">Email tidak bisa diubah</p>
                  )}
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                    {editUser ? "Password Baru (opsional)" : "Password"}
                  </label>
                  <div className="relative">
                    <input
                      type={showPw ? "text" : "password"}
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      className="input-field pr-10"
                      placeholder={editUser ? "Kosongkan jika tidak diubah" : "Min. 6 karakter"}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(!showPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                    >
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {editUser && (
                    <p className="text-xs text-slate-400 mt-1">
                      Jika diisi, email reset password akan dikirim ke user.
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                    Role
                  </label>
                  <select
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
                    className="input-field"
                  >
                    <option value="operator">Operator — hanya bisa scan</option>
                    <option value="admin">Admin — full access</option>
                  </select>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                )}
              </div>

              <div className="px-6 pb-6 flex justify-end gap-2">
                <button onClick={() => setShowModal(false)} className="btn-secondary">
                  Batal
                </button>
                <button onClick={handleSave} disabled={saving} className="btn-primary">
                  {saving
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Menyimpan...</>
                    : <><Check className="w-4 h-4" /> {editUser ? "Simpan" : "Buat User"}</>
                  }
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
