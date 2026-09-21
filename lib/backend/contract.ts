/**
 * 后台服务的接口契约。
 *
 * ## 这份文件解决什么问题
 *
 * `lib/backend/api.ts` 现在是纯前端实现（localStorage）。将来转前后端分离时，
 * 服务端必须实现**同一个接口**，页面才不会改。因此把「有哪些方法、各自属于哪一类、
 * 服务端必须自己复核哪些校验」写成一份可校验的清单：
 *
 *   - `npm run check` 会逐项比对这份清单与 `api.ts` 的真实形状：
 *     有方法没登记（漏文档）或登记了却不存在（文档漂移）都会失败；
 *   - 同时会检查 `docs/后台API约定.md` 里提到了每一个方法 —— 文档不能悄悄漏掉接口。
 *
 * ## 为什么按「类别」而不是平铺 82 个方法
 *
 * 服务端实现时，这五类的做法完全不同：通用 CRUD 用一套 REST 就行，
 * 业务动作必须是一个事务，聚合查询是只读的报表接口。平铺一张 82 行的表
 * 只会让实现者挨个猜「这个要不要事务」。
 */

export type ContractGroup = {
  id: string;
  title: string;
  /** 给实现者的关键提示（做法、坑、必须注意的地方）。 */
  note: string;
  /** 这一组包含的方法路径（与 api.ts 的对象层级一致）。 */
  methods: string[];
};

/**
 * 分组清单。
 *
 * 顺序按「实现优先级」排：先做通用 CRUD 与服务端必须复核的校验，
 * 再做业务动作与看板。
 */
