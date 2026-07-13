import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  serverTimestamp,
  onSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
  AppUser,
  Expedisi,
  Karung,
  ScanRecord,
  CompanySettings,
  ClaimSheetConfig,
  ClaimExpedisiSheet,
  AuditLog,
  KarungStatus,
} from "@/types";

// ─── SETTINGS ──────────────────────────────────────────────────────────────

export async function getSettings(): Promise<CompanySettings> {
  try {
    const snap = await getDoc(doc(db, "settings", "company"));
    if (snap.exists()) return snap.data() as CompanySettings;
  } catch { /* ignore */ }
  return {
    namaPerusahaan: "PT. IEG",
    noteTandaTerima:
      "Seluruh karung yang diserahkan sudah di scan dan disaksikan oleh pihak yang menyerahkan barang. tanda terima ini menjadi bukti yang sah, untuk tanda terima barang dari expedisi ke PT. IEG",
    spreadsheetId: "",
    updatedAt: null,
    updatedBy: null,
  };
}

export async function saveSettings(data: Partial<CompanySettings>, uid: string) {
  await setDoc(
    doc(db, "settings", "company"),
    { ...data, updatedAt: serverTimestamp(), updatedBy: uid },
    { merge: true }
  );
}

/** Inisialisasi settings dengan nilai default jika belum ada. */
export async function initSettings(uid: string) {
  const snap = await getDoc(doc(db, "settings", "company"));
  if (!snap.exists()) {
    await setDoc(doc(db, "settings", "company"), {
      namaPerusahaan: "PT. IEG",
      noteTandaTerima:
        "Seluruh karung yang diserahkan sudah di scan dan disaksikan oleh pihak yang menyerahkan barang. tanda terima ini menjadi bukti yang sah, untuk tanda terima barang dari expedisi ke PT. IEG",
      spreadsheetId: "",
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    });
  }
}

// ─── USERS ─────────────────────────────────────────────────────────────────

export async function getUsers(): Promise<AppUser[]> {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs
    .map((d) => ({ uid: d.id, ...d.data() } as AppUser))
    .sort((a, b) => {
      const ta = (a.createdAt as Timestamp)?.seconds ?? 0;
      const tb = (b.createdAt as Timestamp)?.seconds ?? 0;
      return tb - ta;
    });
}

export async function getUser(uid: string): Promise<AppUser | null> {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  return { uid: snap.id, ...snap.data() } as AppUser;
}

export async function createUserDoc(
  uid: string,
  data: Omit<AppUser, "uid" | "createdAt">
) {
  await setDoc(doc(db, "users", uid), {
    ...data,
    createdAt: serverTimestamp(),
  });
}

export async function updateUser(uid: string, data: Partial<AppUser>) {
  await updateDoc(doc(db, "users", uid), data);
}

export async function toggleUserActive(uid: string, active: boolean) {
  await updateDoc(doc(db, "users", uid), { active });
}

// ─── EXPEDISI ──────────────────────────────────────────────────────────────

/** Ambil semua expedisi aktif. Sort client-side — tidak butuh composite index. */
export async function getExpedisiList(): Promise<Expedisi[]> {
  const snap = await getDocs(
    query(collection(db, "expedisi"), where("active", "==", true))
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Expedisi))
    .sort((a, b) => a.name.localeCompare(b.name, "id"));
}

export async function getAllExpedisi(): Promise<Expedisi[]> {
  const snap = await getDocs(collection(db, "expedisi"));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Expedisi))
    .sort((a, b) => a.name.localeCompare(b.name, "id"));
}

