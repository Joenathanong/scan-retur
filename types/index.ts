import { Timestamp } from "firebase/firestore";

export type UserRole = "admin" | "operator";

export interface AppUser {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  createdAt: Timestamp;
  createdBy: string;
}

export interface Expedisi {
  id: string;
  name: string;
  code: string;
  active: boolean;
  createdAt: Timestamp;
  createdBy: string;
}

export type KarungStatus = "open" | "locked" | "admin_unlocked";

export interface Karung {
  id: string;
  expedisiId: string;
  expedisiName: string;
  nomorKarung: string;
  date: string; // YYYY-MM-DD
  createdBy: string;      // uid
  createdByName: string;
  createdAt: Timestamp;
  status: KarungStatus;
  lockedAt: Timestamp | null;
  lockedBy: string | null;    // uid who triggered print
  printedAt: Timestamp | null;
  adminUnlockedAt: Timestamp | null;
  adminUnlockedBy: string | null;
  totalResi: number;
}

export type ScanStatus = "success" | "duplicate";

export interface ScanRecord {
  id: string;
  karungId: string;
  expedisiId: string;
  expedisiName: string;
  nomorKarung: string;
  noResi: string;
  scannedBy: string;      // uid
  scannedByName: string;
  scannedAt: Timestamp;
  date: string;           // YYYY-MM-DD
  status: ScanStatus;
  syncedToSheet: boolean;
}

export interface CompanySettings {
  namaPerusahaan: string;
  noteTandaTerima: string;
  spreadsheetId: string;
  updatedAt: Timestamp | null;
  updatedBy: string | null;
}

export interface AuditLog {
  id: string;
  action: string;
  userId: string;
  userName: string;
  detail: string;
  timestamp: Timestamp;
  metadata?: Record<string, string>;
}

// For the scan session (client-side state)
export interface ScanSession {
  expedisi: Expedisi;
  karung: Karung;
}

// For print
export interface PrintData {
  karung: Karung;
  scans: ScanRecord[];
  settings: CompanySettings;
}