export const API_CONTRACT: ContractGroup[] = [
  {
    id: "crud",
    title: "一、通用 CRUD（9 个资源 × 5 个方法）",
    note:
      "学生 / 教师 / 教室 / 排课 / 课堂记录 / 作业记录 / 阶段测评 / 收款记录。" +
      "服务端用一套 REST 即可：GET 列表、GET 单项、POST 新建、PATCH 修改、DELETE 删除。" +
      "注意两点：id 由服务端生成（前端只读）；删除一律要问清是「软删除还是真删」——" +
      "本项目里课时、收款、流水都是**留痕不删**，只有档案类才允许真删。",
    methods: [
      "students.list", "students.get", "students.create", "students.update", "students.remove",
      "teachers.list", "teachers.get", "teachers.create", "teachers.update", "teachers.remove",
      "classrooms.list", "classrooms.get", "classrooms.create", "classrooms.update", "classrooms.remove",
      "lessons.list", "lessons.get", "lessons.create", "lessons.update", "lessons.remove",
      "lessonRecords.list", "lessonRecords.get", "lessonRecords.create", "lessonRecords.update", "lessonRecords.remove",
      "homework.list", "homework.get", "homework.create", "homework.update", "homework.remove",
      "assessments.list", "assessments.get", "assessments.create", "assessments.update", "assessments.remove",
      "payments.list", "payments.get", "payments.create", "payments.update", "payments.remove",
      "courses.list", "courses.get", "courses.create", "courses.update", "courses.remove",
    ],
  },
  {
    id: "query",
    title: "二、关联查询（按关系取数据）",
    note:
      "对应服务端的查询参数（如 `GET /lessons?studentId=…&from=…&to=…`），不要在前端做全表过滤 —— " +
      "数据量一上来就会拖垮页面。`students.search` 是模糊查询：本项目**刻意不做拼音/模糊匹配**，" +
      "只做不区分大小写的子串匹配，「张」和「章」必须区分开。",
    methods: [
      "courses.options",
      "students.search",
      "teachers.listActive",
      "payments.listByStudent", "payments.listByEnrollment", "payments.listBetween",
      "transactions.listByStudent", "transactions.listByEnrollment",
      "lessonRecords.listByLesson", "lessonRecords.listByStudent",
      "homework.listByStudent",
      "assessments.listByStudent",
      "lessons.listByDate", "lessons.listByStudent", "lessons.listByTeacher",
      "lessons.listByClassroom", "lessons.listBetween",
      "lessons.pendingMakeups",
    ],
  },
  {
    id: "actions",
    title: "三、业务动作（服务端必须在一个事务里完成）",
    note:
      "这些是「改一个数字会影响好几张表」的动作，**不能由前端拆成多步调用**：" +
      "报课要同时建报课记录与收款流水、标记已上要写课时流水并扣课时、退课要记账并保留历史。" +
      "全部要求**幂等**：重复提交不能重复扣课时、重复收款。审计日志也在这里写。",
    methods: [
      "students.enroll", "students.renewEnrollment", "students.refundEnrollment",
      "students.adjustEnrollmentLessons", "students.saveProfile",
      "lessons.markCompleted", "lessons.createMakeup", "lessons.suggestMoves",
      "lessonRecords.save",
      "assessments.add",
      "payments.record",
      "courses.syncFromSite",
    ],
  },
  {
    id: "inquiries",
    title: "四、咨询线索（新家长咨询 → 能不能接）",
    note:
      "家长口头咨询后登记，判定「这个安排能不能接」，不可行时给最接近的方案。" +
      "判定的关键在**检查的是一串日期而不是一天**（每周一次 × 12 节 = 12 个时段都得空），" +
      "以及**不可行要说清挡路的是谁**（哪节课、哪位老师、哪位已有学生）——" +
      "因为接着要决定是让新学生换时段、还是去协调那位已有学生。" +
      "`accept` 落库前必须**再复核一次**：判定是「看」，落库是「改」，中间的时间差不能忽略。",
    methods: [
      "inquiries.list", "inquiries.get", "inquiries.create", "inquiries.update", "inquiries.remove",
      "inquiries.evaluate", "inquiries.accept", "inquiries.abandon",
    ],
  },
  {
    id: "pricing",
    title: "五、报价配置（价格是数据，不是代码）",
    note:
      "基础价 / 科目系数 / 班级系数 / 时长乘数 / 计费规则。服务端实现时注意三点：" +
      "1) **公式只有一份实现**（现在在 lib/backend/pricing.ts），服务端照它实现，" +
      "不要在前端再算一遍 —— 两边算出不同的价格是最不能接受的事故；" +
      "2) 报价请求只发「选了哪门课、哪个班型、多少节」，**不发价格**，" +
      "价格一律由服务端查自己的配置（否则前端改个数字就能改价）；" +
      "3) 配置改动必须留审计：价格变了要能查到谁在什么时候改的、从多少改到多少；" +
      "4) 报价配置里还包含**教师分成规则**（课内班型 40% 起、每加一名学生 +10%，" +
      "即 `小时数 × 课程单价/小时 × (0.4 + (人数−1) × 0.1)`；9 人以上大班课不适用）。" +
      "`pricing.teacherFee` 与 `pricing.quote` 一样只收「选择」不收金额 —— 教师工资" +
      "同样不能让前端传数字进来。",
    methods: [
      "pricing.get", "pricing.update", "pricing.reset", "pricing.quote", "pricing.teacherFee",
      "pricing.exportMarkdown",
    ],
  },
  {
    id: "dashboards",
    title: "六、看板与统计（只读）",
    note:
      "对应报表接口，可以加缓存。算法已经写成纯函数（`lib/backend/followup.ts`、`stats.ts`、" +
      "`finance.ts`），服务端可以原样搬过去 —— 但**口径不要改**：利用率分母、退课按课时算、" +
      "预警阈值这些都在文件顶部写明了为什么这么定。",
    methods: [
      "today", "stats", "followups", "finance", "outstandingByStudent", "search",
      // 冲突检查是「只读查询」，但它返回的是**服务端必须复核的结论**，
      // 因此单独说明：服务端可以保留这个接口给前端做即时提示，
      // 但保存时仍要自己再判一次（前端结果不可信）
      "lessons.findConflicts",
      "courses.summary",
    ],
  },
  {
    id: "ops",
    title: "七、运维与审计",
    note:
      "导入导出有两个层次，别混：**整库导入**（`importDatabase`，整体替换，用于换机器/换数据库）" +
      "与**批量导入**（`imports.apply`，只新增，用于把 Excel/表格里的名单一次录进来）。" +
      "两者都要在动手前留备份（前者是结构校验 + 导入前备份 + 版本迁移三道保险）。" +
      "`logs` 存在库里、能被导入导出整体替换，因此还不是不可篡改的审计记录。",
    methods: [
      "exportDataset",
      "exportDatabase", "importDatabase", "imports.apply", "hasBackup", "restoreBackup", "reset",
      "setOperator", "logs.list", "logs.clear",
    ],
  },
];

/**
 * 服务端**必须自己复核**的校验。
 *
 * 前端已经有这些检查，但它们只是体验：请求可以被绕过、也可以被伪造。
 * 这份清单是「接服务端时必须补上」的验收项，每一项都对应一个已经踩过的坑。
 */
export type ServerValidation = { rule: string; why: string; done: false };