export async function getExpedisiById(id: string): Promise<Expedisi | null> {
  const snap = await getDoc(doc(db, "expedisi", id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Expedisi;
}

/**
 * Cari expedisi berdasarkan nama (case-insensitive).
 * Returns null jika tidak ada.
 */
export async function findExpedisiByName(name: string): Promise<Expedisi | null> {
  const snap = await getDocs(collection(db, "expedisi"));
  const normalized = name.trim().toLowerCase();
  const found = snap.docs.find(
    (d) => (d.data().name as string).toLowerCase() === normalized
  );
  if (!found) return null;
  return { id: found.id, ...found.data() } as Expedisi;
}

export async function createExpedisi(
  name: string,
  uid: string,
  userName: string
): Promise<Expedisi> {
  const code = name.toUpperCase().replace(/\s+/g, "_").slice(0, 20);
  const ref = await addDoc(collection(db, "expedisi"), {
    name,
    code,
    active: true,
    createdAt: serverTimestamp(),
    createdBy: uid,
  });
  await addAuditLog(uid, userName, "CREATE_EXPEDISI", `Buat expedisi: ${name}`);
  return { id: ref.id, name, code, active: true, createdAt: Timestamp.now(), createdBy: uid };
}

export async function updateExpedisi(id: string, data: Partial<Expedisi>) {
  await updateDoc(doc(db, "expedisi", id), data);
}

/** Hapus permanen expedisi dari Firestore. */
export async function deleteExpedisi(id: string) {
  await deleteDoc(doc(db, "expedisi", id));
}

// ── KARUNG NOMOR EDIT ───────────────────────────────────────────────────────
export async function updateKarungNomor(
  id: string,
  nomorKarung: string,
  uid: string,
  userName: string
) {
  await updateDoc(doc(db, "karung", id), { nomorKarung });
  await addAuditLog(uid, userName, "EDIT_KARUNG_NOMOR", `Edit nomor karung ID ${id} → ${nomorKarung}`);
}

// ── DELETE KARUNG (hanya yang kosong / totalResi === 0) ────────────────────
export async function deleteKarung(
  id: string,
  nomorKarung: string,
  uid: string,
  userName: string
) {
  const karungDoc = await getDoc(doc(db, "karung", id));
  if (!karungDoc.exists()) throw new Error("Karung tidak ditemukan");
  const data = karungDoc.data();
  if ((data?.totalResi ?? 0) > 0) throw new Error("Karung tidak kosong, tidak bisa dihapus");
  await deleteDoc(doc(db, "karung", id));
  await addAuditLog(uid, userName, "DELETE_KARUNG", `Hapus karung #${nomorKarung} (ID: ${id})`);
}

// ─── KARUNG ────────────────────────────────────────────────────────────────

/**
 * Karung hari ini untuk expedisi tertentu.
 * Hanya filter expedisiId + date — tidak butuh composite index.
 */
export async function getTodayKarungByExpedisi(
  expedisiId: string,
  date: string
): Promise<Karung[]> {
  const snap = await getDocs(
    query(
      collection(db, "karung"),
      where("expedisiId", "==", expedisiId),
      where("date", "==", date)
    )
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Karung))
    .sort((a, b) => {
      const ta = (a.createdAt as Timestamp)?.seconds ?? 0;
      const tb = (b.createdAt as Timestamp)?.seconds ?? 0;
      return tb - ta; // desc
    });
}

export async function createKarung(
  expedisiId: string,
  expedisiName: string,
  nomorKarung: string,
  date: string,
  uid: string,
  userName: string
): Promise<Karung> {
  const ref = await addDoc(collection(db, "karung"), {
    expedisiId,
    expedisiName,
    nomorKarung,
    date,
    createdBy: uid,
    createdByName: userName,
    createdAt: serverTimestamp(),
    status: "open" as KarungStatus,
    lockedAt: null,
    lockedBy: null,
    printedAt: null,
    adminUnlockedAt: null,
    adminUnlockedBy: null,
    totalResi: 0,
  });
  await addAuditLog(
    uid,
    userName,
    "CREATE_KARUNG",
    `Buat karung ${nomorKarung} untuk ${expedisiName}`
  );
  return {
    id: ref.id,
    expedisiId,
    expedisiName,
    nomorKarung,
    date,
    createdBy: uid,
    createdByName: userName,
    createdAt: Timestamp.now(),
    status: "open",
    lockedAt: null,
    lockedBy: null,
    printedAt: null,
    adminUnlockedAt: null,
    adminUnlockedBy: null,
    totalResi: 0,
  };
}

export async function getKarung(id: string): Promise<Karung | null> {
  const snap = await getDoc(doc(db, "karung", id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Karung;
}

export function isKarungLocked(karung: Karung): boolean {
  if (karung.status === "open") return false;
  if (karung.status === "locked") return true;
  if (karung.status === "admin_unlocked") {
    if (karung.adminUnlockedAt) {
      const unlockTime = (karung.adminUnlockedAt as Timestamp).toMillis();
      if (Date.now() - unlockTime > 24 * 60 * 60 * 1000) return true;
    }
    return false;
  }
  return false;
}

export async function lockKarung(id: string, uid: string, userName: string) {
  await updateDoc(doc(db, "karung", id), {
    status: "locked",
    lockedAt: serverTimestamp(),
    lockedBy: uid,
    printedAt: serverTimestamp(),
  });
  await addAuditLog(uid, userName, "LOCK_KARUNG", `Lock karung ID: ${id}`);
}

export async function unlockKarung(id: string, uid: string, userName: string) {
  await updateDoc(doc(db, "karung", id), {
    status: "admin_unlocked",
    adminUnlockedAt: serverTimestamp(),
    adminUnlockedBy: uid,
  });
  await addAuditLog(uid, userName, "ADMIN_UNLOCK_KARUNG", `Admin unlock karung ID: ${id}`);
}

export async function relockKarung(id: string, uid: string, userName: string) {
  await updateDoc(doc(db, "karung", id), {
    status: "locked",
    adminUnlockedAt: null,
    adminUnlockedBy: null,
  });
  await addAuditLog(uid, userName, "ADMIN_RELOCK_KARUNG", `Admin re-lock karung ID: ${id}`);
}

/**
 * History karung berdasarkan range tanggal.
 * Filter date range dengan satu orderBy (wajib untuk range query).
 * Sort lanjutan dilakukan client-side.
 */
export async function getKarungHistory(
  dateFrom: string,
  dateTo: string
): Promise<Karung[]> {
  const snap = await getDocs(
    query(
      collection(db, "karung"),
      where("date", ">=", dateFrom),
      where("date", "<=", dateTo),
      orderBy("date", "asc")
    )
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Karung))
    .sort((a, b) => {
      // date desc
      if (b.date !== a.date) return b.date.localeCompare(a.date);
      // createdAt desc
      const ta = (a.createdAt as Timestamp)?.seconds ?? 0;
      const tb = (b.createdAt as Timestamp)?.seconds ?? 0;
      return tb - ta;
    });
}

// ─── SCAN RECORDS ──────────────────────────────────────────────────────────

/**
 * Cek duplikat resi secara GLOBAL (semua karung, semua expedisi).
 * Jika resi sudah pernah di-scan sukses di mana pun, return info karungnya.
 */
export async function checkDuplicateResi(
  _karungId: string,
  noResi: string
): Promise<{ isDuplicate: boolean; karungInfo?: string }> {
  const snap = await getDocs(
    query(
      collection(db, "scans"),
      where("noResi", "==", noResi),
      where("status", "==", "success"),
      limit(1)
    )
  );
  if (snap.empty) return { isDuplicate: false };
  const data = snap.docs[0].data();
  return {
    isDuplicate: true,
    karungInfo: `Karung #${data.nomorKarung} — ${data.expedisiName} (${data.date ?? ""})`,
  };
}

export async function addScanRecord(
  data: Omit<ScanRecord, "id">
): Promise<ScanRecord> {
  const ref = await addDoc(collection(db, "scans"), data);
  if (data.status === "success") {
    const karungRef = doc(db, "karung", data.karungId);
    const karungSnap = await getDoc(karungRef);
    if (karungSnap.exists()) {
      const current = (karungSnap.data().totalResi as number) || 0;
      await updateDoc(karungRef, { totalResi: current + 1 });
    }
  }
  return { id: ref.id, ...data };
}

/**
 * Ambil semua resi sukses untuk satu karung.
 * Filter hanya karungId — tidak butuh composite index.
 * Filter status + sort client-side.
 */
export async function getScansByKarung(karungId: string): Promise<ScanRecord[]> {
  const snap = await getDocs(
    query(collection(db, "scans"), where("karungId", "==", karungId))
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as ScanRecord))
    .filter((s) => s.status === "success")
    .sort((a, b) => {
      const ta = (a.scannedAt as Timestamp)?.seconds ?? 0;
      const tb = (b.scannedAt as Timestamp)?.seconds ?? 0;
      return ta - tb; // asc
    });
}

/**
 * Resi berdasarkan tanggal.
 * Filter date saja — sort + filter status client-side.
 */
export async function getScansByDate(date: string): Promise<ScanRecord[]> {
  const snap = await getDocs(
    query(collection(db, "scans"), where("date", "==", date))
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as ScanRecord))
    .filter((s) => s.status === "success")
    .sort((a, b) => {
      const ta = (a.scannedAt as Timestamp)?.seconds ?? 0;
      const tb = (b.scannedAt as Timestamp)?.seconds ?? 0;
      return ta - tb; // asc
    });
}

