import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: process.env.NEXT_PUBLIC_URL_PREFIX || '',
  output: 'standalone',
  serverExternalPackages: ["node-fetch", "pg"],
  experimental: {
      serverActions: {
          allowedOrigins: ["*"] //
      }
  },
  async rewrites() {
    const urlPrefix = process.env.NEXT_PUBLIC_URL_PREFIX || '';
    
    const rewrites = [
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

    if (urlPrefix) {
      rewrites.push({
        source: `${urlPrefix}/api/:path*`,
        destination: '/api/:path*',
      });
    }
    
    return rewrites;
  },
};

export default nextConfig;
