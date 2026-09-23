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
  /*
   * 课程类型（后台「课程类型」页）：五个维度表是**配置**，与课程库写入同一档
   * （技术管理员 / 财务管理员 / 招生老师），普通教师只读 —— 教师要用「班型」下拉，
   * 但"本机构开哪些班型"不该由每位老师各改一份。
   * 这与 `GROUP_ACCESS.crud` 对 `catalog.save` 的判定是同一个答案（该分组不给普通教师）。
   */
  "/admin/catalog": ["技术管理员", "财务管理员", "招生老师"],
  /*
   * 开放矩阵（后台「开放矩阵」页）：勾"哪些组合真的开"。与课程类型同一档 ——
   * 它是经营口径的设置（技术管理员 / 财务管理员 / 招生老师），教师只读。
   */
  "/admin/offers": ["技术管理员", "财务管理员", "招生老师"],
  "/admin/lessons": ["技术管理员", "招生老师", "普通教师"],
  "/admin/calendar": ["技术管理员", "财务管理员", "招生老师", "普通教师"],
  "/admin/timetable": ["技术管理员", "财务管理员", "招生老师", "普通教师"],
  "/admin/stats": ["技术管理员", "财务管理员", "招生老师", "普通教师"],
  "/admin/followups": ["技术管理员", "财务管理员", "招生老师"],
  "/admin/scripts": ["技术管理员", "招生老师"],
  "/admin/finance": ["技术管理员", "财务管理员"],
  "/admin/pricing": ["技术管理员", "财务管理员", "招生老师"],
  "/admin/data": ["技术管理员"],
  /*
   * 网站内容（后台「网站内容」页）：学生案例这类**对外文案**。
   *
   * 为什么给招生老师：案例与对外文案是市场营销口径的活，招生老师天天在跟家长讲这些；
   * 锁在技术管理员那一档的结果是"改一条案例要去找技术"。注意这一页**不含课程正文**
   * （那个仍在「课程库」页，`site.saveContent` 仍是技术管理员专属）——
   * 两个页面的分工写在 `docs/使用手册.md` 里。
   */
  "/admin/content": ["技术管理员", "招生老师"],
  /*
   * 账号管理（后台「账号」页）：**只有技术管理员**。
   *
   * 它决定"谁能登录这个系统、各是什么角色"—— 给了别的角色等于把权限本身交出去，
   * 于是"分权"这件事就没有意义了。与 `server/index.mts` 的 `/api/accounts` 那条闸门
   * （`ACCOUNTS_ROUTE_ROLES`）是同一个答案，`scripts/check-auth.mts` 的 [10] 节
   * 用真实 HTTP 断言普通教师调那四条路由一律 403。
   */
  "/admin/accounts": ["技术管理员"],
  /*
   * 节假日表（后台「节假日」页）：**只是给人看的参考资料**，四个角色都能进
   * （排课时要看哪天是假期、哪天是调休上班）。抓取那件事只有技术管理员，见下面的
   * `HOLIDAY_ACTION_ACCESS`。
   */
  "/admin/holidays": ["技术管理员", "财务管理员", "招生老师", "普通教师"],
};

/**
 * 节假日页内部的动作 → 允许的角色（页面级权限管不到这一层）。
 *
 * 与 `STUDENT_ACTION_ACCESS` 同一个做法：同一个页面里"读"与"抓取"是两个权限边界。
 * 服务端（`server/index.mts` 的 `holidaysRefreshDenial`）与前端按钮**都读这一份** ——
 * 判定数据只有一个来源，界面与接口不会各说一套。
 */
export const HOLIDAY_ACTION_ACCESS: Record<string, Role[]> = {
  /** 看这张表（与上面的页面权限同一个答案）。 */
  "holidays.read": ["技术管理员", "财务管理员", "招生老师", "普通教师"],
  /**
   * 抓取数据（走外网、写服务端机器上的文件）—— 属于**运维动作**，只有技术管理员。
   * 招生与财务每天都在用系统，但不该有人顺手把假日表换掉：这张表会影响排课与家长沟通。
   */
  "holidays.refresh": ["技术管理员"],
};

