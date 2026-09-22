/**
 * **角色与权限的"一份数据"**（机构已确认的四个角色）。
 *
 * ## 现在是什么状态
 *
 * 系统**还没有账号与权限**：一个 `admin` 登进来就能看、能改全部数据。
 * 这个文件是**提前立起来的映射**：谁该看到哪一页、谁该能调哪一组接口。
 * 映射本身现在不影响任何行为（唯一使用者是自检与后面的界面隐藏），
 * 但它把"分工"从文档里搬进了代码 —— 权限落地时只需要在服务端按这张表做闸门，
 * 而不是重新讨论一遍谁该看什么。
 *
 * ## 为什么要写成数据、并且让自检盯着它
 *
 * 权限最容易出的问题不是"判错了"，而是**新增功能时没人给它定归属** ——
 * 加了 20 个接口、加了 3 个页面，映射表还是旧的，于是新功能默认对所有人开放
 * （默认开放是最危险的那种默认值）。因此 `scripts/check.mts` 里有三条断言：
 *
 *   1. `ADMIN_NAV` 里的**每个页面**都要有角色映射；
 *   2. `API_CONTRACT` 里的**每个接口分组**都要有角色映射；
 *   3. **技术管理员必须是全集的超集**（"全权限"不能只是文档里的一句话）。
 *
 * 漏一个就红，于是新功能必须顺手想清楚"归谁"。
 *
 * ## 四条已确认的边界（来自机构）
 *
 * ① 财务管理员**能**建档 / 报课；② 招生老师**能**退课；
 * ③ 普通教师**能**看到**自己学生**的课时余额；④ 一个账号**能**兼任多个角色。
 *
 * 一个账号多个角色 → 判定是"**角色集合里只要有一个允许就允许**"
 * （见 `canAccess`），而不是"取最高角色"那种容易说不清的做法。
 */

/** 四个角色。顺序即后台界面上的展示顺序（权限高→低）。 */
import { API_CONTRACT } from "@/lib/backend/contract";

export const ROLES = ["技术管理员", "财务管理员", "招生老师", "普通教师"] as const;
export type Role = (typeof ROLES)[number];

/** 角色什么时候能看到"自己的"数据（普通教师只看自己的课、自己学生的课时）。 */
export const ROLE_SCOPE_NOTES: Record<Role, string> = {
  技术管理员: "全部数据",
  财务管理员: "全部学生的钱与账（以及建档 / 报课）",
  招生老师: "全部学生与排课（含退课与收款）",
  普通教师: "只看自己的课与自己学生的课时余额",
};

/**
 * 后台页面 → 允许的角色（键与 `lib/site/admin-nav.ts` 的 `href` 一致）。
 *
 * 说明几处刻意的安排：
 *   - 教师页与教室页：普通教师与招生老师**只读**（看谁带什么课、哪间教室空着），
 *     维护归技术管理员 —— 权限落地时"只读"与"可改"要在服务端分开（读接口宽、写接口严）；
 *   - 学生页：四类人**都能进**，但能做的事不同（教师看课时余额、招生与财务能改、技术全权）；
 *     因此页面级权限不够，落地时要细到"动作"（报课 / 收款 / 退课 / 改档案）。
 */
export const PAGE_ACCESS: Record<string, Role[]> = {
  "/admin": ["技术管理员", "财务管理员", "招生老师", "普通教师"],
  "/admin/inquiries": ["技术管理员", "招生老师"],
  "/admin/students": ["技术管理员", "财务管理员", "招生老师", "普通教师"],
  "/admin/teachers": ["技术管理员", "财务管理员", "招生老师", "普通教师"],
  "/admin/classrooms": ["技术管理员", "财务管理员", "招生老师", "普通教师"],
  "/admin/courses": ["技术管理员", "招生老师", "普通教师"],
  "/admin/lessons": ["技术管理员", "招生老师", "普通教师"],
  "/admin/calendar": ["技术管理员", "财务管理员", "招生老师", "普通教师"],
  "/admin/timetable": ["技术管理员", "财务管理员", "招生老师", "普通教师"],
  "/admin/stats": ["技术管理员", "财务管理员", "招生老师", "普通教师"],
  "/admin/followups": ["技术管理员", "财务管理员", "招生老师"],
  "/admin/scripts": ["技术管理员", "招生老师"],
  "/admin/finance": ["技术管理员", "财务管理员"],
  "/admin/pricing": ["技术管理员", "财务管理员", "招生老师"],
  "/admin/data": ["技术管理员"],
};