export const SERVER_MUST_VALIDATE: ServerValidation[] = [
  {
    rule: "排课冲突：同一教师 / 教室 / 学生的时间不得重叠（相邻时段不算冲突）",
    why: "前端拦得住手滑，拦不住并发：两个人同时给同一间教室排课，只有服务端能发现",
    done: false,
  },
  {
    rule: "排课容量：学生数不得超过场地容量；科目必须在该教师的可带科目内",
    why: "这两条前端只提示，服务端不校验就会出现「8 人的教室排进 10 个学生」",
    done: false,
  },
  {
    rule: "课时扣减幂等：同一节课重复「标记已上」不得重复扣课时",
    why: "这是同类系统最常见的数据事故；前端用流水对账保证，服务端要用唯一约束或事务锁",
    done: false,
  },
  {
    rule: "课时不足时的处理：扣课时不得把 usedLessons 变成负数，超扣要明确报错而不是静默截断",
    why: "静默截断会让「还剩多少节」永远对不上账",
    done: false,
  },
  {
    rule: "金额不变式：报课记录的实收必须等于其收款合计减退款合计",
    why: "前端靠「只允许通过收款记录改实收」维持，服务端要用事务 + 约束",
    done: false,
  },
  {
    rule: "退费：必须按选定的口径在服务端重算，不能相信前端传来的金额",
    why: "退费金额直接对应打款，前端传来的数字必须视为不可信输入",
    done: false,
  },
  {
    rule: "请假规则：提前 24 小时请假不扣课时 —— 判定要用服务端时间",
    why: "客户端时间可以被改，改一下就能把临时缺课说成提前请假",
    done: false,
  },
  {
    rule: "登录与权限：口令校验、会话签发、接口鉴权全在服务端",
    why: "静态站点的登录只是门（口令在浏览器里），接服务端后必须换成真正的鉴权",
    done: false,
  },
  {
    rule: "报价：基础价与系数必须为正数、手续费在 0–100 之间、试课门槛为不小于 1 的整数，且课程名不重复",
    why: "系数写 0 会让所有报价变成 0、写错类型会变成 ¥NaN，而这些会直接显示给家长",
    done: false,
  },
  {
    rule: "报价金额必须由服务端按配置计算，不接受前端传来的单价或总价",
    why: "这是整套系统里唯一直接对外报价的接口，前端传来的价格等于让家长自己定价",
    done: false,
  },
  {
    rule: "课程名唯一且非空：课程名是排课、教师可带科目与报课记录的引用键",
    why: "两门都叫「数学」的课程会让课时扣到哪一门说不清，而这件事往往到期末对账才暴露",
    done: false,
  },
  {
    rule: "审计日志：记录操作人、时间、对象与摘要，且前端不可篡改",
    why: "「这条数据是谁改的」只能靠服务端记录，前端日志只是草稿",
    done: false,
  },
];

/** 转前后端分离的步骤（写给将来的自己）。 */
export const MIGRATION_STEPS: Array<{ step: string; detail: string }> = [
  {
    step: "1. 冻结数据格式",
    detail:
      "以 `lib/backend/types.ts` 为唯一契约，以导出文件（`/admin/data` 的 JSON）为迁移载体。" +
      "导出文件里带 `version`，服务端按同一套 migrate 链升级。",
  },
  {
    step: "2. 服务端实现接口",
    detail:
      "照 `API_CONTRACT` 分组实现；先把「通用 CRUD + 服务端必须复核的校验」做完，" +
      "再接业务动作。数据库表结构可以直接照 `types.ts` 建。",
  },
  {
    step: "3. 前端切一个文件",
    detail:
      "把 `lib/backend/api.ts` 的实现从 localStorage 换成 `fetch`；对外类型保持不变" +
      "（`export type BackendApi = typeof api` 就是那份形状）。所有页面代码不动。",
  },
  {
    step: "4. 数据搬迁",
    detail:
      "在旧站点导出 JSON → 在新服务端用同一份导入逻辑灌入 → 核对条数（导出页会显示各表条数）。" +
      "导入前会自动备份，导错可以回滚。",
  },
  {
    step: "5. 登录换成真的",
    detail:
      "`lib/auth/session.ts` 的 `login` 改为调服务端；口令不再出现在前端代码里。" +
      "同时删掉登录页上「这是演示登录」的说明。",
  },
  {
    step: "6. 退出条件",
    detail:
      "服务端能通过同一套自检口径（课时不变式、金额不变式、冲突检测边界、迁移链），" +
      "并且前端不再有任何一处直接读 localStorage。",
  },
];
