import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

function getAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    key: (process.env.GOOGLE_SHEETS_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

// Map field name → column letter in the sheet
const COLUMN_MAP: Record<string, string> = {
  kodeResi:   "B",
  noKarung:   "C",
  diScanOleh: "D",
  tanggal:    "E",
  jam:        "F",
};

/**
 * PATCH /api/gsheet/update-row
 *
 * Update satu cell di Google Sheets berdasarkan nama tab, nomor baris, dan field.
 *
 * Body (JSON):
 *   spreadsheetId  — Google Sheets ID
 *   sheetName      — nama tab, mis. "JNE_25-06-2026"
 *   gsheetRow      — nomor baris di sheet (1-based; baris 1 = header, data mulai baris 2)
 *   field          — nama field: "kodeResi" | "noKarung" | "diScanOleh" | "tanggal" | "jam"
 *   value          — nilai baru
 *
 * Response: { success: true } atau error
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { spreadsheetId: bodyId, sheetName, gsheetRow, field, value } = body;

    const spreadsheetId = bodyId || process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

    if (!spreadsheetId || !sheetName || !gsheetRow || !field || value === undefined) {
      return NextResponse.json(
        { error: "Field wajib: spreadsheetId, sheetName, gsheetRow, field, value" },
        { status: 400 }
      );
    }

    const col = COLUMN_MAP[field];
    if (!col) {
      return NextResponse.json(
        { error: `Field tidak dikenal: ${field}. Pilih: ${Object.keys(COLUMN_MAP).join(", ")}` },
        { status: 400 }
      );
    }

    const auth   = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!${col}${gsheetRow}`,
      valueInputOption: "RAW",
      requestBody: { values: [[String(value)]] },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("GSheet update-row error:", err);
    return NextResponse.json(
      { error: "Gagal update data", detail: String(err) },
      { status: 500 }
    );
  }
}
