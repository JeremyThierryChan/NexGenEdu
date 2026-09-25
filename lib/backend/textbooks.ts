/**
 * 学生「现阶段使用的教材」（`Student.textbooks`）的**口径、显示、校验与解析**
 * （纯函数：不读数据库、不读写文件）。
 *
 * ## 教材是什么（这一条决定了下面全部规则）
 *
 * 机构原话：「新建学生应该有一个年级、生日以及**现阶段使用的教材**（可以有多本，
 * 因为一个学生可能有多个科目）」。
 *
 * **教材 = 课程类型里的「内容模块」**（`catalog.modules`，就是「课程类型」页那一层：
 * 一年级…九年级教材 / 必修教材 / 选修教材 / 听力 / 作文 / N5…B2 / Python…）。
 * 它本来就**挂在学科上**（`CatalogModule.subjectId`），所以"一个学生多本教材、跨科目"
 * 用**模块 id 的列表**正好表达 —— 不需要新建一张"教材表"，也不需要给教材加学科字段
 * （那会是同一件事的第二份记录）。
 *
 * ## 三条边界（写进代码，也是自检里的反向断言）
 *
 *   1. **不参与报价**：报价只算课程 + 班型 + 人数 + 时长，教材不是它的输入；
 *   2. **不参与排课冲突判定**：冲突判据是教师 / 教室 / 学生与时间，教材不是；
 *   3. **不参与课时账本**：扣课时只按 `enrollments` 里的科目走。
 *
 * 换句话说：它只是"这个学生现在在读哪些教材"——**不是报名、不是报课**。
 * 把教材做成"报名关系"会让一次勾选悄悄影响钱与课时，那是这份数据最不该有的副作用。
 *
 * ## 为什么显示要带学科前缀
 *
 * 模块名在**多个学科下会重名**（真实库：`必修教材` 在数学 / 物理 / 化学 / 生物 /
 * 政治 / 历史 / 地理 / 技术 / 初升高预习班下都有，`一年级` 在语文 / 数学下都有，
 * 一共 18 个重名模块名）。只写「必修教材」看不出是哪一科的教材 ——
 * 因此**显示**与**导入**一律带学科：`物理·必修教材`（与 `catalogId("mod", …)` 的派生
 * 写法一致，也与 `extra-courses.ts` 里 `modules: ["小升初预习班·七年级教材"]` 同一套）。
 *
 * ## 这个模块里有四个读者，各取所需（口径都从这里出，不许各写一份）
 *
 *   - **界面**（学生列表 / 详情 / 新建表单）：`moduleLabel` / `textbookLabels`；
 *   - **服务层**（`students.create` / `students.update` 的写入闸）：`textbookIssues`；
 *   - **批量导入**（`import.ts` 的「教材」列）：`resolveTextbookRef`；
 *   - **迁移与收尾归一**：`normalizeTextbooks`（只去空去重，**不校验** ——
 *     老库里的模块 id 失效不该让整库读不出来，与 `normalizeTeacherRecord` 同一条纪律）。
 */
import type { Catalog, CatalogModule } from "./types";

/** 教材列表里的一项：模块 id（`Student.textbooks` 的元素）。 */
export type TextbookId = string;

/** 按 id 取模块（找不到返回 undefined）。 */
export function findTextbookModule(catalog: Catalog, id: string): CatalogModule | undefined {
  const key = id.trim();
  if (key === "") return undefined;
  return catalog.modules.find((item) => item.id === key);
}

/**
 * 归一：只留非空字符串、去前后空白、去重（保序）。
 *
 * **刻意不校验 id 是否存在**：这个函数同时被迁移与收尾归一调用，那里面对的是已经躺在
 * 库里的历史数据 —— 在那一层因为"某个模块被删了"而抛错，后果是**整库读不出来**
 * （比"显示成已失效"坏得多，与教室的"不猜、不拒"同一条纪律）。
 * 拒绝非法值的那道闸在服务层（见 `textbookIssues`）。
 */
