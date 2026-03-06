import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ["node-fetch"],
  experimental: {
      serverActions: {
          allowedOrigins: ["*"] // Allow cross-origin requests in dev
      }
  },
  async rewrites() {
    return [
      {
        source: '/v1/traces',
        destination: '/api/otel/v1/traces',
      },
      {
        source: '/v1/logs',
        destination: '/api/otel/v1/logs',
      },
      {
        source: '/v1/metrics',
        destination: '/api/otel/v1/metrics',
      },
    ];
  },
};

export default nextConfig;
