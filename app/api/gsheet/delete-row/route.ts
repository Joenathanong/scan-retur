import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

function getAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    key: (process.env.GOOGLE_SHEETS_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

/**
 * DELETE /api/gsheet/delete-row
 *
 * Hapus satu baris dari Google Sheets berdasarkan nama tab dan nomor baris.
 *
 * Body (JSON):
 *   spreadsheetId  — Google Sheets ID
 *   sheetName      — nama tab, mis. "JNE_25-06-2026"
 *   gsheetRow      — nomor baris di sheet (1-based; baris 1 = header, data mulai baris 2)
 *
 * Response: { success: true } atau error
 */
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { spreadsheetId: bodyId, sheetName, gsheetRow } = body;

    const spreadsheetId = bodyId || process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

    if (!spreadsheetId || !sheetName || !gsheetRow) {
      return NextResponse.json(
        { error: "Field wajib: spreadsheetId, sheetName, gsheetRow" },
        { status: 400 }
      );
    }

    const auth   = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // Lookup sheetId for the named tab
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetMeta = meta.data.sheets?.find(
      (s) => s.properties?.title === sheetName
    );

    if (!sheetMeta) {
      return NextResponse.json(
        { error: `Tab "${sheetName}" tidak ditemukan di spreadsheet` },
        { status: 404 }
      );
    }

    const sheetId = sheetMeta.properties?.sheetId;

    // Delete the row — gsheetRow is 1-based, API uses 0-based startIndex/endIndex
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: gsheetRow - 1, // inclusive, 0-based
                endIndex:   gsheetRow,     // exclusive, 0-based
              },
            },
          },
        ],
      },
    });

    // Re-number column A from row 2 downward so the sequence stays continuous.
    // Read column A after deletion to know how many data rows remain.
    const colA = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:A`,
    });
    const colAValues = colA.data.values || [];
    // Row 0 = header; count rows that currently have any value in column A (data rows)
    const dataRowCount = colAValues.length > 1 ? colAValues.length - 1 : 0;

    if (dataRowCount > 0) {
      // Build sequential numbers [[1],[2],...,[n]]
      const newNumbers = Array.from({ length: dataRowCount }, (_, i) => [i + 1]);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!A2:A${dataRowCount + 1}`,
        valueInputOption: "RAW",
        requestBody: { values: newNumbers },
      });
    }

    return NextResponse.json({ success: true, remainingRows: dataRowCount });
  } catch (err) {
    console.error("GSheet delete-row error:", err);
    return NextResponse.json(
      { error: "Gagal hapus baris", detail: String(err) },
      { status: 500 }
    );
  }
}