/**
 * Real-time listener untuk scan satu karung.
 * Filter hanya karungId — filter status + sort + limit client-side.
 */
export function subscribeKarungScans(
  karungId: string,
  callback: (scans: ScanRecord[]) => void
) {
  return onSnapshot(
    query(collection(db, "scans"), where("karungId", "==", karungId)),
    (snap) => {
      const scans = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as ScanRecord))
        .filter((s) => s.status === "success")
        .sort((a, b) => {
          const ta = (a.scannedAt as Timestamp)?.seconds ?? 0;
          const tb = (b.scannedAt as Timestamp)?.seconds ?? 0;
          return tb - ta; // desc (terbaru dulu)
        });
      callback(scans);
    }
  );
}

export async function markScanSynced(scanId: string) {
  await updateDoc(doc(db, "scans", scanId), { syncedToSheet: true });
}

// ─── AUDIT LOG ─────────────────────────────────────────────────────────────

export async function addAuditLog(
  userId: string,
  userName: string,
  action: string,
  detail: string,
  metadata?: Record<string, string>
) {
  try {
    await addDoc(collection(db, "auditLog"), {
      userId,
      userName,
      action,
      detail,
      metadata: metadata || {},
      timestamp: serverTimestamp(),
    });
  } catch { /* audit log gagal tidak boleh crash operasi utama */ }
}

