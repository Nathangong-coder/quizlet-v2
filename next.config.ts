import path from "node:path";
import type { NextConfig } from "next";

/**
 * Security headers on every response.
 *
 * HTTPS itself is enforced by the platform: Vercel serves only over TLS and
 * redirects http:// to https:// before a request reaches this app. What the
 * app adds is HSTS — a browser that has seen it once will not even attempt
 * plain HTTP for a year — plus the usual clickjacking / sniffing / referrer
 * guards. A Content-Security-Policy is deliberately NOT set here yet: the
 * app inlines styles and scripts through Next and next-themes, and a CSP
 * that breaks hydration is worse than none. Add it with nonces as its own
 * change.
 */
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Microphone deliberately NOT denied: Stage 4 (voice) needs it.
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  // Silences a Turbopack workspace-root warning caused by a stray
  // C:\Users\nagon\package-lock.json outside this repo on local dev
  // machines. Vercel builds from a clean checkout with no such lockfile,
  // so this only affects local `next build`/`next dev` output.
  turbopack: {
    root: path.join(__dirname),
  },
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
