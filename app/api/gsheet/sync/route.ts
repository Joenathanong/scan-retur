import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { sheetTabName, sheetDateName } from "@/lib/utils";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

const HEADER_ROW = [
  "No.",
  "Kode Resi",
  "No. Karung",
  "Di Scan Oleh",
  "Tanggal",
  "Jam",
];

function getAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    key: (process.env.GOOGLE_SHEETS_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    scopes: SCOPES,
  });
}

async function ensureSheet(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  sheetName: string
) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets?.find(
    (s) => s.properties?.title === sheetName
  );

  if (!existing) {
    // Add new sheet
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName,
                gridProperties: { frozenRowCount: 1 },
              },
            },
          },
        ],
      },
    });

    // Write header
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A1:F1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADER_ROW] },
    });

    // Format header (bold, background)
    const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetId = sheetMeta.data.sheets?.find(
      (s) => s.properties?.title === sheetName
    )?.properties?.sheetId;

    if (sheetId !== undefined) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.09, green: 0.64, blue: 0.3 },
                    textFormat: {
                      bold: true,
                      foregroundColor: { red: 1, green: 1, blue: 1 },
                    },
                    horizontalAlignment: "CENTER",
                  },
                },
                fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
              },
            },
            {
              updateSheetProperties: {
                properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
                fields: "gridProperties.frozenRowCount",
              },
            },
          ],
        },
      });
    }
  }
}

/**
 * Check if noResi already exists in column B, and get the next row number.
 * Reads A:B in one API call to avoid double-writes (idempotency).
 */
async function checkAndGetNextRow(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  sheetName: string,
  noResi: string
): Promise<{ exists: boolean; nextRowNo: number }> {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:B`,
    });
    const rows = res.data.values || [];
    const needle = noResi.toUpperCase().trim();

    for (const row of rows) {
      if (row[1] && String(row[1]).toUpperCase().trim() === needle) {
        return { exists: true, nextRowNo: 0 };
      }
    }

    // Count numeric rows in column A for the next sequence number
    const dataRows = rows.filter((r) => r[0] && !isNaN(Number(r[0])));
    return { exists: false, nextRowNo: dataRows.length + 1 };
  } catch {
    return { exists: false, nextRowNo: 1 };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      noResi,
      nomorKarung,
      expedisiName,
      expedisiCode,
      scannedByName,
      scannedAt,
      date,
      spreadsheetId: bodySpreadsheetId,
    } = body;

    const spreadsheetId =
      bodySpreadsheetId || process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

    if (!spreadsheetId) {
      return NextResponse.json(
        { error: "Spreadsheet ID not configured" },
        { status: 400 }
      );
    }

    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const sheetName = sheetTabName(expedisiCode, date);
    await ensureSheet(sheets, spreadsheetId, sheetName);

    // Idempotency check: skip if noResi already exists in the sheet
    const { exists, nextRowNo: rowNo } = await checkAndGetNextRow(
      sheets, spreadsheetId, sheetName, noResi
    );
    if (exists) {
      console.log(`GSheet sync: resi ${noResi} already in ${sheetName}, skipping.`);
      return NextResponse.json({ success: true, skipped: true });
    }

    const scanDate = sheetDateName(date);
    // scannedAt sudah berupa "HH:mm:ss" (diformat di client = timezone lokal user/WIB)
    const scanTime = scannedAt;

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${sheetName}'!A:F`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [
          [rowNo, noResi, nomorKarung, scannedByName, scanDate, scanTime],
        ],
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("GSheet sync error:", err);
    return NextResponse.json(
      { error: "Sync failed", detail: String(err) },
      { status: 500 }
    );
  }
}
