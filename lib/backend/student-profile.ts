/**
 * 学生信息采集表的字段定义。
 *
 * 为什么做成「数据」而不是写八十个输入框：
 *   1. 采集表是会改的（家长问卷、教育局要求、老师的经验都会让它变），
 *      改字段只应该改这一个文件；
 *   2. 表单与详情页共用同一份定义，不会出现「表单加了字段、详情页忘了显示」；
 *   3. 心理与情绪健康一节标了 `sensitive`，界面据此默认折叠 —— 敏感信息的
 *      可见性由数据决定，而不是散落在各个页面里判断。
 *
 * 答案存在 `Student.profile` 里（键值对），因此加字段不需要数据迁移：
 * 老档案读不到新字段就是空值。
 */

/** 字段类型：决定表单控件与详情页的展示方式。 */
export type ProfileFieldType =
  | "text"
  | "longtext"
  | "date"
  | "number"
  | "select"
  | "multi"
  | "table";

/** 表格型字段的列定义。 */
export type ProfileTableColumn = {
  key: string;
  label: string;
  /** 列宽参考；仅用于表格布局。 */
  width?: string;
  /** 该列是下拉选择时的候选项。 */
  options?: string[];
};

export type ProfileField = {
  /** 存储键；一旦有数据就不要改名（改名等于丢数据）。 */
  key: string;
  label: string;
  type: ProfileFieldType;
  /** select / multi / table 列的候选项。 */
  options?: string[];
  /** 单位或填写提示。 */
  hint?: string;
  /** table 型：固定行标签（如「周一…周日」），为空表示行可自由增删。 */
  rows?: string[];
  /** table 型：列定义。 */
  columns?: ProfileTableColumn[];
};

export type ProfileSection = {
  id: string;
  title: string;
  /** 一节标题下的说明。 */
  description?: string;
  /** 敏感小节：默认折叠，需要点开才显示。 */
  sensitive?: boolean;
  fields: ProfileField[];
};

