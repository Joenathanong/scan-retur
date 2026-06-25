import {
  collection,
  doc,
  getDoc,
  getDocs,
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
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
  AppUser,
  Expedisi,
  Karung,
  ScanRecord,
  CompanySettings,
  AuditLog,
  KarungStatus,
} from "@/types";

// ─── SETTINGS ──────────────────────────────────────────────────────────────

export async function getSettings(): Promise<CompanySettings> {
  const snap = await getDoc(doc(db, "settings", "company"));
  if (snap.exists()) return snap.data() as CompanySettings;
  return {
    namaPerusahaan: "PT. IEG",
    noteTandaTerima:
      "Seluruh karung yang diserahkan sudah di scan dan disaksikan oleh pihak yang menyerahkan barang. tanda terima ini menjadi bukti yang sah, untuk tanda terima barang dari expedisi ke PT. IEG",
    spreadsheetId: "",
    updatedAt: null,
    updatedBy: null,
  };
}

export async function saveSettings(
  data: Partial<CompanySettings>,
  uid: string
) {
  await updateDoc(doc(db, "settings", "company"), {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

export async function initSettings() {
  const ref = doc(db, "settings", "company");
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await updateDoc(ref, {
      namaPerusahaan: "PT. IEG",
      noteTandaTerima:
        "Seluruh karung yang diserahkan sudah di scan dan disaksikan oleh pihak yang menyerahkan barang. tanda terima ini menjadi bukti yang sah, untuk tanda terima barang dari expedisi ke PT. IEG",
      spreadsheetId: "",
      updatedAt: null,
      updatedBy: null,
    }).catch(() => {
      // If doc doesn't exist, create via set
      import("firebase/firestore").then(({ setDoc }) =>
        setDoc(ref, {
          namaPerusahaan: "PT. IEG",
          noteTandaTerima:
            "Seluruh karung yang diserahkan sudah di scan dan disaksikan oleh pihak yang menyerahkan barang. tanda terima ini menjadi bukti yang sah, untuk tanda terima barang dari expedisi ke PT. IEG",
          spreadsheetId: "",
          updatedAt: null,
          updatedBy: null,
        })
      );
    });
  }
}

// ─── USERS ─────────────────────────────────────────────────────────────────

export async function getUsers(): Promise<AppUser[]> {
  const snap = await getDocs(
    query(collection(db, "users"), orderBy("createdAt", "desc"))
  );
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() } as AppUser));
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
  await import("firebase/firestore").then(({ setDoc }) =>
    setDoc(doc(db, "users", uid), {
      ...data,
      createdAt: serverTimestamp(),
    })
  );
}

export async function updateUser(uid: string, data: Partial<AppUser>) {
  await updateDoc(doc(db, "users", uid), data);
}

export async function toggleUserActive(uid: string, active: boolean) {
  await updateDoc(doc(db, "users", uid), { active });
}

// ─── EXPEDISI ──────────────────────────────────────────────────────────────

export async function getExpedisiList(): Promise<Expedisi[]> {
  const snap = await getDocs(
    query(
      collection(db, "expedisi"),
      where("active", "==", true),
      orderBy("name", "asc")
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Expedisi));
}

export async function getAllExpedisi(): Promise<Expedisi[]> {
  const snap = await getDocs(
    query(collection(db, "expedisi"), orderBy("name", "asc"))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Expedisi));
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

export async function deleteExpedisi(id: string) {
  await updateDoc(doc(db, "expedisi", id), { active: false });
}

// ─── KARUNG ────────────────────────────────────────────────────────────────

export async function getTodayKarungByExpedisi(
  expedisiId: string,
  date: string
): Promise<Karung[]> {
  const snap = await getDocs(
    query(
      collection(db, "karung"),
      where("expedisiId", "==", expedisiId),
      where("date", "==", date),
      orderBy("createdAt", "desc")
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Karung));
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
    // Auto-relock after 24 hours
    if (karung.adminUnlockedAt) {
      const unlockTime = karung.adminUnlockedAt.toMillis();
      const now = Date.now();
      if (now - unlockTime > 24 * 60 * 60 * 1000) return true;
    }
    return false;
  }
  return false;
}

export async function lockKarung(
  id: string,
  uid: string,
  userName: string
) {
  await updateDoc(doc(db, "karung", id), {
    status: "locked",
    lockedAt: serverTimestamp(),
    lockedBy: uid,
    printedAt: serverTimestamp(),
  });
  await addAuditLog(uid, userName, "LOCK_KARUNG", `Lock karung ID: ${id}`);
}

export async function unlockKarung(
  id: string,
  uid: string,
  userName: string
) {
  await updateDoc(doc(db, "karung", id), {
    status: "admin_unlocked",
    adminUnlockedAt: serverTimestamp(),
    adminUnlockedBy: uid,
  });
  await addAuditLog(
    uid,
    userName,
    "ADMIN_UNLOCK_KARUNG",
    `Admin unlock karung ID: ${id}`
  );
}

export async function relockKarung(
  id: string,
  uid: string,
  userName: string
) {
  await updateDoc(doc(db, "karung", id), {
    status: "locked",
    adminUnlockedAt: null,
    adminUnlockedBy: null,
  });
  await addAuditLog(
    uid,
    userName,
    "ADMIN_RELOCK_KARUNG",
    `Admin re-lock karung ID: ${id}`
  );
}

// ─── SCAN RECORDS ──────────────────────────────────────────────────────────

export async function checkDuplicateResi(
  karungId: string,
  noResi: string
): Promise<boolean> {
  const snap = await getDocs(
    query(
      collection(db, "scans"),
      where("karungId", "==", karungId),
      where("noResi", "==", noResi),
      limit(1)
    )
  );
  return !snap.empty;
}

export async function addScanRecord(
  data: Omit<ScanRecord, "id">
): Promise<ScanRecord> {
  const ref = await addDoc(collection(db, "scans"), data);
  // Increment counter on karung
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

export async function getScansByKarung(karungId: string): Promise<ScanRecord[]> {
  const snap = await getDocs(
    query(
      collection(db, "scans"),
      where("karungId", "==", karungId),
      where("status", "==", "success"),
      orderBy("scannedAt", "asc")
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ScanRecord));
}

export async function getScansByDate(date: string): Promise<ScanRecord[]> {
  const snap = await getDocs(
    query(
      collection(db, "scans"),
      where("date", "==", date),
      where("status", "==", "success"),
      orderBy("scannedAt", "asc")
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ScanRecord));
}

export function subscribeKarungScans(
  karungId: string,
  callback: (scans: ScanRecord[]) => void
) {
  return onSnapshot(
    query(
      collection(db, "scans"),
      where("karungId", "==", karungId),
      where("status", "==", "success"),
      orderBy("scannedAt", "desc"),
      limit(50)
    ),
    (snap) => {
      callback(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as ScanRecord))
      );
    }
  );
}

export async function getKarungHistory(
  dateFrom: string,
  dateTo: string
): Promise<Karung[]> {
  const snap = await getDocs(
    query(
      collection(db, "karung"),
      where("date", ">=", dateFrom),
      where("date", "<=", dateTo),
      orderBy("date", "desc"),
      orderBy("createdAt", "desc")
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Karung));
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
  await addDoc(collection(db, "auditLog"), {
    userId,
    userName,
    action,
    detail,
    metadata: metadata || {},
    timestamp: serverTimestamp(),
  });
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
