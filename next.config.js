const createNextIntlPlugin = require('next-intl/plugin');

// Point next-intl at the request config (single-locale, no URL routing).
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Link the local SDK package (file:../sdk) into the Next compile graph.
  transpilePackages: ['@zkcoins/sdk'],
  // Serve the static user handbook (public/handbook/index.html) at the
  // clean URL /handbook. The screenshots subfolder is reached normally
  // via /handbook/screenshots/*.
  async rewrites() {
    const rewrites = [
      { source: '/handbook', destination: '/handbook/index.html' },
      { source: '/handbook/de', destination: '/handbook/de/index.html' },
    ];

    // Local-only same-origin proxy to a zkCoins node. Used by the local
    // E2E run so the browser talks to the node without a cross-origin
    // preflight. Proxies the closed `/v1/*` surface (and health).
    const proxyTarget = process.env.LOCAL_NODE_PROXY_TARGET;
    if (proxyTarget) {
      const base = proxyTarget.replace(/\/+$/, '');
      rewrites.push(
        { source: '/v1/:path*', destination: `${base}/v1/:path*` },
        { source: '/health/:path*', destination: `${base}/health/:path*` },
        { source: '/health', destination: `${base}/health` },
      );
    }

    return rewrites;
  },
};

module.exports = withNextIntl(nextConfig);
