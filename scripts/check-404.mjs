/**
 * 构建产物校验：自定义 404 页面（网站版 + 教务后台版）。
 *
 * 放在构建之后运行，因为 404 的产物形式（out/404.html）
 * 由静态导出决定，只有构建完才能检查。
 * 目的是防止「改了 404 但产物没更新 / 文案丢失 / 链接带错 basePath /
 * 两版分流逻辑失效」。
 *
 * 分流逻辑不只看字符串：这里把产物里的内联脚本抠出来，用桩对象
 * 实际跑一遍后台路径与网站路径，确认它真的只给后台路径打标记。
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "out", "404.html");

if (!existsSync(file)) {
  console.error("✗ 未找到 out/404.html —— 静态导出未生成 404 页面");
  process.exit(1);
}

const html = readFileSync(file, "utf8");

/*
 * 去掉 <script> 后的「纯 DOM」文本。
 *
 * 必须区分两者：RSC 的 flight 数据（也是 <script>）里带着两版内容的序列化副本，
 * 因此「后台版里不该出现站内目录」这类**只看页面结构**的断言必须在纯 DOM 上做，
 * 否则会被文档末尾的数据副本误判。
 */
const domOnly = html.replace(/<script[\s\S]*?<\/script>/g, "");

// 站内链接前缀取决于本次构建是否注入 NEXT_PUBLIC_BASE_PATH：
// CI 部署时带 /NexGenEdu，本地直接 build 则没有。
// 这里原先硬编码 /NexGenEdu，导致本地构建后必然误报一项失败。
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
const siteLink = new RegExp(
  `href="${basePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(courses|quote|faq|cases|schedule)/"`,
);

/**
 * 产物样式表全文（压缩后属性值的引号会被去掉，因此匹配不带引号）。
 *
 * 注意：css 目录下可能还有子目录（Next 会按路由分组生成，如 css/app/），
 * 因此必须递归收集，不能直接对目录项 readFileSync —— 那会抛 EISDIR。
 */
function builtCss() {
  const dir = path.join(root, "out", "_next", "static", "css");
  if (!existsSync(dir)) return "";

  const collect = (current) =>
    readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) return collect(full);
      return entry.isFile() && entry.name.endsWith(".css")
        ? [readFileSync(full, "utf8")]
        : [];
    });

  return collect(dir).join("\n");
}

const css = builtCss();

/**
 * 取出 404 页面里的分流脚本并实际执行。
 *
 * 注意：RSC 的 flight 数据里也带着脚本源码（作为字符串），
 * 因此不能只按“包含关键字”判断，要看是不是真正的 `(function(){` 脚本。
 */
function runRouteScript(pathname) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const code = scripts.find((body) => body.trimStart().startsWith("(function(){try{"));
  if (code === undefined) return { error: "未找到内联分流脚本" };

  const state = { attrs: {}, title: "(未改)" };
  const slot = { textContent: "(未填)" };
  const sandbox = {
    location: { pathname },
    document: {
      documentElement: { setAttribute: (key, value) => { state.attrs[key] = value; } },
      addEventListener: (event, callback) => {
        if (event === "DOMContentLoaded") state.ready = callback;
      },
      querySelector: () => slot,
    },
    console: { log() {} },
  };
  Object.defineProperty(sandbox.document, "title", {
    set(value) { state.title = value; },
    get() { return state.title; },
  });

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  if (state.ready) state.ready();

  return { route: state.attrs["data-nf-route"], title: state.title, path: slot.textContent };
}

const adminRun = runRouteScript(`${basePath}/admin/students`);
const publicRun = runRouteScript(`${basePath}/courses/da-cuo-de-di-zhi`);

const checks = [
  // ── 网站版 ────────────────────────────────────────────────────────────
  ["网站版：自定义标题", domOnly.includes("这一页还没学到")],
  ["网站版：页码意象文案", domOnly.includes("还没印上去的页码")],
  ["网站版：站内目录区块", domOnly.includes("站内目录")],
  ["网站版：返回首页入口", domOnly.includes("回到首页")],
  ["网站版：页头品牌（含页脚 Layout 未被绕过）", domOnly.includes("NexGenEdu")],
  ["网站版：页脚版权", domOnly.includes("保留所有权利")],
  [`网站版：站内链接前缀（basePath="${basePath}"）`, siteLink.test(domOnly)],
  ["网站版：默认显示（后台版带 hidden）", /class="nf-backoffice[^"]*"\s+hidden/.test(domOnly)],

  // ── 教务后台版 ────────────────────────────────────────────────────────
  ["后台版：提示联系管理员", domOnly.includes("该功能尚未完善，请联系管理员陈林维祎")],
  ["后台版：不显示站内目录（后台不铺站点导航）", (() => {
    const start = domOnly.indexOf('class="nf-backoffice');
    return start !== -1 && !domOnly.slice(start).includes("站内目录");
  })()],
  // ButtonLink 走 Next 的链接，会带上 trailingSlash（/admin/）
  ["后台版：有返回后台首页入口", /href="[^"]*\/admin\/?"/.test(domOnly)],

  // ── 分流（实际执行脚本，不只看字符串）────────────────────────────────
  ["分流：后台路径命中 backoffice", adminRun.route === "backoffice"],
  ["分流：后台路径改写标签页标题", (adminRun.title ?? "").includes("教务后台")],
  ["分流：后台路径回填请求路径", (adminRun.path ?? "").includes("/admin/students")],
  ["分流：网站路径不打标记", publicRun.route === undefined],
  ["分流：网站路径不改标题", publicRun.title === "(未改)"],

  // ── 分流样式 ──────────────────────────────────────────────────────────
  ["样式：命中后台路径时隐藏网站版", css.includes(".nf-public{display:none!important}")],
  ["样式：命中后台路径时显示后台版", css.includes(".nf-backoffice[hidden]{display:flex!important}")],

  ["未残留默认 Next 404 文案", !html.includes("This page could not be found")],
];

let failed = 0;
for (const [label, pass] of checks) {
  if (!pass) failed += 1;
  console.log(`  ${pass ? "✓" : "✗"} ${label}`);
}
console.log(`\n404 产物校验：${failed === 0 ? "全部通过" : `${failed} 项失败`}`);
process.exit(failed === 0 ? 0 : 1);
