import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import {
  getClaimAuth,
  ensureClaimTab,
  readExistingKeys,
  getTabDataCount,
  appendClaimRows,
  createExpedisiSpreadsheet,
  detectExpedisi,
  dedupKey,
  type ClaimRow,
} from "@/lib/claim-gsheet";

/**
 * POST /api/claim/upload
 *
 * Body: { masterSpreadsheetId, expedisiSheets, rows }
 * Response: { added, skipped, total, expedisiSummary, newSheets }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      masterSpreadsheetId,
      expedisiSheets = {},
      rows: incoming = [],
    } = body;

    if (!masterSpreadsheetId) {
      return NextResponse.json({ error: "masterSpreadsheetId wajib diisi" }, { status: 400 });
    }
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return NextResponse.json({ error: "rows tidak boleh kosong" }, { status: 400 });
    }

    const auth   = getClaimAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // 1. Pastikan tab ALL di master sheet ada
    await ensureClaimTab(sheets, masterSpreadsheetId, "ALL");

    // 2. Baca existing keys dari master ALL
    const existingKeys = await readExistingKeys(sheets, masterSpreadsheetId);

    // 3. Detect expedisi + filter duplikat
    const processed: ClaimRow[] = (incoming as Partial<ClaimRow>[]).map((r) => ({
      noResi:      String(r.noResi      ?? "").trim(),
      barcode:     String(r.barcode     ?? "").trim(),
      noItem:      String(r.noItem      ?? "").trim(),
      sku:         String(r.sku         ?? "").trim(),
      qty:         String(r.qty         ?? "").trim(),
      kondisi:     String(r.kondisi     ?? "").trim(),
      batch:       String(r.batch       ?? "").trim(),
      expDate:     String(r.expDate     ?? "").trim(),
      createdBy:   String(r.createdBy   ?? "").trim(),
      createdDate: String(r.createdDate ?? "").trim(),
      expedisi:    detectExpedisi(String(r.noResi ?? "")),
    }));

    const newRows: ClaimRow[] = [];
    let skipped = 0;

    for (const row of processed) {
      const key = dedupKey(row.noResi, row.noItem, row.sku, row.barcode);
      if (existingKeys.has(key)) {
        skipped++;
      } else {
        existingKeys.add(key);
        newRows.push(row);
      }
    }

    if (newRows.length === 0) {
      return NextResponse.json({
        added: 0, skipped, total: incoming.length,
        expedisiSummary: {}, newSheets: {},
      });
    }

    // 4. Append ke master ALL
    const masterCount = await getTabDataCount(sheets, masterSpreadsheetId, "ALL");
    await appendClaimRows(sheets, masterSpreadsheetId, "ALL", newRows, masterCount + 1);

    // 5. Group by expedisi
    const byExpedisi = new Map<string, ClaimRow[]>();
    for (const row of newRows) {
      if (!byExpedisi.has(row.expedisi)) byExpedisi.set(row.expedisi, []);
      byExpedisi.get(row.expedisi)!.push(row);
    }

    // 6. Tulis ke tiap expedisi sheet (create jika belum ada)
    const expedisiSummary: Record<string, number>                                 = {};
    const newSheets:       Record<string, { spreadsheetId: string; url: string }> = {};

    for (const [expCode, rows] of byExpedisi) {
      let expSheetId: string = (expedisiSheets as Record<string, string>)[expCode] ?? "";

      if (!expSheetId) {
        const created = await createExpedisiSpreadsheet(sheets, expCode);
        expSheetId = created.spreadsheetId;
        newSheets[expCode] = created;
      } else {
        await ensureClaimTab(sheets, expSheetId, expCode);
      }

      const expCount = await getTabDataCount(sheets, expSheetId, expCode);
      await appendClaimRows(sheets, expSheetId, expCode, rows, expCount + 1);
      expedisiSummary[expCode] = rows.length;
    }

    return NextResponse.json({
      added:  newRows.length,
      skipped,
      total:  incoming.length,
      expedisiSummary,
      newSheets,
    });
  } catch (err) {
    console.error("Claim upload error:", err);
    return NextResponse.json(
      { error: "Upload gagal", detail: String(err) },
      { status: 500 }
    );
  }
}
