import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 1. YOUR EXISTING WASM CONFIG
  webpack: (config) => {
    config.resolve.fallback = { fs: false, path: false, crypto: false };
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },

  // 2. YOUR EXISTING TYPESCRIPT RULE
  typescript: { 
    ignoreBuildErrors: true 
  },

  // 3. VERCEL MEMORY CRASH PREVENTION (No ESLint block to cause TS errors)
  experimental: {
    cpus: 1,
    workerThreads: false,
  },
};

export default nextConfig;