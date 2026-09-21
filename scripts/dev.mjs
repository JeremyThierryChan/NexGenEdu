/**
 * 开发模式：监听 data/site/*.md，改动后自动同步为 .ts 模块，并运行 next dev。
 *
 * 为什么需要它：
 *   内容以 .md 维护，但 Next 无法可靠地直接把 .md 当字符串 import
 *   （内置处理会把 `·` 序列化成非法的 `\xb7`），因此 .md 会先生成同名的 .ts 模块。
 *   本脚本把「生成」这一步自动化，并跟随 next dev 一起退出。
 *
 * 用 Node 内置的 fs.watch，不引入额外依赖。
 * 手工同步：npm run sync-content
 */
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data", "site");

/** 同步一次内容（同步执行，避免并发写同一文件）。返回值表示是否成功。 */
function sync() {
  const result = spawn(process.execPath, [path.join(root, "scripts", "sync-content.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  return new Promise((resolve) => result.on("exit", (code) => resolve(code === 0)));
}

/** 取一次后端数据（失败不拦开发：回落模版，脚本自己会说明原因）。 */
function syncSiteData() {
  const result = spawn(process.execPath, [path.join(root, "scripts", "sync-site-data.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  return new Promise((resolve) => result.on("exit", () => resolve(true)));
}

await sync();

/*
 * 取一次后端数据（决定网站内容用后端还是模版）。
 *
 * 启动时取一次只是**起点**：下面还有一段"盯着后端"的循环（见 watchBackendContent），
 * 后端里的教师 / 课程 / 正文 / 报价一变，网站内容就会自动跟着刷新 ——
 * 本机开发时不用为了看一个改动去重启 dev 或手工构站。
 */
await syncSiteData();

// 启动 next dev，继承标准输入输出
const nextBin = path.join(root, "node_modules", ".bin", "next");
const dev = spawn(nextBin, ["dev"], { cwd: root, stdio: "inherit" });

/*
 * ── 盯着后端内容，变了就刷新网站内容（本机开发时的"动态"）────────────────────
 *
 * ## 为什么不是"页面自己去请求后端"
 *
 * 网站是静态导出（`output: "export"`）：页面在构建那一刻就把内容烤进去了。
 * 要让它**每次请求都去问后端**，就得放弃静态导出、把整站改成服务端渲染 ——
 * 那是另一套部署方式（见 docs/技术架构.md §5.1）。这里的取法是：
 * 内容变了就重写 `data/site/.backend-snapshot.ts`，让打包器重编译那几页，
 * 浏览器自己热更新。**效果上就是动态的**（1-2 秒内页面更新），
 * 而构站产物仍是纯静态 —— 两边的规矩不变，只是开发时不再需要人手工触发。
 *
 * ## 为什么用轮询而不是"监听数据库文件"
 *
 * 后端是 SQLite + WAL：写入可能只落在 `-wal` 上，主库文件的 mtime 未必变，
 * 盯文件会在某些写入路径上漏掉。轮询一次就是一次 `GET /api/public/site`
 * （本机、几毫秒），比漏更新强。默认 2 秒，可用 `SITE_LIVE_POLL_MS` 调。
 */
const POLL_MS = Number(process.env.SITE_LIVE_POLL_MS ?? 2000);
const LIVE = process.env.SITE_LIVE !== "0";
const backendBase = (
  process.env.SITE_API_BASE ??
  process.env.NEXT_PUBLIC_API_BASE ??
  "http://127.0.0.1:4000"
).replace(/\/+$/, "");

/**
 * 内容指纹：**必须排除 `generatedAt`** —— 它是后端每次请求现生成的时间戳，
 * 带上它就会"每次都算变了"，于是每 2 秒重编译一次页面（开发体验直接崩掉）。
 */
function fingerprint(data) {
  const copy = { ...data };
  delete copy.generatedAt;
  return createHash("sha1").update(JSON.stringify(copy)).digest("hex");
}

let lastFingerprint = null;
let polling = false;
let backendWasDown = false;

async function watchBackendContent() {
  if (!LIVE) {
    console.log("[site-data] 已关闭「盯着后端」（SITE_LIVE=0）：网站内容只在启动时取一次");
    return;
  }
  console.log(
    `[site-data] 已开始盯着后端（${backendBase}，每 ${POLL_MS}ms）：` +
      "在后台改教师 / 课程 / 正文 / 报价，网站页面 1-2 秒内自动更新（不用重启、不用构站）",
  );
  setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const response = await fetch(`${backendBase}/api/public/site`, { signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body?.ok !== true || body?.data === undefined) throw new Error("返回内容不合法");
      backendWasDown = false;

      const next = fingerprint(body.data);
      if (lastFingerprint === null) {
        // 第一次：记下当前指纹（启动时已经取过一次，不必再写一遍文件）
        lastFingerprint = next;
        return;
      }
      if (next === lastFingerprint) return;
      lastFingerprint = next;
      console.log("[site-data] 后端内容有变化，正在刷新网站内容…");
      await syncSiteData();
    } catch {
      // 后端没起来是常态（比如只调前端样式），只在"从有变没有"时说一句
      if (!backendWasDown) {
        backendWasDown = true;
        console.log(`[site-data] 连不上后端（${backendBase}）：网站内容暂停跟随（起来了会自动继续）`);
      }
    } finally {
      polling = false;
    }
  }, Number.isFinite(POLL_MS) && POLL_MS >= 500 ? POLL_MS : 2000);
}

void watchBackendContent();

let timer = null;
let syncing = false;
let pending = false;

/**
 * 防抖：编辑器保存常常连续触发多次事件。
 * 同步进行中再次触发时记为 pending，结束后补跑一次，避免漏掉最后一次改动。
 */
function scheduleSync() {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = null;
    if (syncing) {
      pending = true;
      return;
    }
    syncing = true;
    console.log("[content] 检测到 Markdown 改动，正在同步…");
    await sync();
    syncing = false;
    if (pending) {
      pending = false;
      scheduleSync();
    }
  }, 120);
}

try {
  watch(dataDir, (_event, filename) => {
    if (filename !== null && filename.endsWith(".md")) scheduleSync();
  });
  console.log(`[content] 已监听 ${path.relative(root, dataDir)}/*.md，修改后会自动同步`);
} catch (error) {
  // 监听失败不影响开发，只是需要手工执行 npm run sync-content
  console.warn("[content] 无法监听 Markdown 改动，请手动执行 npm run sync-content：", error);
}

const shutdown = () => {
  dev.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
dev.on("exit", (code) => process.exit(code ?? 0));
