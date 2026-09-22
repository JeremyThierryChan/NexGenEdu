/**
 * 卡片（课程库里的一行）与**网站正文小节**之间的关联规则 —— 全仓库只有这一份。
 *
 * ## 为什么单独一个模块，而且必须是纯函数
 *
 * 「这门课指向哪些小节」这件事原先散在三个地方各写一遍：
 * 课程清单的「网站正文」按钮、网站正文面板的定位逻辑、以及人脑里的印象。
 * 三份实现的好处是每处只有两行，坏处是**它们会慢慢对不上**：
 * 一处按锚点算、另一处把标题也算进去，于是「点『网站正文』跳过去说没找到」
 * 而「面板里明明看得见」。这类不一致不会报错，只会让人不再相信这个按钮。
 *
 * 因此这里的函数有三个硬要求：
 *   1. **纯**（不读库、不读文件、不碰 window）：浏览器里的课程表单、Node 里的自检
 *      与 `validateSiteContent` 都能调同一份；
 *   2. 依赖面只有 `./types`：这样组件引它不会把整条数据加载链拖进浏览器包；
 *   3. 命中规则只有 `bandsForTargets` 一处 —— 谁要用都得调它（`scripts/check.mts`
 *      直接对这条规则下断言，改规则先过自检）。
 *
 * ## 命中规则（唯一的一份）
 *
 * 一张卡片给出的 targets = 卡片自己的靶点（`course.target`，非空时）
 * + 每个标签的目标（`course.tags[].target`）。
 * 一个小节**命中**，当且仅当它的锚点 `band.id` 或标题 `band.title`（去掉首尾空白后）
 * 等于其中某一个 target。
 *
 * 为什么标题也算命中：小节的锚点规定是标题里「｜」之前的那一段（见 `site-content.ts`
 * 的 `bandAnchor`），所以「锚点」与「标题前半段」在人眼里本来就是同一个东西；
 * 内容文件里手写卡片时也常常直接把标题写进标签。只认锚点会让"看起来明明对得上"的一跳落空。
 */

import type { SiteBand, SiteSubject } from "./types";

/** 算「这门课指向哪些小节」只需要这两样（课程表单的草稿也能满足）。 */
export type CardTargets = {
  /** 卡片本身点进哪个小节（空串＝没写）。 */
  target: string;
  /** 卡片上的细分标签（`学考→高中物理学考`）。 */
  tags: readonly { target: string }[];
};

/**
 * 一张卡片给出的 target 清单：卡片自己的靶点 + 每个标签的目标。
 *
 * 空串一律丢掉（表单里没填就是没填，不能让它去匹配"锚点恰好也是空串"的小节 ——
 * 虽然服务端不许空锚点，但这里不该依赖那个前提）。
 */