/**
 * **界面用**：这个角色集合能不能调这个服务层方法？
 *
 * ## 为什么要有它（审计抓到的一整片"点了没反应"）
 *
 * 界面上的按钮原先对四个角色**一律渲染**，于是普通教师在学生页看到「新增 / 编辑 / 删除」、
 * 财务管理员在排课页看到「标记已上」，点下去服务端 403，而调用是裸 `await` ——
 * 没人接的拒绝：提示不出现、按钮停在"保存中"。用户只知道"点了没反应"。
 *
 * 判定**不另建一张表**：直接问服务端用的那一个函数（`allowedRolesForMethod`）。
 * 这样界面上"看得见"的按钮与接口"放得行"的判定**天然同源**，
 * 不会再出现"页面进得去、每个请求都 403"（审计里报价页、课程库页正是这样）。
 *
 * 注意：前端拦得住手滑，拦不住直接调接口 —— **权限始终由服务端判定**，
 * 这里只是把必然失败的按钮藏起来，并告诉人该找谁。
 */
export function canCallMethod(roles: readonly Role[], method: string): boolean {
  const allowed = allowedRolesForMethod(method);
  // 没登记归属的方法对谁都不放行（与服务端闸门同一个默认：关门）
  return allowed !== null && canAccess(roles, allowed);
}

/** 上面那条判定失败时的说法（界面上写一句"这件事归谁"，而不是让人猜）。 */
export function methodOwnerText(method: string): string {
  const allowed = allowedRolesForMethod(method);
  return allowed === null ? "（这个方法没登记归属，谁都调不了）" : allowed.join(" 或 ");
}

/**
 * 接口分组（键与 `lib/backend/contract.ts` 的 `API_CONTRACT[].id` 一致）→ 允许的角色。
 *
 * 粒度刻意取"分组"而不是"逐个方法"：98 个方法逐个配一遍，改一次要动几十行、
 * 而且没人会去核对；按分组配，一眼能看完，服务端闸门也正好是"按方法前缀/分组"一处。
 * 分组内部真的需要再分时（例如学生页的"读 / 写 / 钱"），用 `canCallMethod`（按具体方法名问同一个判定函数）。
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
  // 学生案例这类对外文案：招生老师也要能改（见 PAGE_ACCESS 里 /admin/content 的说明）
  "site.saveBlocks": ["技术管理员", "招生老师"],
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

/* ── 行级范围（Phase B）：普通教师只看自己的课与自己学生的课时余额 ────────────────
 *
 * ## 这一层与上面那一层的分工
 *
 * 上半部分是**方法级**归属（"这件事归谁做"）：不满足就 403（`allowedRolesForMethod`）。
 * 这一部分是**行级**范围（"这件事里你只看得到哪几行"）：满足归属之后，
 * 普通教师仍然只能看到**自己带的课**与**自己课上的学生**。
 *
 * 两层都判定在服务端（`server/index.mts` 的 `permissionError` 与 `lib/backend/api.ts`
 * 各读一次这里的规则），因此"哪件事归谁""哪一行归谁"这两份口径都只有一处定义。
 *
 * ## 判定规则（写死的三条，机构已确认）
 *
 * ① **只有"当前身份恰好是普通教师"才启用范围**（`isPlainTeacher`）：
 *    一个账号可以兼任多个角色（机构确认④），兼职时按更高角色看 ——
 *    兼任财务的教师要看全部钱的账，兼任技术管理员的校长更是什么都要管。
 *    实现上是"角色集合恰好只含普通教师"，而不是"含普通教师就限"。
 *
 * ② **账号没绑 `teacherId` → 范围是空的**（登录成功但什么都看不到）。
 *    为什么选"空范围"而不是"拒绝启动/拒绝登录"：这是**数据配置**问题，不是身份问题 ——
 *    拒绝登录会让那位老师在机构现场彻底用不了系统（连"这节课是谁上的"都查不到），
 *    而机构加账号时漏填一个字段是必然会发生的（账号表是手写的）。
 *    空范围是"宁可少给"的正确方向：不会多给一行数据，而且提示写在登录响应 / 会话里
 *    （`scopeWarning`）说清了"为什么什么都看不到、该去哪里补"，人一看就知道怎么修。
 *    这条提示也写进了 docs/使用手册.md 的账号那一节。
 *
 * ③ **"自己的学生" = 在我的课里出现过的学生**（`lessons.teacherId === 我`，
 *    排除已取消的课；见 `lib/backend/api.ts` 的 `visibleStudentIds`）。
 *    刻意不做"报课记录里指定了这位教师"那种更宽的口径：一节我带的课上就有这个学生，
 *    我却看不到他的课时余额，老师的日常（家长问"还剩几节"）就断了；
 *    反过来把"只是报课时指定了我、但课都不是我上"的学生也算进来，才是多给。
 *
 * ## 默认关门，显式放行
 *
 * 规则表（`TEACHER_SCOPE_RULES`）里**没登记**的方法，对普通教师**一律拒绝**
 * （见 `teacherScopeDenial`）。这条默认值是这个文件里最重要的约定：
 * 角色表是"读宽写严"的（`crud` / `query` 里的只读方法默认四类角色都能用），
 * 于是**新增一个读接口时它会自动对教师开放** —— 如果范围那一层是"默认放行、逐个加过滤"，
 * 那么"教师能读到全校学生的接口"会随着每次加接口再出现一次，而且没人会发现。
 * 写成默认关门之后，新增接口的后果是"教师一点都调不到，于是有人去登记它"，
 * 这正是我们要的那种默认值。`scripts/check.mts` 里有一条断言盯着它：
 * **角色上允许普通教师的每个方法，都必须在这里登记**，漏一个就红。
 */

