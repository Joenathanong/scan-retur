// Client-side helper that calls our own API route to sync a scan to Google Sheets.
// The actual Google Sheets API call is in /api/gsheet/sync (server-side).

export interface SyncPayload {
  scanId: string;
  noResi: string;
  nomorKarung: string;
  expedisiName: string;
  expedisiCode: string;
  scannedByName: string;
  scannedAt: string;   // "HH:mm:ss" — diformat di client agar timezone lokal (WIB), bukan UTC
  date: string;        // YYYY-MM-DD
  spreadsheetId: string;
}

export async function syncToSheet(payload: SyncPayload): Promise<boolean> {
  try {
    const res = await fetch("/api/gsheet/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}
