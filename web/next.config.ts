import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app lives inside the arleking-social repo, which has its own
  // root-level package-lock.json — pin the workspace root to `web/` itself
  // so Next doesn't try to guess between the two lockfiles.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
