/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    unoptimized: true
  },
  // Keep lint and TypeScript errors blocking for production builds.
};

module.exports = nextConfig;