export function normalizeTextbooks(value: unknown): TextbookId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (id === "" || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/**
 * 模块的**显示名**：`学科·模块名`（子模块带上上级链：`学科·上级·子模块`）。
 *
 * 找不到那个模块时返回**空串**（调用方要显示"已失效"就用 `textbookLabel`）。
 * 带学科的理由见文件头：模块名在多个学科下重名。
 */
export function moduleLabel(catalog: Catalog, id: string): string {
  /*
   * 局部变量刻意**不叫** `module`：`@next/next/no-assign-module-variable` 会当场报错
   * （Next 的 lint 规则把 `module` 当成那个 CommonJS 变量）—— 名字换成 `found`，
   * 口径与文案一个字没变。
   */
  const found = findTextbookModule(catalog, id);
  if (found === undefined) return "";

  const subject = catalog.subjects.find((item) => item.id === found.subjectId);
  const chain: string[] = [];
  let parentId = found.parentId;
  // 上级链：模块树理论上可以更深，因此循环上溯而不是"取一层"（同时防自引用死循环）
  const guard = new Set<string>([found.id]);
  while (parentId !== "" && !guard.has(parentId)) {
    guard.add(parentId);
    const parent = catalog.modules.find((item) => item.id === parentId);
    if (parent === undefined) break;
    chain.unshift(parent.name);
    parentId = parent.parentId;
  }

  return [subject?.name ?? "", ...chain, found.name].filter((part) => part !== "").join("·");
}

/**
 * 显示口径（唯一一处）：`学科·模块名`；模块已经不在课程类型里时给一句**看得懂**的话
 * 而不是空串 —— 空串在列表上是一个空白单元格，人会以为是"没填"。
 *
 * 括号里带的是 id：模块 id 本身就是 `mod_学科·模块名` 派生的，所以这一句既说明
 * "这本教材在课程类型里已经没有了"，又能让人照着去查是哪一本
 * （与「分区已失效」那种待办标记同一个做法：**看得见，能自己去修**）。
 */
export function textbookLabel(catalog: Catalog, id: string): string {
  const label = moduleLabel(catalog, id);
  return label !== "" ? label : `已失效教材（${id}）`;
}

/** 显示一列教材（列表 / 详情 / 日志用）。 */
export function textbookLabels(catalog: Catalog, ids: readonly string[]): string[] {
  return normalizeTextbooks(ids).map((id) => textbookLabel(catalog, id));
}

/** 一句话写法：`数学·八年级教材、物理·必修教材`（空列表给「—」）。 */
export function textbookSummary(catalog: Catalog, ids: readonly string[]): string {
  const labels = textbookLabels(catalog, ids);
  return labels.length === 0 ? "—" : labels.join("、");
}

/**
 * **服务层写入闸**：返回问题清单（空数组＝通过）。
 *
 * 判据与文案与批量导入（`resolveTextbookRef`）共用同一套说法，否则同一条记录
 * 从表单进来和从 CSV 进来会得到两种解释。
 *
 * 三类问题：
 *   1. 整个字段不是数组（例如有人把教材写成了一串文本）；
 *   2. 列表里有非字符串 / 空串以外的坏值；
 *   3. **id 在课程类型里不存在** —— 这时**不静默丢弃、也不静默存下**，而是报错拒绝，
 *      并且如果那个值其实写的是教材的**名字**（`物理·必修教材`），把它对应的
 *      **正规写法（id）说出来** —— "选错了"和"这一步该填什么"是两句话，
 *      只说前一句的报错会让人对着一个看不出问题的字符串发呆。
 */
export function textbookIssues(catalog: Catalog, value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    return [
      `学生的「教材」要是一个列表（课程类型里那些内容模块的 id），收到 ${typeof value}。` +
        "空数组表示还没填。",
    ];
  }

  const problems: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      problems.push(`「教材」里有空值或非文本项（${JSON.stringify(item)}）：请传模块 id，或干脆不传这一项。`);
      continue;
    }
    const id = item.trim();
    if (findTextbookModule(catalog, id) !== undefined) continue;

    /*
     * 没用 id 而用了**名字**是最常见的一种（「物理·必修教材」）：这是**能指出怎么改**的错，
     * 因此单独给一句 —— 指出它在库里的 id 是什么，人照着改一次就好。
     */
    const resolved = resolveTextbookRef(catalog, id);
    problems.push(
      resolved.ok
        ? `「教材」里写的是教材名字「${id}」，接口要的是**模块 id**：本库里它是「${resolved.id}」。` +
          "（界面上不用手填 —— 新建/编辑学生时在「现阶段使用的教材」里勾选即可。）"
        : `「教材」里有课程类型里不存在的模块：「${id}」。请到「课程 → 课程类型」里选一本已有的教材` +
          `（教材就是那一页的「内容模块」），再用它的 id 提交。${resolved.reason}`,
    );
  }
  return problems;
}

/** 解析结果：成 或 不成（不成的理由直接给人看）。 */
export type TextbookRefResolution =
  | { ok: true; id: TextbookId }
  | { ok: false; reason: string };

/**
 * **一格教材 → 模块 id 列表**（批量导入的「教材」列用：那一格按 `|` 拆好之后交进来）。
 *
 * 写法逐项交给 `resolveTextbookRef`（**唯一一处解析**：界面与服务层都不另写一份），
 * 因此「只写重名模块名」那一类错在这里得到的正是那句"没说清是哪个学科、请带上学科"。
 *
 * 两项约定与 `normalizeTextbooks` 一致：
 *   - 有一项认不出来就**整格不通过**（返回第一处的原因）—— 与 `textbookIssues` 同一个立场：
 *     宁可让人回去改一次表格，也不要静默存下"半格的选择"（少了哪一本，事后看不出来）；
 *   - 认下来的 id **去重保序**（同一本教材写两遍不该在库里变成两条）。
 */
