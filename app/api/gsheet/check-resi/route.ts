import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

function getAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    key: (process.env.GOOGLE_SHEETS_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    scopes: SCOPES,
  });
}

/**
 * GET /api/gsheet/check-resi
 *
 * Cek apakah sebuah kode resi sudah ada di kolom B (Kode Resi) sheet tab tertentu.
 * Digunakan saat duplicate check Firestore menemukan resi yang sama — jika resi
 * TIDAK ada di G-Sheet (artinya sync sebelumnya gagal), scan ulang tetap diizinkan.
 *
 * Query params:
 *   spreadsheetId — ID spreadsheet Google Sheets
 *   sheetName     — nama tab, mis. "JNE_25-06-2026"
 *   noResi        — kode resi yang dicari
 *
 * Response:
 *   { exists: boolean }
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const spreadsheetId = searchParams.get("spreadsheetId");
    const sheetName     = searchParams.get("sheetName");
    const noResi        = searchParams.get("noResi");

    if (!spreadsheetId || !sheetName || !noResi) {
      return NextResponse.json({ error: "Missing params: spreadsheetId, sheetName, noResi" }, { status: 400 });
    }

    const auth   = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    let values: string[][] = [];
    try {
      // Baca kolom B saja (Kode Resi), lewati baris pertama (header)
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!B2:B`,
      });
      values = (res.data.values ?? []) as string[][];
    } catch (err: unknown) {
      // Sheet tab belum dibuat (belum ada scan) → resi pasti tidak ada
      const code = (err as { code?: number })?.code;
      if (code === 400 || code === 404) {
        return NextResponse.json({ exists: false });
      }
      throw err;
    }

    const needle = noResi.toUpperCase().trim();
    const exists = values.some(
      (row) => row[0] && row[0].toString().toUpperCase().trim() === needle
    );

    return NextResponse.json({ exists });
  } catch (err) {
    console.error("GSheet check-resi error:", err);
    return NextResponse.json({ error: "Check failed", detail: String(err) }, { status: 500 });
  }
}
