import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next.js 15: moved out of experimental
  serverExternalPackages: ["firebase-admin"],
};

export default nextConfig;
