import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  devIndicators: false,
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
