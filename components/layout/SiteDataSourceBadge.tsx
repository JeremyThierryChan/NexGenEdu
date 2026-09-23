import { backendSnapshot, siteContentSource } from "@/lib/site/backend-source";
import { backendSiteNote } from "@/data/site/.backend-snapshot";

/**
 * 「这一份网站的内容从哪来」的状态小标 —— 挂在页脚右下角「教务后台」旁边。
 *
 * ## 为什么需要它（机构要求）
 *
 * 机构：「**再在网站的右下角教务后台旁边添加一个状态显示吧，显示现在的网站使用的是
 * 模版数据还是根据后端显示的数据**」。
 *
 * 这不是装饰：网站是**静态导出**的，内容可能来自三个地方，而它们长得一模一样：
 *
 * | 这一份 | 内容来自 | 谁会产生它 |
 * | --- | --- | --- |
 * | `backend` | **后台（SQLite 库）** 的公开数据快照 | 构站那台机器连得上后端（`npm run dev` / `npm run build`） |
 * | `template` | **`data/site/*.md` 内容文件** | 显式 `SITE_CONTENT_SOURCE=template`（线上 GitHub Pages 就是这条） |
 * | `blank` | **空**（只剩页面骨架文案） | 构站时连不上后端（现在 `npm run build` 会直接失败，不会产出这一种） |
 *
 * 没有这个标的时候，"页面上的课程怎么和我后台改的不一样"只能靠猜 —— 那正是前几轮反复出现的问题
 * （机构问过「为什么我在后台改了课程名字，前台没变」）。有了它，一眼就能分清是
 * **看的那一份不对**（模版 / 空白），还是**数据没重新取**（快照是上次构站那一刻的）。
 *
 * ## 为什么把"取数时间"也写上
 *
 * 因为后端数据是**构站那一刻**取的一份快照，不是实时读库。写上时间，机构就能自己判断
 * "我是在这之前还是之后改的后台"—— 这比一句笼统的"来自后端"有用得多。
 */
export function SiteDataSourceBadge() {
  const source = siteContentSource();
  const generatedAt = backendSnapshot()?.generatedAt ?? "";
  const taken = formatTaken(generatedAt);

  const view = {
    backend: {
      text: "内容：后端数据",
      detail: taken === "" ? "构站时从后台取的公开数据" : `构站时从后台取的公开数据 · ${taken}`,
      className: "border-brand-200 bg-brand-50 text-brand-700",
    },
    template: {
      text: "内容：模版数据",
      detail: "这一份读的是内容文件 data/site/*.md，不是后台的数据",
      className: "border-accent-200 bg-accent-50 text-accent-700",
    },
    blank: {
      text: "内容：空（没连上后端）",
      detail: "构站时连不上后端，需要后端数据的那几块是空的",
      className: "border-warning-200 bg-warning-50 text-warning-700",
    },
  }[source];

  return (
    <span
      // `title` 里给出完整来源说明（构站脚本写的那一句，含后端地址与时间戳）
      title={`${view.detail}${backendSiteNote === "" ? "" : `\n来源：${backendSiteNote}`}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] leading-none ${view.className}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {view.text}
      {source === "backend" && taken !== "" && (
        <span className="text-[10px] opacity-70">· {taken}</span>
      )}
    </span>
  );
}

/**
 * 取数时间：`2026-09-23T16:46:52.226Z` → `09-23 16:46 UTC`。
 *
 * 刻意**不做时区换算**：这是构站机器上的一个时间戳，页面是静态产物 ——
 * 换算到本地时区会让"这一份是什么时候取的"取决于构站机器，反而说不清。
 * 写 UTC 是唯一在所有机器上都成立的写法（`title` 里有完整原文）。
 */
function formatTaken(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (match === null) return "";
  return `${match[2]}-${match[3]} ${match[4]}:${match[5]} UTC`;
}
