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
  images: { unoptimized: true },
  trailingSlash: true,
  basePath: isGhPages ? "/relocate-ai" : "",
  assetPrefix: isGhPages ? "/relocate-ai/" : "",
};

export default nextConfig;
