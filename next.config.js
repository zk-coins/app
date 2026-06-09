/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  webpack: (config) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    return config;
  },
  // Serve the static user handbook (public/handbook/index.html) at the
  // clean URL /handbook. The screenshots subfolder is reached normally
  // via /handbook/screenshots/*.
  async rewrites() {
    const rewrites = [
      { source: '/handbook', destination: '/handbook/index.html' },
      { source: '/handbook/de', destination: '/handbook/de/index.html' },
    ];

    // Local-only same-origin proxy to a zkCoins node. Used by the local
    // E2E send-leg run (`E2E_API_URL`/`NEXT_PUBLIC_API_URL` point at this
    // app's own origin), so the browser talks to the node without a
    // cross-origin preflight — the node's CORS policy allows `*` origin
    // but not the `Idempotency-Key` request header, which would otherwise
    // make the admit POST fail with "Failed to fetch". Unset in CI and
    // the Docker image, so production builds never proxy.
    const proxyTarget = process.env.LOCAL_NODE_PROXY_TARGET;
    if (proxyTarget) {
      const base = proxyTarget.replace(/\/+$/, '');
      rewrites.push(
        { source: '/api/:path*', destination: `${base}/api/:path*` },
        { source: '/health/:path*', destination: `${base}/health/:path*` },
        { source: '/health', destination: `${base}/health` },
      );
    }

    return rewrites;
  },
};

module.exports = nextConfig;
