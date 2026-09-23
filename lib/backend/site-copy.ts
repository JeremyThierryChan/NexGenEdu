/**
 * **「内容文件 → 库」那一个方向的页面文案导入**（空库初始化、老库迁移）。
 *
 * 这个模块可以读 `data/site/*.md`（它就是干这个的）；**网站那一侧不许 import 它** ——
 * 那里要的是 `lib/backend/site-copy-model.ts`（纯函数，能把库里那一份适配成同一个读取接口）。
 * 这条分工与 `site-content.ts` 同一条纪律：两条路各读各的来源，
 * 但**共用同一个映射函数**，因此"导进去一套、页面读另一套"不可能发生。
 * （v32 / v36 把运行期的三个「从网站导入」入口删掉之后，这里只剩下**建库**与**迁移**两条路。）
 */
import { getPageBlock } from "@/lib/data/content";
import { parseDocument } from "@/lib/data/content";
import { contentSource } from "@/data/site/content";
import { scheduleSource } from "@/data/site/schedule";
import { SITE_COPY_GROUPS, SITE_COPY_KEYS, SITE_COPY_PAGES, emptyCopyBlock } from "./site-copy-model";
import type { PageBlock } from "@/lib/data/content";
import type { SiteCopyBlock, SiteCopyGroup, SiteCopyItem, SiteCopyKey } from "./types";
import { nextId } from "./ids";

/**
 * 从内容文件读出五块文案。
 *
 * 每一行的键（`key`）就是内容文件里那一行的字段名 —— **原样搬**，不改名、不重组：
 * 页面那侧的读取用同一批键名（`CopySource.field("phone")`），两边靠这份一致性对齐。
 *
 * id 由服务生成：它们只用来"认人"（日志、增删、上下移），与页面上的文字无关。
 */
export function copyBlocksFromContent(): Record<SiteCopyKey, SiteCopyBlock> {
  const result = {} as Record<SiteCopyKey, SiteCopyBlock>;
  for (const key of SITE_COPY_KEYS) {
    result[key] = blockFromPage(key, readPage(key));
  }
  return result;
}

/**
 * 读出某个块对应的页面块；读不到（文件被改坏 / 那一页不存在）返回 `null`。
 *
 * 时间安排单独一个文件（`data/site/schedule.md`），因此它走另一份解析结果；
 * 其余四块都在 `content.md` 里，按页面名取。
 */
function readPage(key: SiteCopyKey): PageBlock | null {
  try {
    const name = SITE_COPY_PAGES[key];
    if (key === "schedule") {
      const document = parseDocument(scheduleSource);
      return document.pages.get(name) ?? null;
    }
    return getPageBlock(name);
  } catch {
    return null;
  }
}

/** 一个页面块 → 一块文案（短字段 + 分组）。 */
function blockFromPage(key: SiteCopyKey, page: PageBlock | null): SiteCopyBlock {
  if (page === null) return emptyCopyBlock();

  const fields = Object.entries(page.data)
    // 数组字段（keywords / trial_points）在库里存成多行文本：一个字段一行，
    // 与后台那个"一行一个"的输入方式一致（读取时两种写法都支持，见 blockSource）。
    .map(([name, value]) => ({
      id: nextId("copyf"),
      key: name,
      value: Array.isArray(value) ? value.join("\n") : String(value),
    }))
    .filter((field) => field.key !== "");

  const allowed = SITE_COPY_GROUPS[key];
  const groups: SiteCopyGroup[] = page.groups
    .filter((section) => allowed === "all" || allowed.includes(section.name))
    .map((section) => ({
    id: nextId("copyg"),
    title: section.name,
    // 内容文件里的 `Section.note` 是"分组下的说明"，在这里叫 description（见 SiteCopyGroup）
    description: section.note,
      items: section.items.map((item): SiteCopyItem => ({
        id: nextId("copyi"),
        title: item.title,
        value: item.value,
        body: (item.body ?? "").trim(),
      })),
    }));

  return { fields, groups };
}

/** 这一块在库里的**键**是否齐全（自检与导入核对用）。 */
export function missingCopyKeys(blocks: Partial<Record<SiteCopyKey, SiteCopyBlock>>): SiteCopyKey[] {
  return SITE_COPY_KEYS.filter((key) => blocks[key] === undefined);
}

export { contentSource };
