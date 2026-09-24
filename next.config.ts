import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 向けに最小ランタイム（.next/standalone）を出力する。
  // standalone には public / .next/static / prompts は含まれないので、
  // Dockerfile 側で明示的にコピーしている（DEPLOY.md 参照）。
  output: "standalone",
};

export default nextConfig;
