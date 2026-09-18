# 教务后台 API 约定（伪后端 → 真实服务端）

> 这份文档是**给将来实现服务端的人**看的（也可能就是几个月后的你自己）。
> 它说明：现在前端里那套「伪后端」提供了哪些接口、哪些校验必须由服务端重新做、
> 以及怎么把数据从浏览器搬到服务端。最新情况以 `PROJECT.md` 为准。

## 一、现在的架构

```
页面（app/admin/**，客户端组件）
   ↓ 只调用这一层，签名与 HTTP 接口一致
lib/backend/api.ts        纯前端实现（localStorage，键 nexgenedu.admin.db.v1）
   ↓
lib/backend/storage.ts    KeyValueStore：浏览器里是 localStorage，Node 里是内存（自检用）
```

- 全部方法都是 `async`，**页面里没有一处直接读写 localStorage**；
- 对外形状由 `lib/backend/types.ts` 定义，`export type BackendApi = typeof api`
  就是服务端要满足的那份形状；
- 数据类型带 `version`（当前 v11），升级链在 `api.ts` 的 `migrate()`，
  **必须按版本升序逐级推进**（历史上写反过一次顺序，导致老数据被重新灌成示例数据）。

## 二、接口分组（共 97 个方法）

分组的意义在于「服务端的做法完全不同」，不是罗列。
完整清单见 `lib/backend/contract.ts`，`npm run check` 会逐项校验它与代码一致。

### 1. 通用 CRUD（8 个资源 × 5 个方法）

八个资源，每个都有 `list` / `get` / `create` / `update` / `remove` 五个方法：

| 资源 | 方法 |
| --- | --- |
| 学生 | `students.list` · `students.get` · `students.create` · `students.update` · `students.remove` |
| 教师 | `teachers.list` · `teachers.get` · `teachers.create` · `teachers.update` · `teachers.remove` |
| 教室 | `classrooms.list` · `classrooms.get` · `classrooms.create` · `classrooms.update` · `classrooms.remove` |
| 排课 | `lessons.list` · `lessons.get` · `lessons.create` · `lessons.update` · `lessons.remove` |
| 课堂记录 | `lessonRecords.list` · `lessonRecords.get` · `lessonRecords.create` · `lessonRecords.update` · `lessonRecords.remove` |
| 作业记录 | `homework.list` · `homework.get` · `homework.create` · `homework.update` · `homework.remove` |
| 阶段测评 | `assessments.list` · `assessments.get` · `assessments.create` · `assessments.update` · `assessments.remove` |
| 收款记录 | `payments.list` · `payments.get` · `payments.create` · `payments.update` · `payments.remove` |

- 服务端用一套 REST 即可：`GET` 列表、`GET` 单项、`POST` 新建、`PATCH` 修改、`DELETE` 删除；
- **id 由服务端生成**，前端只读；
- 删除要分清楚：课时流水（`transactions`）、收款（`payments`）、退课记录
  **一律留痕不删**（否则「这些课时/钱去哪了」说不清）；只有档案类允许真删。

### 2. 关联查询

`students.search`、`teachers.listActive`、`payments.listByStudent`、
`payments.listByEnrollment`、`payments.listBetween`、`transactions.listByStudent`、
`transactions.listByEnrollment`、`lessonRecords.listByLesson`、
`lessonRecords.listByStudent`、`homework.listByStudent`、`assessments.listByStudent`、
`lessons.listByDate`、`lessons.listByStudent`、`lessons.listByTeacher`、
`lessons.listByClassroom`、`lessons.listBetween`、`lessons.pendingMakeups`。

- 对应服务端的查询参数（如 `GET /lessons?studentId=…&from=…&to=…`），
  **不要在前端做全表过滤**；
- `students.search` 只做**不区分大小写的子串**匹配：本项目刻意不做拼音/模糊匹配，
  「张」和「章」必须区分开 —— 宁可搜不到，也不要搜错人。

### 3. 业务动作（服务端必须在一个事务里完成）

`students.enroll`、`students.renewEnrollment`、`students.refundEnrollment`、
`students.adjustEnrollmentLessons`、`students.saveProfile`、`lessons.markCompleted`、
`lessons.createMakeup`、`lessonRecords.save`、`assessments.add`、`payments.record`。

这些动作「改一个数字会影响好几张表」，**不能由前端拆成多步调用**：

