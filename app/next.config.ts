import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@liq/sdk"],
  reactStrictMode: true,
};

export default nextConfig;
