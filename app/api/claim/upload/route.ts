import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import {
  getClaimAuth,
  getTabList,
  ensureClaimTab,
  readExistingKeys,
  getTabDataCount,
  appendClaimRows,
  detectExpedisi,
  dedupKey,
  type ClaimRow,
} from "@/lib/claim-gsheet";

/**
 * POST /api/claim/upload
 *
 * Terima array ClaimRow dari client (hasil parse Excel), cek duplikat di
 * tab ALL, tambahkan baris baru ke ALL + tab expedisi masing-masing.
 *
 * Body:
 *   spreadsheetId — ID Google Sheets untuk claim
 *   rows          — ClaimRow[] (sudah di-parse di client)
 *
 * Response:
 *   { added, skipped, expedisiSummary, total }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { spreadsheetId: bodyId, rows: incoming } = body;

    const spreadsheetId = bodyId || process.env.CLAIM_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return NextResponse.json({ error: "spreadsheetId wajib diisi" }, { status: 400 });
    }
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return NextResponse.json({ error: "rows tidak boleh kosong" }, { status: 400 });
    }

    const auth   = getClaimAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // 1. Get all existing tabs once
    const tabs = await getTabList(sheets, spreadsheetId);

    // 2. Ensure ALL tab exists
    await ensureClaimTab(sheets, spreadsheetId, "ALL", tabs);

    // 3. Read existing dedup keys from ALL tab
    const existingKeys = await readExistingKeys(sheets, spreadsheetId);

    // 4. Detect expedisi + filter new rows
    const processed: ClaimRow[] = incoming.map((r: Partial<ClaimRow>) => ({
      ...r,
      expedisi: detectExpedisi(r.noResi ?? ""),
    } as ClaimRow));

    const newRows: ClaimRow[] = [];
    const skippedRows: ClaimRow[] = [];

    for (const row of processed) {
      const key = dedupKey(row.noResi, row.noItem, row.sku, row.barcode);
      if (existingKeys.has(key)) {
        skippedRows.push(row);
      } else {
        existingKeys.add(key); // prevent within-batch dupes
        newRows.push(row);
      }
    }

    if (newRows.length === 0) {
      return NextResponse.json({
        added:           0,
        skipped:         skippedRows.length,
        expedisiSummary: {},
        total:           incoming.length,
      });
    }

    // 5. Append to ALL tab
    const allCount = await getTabDataCount(sheets, spreadsheetId, "ALL");
    await appendClaimRows(sheets, spreadsheetId, "ALL", newRows, allCount + 1);

    // 6. Group new rows by expedisi and append to per-expedisi tabs
    const byExpedisi = new Map<string, ClaimRow[]>();
    for (const row of newRows) {
      if (!byExpedisi.has(row.expedisi)) byExpedisi.set(row.expedisi, []);
      byExpedisi.get(row.expedisi)!.push(row);
    }

    const expedisiSummary: Record<string, number> = {};
    // Refresh tab list after creating ALL
    const freshTabs = await getTabList(sheets, spreadsheetId);

    for (const [expCode, rows] of byExpedisi) {
      await ensureClaimTab(sheets, spreadsheetId, expCode, freshTabs);
      const tabCount = await getTabDataCount(sheets, spreadsheetId, expCode);
      await appendClaimRows(sheets, spreadsheetId, expCode, rows, tabCount + 1);
      expedisiSummary[expCode] = rows.length;
      // Add the new tab to freshTabs so next ensureClaimTab call sees it
      freshTabs.push({ title: expCode, sheetId: -1 });
    }

    return NextResponse.json({
      added:           newRows.length,
      skipped:         skippedRows.length,
      expedisiSummary,
      total:           incoming.length,
    });
  } catch (err) {
    console.error("Claim upload error:", err);
    return NextResponse.json(
      { error: "Upload gagal", detail: String(err) },
      { status: 500 }
    );
  }
}
