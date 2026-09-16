import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * 子路径部署支持（GitHub Pages 项目站点）。
 *
 * GitHub Pages 的项目站点地址形如 https://<user>.github.io/<repo>/，
 * 所有资源与站内链接都必须带 /<repo> 前缀。该前缀只能在构建时注入，
 * 不能写死：
 *   - 本地 `npm run dev` 需要空前缀，否则访问 http://localhost:3000 会跳到 /NexGenEdu
 *   - 部署时由 CI 设置 NEXT_PUBLIC_BASE_PATH=/NexGenEdu
 * 因此同一个仓库既能本地开发，也能部署到子路径，无需改动代码。
 */
const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
const basePath =
  rawBasePath === "" || rawBasePath === "/"
    ? ""
    : `/${rawBasePath.replace(/^\/+|\/+$/g, "")}`;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 显式指定项目根目录：本机 HOME 下存在其它 lockfile，
  // 若不指定，Next 会错误推断 workspace root。
  outputFileTracingRoot: projectRoot,

  // GitHub Pages 只能托管静态文件：导出纯静态站点到 out/。
  output: "export",
  // 导出产物中目录形式的 URL（/courses/ → courses/index.html）。
  trailingSlash: true,
  // 静态导出不支持 Next 的图片优化服务，如需使用 next/image 必须关闭优化。
  images: { unoptimized: true },

  // 子路径部署时同步前缀（basePath 影响路由，assetPrefix 影响静态资源）。
  ...(basePath === ""
    ? {}
    : {
        basePath,
        assetPrefix: basePath,
      }),

};

export default nextConfig;
