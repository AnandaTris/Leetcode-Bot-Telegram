import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // There is a stray lockfile in the home directory; without this Next infers
  // the workspace root as ~ and traces the wrong files.
  outputFileTracingRoot: path.join(import.meta.dirname, "."),
};

export default nextConfig;