/** 一次会话的行级范围（服务端每请求按会话设置，见 `api.setScope`）。 */
export type SessionScope = {
  /** `"all"` = 不受行级范围限制；`"own"` = 只看 `teacherId` 名下的课与学生。 */
  kind: "all" | "own";
  /** `kind === "own"` 时的教师档案 id；空串表示"账号没绑教师档案"→ 范围为空。 */
  teacherId: string;
  /** 说清"为什么这个范围不正常"的一句话（空串 = 正常）；服务端把它放进登录响应与会话。 */
  warning: string;
};

/** 不受限制的范围（技术管理员 / 财务管理员 / 招生老师 / 兼任多角色的账号）。 */
export const SCOPE_ALL: SessionScope = { kind: "all", teacherId: "", warning: "" };

/** 教师账号没填 `teacherId` 时的提示（放登录响应与会话里，界面直接显示）。 */
export const EMPTY_SCOPE_WARNING =
  "这个账号是普通教师，但账号里没填 teacherId（要填教师档案的 id，不是姓名），" +
  "因此你的范围是空的：登录后看不到任何学生与排课。" +
  "请让技术管理员在后台的「账号」页给这条账号补上 teacherId（备用做法：改 accounts.json 里那一条，然后重启后端）。";

/**
 * 这个账号是不是"**只有**普通教师这一个角色"。
 *
 * 判据刻意是 `every`（而不是 `includes`）：兼任多角色的账号不受行级范围限制 ——
 * 机构确认过"一个账号能兼任多个角色"，给了更高角色就按更高角色看。
 */
export function isPlainTeacher(roles: readonly Role[]): boolean {
  return roles.length > 0 && roles.every((role) => role === "普通教师");
}

/**
 * 由**账号**（角色 + teacherId）算出这次会话的行级范围。
 *
 * 服务端用它（`requireAuth` 里按会话设置），前端算不了也不需要算 ——
 * 范围是服务端的事，前端说了不算（与角色同一条纪律）。
 */
export function scopeForAccount(roles: readonly Role[], teacherId: string): SessionScope {
  if (!isPlainTeacher(roles)) return SCOPE_ALL;
  const id = teacherId.trim();
  return { kind: "own", teacherId: id, warning: id === "" ? EMPTY_SCOPE_WARNING : "" };
}

