import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Silences a Turbopack workspace-root warning caused by a stray
  // C:\Users\nagon\package-lock.json outside this repo on local dev
  // machines. Vercel builds from a clean checkout with no such lockfile,
  // so this only affects local `next build`/`next dev` output.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
