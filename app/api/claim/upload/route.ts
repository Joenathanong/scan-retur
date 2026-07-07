import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import * as XLSX from "xlsx";
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

// Vercel: gunakan Node.js runtime + timeout 60 detik (Pro)
export const runtime    = "nodejs";
export const maxDuration = 60;

// Batch size untuk Google Sheets API (rows per request)
const GSHEET_BATCH = 1000;

function fmtDate(val: unknown): string {
  if (!val) return "";
  if (val instanceof Date) return val.toISOString().slice(0, 19).replace("T", " ");
  const d = new Date(String(val));
  return isNaN(d.getTime()) ? String(val) : d.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * POST /api/claim/upload
 *
 * Menerima multipart/form-data:
 *   file               - file Excel (.xlsx/.xls)
 *   masterSpreadsheetId - string
 *   expedisiSheets     - JSON string: Record<string, string> (code -> spreadsheetId)
 *
 * Parsing dilakukan di server agar mendukung file besar (ratusan ribu baris).
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file               = form.get("file") as File | null;
    const masterSpreadsheetId = ((form.get("masterSpreadsheetId") as string) ?? "").trim();
    const expedisiSheets: Record<string, string> = JSON.parse(
      (form.get("expedisiSheets") as string) ?? "{}"
    );

    if (!file) {
      return NextResponse.json({ error: "File Excel wajib disertakan" }, { status: 400 });
    }
    if (!masterSpreadsheetId) {
      return NextResponse.json({ error: "masterSpreadsheetId wajib diisi" }, { status: 400 });
    }

    // ── Parse Excel di server ──────────────────────────────────────────────
    const buffer = await file.arrayBuffer();
    const wb     = XLSX.read(buffer, { type: "array", cellDates: true });
    const ws     = wb.Sheets[wb.SheetNames[0]];
    const raw    = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

    const incoming: ClaimRow[] = (raw as Record<string, unknown>[])
      .map((r) => ({
        noResi:      String(r["No. Pesanan/Resi"] ?? r["No Pesanan"] ?? r["Resi"] ?? "").trim(),
        barcode:     String(r["Barcode Scan"]     ?? r["Barcode"]    ?? "").trim(),
        noItem:      String(r["No. Item"]          ?? r["No Item"]   ?? "").trim(),
        sku:         String(r["SKU"]               ?? "").trim(),
        qty:         String(r["Qty"]               ?? r["Quantity"]  ?? "").trim(),
        kondisi:     String(r["Kondisi"]           ?? "").trim(),
        batch:       String(r["Batch"]             ?? "").trim(),
        expDate:     fmtDate(r["Exp. Date"]        ?? r["Exp Date"]  ?? ""),
        createdBy:   String(r["Created By"]        ?? "").trim(),
        createdDate: fmtDate(r["Created Date"]     ?? r["Tanggal"]   ?? ""),
        expedisi:    "",
      }))
      .filter((r) => r.noResi !== "")
      .map((r)   => ({ ...r, expedisi: detectExpedisi(r.noResi) }));

    if (incoming.length === 0) {
      return NextResponse.json(
        { error: "Tidak ada baris valid. Pastikan kolom 'No. Pesanan/Resi' terisi dan nama kolom sesuai template." },
        { status: 400 }
      );
    }

    // ── Google Sheets ──────────────────────────────────────────────────────
    const auth   = getClaimAuth();
    const sheets = google.sheets({ version: "v4", auth });

    await ensureClaimTab(sheets, masterSpreadsheetId, "ALL");
    const existingKeys = await readExistingKeys(sheets, masterSpreadsheetId);

    // Dedup
    const newRows: ClaimRow[] = [];
    let   skipped = 0;
    for (const row of incoming) {
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

    // Tulis ke master ALL (batch)
    let masterCount = await getTabDataCount(sheets, masterSpreadsheetId, "ALL");
    for (let i = 0; i < newRows.length; i += GSHEET_BATCH) {
      const batch = newRows.slice(i, i + GSHEET_BATCH);
      await appendClaimRows(sheets, masterSpreadsheetId, "ALL", batch, masterCount + 1);
      masterCount += batch.length;
    }

    // Group by expedisi
    const byExpedisi = new Map<string, ClaimRow[]>();
    for (const row of newRows) {
      if (!byExpedisi.has(row.expedisi)) byExpedisi.set(row.expedisi, []);
      byExpedisi.get(row.expedisi)!.push(row);
    }

    // Tulis ke expedisi sheets (batch)
    const expedisiSummary: Record<string, number>                                 = {};
    const newSheets:       Record<string, { spreadsheetId: string; url: string }> = {};

    for (const [expCode, rows] of byExpedisi) {
      let expSheetId = expedisiSheets[expCode] ?? "";
      if (!expSheetId) {
        const created = await createExpedisiSpreadsheet(sheets, expCode);
        expSheetId       = created.spreadsheetId;
        newSheets[expCode] = created;
      } else {
        await ensureClaimTab(sheets, expSheetId, expCode);
      }

      let expCount = await getTabDataCount(sheets, expSheetId, expCode);
      for (let i = 0; i < rows.length; i += GSHEET_BATCH) {
        const batch = rows.slice(i, i + GSHEET_BATCH);
        await appendClaimRows(sheets, expSheetId, expCode, batch, expCount + 1);
        expCount += batch.length;
      }
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
