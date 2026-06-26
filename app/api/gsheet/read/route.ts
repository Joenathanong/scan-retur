import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { sheetTabName } from "@/lib/utils";

function getAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    key: (process.env.GOOGLE_SHEETS_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

/**
 * GET /api/gsheet/read
 * Query params:
 *   spreadsheetId  — Google Sheet ID
 *   expedisiCode   — kode expedisi (e.g. "JNE")
 *   date           — tanggal yyyy-MM-dd
 *   karungNomors   — (opsional) nomor karung dipisah koma, e.g. "1,2,3"
 *
 * Returns: { rows: string[][], sheetName: string, total: number }
 * Columns: [No, Kode Resi, No. Karung, Di Scan Oleh, Tanggal, Jam]
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const spreadsheetId =
      searchParams.get("spreadsheetId") ||
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    const expedisiCode = searchParams.get("expedisiCode");
    const date = searchParams.get("date");
    const karungNomorsParam = searchParams.get("karungNomors");

    if (!spreadsheetId || !expedisiCode || !date) {
      return NextResponse.json(
        { error: "Parameter wajib: spreadsheetId, expedisiCode, date" },
        { status: 400 }
      );
    }

    const sheetName = sheetTabName(expedisiCode, date);
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // Read all data rows
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:F`,
    });

    const allRows = res.data.values || [];
    // Row 0 = header, skip it; only keep rows where column A is a number
    const dataRows = allRows
      .slice(1)
      .filter((r) => r[0] !== undefined && !isNaN(Number(r[0])));

    // Filter by karung nomors if provided
    let filtered = dataRows;
    if (karungNomorsParam) {
      const nomors = karungNomorsParam.split(",").map((n) => n.trim());
      filtered = dataRows.filter((r) => nomors.includes(String(r[2] ?? "")));
    }

    // Re-number sequentially after filtering
    const renumbered = filtered.map((r, i) => [String(i + 1), ...r.slice(1)]);

    return NextResponse.json({
      rows: renumbered,
      sheetName,
      total: renumbered.length,
    });
  } catch (err) {
    const msg = String(err);
    // Sheet tab belum ada = bukan error kritis
    if (
      msg.includes("Unable to parse range") ||
      msg.includes("notFound") ||
      msg.includes("not found")
    ) {
      return NextResponse.json({ rows: [], sheetName: null, total: 0, notFound: true });
    }
    console.error("GSheet read error:", err);
    return NextResponse.json(
      { error: "Gagal membaca Google Sheet", detail: msg },
      { status: 500 }
    );
  }
}
