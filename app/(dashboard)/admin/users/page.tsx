"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  getUsers,
  createUserDoc,
  updateUser,
  toggleUserActive,
  addAuditLog,
} from "@/lib/firestore";
import { auth } from "@/lib/firebase";
import {
  createUserWithEmailAndPassword,
  updatePassword,
  sendPasswordResetEmail,
} from "firebase/auth";
import AuthGuard from "@/components/AuthGuard";
import type { AppUser, UserRole } from "@/types";
import {
  Users,
  Plus,
  Loader2,
  Check,
  X,
  Edit2,
  Mail,
  KeyRound,
  UserCog,
  ShieldCheck,
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

  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<AppUser | null>(null);
  const [form, setForm] = useState<UserForm>(defaultForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState<string | null>(null);

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
    if (!form.name || !form.email) { setError("Nama dan email wajib diisi"); return; }
    if (!editUser && !form.password) { setError("Password wajib diisi untuk user baru"); return; }
    if (form.password && form.password.length < 6) { setError("Password minimal 6 karakter"); return; }
    if (!appUser) return;

    setSaving(true);
    setError("");
    try {
      if (editUser) {
        // Update existing
        await updateUser(editUser.uid, { name: form.name, role: form.role });
        if (form.password) {
          // Note: updating another user's password requires Admin SDK.
          // For simplicity, we send a reset email instead.
          await sendPasswordResetEmail(auth, editUser.email);
          setResetEmailSent(editUser.email);
        }
        await addAuditLog(appUser.uid, appUser.name, "UPDATE_USER", `Update user: ${form.email}`);
      } else {
        // Create new Firebase Auth user
        // Note: createUserWithEmailAndPassword signs in the NEW user.
        // In production, use Firebase Admin SDK via an API route to avoid this.
        // For now we use a workaround: create user, then immediately sign back.
        const adminEmail = appUser.email;
        const cred = await createUserWithEmailAndPassword(auth, form.email, form.password);
        await createUserDoc(cred.user.uid, {
          name: form.name,
          email: form.email,
          role: form.role,
          active: true,
          createdBy: appUser.uid,
        });
        await addAuditLog(appUser.uid, appUser.name, "CREATE_USER", `Buat user: ${form.email}`);
        // Sign admin back in
        // (In production use Admin SDK API route — see SETUP_GUIDE.md)
        alert("User berhasil dibuat. PENTING: Anda harus login kembali sebagai admin karena Firebase memindahkan sesi ke user baru. Gunakan fitur Create User via API untuk production.");
      }
      setShowModal(false);
      loadUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes("email-already-in-use") ? "Email sudah terdaftar" : msg);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (u: AppUser) => {
    if (!appUser) return;
    await toggleUserActive(u.uid, !u.active);
    await addAuditLog(
      appUser.uid,
      appUser.name,
      u.active ? "DEACTIVATE_USER" : "ACTIVATE_USER",
      `${u.active ? "Nonaktifkan" : "Aktifkan"} user: ${u.email}`
    );
    loadUsers();
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

        <div className="card overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-green-600" />
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
                          {u.name}
                          {u.uid === appUser?.uid && (
                            <span className="badge-info text-xs">Anda</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{u.email}</td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          u.role === "admin" ? "badge-warning" : "badge-success"
                        )}>
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
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          {u.uid !== appUser?.uid && (
                            <button
                              onClick={() => handleToggleActive(u)}
                              className={cn(
                                "btn-ghost px-2.5 py-1.5 text-xs",
                                u.active ? "text-red-500 hover:bg-red-50" : "text-green-600 hover:bg-green-50"
                              )}
                            >
                              {u.active
                                ? <><UserX className="w-3.5 h-3.5" /> Nonaktifkan</>
                                : <><UserCheck className="w-3.5 h-3.5" /> Aktifkan</>
                              }
                            </button>
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

        {resetEmailSent && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
            Email reset password telah dikirim ke <strong>{resetEmailSent}</strong>
          </div>
        )}

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
                  <label className="text-sm font-medium text-slate-700 mb-1.5 block">Nama Lengkap</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="input-field"
                    placeholder="Nama lengkap"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1.5 block">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="input-field"
                    placeholder="email@perusahaan.com"
                    disabled={!!editUser}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                    {editUser ? "Password Baru (kosongkan jika tidak diubah)" : "Password"}
                  </label>
                  <div className="relative">
                    <input
                      type={showPw ? "text" : "password"}
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      className="input-field pr-10"
                      placeholder={editUser ? "Kosongkan jika tidak diubah" : "Min. 6 karakter"}
                    />
                    <button type="button" onClick={() => setShowPw(!showPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {editUser && (
                    <p className="text-xs text-slate-400 mt-1">
                      Jika diisi, akan mengirimkan email reset password ke user.
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1.5 block">Role</label>
                  <select
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
                    className="input-field"
                  >
                    <option value="operator">Operator (Scan saja)</option>
                    <option value="admin">Admin (Full access)</option>
                  </select>
                </div>
                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                )}
              </div>
              <div className="px-6 pb-6 flex justify-end gap-2">
                <button onClick={() => setShowModal(false)} className="btn-secondary">Batal</button>
                <button onClick={handleSave} disabled={saving} className="btn-primary">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editUser ? "Simpan Perubahan" : "Buat User"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