| 动作 | 一次要落库的内容 |
| --- | --- |
| 报课 / 续费 | 报课记录 + 收款记录 + 实收累计 + 课时流水 |
| 标记已上 | 课节状态 + 课时流水（按出勤决定扣不扣）+ 学生课时余额 |
| 退课 / 退款 | 报课状态 + 退款记录 + 实收累计 + 历史留痕 |
| 课堂记录 | 记录本身 + （已上的课）重新对账课时 |

全部要求**幂等**：重复提交不能重复扣课时、重复收款（前端已按此实现，服务端要用
唯一约束或事务锁保证）。

### 4. 咨询线索（新家长咨询 → 能不能接）

`inquiries.list`、`inquiries.get`、`inquiries.create`、`inquiries.update`、
`inquiries.remove`、`inquiries.evaluate`、`inquiries.accept`、`inquiries.abandon`。

家长口头问「每周六上午十点、指定陈老师，能不能排」——这类问题要**当场**给答复。
因此这一组的关键是判定本身（`lib/backend/inquiry.ts`，纯函数）：

- **检查的是一串日期，不是一天**：每周一次 × 12 节 = 未来 12 个同一时段都得空着；
- 候选时段是**备选**而不是「全要」：依次尝试，第一个能排下的就用它；
- 不可行要说清**挡路的是谁**（哪节课 / 哪位老师 / 哪位已有学生），
  因为接着要决定是新学生换时段，还是去协调那位已有学生；
- `accept` 落库前**再复核一次**：判定是「看」、落库是「改」，中间的时间差不能忽略；
- `lessons.suggestMoves` 给已有课算出可挪的时间（用于「协调已有学生」），
  走同一套判定，因此挪过去不会再制造冲突。

### 5. 报价配置（价格是数据，不是代码）

`pricing.get`、`pricing.update`、`pricing.reset`、`pricing.quote`、`pricing.teacherFee`、
`pricing.exportMarkdown`。

报价原先只有一份公式写在页面侧（`lib/pricing/quote.ts`），规则还硬编码在里面：
调一次价要改代码、重新构建，后台也看不到家长会被报多少。
现在价格与规则都是**数据**（`PricingConfig`），公式只有一份实现
（`lib/backend/pricing.ts`），前台报价页与后台试算器调的是同一个函数。

计价模型（每个系数各管一件事，互不重叠）：

| 维度 | 含义 | 默认 |
| --- | --- | --- |
| 基础价 | 一对一、1 小时、报 2 节及以上的价格（元 / 节），所有换算的基准 | 分阶段设定 |
| 科目系数 | 同一阶段内不同科目的师资 / 难度差异 | 1.0 |
| 班级系数 | 人越多每人越便宜 | 一对二 0.7、一对三 0.6、一对多 0.5 |
| 时长乘数 | 一节课上多久 | 1 / 1.5 / 2 小时 → 1.0 / 1.5 / 2.0 |
| 手续费 | 只报 1 节时加收 | 10% |
| 试课 | 报满多少节后试课免费，否则按原价收 1 节 | 10 节 |

两个例外：**班课**按「教师课时总费用 ÷ 班级人数」分摊（不用班级系数）；
**试课费**永远按课程基础价原价收（不带任何系数与手续费）。

服务端实现时注意：

- `pricing.quote` 只接受「课程名 / 科目名 / 班型 / 时长 / 节数」，**不接受价格**；
- `pricing.update` 必须自己复核配置合法性（系数为正、手续费 0–100、课程名不重复），
  否则系数写 0 会让所有报价变 0、写错类型会变成 ¥NaN，而这些会直接显示给家长；
- 改价要留审计（谁在什么时候把哪门课从多少改到多少）；
- 站点侧的规则来自内容文件（`data/site/pricing.md` 的「计费规则」分组）。
  伪后端阶段后台改价只存在管理员本机，因此 `pricing.exportMarkdown` 导出与
  `data/site/pricing.md` 同构的片段，替换进内容文件后才算真正上线 ——
  这也是 `npm run check` 里「前后台同一份配置必须算出同一个价」那条断言的由来。

**教师分成（课时费）**：课内课程里按系数计价的班型（一对一定制课 / 一对二 /
一对三小组课 / 一对多小班课，1–8 人）适用下面这条规则，9 人以上大班课不适用
（那类按「教师课时总费用 ÷ 班级人数」另议）：

```
教师课时费 = 小时数 × (课程单价 / 小时) × (0.4 + (学生人数 − 1) × 0.1)
```