/**
 * 学生页内部的动作 → 允许的角色（页面级权限管不到这一层）。
 *
 * 这张表是给实现时用的：同一个 `/admin/students` 页面，
 * 教师只能读课时余额，招生与财务能报课收款退课，技术管理员全权。
 */
export const STUDENT_ACTION_ACCESS: Record<string, Role[]> = {
  /** 看档案与课时余额（普通教师只看自己学生的）。 */
  "students.read": ["技术管理员", "财务管理员", "招生老师", "普通教师"],
  /** 建档 / 改档案。 */
  "students.write": ["技术管理员", "财务管理员", "招生老师"],
  /** 报课 / 改报课（机构确认：财务也要能报课）。 */
  "students.enroll": ["技术管理员", "财务管理员", "招生老师"],
  /** 收款 / 退款 / 退课（机构确认：招生也要能退课）。 */
  "students.money": ["技术管理员", "财务管理员", "招生老师"],
  /** 只读课时账本（流水与撤销记录）。 */
  "students.ledger": ["技术管理员", "财务管理员", "招生老师", "普通教师"],
};

/**
 * 接口分组（键与 `lib/backend/contract.ts` 的 `API_CONTRACT[].id` 一致）→ 允许的角色。
 *
 * 粒度刻意取"分组"而不是"逐个方法"：114 个方法逐个配一遍，改一次要动几十行、
 * 而且没人会去核对；按分组配，一眼能看完，服务端闸门也正好是"按方法前缀/分组"一处。
 * 分组内部真的需要再分时（例如学生页的"读 / 写 / 钱"），用 `STUDENT_ACTION_ACCESS` 那一层。
 */
export const GROUP_ACCESS: Record<string, Role[]> = {
  /** 一、通用 CRUD：档案类增删改（学生 / 教师 / 教室 / 课程 / 排课…）。 */
  crud: ["技术管理员", "财务管理员", "招生老师"],
  /** 二、关联查询：按学生 / 教师 / 教室 / 日期查课。 */
  query: ["技术管理员", "财务管理员", "招生老师", "普通教师"],
  /** 三、业务动作：报课、改报课、续费、退课、标记已上、课堂记录、收款…。 */
  actions: ["技术管理员", "财务管理员", "招生老师", "普通教师"],
  /** 四、咨询线索。 */
  inquiries: ["技术管理员", "招生老师"],
  /** 五、报价配置（改价）。 */
  pricing: ["技术管理员", "财务管理员"],
  /** 六、看板与统计。 */
  dashboards: ["技术管理员", "财务管理员", "招生老师", "普通教师"],
  /** 七、运维与审计：导入导出、备份恢复、重置、日志。 */
  ops: ["技术管理员"],
};

/**
 * 每个方法的归属解析：**分组只作兜底，特例写在这里**。
 *
 * ## 为什么分组不够
 *
 * `API_CONTRACT` 的分组是**接口分类**（一、通用 CRUD；三、业务动作…），它不总是权限边界：
 *   - `crud` 里既有 `students.list`（读）也有 `students.remove`（删）—— 而
 *     "普通教师能看自己学生的课时余额"意味着**读要宽、写要严**；
 *   - `actions` 里既有 `students.enroll`（报课：招生 / 财务）也有 `lessons.markCompleted`
 *     （标记已上：教师的核心动作）—— 同一组里归不同角色。
 *
 * 因此判定按下表逐层解析，**先特例、后分组**：
 *   1. `METHOD_ACCESS` 里点了名的，就按它（下面那一小张表，一眼能看完）；
 *   2. `crud` / `query` 里的**只读方法**对所有角色开放（见 `isReadMethod`）；
 *   3. 其余按 `GROUP_ACCESS` 的分组默认；
 *   4. 都没有（方法没登记归属）→ **返回 null，调用方必须关门**。
 *
 * 第 4 条是这个文件里最重要的一条：新增方法时忘了定归属，默认结果必须是"谁都进不来"，
 * 而不是"谁都能进" —— 后者是最危险的那种默认值（新功能静默对所有人开放）。
 */
