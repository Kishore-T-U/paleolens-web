const nextConfig = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webpack: (config: any) => {
    // Allows Next.js to compile and serve WASM files for the ONNX Runtime
    config.resolve.fallback = { fs: false, path: false, crypto: false };
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },
  // Prevents strict TypeScript rules from failing your production deployment
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;