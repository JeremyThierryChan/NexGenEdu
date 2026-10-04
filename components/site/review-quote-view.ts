/**
 * 双语评价卡片「显示哪一份、前缀写什么、要不要按钮」的**纯逻辑**（v37 / E26）。
 *
 * ## 为什么把它从组件里抽出来
 *
 * 机构口径有三态，而这三态最容易写成"组件里一串三元表达式"：
 *
 *   1. **单语**（`original` 为空）→ 只显示 `text`，**不加任何前缀、不显示按钮**
 *      （机构原话：「单语评价保持干净」）；
 *   2. **双语 · 默认** → 显示 `text`（译文），段落前加小字前缀「（译文）」；
 *   3. **双语 · 切到原文** → 显示 `original`，前缀变成「（{originalLanguage}原文）」
 *      （例：「（法语原文）」；`originalLanguage` 为空时退化成「（原文）」）。
 *
 * 抽成纯函数之后，`scripts/check.mts` §59 可以直接 `import` 它把三态**逐字段**验一遍
 * （不用渲染 React、不用点按钮），组件那一层就只剩"把结果画出来 + 管 `useState`"。
 * 组件与断言读的是**同一份判据**，不会出现"断言验的是一套、页面跑的是另一套"。
 *
 * ⚠️ 这里**不碰** `realName`（内部实名）：评价卡片在网站上永远是匿名的，
 * 署名那一栏由调用方从 `author` 取，这个函数只管正文与那行前缀。
 */

/** 组件收到的三个数据（原文 / 原文语言都可空 —— 空串就是单语评价）。 */
export type ReviewQuoteInput = {
  /** 译文（卡片默认显示的那一份）。 */
  text: string;
  /** 原文；空串＝没有原文（单语评价）。 */
  original?: string;
  /** 原文语言（例：`法语`）；空串时原文前缀退化成「（原文）」。 */
  originalLanguage?: string;
};

/** 当前该画出来的东西（前缀 / 正文 / 按钮）。 */
export type ReviewQuoteView = {
  /** 当前显示的正文（原样，段落里的换行由组件用 `whitespace-pre-line` 保留）。 */
  body: string;
  /**
   * 段落前那行小字前缀：`（译文）` / `（法语原文）` / `（原文）`；
   * **单语评价是空串**（不加任何前缀 —— 机构要求单语保持干净）。
   */
  prefix: string;
  /** 是否显示切换按钮：**只有有原文时才显示**。 */
  showToggle: boolean;
  /** 按钮上的字（「看原文」/「看译文」）。 */
  toggleLabel: string;
  /**
   * 无障碍标签：说清**按了会发生什么**（不是"切换"这种说了等于没说的话）。
   * 单语评价没有按钮，这里是空串。
   */
  toggleAriaLabel: string;
};

/**
 * 算出当前该显示哪一份。
 *
 * @param input 评价的三样数据
 * @param showOriginal 当前是不是停在原文上（由组件的 `useState` 给）。
 *   **不记住这个状态**：刷新回到默认的译文 —— 与仓库既有取舍一致（"看的方式"不是数据，
 *   机构从没要求刷新后还停在原文）。
 */
export function reviewQuoteView(input: ReviewQuoteInput, showOriginal: boolean): ReviewQuoteView {
  const text = input.text ?? "";
  const original = (input.original ?? "").trim();
  const language = (input.originalLanguage ?? "").trim();
  /** 前缀里的语言标签：没填语言就说「原文」。 */
  const originalLabel = language === "" ? "原文" : `${language}原文`;

  // 单语：不加前缀、不显示按钮（机构口径：单语评价保持干净）
  if (original === "") {
    return {
      body: text,
      prefix: "",
      showToggle: false,
      toggleLabel: "",
      toggleAriaLabel: "",
    };
  }

  if (showOriginal) {
    return {
      body: original,
      prefix: `（${originalLabel}）`,
      showToggle: true,
      toggleLabel: "看译文",
      // 按钮按下去会回到译文：标签要说清"会变成什么"
      toggleAriaLabel: `切换到译文（${language === "" ? "默认" : "中文"}译文）`,
    };
  }

  return {
    body: text,
    prefix: "（译文）",
    showToggle: true,
    toggleLabel: "看原文",
    // 按钮按下去会看到原文：标签把语言说进去（「看原文」在法语卡片上不够具体）
    toggleAriaLabel: `查看${originalLabel}`,
  };
}