export const METHOD_ACCESS: Record<string, Role[]> = {
  // 报课 / 改报课 / 续费 / 退课 / 调整课时：机构确认"财务也要能报课""招生也要能退课"
  "students.enroll": ["技术管理员", "财务管理员", "招生老师"],
  "students.updateEnrollment": ["技术管理员", "财务管理员", "招生老师"],
  "students.renewEnrollment": ["技术管理员", "财务管理员", "招生老师"],
  "students.refundEnrollment": ["技术管理员", "财务管理员", "招生老师"],
  "students.adjustEnrollmentLessons": ["技术管理员", "财务管理员", "招生老师"],
  "students.saveProfile": ["技术管理员", "财务管理员", "招生老师"],
  // 记收款 / 退款：钱的事
  "payments.record": ["技术管理员", "财务管理员", "招生老师"],
  // 标记已上 / 课堂记录 / 阶段测评：教师的核心动作（财务不参与教学）
  "lessons.markCompleted": ["技术管理员", "招生老师", "普通教师"],
  "lessons.createMakeup": ["技术管理员", "招生老师", "普通教师"],
  "lessonRecords.save": ["技术管理员", "招生老师", "普通教师"],
  "assessments.add": ["技术管理员", "招生老师", "普通教师"],
  // 咨询：招生的活
  "inquiries.evaluate": ["技术管理员", "招生老师"],
  "inquiries.accept": ["技术管理员", "招生老师"],
  "inquiries.abandon": ["技术管理员", "招生老师"],
  // 报价：看得到价才能给家长试算；**改价**仍是财务与技术（见 GROUP_ACCESS.pricing）
  "pricing.get": ["技术管理员", "财务管理员", "招生老师"],
  "pricing.quote": ["技术管理员", "财务管理员", "招生老师"],
  // 网站内容：读是公开的（构站脚本也要读），写归技术管理员
  "site.publicContent": [...ROLES],
  "site.importFromContent": ["技术管理员"],
  "site.saveContent": ["技术管理员"],
};

/** 只读方法的判据（`crud` / `query` 里"只是看一眼"的那些）。 */
function isReadMethod(method: string): boolean {
  const leaf = method.split(".").pop() ?? "";
  return /^(list|get|find|search|options|summary|suggest|listBy|check)/.test(leaf);
}

/** 方法 → 分组 id（从 `API_CONTRACT` 推导，单一真源；找不到返回 null）。 */
export function groupOfMethod(method: string): string | null {
  for (const group of API_CONTRACT) {
    if (group.methods.includes(method)) return group.id;
  }
  return null;
}

/**
 * 这个方法的**允许角色**；返回 `null` 表示"没登记归属" ——
 * 调用方（服务端闸门）必须按**关门**处理，并说清是哪个方法没登记。
 */
export function allowedRolesForMethod(method: string): Role[] | null {
  const override = METHOD_ACCESS[method];
  if (override !== undefined) return override;

  const group = groupOfMethod(method);
  if (group === null) return null;

  // 读宽写严：查看看板、列表、单条，四类角色都要用（普通教师看自己的课，行级范围另做）
  if ((group === "crud" || group === "query") && isReadMethod(method)) return [...ROLES];

  return GROUP_ACCESS[group] ?? null;
}

/** 角色集合里只要有一个角色被允许，就允许（机构确认：一个账号可兼任多个角色）。 */
export function canAccess(roles: readonly Role[], allowed: readonly Role[]): boolean {
  return roles.some((role) => allowed.includes(role));
}

/** 这个账号能进哪些页面（权限落地后，导航按它过滤）。 */
export function visiblePages(roles: readonly Role[]): string[] {
  return Object.entries(PAGE_ACCESS)
    .filter(([, allowed]) => canAccess(roles, allowed))
    .map(([href]) => href);
}

/** 这个账号能用哪些接口分组（权限落地后，服务端闸门按它拦）。 */
export function allowedGroups(roles: readonly Role[]): string[] {
  return Object.entries(GROUP_ACCESS)
    .filter(([, allowed]) => canAccess(roles, allowed))
    .map(([id]) => id);
}

/** 自检用：这份映射里每个角色分别能进多少页面 / 分组（"全权限"要被验证，而不只是写着）。 */
export function permissionSummary(): Array<{ role: Role; pages: number; groups: number }> {
  return ROLES.map((role) => ({
    role,
    pages: visiblePages([role]).length,
    groups: allowedGroups([role]).length,
  }));
}
