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
  { href: "/admin/students", label: "学生", description: "学生档案、剩余课时与下一节课" },
  { href: "/admin/teachers", label: "教师", description: "教师档案与今日本周课程" },
  { href: "/admin/classrooms", label: "教室", description: "教室占用状态与空档" },
  { href: "/admin/lessons", label: "课程安排", description: "课程列表、排课与冲突检测" },
  { href: "/admin/calendar", label: "日历", description: "按日 / 周查看课程安排" },
  {
    href: "/admin/timetable",
    label: "课表与占用",
    description: "按周查看教师课表与教室占用（谁什么时候上、哪间教室空着）",
  },
  {
    href: "/admin/data",
    label: "数据与备份",
    description: "导出 / 导入全部数据，导出课表到手机日历",
  },
] as const;
