/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // Allow the live preview proxy host
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
    NEXT_PUBLIC_PRICEFEEDL1_ADDRESS: process.env.NEXT_PUBLIC_PRICEFEEDL1_ADDRESS,
    NEXT_PUBLIC_POSITIONS_ADDRESS: process.env.NEXT_PUBLIC_POSITIONS_ADDRESS,
    NEXT_PUBLIC_MARKET_ADDRESS: process.env.NEXT_PUBLIC_MARKET_ADDRESS,
    NEXT_PUBLIC_LIQUIDITYPOOLFACTORY_ADDRESS: process.env.NEXT_PUBLIC_LIQUIDITYPOOLFACTORY_ADDRESS,
    NEXT_PUBLIC_FEEMANAGER_ADDRESS: process.env.NEXT_PUBLIC_FEEMANAGER_ADDRESS,
    NEXT_PUBLIC_WRAPPER_ADDRESS: process.env.NEXT_PUBLIC_WRAPPER_ADDRESS,
    NEXT_PUBLIC_V4_ROUTER_ADDRESS: process.env.NEXT_PUBLIC_V4_ROUTER_ADDRESS,
    NEXT_PUBLIC_V4_HOOK_ADDRESS: process.env.NEXT_PUBLIC_V4_HOOK_ADDRESS,
  },
};

export default nextConfig;