人话是「第一名学生 40%，此后每多一名学生加 10 个百分点（2 人 50% … 8 人 110%）」。
公式里的「课程单价」默认取**课程标准单价**（基础价 × 科目系数，不含班级人数折扣），
也可切换为**班型课时价**（再乘班级系数 = 家长每生实付）—— 两种口径后台一键切换。
`pricing.teacherFee` 只收「哪门课 / 哪个班型 / 几个学生 / 多久」，比例与课时单价由
服务端按配置算（教师工资同样不能由前端传数字）。后台报价页把这条规则翻译成人话、
连同一张人数对照表展示，老师问「这个班多少钱」直接看表。

### 6. 看板与统计（只读）

`today`、`stats`、`followups`、`finance`、`outstandingByStudent`、`search`、
`lessons.findConflicts`、`lessons.suggestMoves`。

算法在 `lib/backend/followup.ts`、`stats.ts`、`finance.ts`、`search.ts` 里，
都是纯函数，可以原样搬到服务端。**口径不要改** —— 每个文件顶部都写了
「为什么这么定」（利用率分母、退课按课时算、预警阈值、空档日的定义）。
`lessons.findConflicts` 可以保留给前端做即时提示，但保存时服务端仍要自己再判一次。

### 7. 运维与审计

`exportDatabase`、`importDatabase`、`hasBackup`、`restoreBackup`、`reset`、
`setOperator`、`logs.list`、`logs.clear`。

导入必须保持三道保险：**结构校验**（不合格直接拒收且不动现有数据）、
**导入前自动备份**、**版本迁移**。`logs` 现在存在本机、可被前端篡改，
接服务端后应改为不可篡改的审计表。

## 三、服务端必须自己复核的校验

前端已经有这些检查，但**它们只是体验**：请求可以被绕过、也可以被伪造。
接服务端时逐项补上，每项都对应一个已经踩过的坑：

1. **排课冲突**：同一教师 / 教室 / 学生时间不得重叠（相邻时段不算冲突）。
   前端拦得住手滑，拦不住并发。
2. **容量与科目**：学生数不得超过场地容量；科目必须在该教师的可带科目内。
3. **课时扣减幂等**：同一节课重复「标记已上」不得重复扣课时 ——
   同类系统最常见的数据事故。
4. **课时不得为负**：超扣要明确报错，不要静默截断（静默截断会让余额永远对不上账）。
5. **金额不变式**：报课的实收必须等于其收款合计减退款合计。
6. **退费金额服务端重算**：前端传来的金额一律视为不可信输入。
7. **请假判定用服务端时间**：客户端时间可改，改一下就能把临时缺课说成提前请假。
8. **登录与鉴权**：口令校验、会话签发、接口鉴权全在服务端；
   现在前端那份登录（`lib/auth/session.ts`）口令写在代码里，只是门不是锁。
9. **审计日志**：记录操作人、时间、对象与摘要，且前端不可篡改。
10. **报价合法性**：基础价与系数为正、手续费 0–100、试课门槛 ≥ 1 的整数、课程名不重复。
11. **报价金额由服务端计算**：不接受前端传来的单价或总价。

## 四、从 localStorage 搬到服务端

1. **冻结数据格式**：以 `lib/backend/types.ts` 为唯一契约，以「数据与备份」页
   导出的 JSON 为迁移载体；服务端按同一套 `migrate` 链升级。
2. **实现接口**：照上面的分组做，先做「通用 CRUD + 服务端必须复核的校验」，
   再做业务动作。数据库表可以直接照 `types.ts` 建。
3. **前端只改一个文件**：把 `lib/backend/api.ts` 的实现从 localStorage 换成
   `fetch`，对外类型不变，**所有页面代码不动**。
4. **数据搬迁**：旧站点导出 JSON → 服务端用同一份导入逻辑灌入 → 核对条数
   （导出页会显示各表条数）。导入前会自动备份，导错可回滚。
5. **登录换成真的**：`lib/auth/session.ts` 的 `login` 改为调服务端，
   口令不再出现在前端代码里，同时删掉登录页上「这是演示登录」的说明。
6. **退出条件**：服务端能通过同一套自检口径（课时不变式、金额不变式、
   冲突检测边界、迁移链），且前端不再有任何一处直接读 localStorage。

## 五、自检怎么保证这份文档不过期

`npm run check` 里有一节专门比对：

- `lib/backend/contract.ts` 的方法清单 ↔ `api.ts` 的真实形状（双向）；
- 本文档必须提到**每一个**方法名，漏掉就失败；
- 服务端校验清单必须覆盖 冲突 / 幂等 / 金额 / 鉴权 / 审计 五项；
- 迁移步骤必须含「退出条件」。

也就是说：加了方法不更新文档，自检会红。