export const PROFILE_SECTIONS: ProfileSection[] = [
  {
    id: "basic",
    title: "一、基本与家庭信息",
    fields: [
      { key: "gender", label: "性别", type: "select", options: ["男", "女", "保密"] },
      { key: "birthDate", label: "出生日期", type: "date" },
      { key: "school", label: "就读学校", type: "text" },
      {
        key: "schoolType",
        label: "学校性质",
        type: "select",
        options: ["公立", "私立", "国际学校"],
      },
      { key: "classroom", label: "班级", type: "text", hint: "例如 3 班" },
      { key: "homeAddress", label: "家庭住址", type: "text" },
      { key: "enrolledAt", label: "入学日期", type: "date" },
      { key: "guardianName", label: "主要监护人姓名", type: "text" },
      {
        key: "guardianRelation",
        label: "与学生关系",
        type: "select",
        options: ["父亲", "母亲", "祖父母", "其他"],
      },
      {
        key: "guardianWechat",
        label: "监护人微信",
        type: "text",
        hint: "监护人手机见上方的「家长联系方式」",
      },
      { key: "backupContact", label: "备用联系人及手机", type: "text" },
      {
        key: "familyStructure",
        label: "家庭结构",
        type: "select",
        options: ["双亲", "单亲", "隔代抚养", "寄宿"],
      },
      {
        key: "parentEducation",
        label: "家长教育背景",
        type: "select",
        options: ["大专及以下", "本科", "研究生及以上"],
      },
      {
        key: "parentInvolvement",
        label: "家长学习参与度",
        type: "select",
        options: ["高度参与", "一般", "基本不参与"],
      },
      {
        key: "familyFinance",
        label: "家庭经济情况（自评）",
        type: "select",
        options: ["宽裕", "一般", "有压力"],
      },
      { key: "expectedTier", label: "家长期望院校层次", type: "text", hint: "如：985 / 一本 / 职校" },
      { key: "hasSiblings", label: "是否有兄弟姐妹", type: "select", options: ["有", "无"] },
    ],
  },
  {
    id: "academic",
    title: "二、学业基础信息",
    fields: [
      {
        key: "baselineScores",
        label: "各科成绩（入学时填写）",
        type: "table",
        rows: ["语文", "数学", "英语", "物理", "化学", "生物", "历史", "地理", "政治/道法"],
        columns: [
          { key: "baseline", label: "摸底测试分数" },
          { key: "recent", label: "学校近期考试分数" },
          { key: "note", label: "备注" },
        ],
      },
      { key: "rankInfo", label: "年级排名 / 班级排名", type: "text" },
      { key: "weakSubjects", label: "自评薄弱科目", type: "text" },
      { key: "strongSubjects", label: "自评擅长科目", type: "text" },
      {
        key: "hadOtherTutoring",
        label: "是否有其他机构辅导经历",
        type: "select",
        options: ["有", "无"],
      },
      { key: "otherTutoringDetail", label: "如有，机构名称及科目", type: "text" },
      {
        key: "subjectCombination",
        label: "选科组合",
        type: "text",
        hint: "高中生填，如：物化生 / 史地政 / 物化政",
      },
      {
        key: "majorDirectionDecided",
        label: "是否已确定目标专业方向",
        type: "select",
        options: ["是", "否", "初步想法"],
      },
      { key: "majorDirection", label: "目标专业方向", type: "text" },
    ],
  },
  {
    id: "habits",
    title: "三、学习行为与习惯",
    fields: [
      { key: "dailyStudyHours", label: "每日有效学习时长（自评）", type: "number", hint: "小时" },
      {
        key: "previewHabit",
        label: "预习习惯",
        type: "select",
        options: ["从不", "偶尔", "经常", "总是"],
      },
      {
        key: "wrongQuestionHabit",
        label: "错题整理习惯",
        type: "select",
        options: ["从不", "偶尔", "经常", "总是"],
      },
      {
        key: "noteHabit",
        label: "笔记习惯",
        type: "select",
        options: ["无笔记", "抄写为主", "主动归纳整理"],
      },
      { key: "attentionSpan", label: "注意力可持续集中时长", type: "number", hint: "分钟" },
      {
        key: "preferredLearningStyles",
        label: "偏好学习形式",
        type: "multi",
        options: ["视频讲解", "老师板书", "大量刷题", "互动讨论", "思维导图"],
      },
      {
        key: "phoneSelfControl",
        label: "手机自控情况",
        type: "select",
        options: ["自控良好", "一般", "依赖严重"],
      },
      { key: "procrastination", label: "拖延程度", type: "select", options: ["低", "中", "高"] },
      {
        key: "homeworkCompletion",
        label: "课后作业完成情况",
        type: "select",
        options: ["每次按时完成", "偶尔拖延", "经常未完成"],
      },
    ],
  },
  {
    id: "scheduling",
    title: "四、排课相关信息",
    fields: [
      {
        key: "preferredTimeSlot",
        label: "偏好上课时间段",
        type: "multi",
        options: ["上午", "下午", "晚上"],
      },
      {
        key: "sessionLengthPreference",
        label: "单次课程时长偏好",
        type: "select",
        options: ["60分钟", "90分钟", "120分钟"],
      },
      {
        key: "consecutiveAcceptance",
        label: "连排课接受度",
        type: "select",
        options: ["不接受", "最多连上两节", "无限制"],
      },
      { key: "schoolEveningEndTime", label: "学校晚自习结束时间", type: "text", hint: "例如 21:00" },
      { key: "commuteMinutes", label: "到机构交通时长", type: "number", hint: "分钟" },
      {
        key: "locationPreference",
        label: "上课地点偏好",
        type: "select",
        options: ["线上", "线下", "均可"],
      },
      {
        key: "availableTimes",
        label: "可上课时间",
        type: "table",
        rows: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"],
        columns: [
          { key: "range", label: "可上课时间段", width: "w-56" },
          { key: "note", label: "备注" },
        ],
      },
      {
        key: "currentSubjects",
        label: "当前已报科目",
        type: "text",
        hint: "家长口述记录用；正式报课以「报课与课时」里的记录为准",
      },
      { key: "extracurricular", label: "课外兴趣班（时间）", type: "text" },
      { key: "upcomingExams", label: "近期重要考试 / 活动日期", type: "longtext" },
      { key: "holidayPlans", label: "假期出行计划", type: "longtext" },
    ],
  },
  {
    id: "psychology",
    title: "五、心理与情绪健康",
    description: "由老师通过日常观察或一对一沟通逐步完善；敏感内容默认折叠。",
    sensitive: true,
    fields: [
      {
        key: "moodState",
        label: "当前整体情绪状态",
        type: "select",
        options: ["积极", "平稳", "有些低落", "焦虑", "说不清楚"],
      },
      {
        key: "academicPressure",
        label: "对学业的压力感受",
        type: "select",
        options: ["没什么压力", "适度", "比较大", "非常大"],
      },
      { key: "examAnxiety", label: "对考试的焦虑程度", type: "select", options: ["低", "中", "高"] },
      { key: "peerRelation", label: "与同学的关系", type: "select", options: ["良好", "一般", "有矛盾"] },
      {
        key: "teacherRelation",
        label: "与学校老师的关系",
        type: "select",
        options: ["良好", "一般", "紧张"],
      },
      {
        key: "parentRelation",
        label: "与家长的关系",
        type: "select",
        options: ["良好", "一般", "有明显冲突"],
      },
      {
        key: "selfEfficacy",
        label: "自我效能感",
        type: "select",
        options: ["高（相信努力有用）", "中", "低（觉得自己学不好）"],
      },
      {
        key: "attributionStyle",
        label: "归因风格",
        type: "select",
        options: ["内控（努力决定结果）", "外控（靠运气/题太难）"],
      },
      { key: "perfectionism", label: "完美主义倾向", type: "select", options: ["低", "中", "高"] },
      {
        key: "learnedHelplessness",
        label: "是否出现习得性无助",
        type: "select",
        options: ['有（"学了也没用"等表达）', "无"],
      },
      { key: "sleepDietAbnormal", label: "睡眠或饮食是否有明显异常", type: "select", options: ["有", "无"] },
      {
        key: "majorLifeEvents",
        label: "是否经历过重大生活事件",
        type: "select",
        options: ["有（转学、家庭变故、被霸凌等）", "无"],
      },
      { key: "counselingHistory", label: "是否有校外心理咨询经历", type: "select", options: ["有", "无"] },
      {
        key: "willingEmotionalSupport",
        label: "是否愿意接受老师的情绪支持",
        type: "select",
        options: ["愿意", "不确定", "不愿意"],
      },
      {
        key: "motivationSource",
        label: "学习动机来源",
        type: "multi",
        options: ["自我兴趣", "家长期望", "同伴竞争", "升学压力", "对未来有规划"],
      },
      {
        key: "goalClarity",
        label: "目标明确程度",
        type: "select",
        options: ["非常清晰", "大致清楚", "比较模糊", "完全不知道"],
      },
      { key: "shortTermGoal", label: "短期目标（下次考试）", type: "text" },
      { key: "midTermGoal", label: "中期目标（学期末）", type: "text" },
      { key: "longTermGoal", label: "长期目标（中考 / 高考）", type: "text" },
      {
        key: "expectations",
        label: "对机构的主要期望",
        type: "multi",
        options: ["成绩提升", "情绪支持", "改善学习方法", "陪伴监督"],
      },
    ],
  },
  {
    id: "health",
    title: "六、健康与特殊需求",
    fields: [
      {
        key: "visionIssue",
        label: "是否有视力问题",
        type: "select",
        options: ["有（需靠前座位）", "无"],
      },
      { key: "hearingIssue", label: "是否有听力问题", type: "select", options: ["有", "无"] },
      {
        key: "learningDisorder",
        label: "是否有学习障碍（阅读障碍、注意力缺陷等）",
        type: "select",
        options: ["有", "无", "疑似但未确诊"],
      },
      { key: "chronicIllness", label: "是否有慢性病或需定期服药", type: "select", options: ["有", "无"] },
      { key: "dietaryRestrictions", label: "饮食限制", type: "text", hint: "无 / 有（请注明）" },
      { key: "healthNotes", label: "其他需要老师注意的事项", type: "longtext" },
    ],
  },
];