export function resolveTextbookList(
  catalog: Catalog,
  texts: readonly string[],
): { ok: true; ids: TextbookId[] } | { ok: false; reason: string } {
  const ids: TextbookId[] = [];
  for (const text of texts) {
    const resolved = resolveTextbookRef(catalog, text);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    ids.push(resolved.id);
  }
  return { ok: true, ids: normalizeTextbooks(ids) };
}

/** 一段文本里最多列几个候选（报错里的"可选写法"，列太长反而没人看）。 */
const SUGGESTION_LIMIT = 6;

/** 引用文本（`学科·模块名`）——导出 / 报错里给人看与让人照抄的写法。 */
export function textbookRefText(catalog: Catalog, id: string): string {
  return textbookLabel(catalog, id);
}

/**
 * **一段文本 → 模块 id**（批量导入的「教材」列，以及"报错时指出正规写法"）。
 *
 * 接受的两种写法（都**只有这里一份实现**，界面不解析、服务层只校验 id）：
 *
 * | 写法 | 例子 | 什么时候用 |
 * | --- | --- | --- |
 * | `学科·模块名` | `物理·必修教材` | 表格里推荐写这个（模块名重名时必须写） |
 * | 模块 id | `mod_物理·必修教材` | 从导出里拿回来的、或接口里复制过来的 |
 *
 * **只写模块名（不带学科）在两种情况下分别对待**：
 *   - 这个名字在全库**唯一** → 认（`数学·七年级教材` 这种写法机构天天用，不该逼人多打四个字）；
 *   - 这个名字在多个学科下都有 → **报错要求带学科前缀**，并把可选写法列出来
 *     （「必修教材」无法判断是物理还是化学 → 这正是机构自己的口径：
 *     「科目名要与课程库一致否则排课报错」那种**把选择讲清楚**的报错）。
 */
export function resolveTextbookRef(catalog: Catalog, raw: string): TextbookRefResolution {
  const text = raw.trim();
  if (text === "") return { ok: false, reason: "这一格是空的。" };

  // ① 直接给了模块 id（导出 / 接口里就是这一串）
  const byId = findTextbookModule(catalog, text);
  if (byId !== undefined) return { ok: true, id: byId.id };

  // ② 带了学科前缀：按**第一个**「·」拆（模块名里带「·」的情形不存在，写清楚免得后来的人猜）
  if (text.includes("·")) {
    const separator = text.indexOf("·");
    const subjectName = text.slice(0, separator).trim();
    const moduleName = text.slice(separator + 1).trim();
    const subjects = catalog.subjects.filter((item) => item.name === subjectName);
    if (subjects.length === 0) {
      return {
        ok: false,
        reason: `「${subjectName}」不是「课程类型」里的学科 —— 写法是「学科·模块名」，例如「物理·必修教材」。`,
      };
    }
    const subjectIds = new Set(subjects.map((item) => item.id));
    const inSubject = catalog.modules.filter(
      (item) => subjectIds.has(item.subjectId) && item.name === moduleName,
    );
    if (inSubject.length === 1) return { ok: true, id: inSubject[0]!.id };
    if (inSubject.length === 0) {
      const available = catalog.modules
        .filter((item) => subjectIds.has(item.subjectId))
        .map((item) => `${subjectName}·${item.name}`)
        .slice(0, SUGGESTION_LIMIT);
      return {
        ok: false,
        reason:
          `「${subjectName}」下面没有叫「${moduleName}」的模块。` +
          (available.length > 0
            ? `这一科现在有：${available.join("、")}${available.length >= SUGGESTION_LIMIT ? " 等" : ""}`
            : "这一科下面还没有模块，请先到「课程 → 课程类型」里加上。"),
      };
    }
    // 同一学科下有重名模块（只在模块被组织成两层时才可能）：把完整路径列出来让人照抄
    return {
      ok: false,
      reason:
        `「${subjectName}」下面有 ${inSubject.length} 个叫「${moduleName}」的模块，看不出是哪一个。` +
        `请照抄其中一条：${inSubject.map((item) => textbookLabel(catalog, item.id)).join("、")}`,
    };
  }

  // ③ 只写了模块名：全库唯一才认
  const matched = catalog.modules.filter((item) => item.name === text);
  if (matched.length === 1) return { ok: true, id: matched[0]!.id };
  if (matched.length === 0) {
    return {
      ok: false,
      reason:
        `「课程类型」的内容模块里没有叫「${text}」的教材。请写「学科·模块名」（例如「物理·必修教材」），` +
        "或到「课程 → 课程类型」里先把这本教材加上。",
    };
  }
  const subjects = matched
    .map((item) => {
      const subject = catalog.subjects.find((candidate) => candidate.id === item.subjectId);
      return subject === undefined ? "" : `${subject.name}·${item.name}`;
    })
    .filter((item) => item !== "");
  return {
    ok: false,
    reason:
      `「${text}」在 ${String(matched.length)} 个学科下都有：这一行没说清是哪个学科的教材。` +
      `请带上学科，写成 ${subjects.slice(0, SUGGESTION_LIMIT).join(" 或 ")}` +
      (matched.length > SUGGESTION_LIMIT ? " 等" : "") +
      "。",
  };
}
