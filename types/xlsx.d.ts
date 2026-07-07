// Minimal type declarations for the xlsx package (v0.18.x)
// The npm package does not bundle its own .d.ts, so we provide a stub.
declare module "xlsx" {
  export function read(
    data: ArrayBuffer | Uint8Array | Buffer,
    opts?: { type?: string; cellDates?: boolean }
  ): WorkBook;

  export function writeFile(
    wb: WorkBook,
    filename: string,
    opts?: Record<string, unknown>
  ): void;

  export const utils: {
    sheet_to_json<T = Record<string, unknown>>(
      ws: WorkSheet,
      opts?: { defval?: unknown; header?: unknown }
    ): T[];
    aoa_to_sheet(data: unknown[][]): WorkSheet;
    book_new(): WorkBook;
    book_append_sheet(wb: WorkBook, ws: WorkSheet, name?: string): void;
  };

  export interface WorkBook {
    SheetNames: string[];
    Sheets: Record<string, WorkSheet>;
  }

  // Use any as the index result so property access (ws[ref].s = ...) compiles
  // without needing casts everywhere in user code.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type WorkSheet = Record<string, any>;
}
