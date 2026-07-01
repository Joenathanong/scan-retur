import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

function getAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    key: (process.env.GOOGLE_SHEETS_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

/**
 * Parse tab name "{CODE}_{DD-MM-YYYY}" → { code, dateStr: "YYYY-MM-DD" }
 * Supports codes with underscores (e.g. "J_T_R_2_25-06-2026" → code="J_T_R_2")
 */
function parseTabName(name: string): { code: string; dateStr: string } | null {
  const m = name.match(/^(.+)_(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  return {
    code: m[1],
    dateStr: `${m[4]}-${m[3]}-${m[2]}`, // YYYY-MM-DD
  };
}

export interface SheetRow {
  no: string;
  kodeResi: string;
  noKarung: string;
  diScanOleh: string;
  tanggal: string;
  jam: string;
  sheetName: string;
  expedisiCode: string;
  gsheetRow: number; // 1-based row index in the actual sheet (row 1 = header)
}

/**
 * GET /api/gsheet/multi-read
 *
 * Membaca data dari beberapa tab sheet sekaligus berdasarkan range tanggal dan filter expedisi.
 *
 * Query params:
 *   spreadsheetId   — Google Sheets ID
 *   dateFrom        — yyyy-MM-dd (inklusif)
 *   dateTo          — yyyy-MM-dd (inklusif)
 *   expedisiCodes   — kode ekspedisi dipisah koma (opsional, default = semua)
 *   karungNomors    — nomor karung dipisah koma (opsional, default = semua)
 *
 * Response: { rows: SheetRow[], totalTabs: number, tabNames: string[] }
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const spreadsheetId =
      searchParams.get("spreadsheetId") || process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    const dateFrom = searchParams.get("dateFrom");
    const dateTo   = searchParams.get("dateTo");
    const expedisiCodesParam = searchParams.get("expedisiCodes");
    const karungNomorsParam  = searchParams.get("karungNomors");

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Missing spreadsheetId" }, { status: 400 });
    }

    const auth   = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // 1. Get all sheet tab names
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties.title",
    });
    const allTabs = (meta.data.sheets || [])
      .map((s) => s.properties?.title || "")
      .filter(Boolean);

    // 2. Filter tabs by date range and expedisi codes
    const expedisiFilter = expedisiCodesParam
      ? expedisiCodesParam.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean)
      : null;

    const matchingTabs: { tabName: string; code: string; dateStr: string }[] = [];
    for (const tab of allTabs) {
      const parsed = parseTabName(tab);
      if (!parsed) continue;
      if (dateFrom && parsed.dateStr < dateFrom) continue;
      if (dateTo   && parsed.dateStr > dateTo)   continue;
      if (expedisiFilter && !expedisiFilter.includes(parsed.code.toUpperCase())) continue;
      matchingTabs.push({ tabName: tab, ...parsed });
    }

    if (matchingTabs.length === 0) {
      return NextResponse.json({ rows: [], totalTabs: 0, tabNames: [] });
    }

    // 3. Batch-read all matching tabs (batchGet = 1 API call)
    const MAX_TABS = 60; // safety cap
    const tabsToRead = matchingTabs.slice(0, MAX_TABS);
    const ranges     = tabsToRead.map((t) => `'${t.tabName}'!A:F`);

    const batchRes = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges,
    });
    const valueRanges = batchRes.data.valueRanges || [];

    // 4. Merge and filter rows
    const karungFilter = karungNomorsParam
      ? karungNomorsParam.split(",").map((n) => n.trim()).filter(Boolean)
      : null;

    const allRows: SheetRow[] = [];

    for (let i = 0; i < tabsToRead.length; i++) {
      const tab       = tabsToRead[i];
      const rawRows   = valueRanges[i]?.values || [];

      // rawRows[0] = header (gsheet row 1), data starts at rawRows[1] (gsheet row 2)
      for (let r = 1; r < rawRows.length; r++) {
        const row = rawRows[r];
        if (!row || row[0] === undefined || isNaN(Number(row[0]))) continue;

        const noKarung = String(row[2] ?? "");
        if (karungFilter && !karungFilter.includes(noKarung)) continue;

        allRows.push({
          no:          String(row[0] ?? ""),
          kodeResi:    String(row[1] ?? ""),
          noKarung,
          diScanOleh:  String(row[3] ?? ""),
          tanggal:     String(row[4] ?? ""),
          jam:         String(row[5] ?? ""),
          sheetName:   tab.tabName,
          expedisiCode: tab.code,
          gsheetRow:   r + 1, // gsheet rows are 1-based; row 1 = header → data row r is gsheet row r+1
        });
      }
    }

    return NextResponse.json({
      rows:       allRows,
      totalTabs:  tabsToRead.length,
      tabNames:   tabsToRead.map((t) => t.tabName),
    });
  } catch (err) {
    console.error("GSheet multi-read error:", err);
    return NextResponse.json(
      { error: "Gagal membaca data dari Google Sheets", detail: String(err) },
      { status: 500 }
    );
  }
}
