"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  getAllExpedisi,
  createExpedisi,
  updateExpedisi,
  deleteExpedisi,
  addAuditLog,
} from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import type { Expedisi } from "@/types";
import {
  Truck,
  Plus,
  Edit2,
  Trash2,
  Check,
  X,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function AdminExpedisiPage() {
  const { appUser } = useAuth();
  const [list, setList] = useState<Expedisi[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<Expedisi | null>(null);
  const [formName, setFormName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [actionId, setActionId]         = useState<string | null>(null);
  const [delConfirmId, setDelConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting]         = useState(false);

  const load = async () => {
    setLoading(true);
    setList(await getAllExpedisi());
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditItem(null);
    setFormName("");
    setError("");
    setShowModal(true);
  };

  const openEdit = (item: Expedisi) => {
    setEditItem(item);
    setFormName(item.name);
    setError("");
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) { setError("Nama wajib diisi"); return; }
    if (!appUser) return;
    setSaving(true);
    setError("");
    try {
      if (editItem) {
        const newCode = formName.toUpperCase().replace(/\s+/g, "_").slice(0, 20);
        await updateExpedisi(editItem.id, { name: formName.trim(), code: newCode });
        await addAuditLog(appUser.uid, appUser.name, "UPDATE_EXPEDISI", `Update expedisi: ${formName}`);
      } else {
        await createExpedisi(formName.trim(), appUser.uid, appUser.name);
      }
      setShowModal(false);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: Expedisi) => {
    if (!appUser) return;
    setDeleting(true);
    try {
      await deleteExpedisi(item.id);
      await addAuditLog(appUser.uid, appUser.name, "DELETE_EXPEDISI", `Hapus expedisi: ${item.name}`);
      setDelConfirmId(null);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleActive = async (item: Expedisi) => {
    if (!appUser) return;
    setActionId(item.id);
    await updateExpedisi(item.id, { active: !item.active });
    await addAuditLog(
      appUser.uid,
      appUser.name,
      item.active ? "DEACTIVATE_EXPEDISI" : "ACTIVATE_EXPEDISI",
      `${item.active ? "Nonaktifkan" : "Aktifkan"} expedisi: ${item.name}`
    );
    load();
    setActionId(null);
  };

  const filtered = list.filter((e) =>
    !search || e.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AuthGuard adminOnly>
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Truck className="w-6 h-6 text-green-600" /> Master Ekspedisi
            </h1>
            <p className="text-slate-500 mt-1">Kelola data master ekspedisi</p>
          </div>
          <button onClick={openCreate} className="btn-primary">
            <Plus className="w-4 h-4" /> Tambah
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field pl-9"
            placeholder="Cari ekspedisi..."
          />
        </div>

        <div className="card overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-green-600" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Truck className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Belum ada data ekspedisi</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                    <th className="px-4 py-3 text-left">Nama Ekspedisi</th>
                    <th className="px-4 py-3 text-left">Kode</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((exp) => (
                    <tr key={exp.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                            <Truck className="w-4 h-4 text-green-700" />
                          </div>
                          {exp.name}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <code className="bg-slate-100 px-2 py-0.5 rounded text-xs text-slate-600">
                          {exp.code}
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        <span className={exp.active ? "badge-success" : "badge-danger"}>
                          {exp.active ? "Aktif" : "Nonaktif"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 justify-end">
                          {/* Edit */}
                          <button
                            onClick={() => { openEdit(exp); setDelConfirmId(null); }}
                            className="btn-ghost px-2.5 py-1.5 text-xs"
                            title="Edit"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          {/* Toggle aktif */}
                          {actionId === exp.id ? (
                            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                          ) : (
                            <button
                              onClick={() => { handleToggleActive(exp); setDelConfirmId(null); }}
                              className={cn(
                                "btn-ghost px-2.5 py-1.5 text-xs",
                                exp.active ? "text-orange-500 hover:bg-orange-50" : "text-green-600 hover:bg-green-50"
                              )}
                              title={exp.active ? "Nonaktifkan" : "Aktifkan"}
                            >
                              {exp.active
                                ? <><ToggleRight className="w-3.5 h-3.5" /> Nonaktifkan</>
                                : <><ToggleLeft  className="w-3.5 h-3.5" /> Aktifkan</>
                              }
                            </button>
                          )}

                          {/* Delete */}
                          {delConfirmId === exp.id ? (
                            <div className="flex items-center gap-1 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
                              <span className="text-xs text-red-600 font-medium">Hapus?</span>
                              <button
                                onClick={() => handleDelete(exp)}
                                disabled={deleting}
                                className="p-0.5 text-red-600 hover:bg-red-100 rounded"
                                title="Ya, hapus"
                              >
                                {deleting
                                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  : <Check className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                onClick={() => setDelConfirmId(null)}
                                className="p-0.5 text-slate-400 hover:bg-slate-100 rounded"
                                title="Batal"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDelConfirmId(exp.id)}
                              className="btn-ghost px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-50 hover:text-red-600"
                              title="Hapus permanen"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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

        {/* Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="font-semibold text-slate-800">
                  {editItem ? "Edit Ekspedisi" : "Tambah Ekspedisi"}
                </h2>
                <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                    Nama Ekspedisi
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSave()}
                    className="input-field"
                    placeholder="Misal: JNE, TIKI, SICEPAT, J&T"
                    autoFocus
                  />
                  {formName && (
                    <p className="text-xs text-slate-400 mt-1">
                      Kode: <code>{formName.toUpperCase().replace(/\s+/g, "_").slice(0, 20)}</code>
                    </p>
                  )}
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
                  Simpan
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
