import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Lets the dev server accept requests whose Origin isn't localhost — needed
   * to open the app from a phone over Tailscale (by IP, or by MagicDNS name
   * under the tailnet's *.ts.net suffix). Dev-only; unrelated to `next start`.
   */
  allowedDevOrigins: ["100.71.30.49", "*.tail291ebd.ts.net"],
  /**
   * PDF text extraction (lib/document-extract.ts): pdfjs loads its worker as a
   * separate file next to its own module at runtime, which bundling breaks
   * ("Setting up fake worker failed: Cannot find module …/pdf.worker.mjs").
   * Loading both straight from node_modules keeps that file where pdfjs looks.
   */
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
