/**
 * 教务后台导航配置。
 * 与宣传网站导航分开维护：后台是工具，信息密度与层级都不同。
 */
export type AdminNavItem = {
  href: string;
  label: string;
  /** 该页面的用途，用于侧边栏 title 提示，也让 Phase 4 实现时有明确目标。 */
  description: string;
};

export const ADMIN_NAV: readonly AdminNavItem[] = [
  { href: "/admin", label: "今日概览", description: "今天有哪些课程、教室占用与课时预警" },
  {
    href: "/admin/inquiries",
    label: "咨询",
    description: "家长咨询登记与排课可行性（这个安排能不能接、不能的话最接近的方案）",
  },
  { href: "/admin/students", label: "学生", description: "学生档案、剩余课时与下一节课" },
  { href: "/admin/teachers", label: "教师", description: "教师档案与今日本周课程" },
  { href: "/admin/classrooms", label: "教室", description: "教室占用状态与空档" },
  {
    href: "/admin/courses",
    label: "课程",
    description:
      "一页三个页签：课程台账（实际开的课、卡片、正文、报价）· 课程类型（学段 × 学科 / 项目 × 内容模块 × 班型这四个维度）· 开放矩阵（哪些组合真的开）。加课、改类型、勾开放都在这一页",
  },
  {
    href: "/admin/content",
    label: "网站内容",
    description: "宣传网站上的对外文案：学生案例（/cases 与首页那块的来源）",
  },
  { href: "/admin/lessons", label: "课程安排", description: "课程列表、排课与冲突检测" },
  {
    href: "/admin/calendar",
    label: "日历",
    description:
      "按周查看排课密度与空档；同页的「假期与作息」里是法定节假日年度表与寒暑假段（手动录入）—— 每天标出按工作日还是按周末时段排",
  },
  {
    href: "/admin/timetable",
    label: "课表与占用",
    description: "按周查看教师课表与教室占用（谁什么时候上、哪间教室空着）",
  },
  {
    href: "/admin/stats",
    label: "统计",
    description: "教室利用率与空档、教师课时、退课与流失",
  },
  {
    href: "/admin/followups",
    label: "待跟进",
    description: "课时不足、欠费、作业与测评异常的学生，附可直接发送的沟通话术",
  },
  {
    href: "/admin/scripts",
    label: "话术",
    description: "按场景摆好的沟通草稿（接待、报价、试课、请假、续费、欠费、退费…），可套用学生后复制",
  },
  {
    href: "/admin/finance",
    label: "收费",
    description: "本月收入、收款流水、欠费清单与退费口径",
  },
  {
    href: "/admin/pricing",
    label: "报价",
    description: "基础价、人数系数与计费规则，并可直接给家长试算",
  },
  {
    href: "/admin/data",
    label: "数据与备份",
    description: "导出 / 导入全部数据，导出课表到手机日历",
  },
  {
    href: "/admin/accounts",
    label: "账号",
    description: "谁能登录后台、各是什么角色（加账号、改角色、绑定教师、重置口令、停用）",
  },
] as const;
