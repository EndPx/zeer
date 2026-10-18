import type { NextConfig } from "next";
import path from "node:path";
const config: NextConfig = {
  poweredByHeader: false,
  output: "standalone",
  experimental: { cpus: 2 },
  serverExternalPackages: ["ssh2"],
  turbopack: { root: path.resolve(import.meta.dirname, "../..") },
};
export default config;
