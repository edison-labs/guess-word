import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  ...(process.env.RUNTIME_PLATFORM === 'aliyun' ? { output: 'standalone' as const } : {}),
  webpack(config, { webpack }) {
    if (process.env.RUNTIME_PLATFORM === 'aliyun') {
      const nodeRuntime = path.resolve(
        process.cwd(),
        'lib/server/runtime-node.ts',
      );
      config.resolve.alias['@/lib/server/runtime$'] = nodeRuntime;
      config.resolve.alias['cloudflare:workers'] = path.resolve(
        process.cwd(),
        'lib/server/cloudflare-workers-node-stub.ts',
      );
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /^@\/lib\/server\/runtime$/,
          nodeRuntime,
        ),
      );
    }
    return config;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
