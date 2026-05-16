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
    return [
      { source: '/handbook', destination: '/handbook/index.html' },
      { source: '/handbook/de', destination: '/handbook/de/index.html' },
    ];
  },
};

module.exports = nextConfig;
