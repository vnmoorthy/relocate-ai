import type { NextConfig } from "next";

/**
 * GitHub Pages deploy config.
 *
 * Static export → /out, served at https://vnmoorthy.github.io/relocate-ai
 * (or whatever custom domain you point at the repo's gh-pages branch).
 *
 * Override basePath + assetPrefix for local `pnpm dev` by setting
 * GITHUB_PAGES=0 in the env.
 */
const isGhPages = process.env.GITHUB_PAGES === "1";

const nextConfig: NextConfig = {
  output: "export",
  turbopack: { root: process.cwd() },
  images: { unoptimized: true },
  trailingSlash: true,
  basePath: isGhPages ? "/relocate-ai" : "",
  assetPrefix: isGhPages ? "/relocate-ai/" : "",
  // Next rewrites its own asset URLs for basePath, but NOT plain <video>/<img>
  // src strings. Components referencing files in /public must prepend this.
  env: { NEXT_PUBLIC_BASE_PATH: isGhPages ? "/relocate-ai" : "" },
  // Next 16 blocks cross-origin dev resources; run.sh serves everything on
  // 127.0.0.1, which Next treats as a different origin than localhost. Without
  // this, dev-mode hydration and HMR silently fail on the printed URLs.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
