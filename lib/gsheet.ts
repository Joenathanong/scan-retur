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

/**
 * Kirim data scan ke G-Sheet via API.
 * Retry otomatis hingga 3x dengan jeda eksponensial (1s, 2s, 4s) untuk
 * menangani kasus server sibuk atau race condition "sheet already exists".
 */
export async function syncToSheet(payload: SyncPayload, maxRetries = 3): Promise<boolean> {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch("/api/gsheet/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) return true;

      // 5xx atau 429 (rate limit) → worth retrying
      if ((res.status >= 500 || res.status === 429) && attempt < maxRetries) {
        await delay(1000 * attempt); // 1s, 2s, 4s
        continue;
      }

      // 4xx lainnya → tidak ada gunanya retry
      return false;
    } catch {
      // Network error → retry
      if (attempt < maxRetries) await delay(1000 * attempt);
    }
  }
  return false;
}
