/** What an uploaded project file is — kept free of DB imports so the upload form can use it too. Invoices and receipts get parsed into invoice records (lib/document-ingest.ts). */
export type DocType = "general" | "invoice" | "receipt";

export const DOC_TYPES: { id: DocType; label: string }[] = [
  { id: "general", label: "General file" },
  { id: "invoice", label: "Invoice" },
  { id: "receipt", label: "Receipt" },
];
