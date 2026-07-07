import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getClaimAuth, getTabList } from "@/lib/claim-gsheet";

/**
 * DELETE /api/claim/delete-row
 *
 * Hapus satu baris dari tab tertentu, lalu renumber kolom A.
 * Jika tab = "ALL", juga hapus dari tab expedisi yang sesuai
 * (berdasarkan kolom L = expedisi).
 *
 * Body: { spreadsheetId, tab, gsheetRow }
 */
export async function DELETE(req: NextRequest) {
  try {
    const { spreadsheetId: bodyId, tab, gsheetRow } = await req.json();
    const spreadsheetId = bodyId || process.env.CLAIM_SPREADSHEET_ID;

    if (!spreadsheetId || !tab || !gsheetRow) {
      return NextResponse.json(
        { error: "Field wajib: spreadsheetId, tab, gsheetRow" },
        { status: 400 }
      );
    }

    const auth   = getClaimAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // ── 1. Find sheetId for this tab ──────────────────────────────────────
    const tabs    = await getTabList(sheets, spreadsheetId);
    const tabMeta = tabs.find((t) => t.title === tab);
    if (!tabMeta) {
      return NextResponse.json(
        { error: `Tab "${tab}" tidak ditemukan` },
        { status: 404 }
      );
    }

    // ── 2. Read the row being deleted (need expedisi value if tab=ALL) ────
    let expedisiCode = "";
    let expedisiGsheetRow: number | null = null;

    if (tab === "ALL") {
      try {
        const rowData = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `'ALL'!B${gsheetRow}:L${gsheetRow}`,
        });
        const vals = rowData.data.values?.[0] ?? [];
        const noResi = String(vals[0]  ?? "");
        const noItem = String(vals[2]  ?? "");
        expedisiCode = String(vals[10] ?? "");

        // Find matching row in the expedisi tab
        if (expedisiCode) {
          const expRows = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${expedisiCode}'!B:D`, // noResi=B, noItem=D
          });
          const expData = expRows.data.values || [];
          for (let i = 1; i < expData.length; i++) {
            if (
              String(expData[i]?.[0] ?? "").trim() === noResi.trim() &&
              String(expData[i]?.[2] ?? "").trim() === noItem.trim()
            ) {
              expedisiGsheetRow = i + 1; // 1-based
              break;
            }
          }
        }
      } catch { /* ignore — delete ALL row only */ }
    }

    // ── 3. Delete from main tab ───────────────────────────────────────────
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId:    tabMeta.sheetId,
                dimension:  "ROWS",
                startIndex: gsheetRow - 1,
                endIndex:   gsheetRow,
              },
            },
          },
        ],
      },
    });

    // ── 4. Renumber col A in main tab ─────────────────────────────────────
    await renumberTab(sheets, spreadsheetId, tab);

    // ── 5. If ALL tab, also delete from the expedisi tab ─────────────────
    if (tab === "ALL" && expedisiCode && expedisiGsheetRow !== null) {
      const expTabMeta = tabs.find((t) => t.title === expedisiCode);
      if (expTabMeta) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                deleteDimension: {
                  range: {
                    sheetId:    expTabMeta.sheetId,
                    dimension:  "ROWS",
                    startIndex: expedisiGsheetRow - 1,
                    endIndex:   expedisiGsheetRow,
                  },
                },
              },
            ],
          },
        });
        await renumberTab(sheets, spreadsheetId, expedisiCode);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Claim delete-row error:", err);
    return NextResponse.json(
      { error: "Gagal hapus baris", detail: String(err) },
      { status: 500 }
    );
  }
}

async function renumberTab(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tabName: string
) {
  try {
    const col = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName}'!A:A`,
    });
    const rows = col.data.values || [];
    const dataCount = rows.length > 1 ? rows.length - 1 : 0;
    if (dataCount === 0) return;

    const numbers = Array.from({ length: dataCount }, (_, i) => [i + 1]);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range:            `'${tabName}'!A2:A${dataCount + 1}`,
      valueInputOption: "RAW",
      requestBody:      { values: numbers },
    });
  } catch { /* ignore renumber errors */ }
}
