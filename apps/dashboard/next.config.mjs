/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@alex101/shared'],
  experimental: {
    serverActions: {
      bodySizeLimit: '64kb',
    },
  },
};

export default nextConfig;