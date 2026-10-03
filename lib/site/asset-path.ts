/**
 * `public/` 下静态资产的 URL —— **唯一一处"要不要加子路径前缀"的实现**。
 *
 * ## 为什么必须有这么个函数（2026-10 的事故）
 *
 * 线上是**子路径部署**（GitHub Pages 的 `/NexGenEdu/`，由 CI 注入 `NEXT_PUBLIC_BASE_PATH`），
 * 本地开发**没有前缀**（同一个仓库两种部署形态，见 `next.config.ts` 的说明）。
 *
 * 路由由 `next/link` 自动加前缀、`_next/` 静态资源由 `assetPrefix` 自动加前缀 ——
 * 但**写在代码里的 `<img src="/logo.png">` 谁也不会帮你加**：浏览器会去域名根
 * `…github.io/logo.png` 找，线上就是 404（页头空白）。更坑的是这个错**本地一切正常**，
 * 而 `check` / `build` / `check:links` 都**不看 `<img src>`**（链接校验只扫 `href`），
 * 所以本地全绿也漏得过去 —— 2026-10 加 logo 的两次提交就是这样让 GitHub Pages
 * 整条流水线白跑、站点两三天没有 logo。
 *
 * 顺带说明**为什么不用 `next/image`**：本仓库 `images.unoptimized = true`（静态导出没有
 * 优化服务），而这个模式下 `next/image` **不走默认加载器、也就不会加前缀** ——
 * 实测产物里仍然是 `src="/logo.png"` 外加一条同样没前缀的 `<link rel="preload">`。
 * 所以这里用"自己算前缀"的直白写法，可读、可断言。
 *
 * 用法：`<img src={assetPath("/logo.png")} … />`（图标 `app/icon.png` 那一类由 Next 的
 * 元数据机制处理，**会**自动带前缀，不需要走这里）。
 */
export function assetPath(path: string): string {
  const raw = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
  const base = raw === "" || raw === "/" ? "" : `/${raw.replace(/^\/+|\/+$/g, "")}`;
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${base}${clean}`;
}