/**
 * 普通教师能调到的方法 → 范围处理方式。
 *
 * 七种取值分别对应服务层里**七种不同的做法**（不是七种措辞）：
 *   - `global`    ：与"我的课 / 我的学生"无关的数据（教师、教室、课程库、网站公开内容）→ 原样返回；
 *   - `lessons`   ：只返回**我带的课**（含按课查的课堂记录）；
 *   - `students`  ：只返回**我的学生**那条线的东西（学生档案、他们的课时流水、课堂记录、作业、测评），
 *                   并且**剥掉金额字段**（见 api.ts 的 hideStudentMoney）；
 *   - `aggregate` ：按我的口径**重算**的看板（今日概览 / 统计：只算我的课、我的学生）；
 *   - `search`    ：全局搜索：学生与排课只搜我的，教师 / 教室 / 课程照旧；
 *   - `teach`     ：教学**写动作**（标记已上 / 课堂记录 / 阶段测评 / 补课）——
 *                   目标必须在我名下，否则当作"这条记录不存在"；
 *   - `hidden`    ：教师看不到的整块业务（**钱**、待跟进、排课、课程库写入）→ **明确拒绝**。
 *
 * ## 口径（服务端与文档里都写这一句）
 *
 *   - **行级越界 → 看不到**：读接口给空集 / `null`，写动作按"这条记录不存在"处理，
 *     一律**不报 403** —— "这个学生不是你的"与"这件事不归你"是两件事，
 *     用 403 会让人以为要找管理员开权限，实际要找的是"这门课是不是你带"；
 *     而且 403 本身就是一句"存在但不是你的"的信息泄漏。
 *   - **方法级没登记 / 标了 `hidden` → 403 明确拒绝**：
 *     那才是"这件事不归你"。这条边界是**可枚举的**（就是下表里标了 hidden 的那些），
 *     所以不会出现"同一个人一会儿 403 一会儿空列表"那种说不清的行为。
 */
export type TeacherScopeRule =
  | "global"
  | "lessons"
  | "students"
  | "aggregate"
  | "search"
  | "teach"
  | "hidden";

export const TEACHER_SCOPE_RULES: Record<string, TeacherScopeRule> = {
  /*
   * 参考数据：与"我的课 / 我的学生"无关，教师本来就要用
   * （排课下拉要教师列表、日历要教室、报课要科目），而且不含学生 / 金额信息。
   * 教师 / 教室页对普通教师本来就是"只读"（见 PAGE_ACCESS 的注释）。
   */
  "teachers.list": "global",
  "teachers.get": "global",
  "teachers.listActive": "global",
  "classrooms.list": "global",
  "classrooms.get": "global",
  "courses.list": "global",
  "courses.options": "global",
  "courses.summary": "global",
  // 分区（栏目 → 子栏目）与课程库同样是参考数据：清单要按它分组、下拉要选它
  "coursePartitions.list": "global",
  /*
   * 课程类型的**维度表**（学段 / 学科 / 模块 / 班型 / 交付形态）同理：
   * 它描述的是"本机构开什么"，不含任何学生 / 金额信息，
   * 而且现在就被前台与后台的下拉用到（`useFormOptions` 的班型候选）。
   * 两个写方法（`catalog.save` / `catalog.resetToSeed`）**刻意不在这里登记**：
   * 角色层 `GROUP_ACCESS.crud` 本来就不给普通教师，登记成 `hidden` 是没人维护的假配置
   * （下面课程分区那段写了同一条取舍，自检也盯着这种死条目）。
   */
  "catalog.list": "global",
  /*
   * 开放组合（`offers`）：与维度表同一条理由 —— 它描述的是"本机构开哪些组合"，
   * 不含任何学生 / 金额信息，而且前台报价与将来的排课下拉都要读它。
   * 写方法 `offers.save` 同样**不登记**（`crud` 那一档本来就不给普通教师）。
   */
  "offers.list": "global",
  "site.publicContent": "global",

  /* 我的课：列表、单条、按日期 / 区间 / 教室 / 学生 / 教师取 */
  "lessons.list": "lessons",
  "lessons.get": "lessons",
  "lessons.listByDate": "lessons",
  "lessons.listBetween": "lessons",
  "lessons.listByClassroom": "lessons",
  "lessons.listByStudent": "lessons",
  "lessons.listByTeacher": "lessons",
  "lessons.pendingMakeups": "lessons",
  "lessonRecords.list": "lessons",
  "lessonRecords.listByLesson": "lessons",
  "lessonRecords.listByStudent": "students",

  /* 我的学生：档案、课时流水，以及只挂在某个学生身上的记录 */
  "students.list": "students",
  "students.get": "students",
  "students.search": "students",
  "transactions.listByStudent": "students",
  "transactions.listByEnrollment": "students",
  "homework.listByStudent": "students",
  "assessments.listByStudent": "students",

  /* 看板：按我的口径重算，而不是"过滤掉别人的行" */
  "today": "aggregate",
  "stats": "aggregate",
  "search": "search",

  /* 教学写动作：目标必须在我名下 */
  "lessons.markCompleted": "teach",
  "lessons.createMakeup": "teach",
  "lessonRecords.save": "teach",
  "assessments.add": "teach",

  /*
   * 教师看不到的整块业务（→ 403）。逐条理由：
   *   - 收款 / 财务汇总 / 欠费：**钱**。使用手册的角色表写着"教师看不到档案里的钱"，
   *     机构确认的边界也只要"课时余额"这一个数字（③）；
   *   - 待跟进：PAGE_ACCESS 里这一页本来就没给普通教师（那是招生 / 财务的跟进口径：
   *     欠费催缴、成交跟进，混进教师的后台只会多出一堆不归他管的事）；
   *   - 排课（预检 / 批量 / 调课建议 / 冲突检查）：教师不带排课这件事（PAGE_ACCESS 里
   *     "课程安排"那几行的写动作归招生与技术），而且冲突结论里会点名**别的教师与别的学生**
   *     （"和 X 老师的那节课撞了"）—— 那正是行级范围要挡住的东西；
   *   - 课程库写入：教师对课程库只读（使用手册的角色表），
   *     这条在角色表里原先漏了（`courses.syncFromSite` 被归进了 actions 分组），
   *     范围层按"默认关门"把它关掉。
   */
  "payments.list": "hidden",
  "payments.listByStudent": "hidden",
  "payments.listByEnrollment": "hidden",
  "finance": "hidden",
  "followups": "hidden",
  "lessons.findConflicts": "hidden",
  "lessons.planSeries": "hidden",
  "lessons.createSeries": "hidden",
  "lessons.suggestMoves": "hidden",
  "courses.syncFromSite": "hidden",
  /*
   * 课程分区的四个写方法与 `courses.setPartition` **刻意不在这里登记**：
   * 它们在角色层（`GROUP_ACCESS.crud`）就不给普通教师，登记成 `hidden` 是一条没人维护的
   * 假配置 —— 自检有一条断言专门盯着这种"压根轮不到这一层的条目"。
   * 读方法 `coursePartitions.list` 已在上面的参考数据一栏登记为 `global`
   * （教师的课程清单要按分区分组）。
   */
};

