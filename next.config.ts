import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 显式指定项目根目录：本机 HOME 下存在其它 lockfile，
  // 若不指定，Next 会错误推断 workspace root。
  outputFileTracingRoot: projectRoot,
};

export default nextConfig;
