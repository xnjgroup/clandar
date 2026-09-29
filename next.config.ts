import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Lets the dev server accept requests whose Origin isn't localhost — needed
   * to open the app from a phone over Tailscale (by IP, or by MagicDNS name
   * under the tailnet's *.ts.net suffix). Dev-only; unrelated to `next start`.
   */
  allowedDevOrigins: ["100.71.30.49", "*.tail291ebd.ts.net"],
};

export default nextConfig;
