import type { NextConfig } from 'next';

// Baseline security headers. Vercel already sends HSTS; these are the ones it does not.
// Deliberately conservative — no CSP here, since the app renders inline <style> blocks
// and inline styles throughout, and a wrong CSP breaks the page silently.
const securityHeaders = [
  // Block framing so a report page cannot be embedded and clickjacked.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Send only the origin to other sites, never the path — report URLs carry the share code.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    '/*': ['./skills/character-deep-analysis/**/*'],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