/** 档案里的一行表格数据；键是列 key。 */
export type ProfileTableRow = Record<string, string>;

/** 档案值：文本 / 多选 / 表格。 */
export type ProfileValue = string | string[] | ProfileTableRow[];

/** 一份档案（键 → 值）。 */
export type StudentProfile = Record<string, ProfileValue>;

/** 全部字段（按 key 索引），供详情页按定义顺序展示。 */
export function allProfileFields(): ProfileField[] {
  return PROFILE_SECTIONS.flatMap((section) => section.fields);
}

/** 取文本值（表格与多选分别由下面的函数取）。 */
export function profileText(profile: StudentProfile, key: string): string {
  const value = profile[key];
  return typeof value === "string" ? value : "";
}

/** 取多选值。 */
export function profileList(profile: StudentProfile, key: string): string[] {
  const value = profile[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : [];
}

/** 取表格值。 */
export function profileTable(profile: StudentProfile, key: string): ProfileTableRow[] {
  const value = profile[key];
  return Array.isArray(value) && value.every((item) => typeof item === "object")
    ? (value as ProfileTableRow[])
    : [];
}

/** 档案填写进度：非空字段数 / 全部字段数（表格型的「有内容」指至少一行有值）。 */
export function profileCompletion(profile: StudentProfile): { filled: number; total: number } {
  const fields = allProfileFields();
  let filled = 0;

  for (const field of fields) {
    const value = profile[field.key];
    if (value === undefined) continue;
    if (typeof value === "string") {
      if (value.trim() !== "") filled += 1;
    } else if (Array.isArray(value)) {
      const hasContent = value.some((item) =>
        typeof item === "string" ? item.trim() !== "" : Object.values(item).some((cell) => cell.trim() !== ""),
      );
      if (hasContent) filled += 1;
    }
  }

  return { filled, total: fields.length };
}

/** 表格型字段的空表（按 rows 与 columns 生成空行）。 */
export function emptyProfileTable(field: ProfileField): ProfileTableRow[] {
  const rows = field.rows ?? [];
  const columns = field.columns ?? [];
  return rows.map(() => Object.fromEntries(columns.map((column) => [column.key, ""])));
}
