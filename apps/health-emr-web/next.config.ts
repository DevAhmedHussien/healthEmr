import type { NextConfig } from 'next';

const config: NextConfig = {
  /**
   * Production builds go somewhere else — and do so by default.
   *
   * `next build` writing over `.next` while `next dev` is serving out of it
   * leaves the dev server pointing at chunks that no longer exist: the page
   * renders, its JavaScript 404s, and every form silently falls back to a
   * native GET — which on the login form puts the password in the URL. The
   * `build` and `start` scripts set `NEXT_DIST_DIR=.next-prod`, so the two
   * never share a directory and remembering to is not part of the workflow.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: false },
  async headers() {
    return [
      {
        // The portal renders PHI. Nothing here should be cached by an
        // intermediary or embedded anywhere.
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