/**
 * 这个方法对普通教师怎么处理；返回 `null` 表示**没登记** ——
 * 调用方必须按**关门**处理（与 `allowedRolesForMethod` 的 `null` 同一个约定）。
 */
export function teacherScopeRule(method: string): TeacherScopeRule | null {
  return TEACHER_SCOPE_RULES[method] ?? null;
}

/**
 * 普通教师这一次调用**该不该被拒**：`null` = 放行（行级过滤在服务层做）；字符串 = 拒绝（403）。
 *
 * 两道门都只经过 `permissionError`（`server/index.mts`），因此这一条判定也只在这一处生效。
 * 注意判定**只看角色**，不看 teacherId：没绑 teacherId 的教师账号不是"被拒"，
 * 而是"能进来、但什么都看不到"（见文件头的取舍 ②）。
 */
export function teacherScopeDenial(method: string, roles: readonly Role[]): string | null {
  if (!isPlainTeacher(roles)) return null;

  const rule = teacherScopeRule(method);
  if (rule === null) {
    return (
      `这个接口没有登记「普通教师」的范围处理：${method}（一律拒绝）。` +
      "请在 lib/auth/roles.ts 的 TEACHER_SCOPE_RULES 里说明它对教师是哪一类：" +
      "「与我的课 / 我的学生无关」「只看我的课 / 我的学生」「只写我名下的」「教师看不到」。" +
      "没登记的接口默认关门 —— 否则「新增一个读接口就顺便对全校学生开放」会一次次重演。"
    );
  }
  if (rule === "hidden") {
    return (
      `这件事不归普通教师：${method}。` +
      "教师能看的是自己的课、自己学生的课时余额（以及排课要用的教师 / 教室 / 课程）。" +
      "钱、待跟进与排课不在其中 —— 分工见 docs/使用手册.md 的「谁能做什么」。"
    );
  }
  return null;
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