export async function getAuditLogs(limitCount = 100): Promise<AuditLog[]> {
  const snap = await getDocs(
    query(
      collection(db, "auditLog"),
      orderBy("timestamp", "desc"),
      limit(limitCount)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as AuditLog));
}

// Claim config (settings/claim)

const CLAIM_DOC = "settings/claim";

export async function getClaimConfig(): Promise<ClaimSheetConfig> {
  const snap = await getDoc(doc(db, CLAIM_DOC));
  if (snap.exists()) {
    const d = snap.data();
    return {
      masterSpreadsheetId: d.masterSpreadsheetId ?? "",
      expedisiSheets:      d.expedisiSheets      ?? {},
    };
  }
  return { masterSpreadsheetId: "", expedisiSheets: {} };
}

export async function saveClaimMasterSheet(spreadsheetId: string): Promise<void> {
  await setDoc(doc(db, CLAIM_DOC), { masterSpreadsheetId: spreadsheetId }, { merge: true });
}

export async function saveClaimExpedisiSheet(
  code: string,
  sheet: ClaimExpedisiSheet
): Promise<void> {
  await setDoc(
    doc(db, CLAIM_DOC),
    { expedisiSheets: { [code]: sheet } },
    { merge: true }
  );
}

export async function saveClaimExpedisiSheets(
  sheets: Record<string, ClaimExpedisiSheet>
): Promise<void> {
  await setDoc(
    doc(db, CLAIM_DOC),
    { expedisiSheets: sheets },
    { merge: true }
  );
}