export function cardTargets(card: CardTargets): string[] {
  return [card.target, ...card.tags.map((tag) => tag.target)]
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/** 一次命中：这张卡片指向的那个小节，以及它在正文里的位置。 */
export type BandHit = {
  /** 命中所在学科（新增小节、显示"在学科 X 下"都要用它）。 */
  subject: SiteSubject;
  /** 学科在 `subjects` 里的下标（编辑器按位置改草稿时用）。 */
  subjectIndex: number;
  band: SiteBand;
  /** 小节在该学科 `bands` 里的下标。 */
  bandIndex: number;
  /** 命中的那个 target 字面量 —— 用来回答"卡片上写的是哪个名字"。 */
  matched: string;
};

/**
 * 这些 targets 命中了哪些小节（命中规则见文件头，**只此一份**）。
 *
 * 顺序：按学科顺序、学科内按小节顺序 —— 与人在页面上看到的一致，
 * 而不是按 targets 的顺序（卡片上的标签顺序与正文顺序常常不一样）。
 * 同一个小节被两个 target 同时命中（比如标签与靶点都指向它）只算一次。
 */
export function bandsForTargets(
  subjects: readonly SiteSubject[],
  targets: readonly string[],
): BandHit[] {
  const wanted = targets.map((item) => item.trim()).filter((item) => item !== "");
  if (wanted.length === 0) return [];

  const hits: BandHit[] = [];
  subjects.forEach((subject, subjectIndex) => {
    subject.bands.forEach((band, bandIndex) => {
      const id = band.id.trim();
      const title = band.title.trim();
      const matched = wanted.find((item) => item === id || item === title);
      if (matched === undefined) return;
      hits.push({ subject, subjectIndex, band, bandIndex, matched });
    });
  });
  return hits;
}

/** `bandsForTargets` 的卡片版：调用方不用自己先拆 targets（免得又拆出第二套口径）。 */
export function bandsForCard(subjects: readonly SiteSubject[], card: CardTargets): BandHit[] {
  return bandsForTargets(subjects, cardTargets(card));
}

/**
 * 判定「谁指着这个锚点」只需要课程名 + 靶点 + 标签。
 *
 * 刻意不写 `Course`：课程表单里的**草稿**（还没落盘的那张卡片）也要能参与判定，
 * 见 `coursesReferencingAnchor` 的说明。`Course` 结构上满足它，因此传库里的课程行没问题。
 */
export type CardAnchorSource = { name: string } & CardTargets;

/**
 * 哪些课程卡片指着这个锚点（`course.target` 或任一标签的目标与它相同）。
 *
 * 为什么这件事必须能算出来：**删掉一个被指着的小节，网站上的那张卡片就会跳空** ——
 * 点「学考」跳到一个不存在的位置，页面上不会报错，只会停在页面顶部。
 * 所以删除前要能说清"是哪门课在指着它"，删不掉时也要把人名点出来
 * （见 `validateSiteContent` 的删除护栏与课程表单里的删除按钮）。
 *
 * 比对上做 `trim()`：卡片字段是文本框里打进去的，前后带空格很常见，
 * 而"多了一个空格就判为没指着"会让护栏静默失效 —— 护栏失效比误报糟得多。
 *
 * ## 调用方要传**哪些**卡片：服务端传库里的，前台传"库里 + 正在改的这张草稿"
 *
 * 课程表单保存的顺序是**课程记录 → 正文 → 报价**（见 `courses/page.tsx` 的 onSubmit），
 * 因此服务端判"还有谁指着它"时，读到的已经是**改过标签之后**的课程行 ——
 * 前台要是只用落盘的那一份判，就会出现"用户在同一张表单里改了标签又删了小节，
 * 前台拦着不让删、服务端其实会放行"的错位。两边都按"库里 + 草稿"算，结论才一致。
 */
export function coursesReferencingAnchor(
  courses: readonly CardAnchorSource[],
  anchor: string,
): CardAnchorSource[] {
  const wanted = anchor.trim();
  if (wanted === "") return [];
  return courses.filter((course) => cardTargets(course).includes(wanted));
}

/**
 * 给"新增小节"取一个**组内与全库都不重名**的锚点。
 *
 * 为什么要在本地就改好、而不是等 `validateSiteContent` 拒：
 * 表单保存是"课程 + 正文 + 报价"一起交的，服务端一拒就是**整份**都被拒 ——
 * 用户会看到「课程也没保存上」，却不知道真正的原因是"锚点重了一个字"。
 * 所以这里按"重了就给下一个可用值"的口径直接改正（自动改正的目标是**唯一**，
 * 不是取悦人：`语文小节1-2` 一眼能看出它是第二个）。
 *
 * 为什么连**别的学科**里的锚点也要避开：卡片是按锚点名跳转的，不看学科 ——
 * 两个学科里各有一个「初中数学」时，那一跳落到哪个学科是随机的。
 * 服务端只校验"组内唯一"（那是既有口径，不动它），而"新建"这条路上
 * 严格一点不会有任何代价：新锚点是我们自己编的，本来就没有名字可争。
 */
export function uniqueBandAnchor(
  contentSubjects: readonly SiteSubject[],
  preferred: string,
): string {
  const base = preferred.trim() === "" ? "新小节" : preferred.trim();
  const taken = new Set(
    contentSubjects.flatMap((subject) => subject.bands.map((band) => band.id.trim())),
  );
  if (!taken.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  // 理论上到不了这里（1000 个同名小节）；真到了也不要返回一个重复值让服务端拒整份保存
  return `${base}-${Date.now()}`;
}
