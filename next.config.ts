import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const repoName = "pimp-my-site";

const nextConfig: NextConfig = {
  // Export a static site for GitHub Pages
  output: "export",
  images: { unoptimized: true },
  assetPrefix: isGitHubPages ? `/${repoName}/` : undefined,
  basePath: isGitHubPages ? `/${repoName}` : undefined,
};

export default nextConfig;
