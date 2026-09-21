# 教务后台 API 约定（服务端已实现）

> 这份文档原本是**给将来实现服务端的人**看的（也可能就是几个月后的你自己）；
> 现在服务端**已经实现**了，所以它同时是两样东西：**当前接口的说明书** +
> 「哪些校验必须由服务端做」的验收清单。
> 结构现状看 [技术架构](./技术架构.md)，那一轮怎么接的看 `docs/后端开发方案.md`，
> 分主题的设计决策记录以 `PROJECT.md` 为准。

## 一、现在的架构

```
页面（app/admin/**，客户端组件）
   ↓ 只调用这一层，签名与 HTTP 接口一致
lib/backend/api.ts        服务层实现（当前 106 个方法）；数据一律经 KeyValueStore 落地
   ├─ 未设置 NEXT_PUBLIC_API_BASE（线上产物的情形）：直接用下面这份本地实现
   │    ↓
   │  lib/backend/storage.ts  KeyValueStore：浏览器里是 localStorage，Node 里是内存（自检用）
   └─ 本机使用时（设置了 NEXT_PUBLIC_API_BASE）：换成远端代理
        ↓
      lib/backend/remote.ts  把上面的每一个方法代理成 POST /api/call
        ↓ Authorization: Bearer <令牌>
      server/（本机 Node）   index.mts 一处鉴权闸门 + /api/call 通用分发
        ↓ 跑的是同一份 lib/backend/api.ts（没有第二份实现）
      server/kv-store.mts    KeyValueStore 的 SQLite 实现：整份 JSON 快照存 kv 表
        ↓
      server/data/nexgenedu.db（不进 git，每天自动备份）
```

- 全部方法都是 `async`，**页面里没有一处直接读写存储**；
- 对外形状由 `lib/backend/types.ts` 定义，`export type BackendApi = typeof api`
  就是那份唯一的形状 —— 服务端没有另写一份实现，而是**复用同一份**，
  因此「口径只有一份」是结构上的事实，不是纪律上的要求；
- 数据类型带 `version`（当前 v13），升级链在 `api.ts` 的 `migrate()`，
  **必须按版本升序逐级推进**（历史上写反过一次顺序，导致老数据被重新灌成示例数据）；
- 鉴权已经是服务端的（`server/auth.mts`）：前端只拿令牌，令牌闲置 12 小时过期、
  **后端重启即失效**；操作人由服务端按会话记录，前端传什么都不作数。
  `/api/` 下除 `/api/login`、`/api/logout`、`/api/session` 外一律要登录（一处闸门），
  端点清单见 [技术架构](./技术架构.md) 第 6.5 节；
- 初始状态是**空库**（`lib/backend/initial.ts`：业务表全空 + 网站课程 + 报价配置），
  `lib/backend/seed.ts` 的示例数据只是自检/演示夹具（要 `NEXGENEDU_ALLOW_SEED=1`）；
  历史：早期「存储为空就自动灌示例学生」，那会让员工把示例数据当成自己录的。

## 二、接口分组（当前 106 个方法）

分组的意义在于「服务端的做法完全不同」，不是罗列。
完整清单见 `lib/backend/contract.ts`，`npm run check` 会逐项校验它与代码一致。

（下面每组写的 REST 形状是**路线 A 的参考实现**：`server/index.mts` 里确实有
`/api/students`、`/api/lessons` 这类接口，它们读写自己的 SQL 表，**不在页面用的数据通路上**。
页面走的是路线 B —— 一个通用分发入口 `POST /api/call`，服务端复用整份 `api.ts`。
两条路线都要登录；加接口时别把参考实现当成唯一标准。）

### 1. 通用 CRUD（9 个资源 × 5 个方法）

九个资源（学生 / 教师 / 教室 / 排课 / 课堂记录 / 作业记录 / 阶段测评 / 收款记录 / 课程库），
每个都有 `list` / `get` / `create` / `update` / `remove` 五个方法：

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

**课程库**（`courses.list`、`courses.get`、`courses.create`、`courses.update`、`courses.remove`）：
课程名是**引用键** —— 排课科目、教师可带科目、报课科目都按名字记它，因此服务端必须
自己复核「课程名非空且唯一」，两门都叫「数学」的课会让课时扣到哪一门说不清。
`courses.remove` 只允许删后台新增的课程；网站来源的课程跟着内容文件走，删了下次
`courses.syncFromSite` 又会回来，不想再排应改成「暂未开放」。

### 2. 关联查询

`students.search`、`teachers.listActive`、`payments.listByStudent`、
`payments.listByEnrollment`、`payments.listBetween`、`transactions.listByStudent`、
`transactions.listByEnrollment`、`lessonRecords.listByLesson`、
`lessonRecords.listByStudent`、`homework.listByStudent`、`assessments.listByStudent`、
`lessons.listByDate`、`lessons.listByStudent`、`lessons.listByTeacher`、
`lessons.listByClassroom`、`lessons.listBetween`、`lessons.pendingMakeups`。

- 对应服务端的查询参数（如 `GET /lessons?studentId=…&from=…&to=…`），
  **不要在前端做全表过滤**。当前实现满足这一条：页面只把方法名与参数发到
  `/api/call`，过滤发生在服务端的服务层里 —— 但要知道它是在**整份 JSON 快照**上过滤的
  （快照式存储的代价，见 [技术架构](./技术架构.md) 第 10 节），数据量真大起来要按行查询；
- `students.search` 只做**不区分大小写的子串**匹配：本项目刻意不做拼音/模糊匹配，
  「张」和「章」必须区分开 —— 宁可搜不到，也不要搜错人。

其中 `courses.options` 是「科目候选」：网站课程 + 机构自己加的课（围棋、书法这类
网站上还没有的），后台所有「选科目」的表单都取它 —— 服务端实现时注意它是**并集**，
不要只查课程表（否则网站课程会从候选里消失）。

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

全部要求**幂等**：重复提交不能重复扣课时、重复收款。服务端实现时本来要用
唯一约束或事务锁保证，实际走的是路线 B：幂等由业务判定承担
（例如「已经标记为已上」的课再点一次不会重复扣课时，`npm run check` 里有断言守着）。

**现状**：这些动作现在整体在**服务端**完成（页面只发一次 `/api/call`，没有"拆成多步"的可能），
原子性来自「一次调用只落一次整库快照」（`persist()`）—— 快照式存储下没有跨行动事务可言，
要么整份改完落盘、要么什么都没写。**但幂等仍要靠唯一约束或版本号**：快照式存储没有这一层，
重复提交的防护目前是靠业务逻辑里的判定做的，多用户场景下不够（见技术架构第 10 节）。

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

这一组接服务端时要注意的地方（现在这些校验都在服务端跑，因此也成了"别哪天搬回前端"的约束）：

- `pricing.quote` 只接受「课程名 / 科目名 / 班型 / 时长 / 节数」，**不接受价格**；
- `pricing.update` 必须自己复核配置合法性（系数为正、手续费 0–100、课程名不重复），
  否则系数写 0 会让所有报价变 0、写错类型会变成 ¥NaN，而这些会直接显示给家长；
- 改价要留审计（谁在什么时候把哪门课从多少改到多少）；
- 站点侧的规则来自内容文件（`data/site/pricing.md` 的「计费规则」分组）。
  后台配置存在**服务端数据库**里，网站却是静态的、读构建期内容文件，两者没有同步通道，
  因此 `pricing.exportMarkdown` 导出与 `data/site/pricing.md` 同构的片段，
  替换进内容文件并提交后才算真正上线 ——
  这也是 `npm run check` 里「前后台同一份配置必须算出同一个价」那条断言的由来。
  （历史：早先后台数据在管理员本机浏览器里，这一步同样是必需的；接上服务端没有顺带解决它，
  因为网站是静态导出 —— 要等网站内容进库做只读镜像，而那个还没做。）

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

`courses.syncFromSite` 是「把网站内容里新增的课程卡片拉进课程库」：**只增不改**
（不动机构在后台维护的状态、班型、备注），并且必须可重复执行（第二次不产生新增）。

### 6. 看板与统计（只读）

`today`、`stats`、`followups`、`finance`、`outstandingByStudent`、`search`、
`lessons.findConflicts`、`lessons.suggestMoves`。

算法在 `lib/backend/followup.ts`、`stats.ts`、`finance.ts`、`search.ts` 里，
都是纯函数，**已经原样跑在服务端**（这批文件一行都没为接后端改过）。**口径不要改** ——
每个文件顶部都写了「为什么这么定」（利用率分母、退课按课时算、预警阈值、空档日的定义）。
`lessons.findConflicts` 可以保留给前端做即时提示，但保存时服务端仍要自己再判一次
（现在这是结构性的：保存请求打到服务端，判定就在服务端跑）。

`courses.summary` 给出课程库的规模（总数 / 开放 / 暂未开放 / 网站 / 后台 / 按分类）。

### 6.1 按周批量排课（`lessons.planSeries` / `lessons.createSeries`）

学生报了 20 节、每周二 17:00 —— 不该点二十次"排课"。这两个方法把它变成一次操作，
**两者共用同一套冲突判定**（`conflictsFor`），因此预览与写入的结论必然一致：

| 方法 | 行为 |
| --- | --- |
| `lessons.planSeries` | **只算不写**：按「起排日期 + 每周几 + 时间 + 节数」生成每一节，逐节给出冲突情况；并给出**建议节数** = 该科目剩余课时 − 已排未上（多人班课取剩余最少的那位） |
| `lessons.createSeries` | **写入**：无冲突的建课，有冲突的**跳过并逐条说明**；一次落盘、只写一条日志 |

刻意**不提供"强行排"**：把课塞进已被占用的时间，事后要一节节去查 ——
宁可少排一节并说清原因（要挪课走单节修改或用 `lessons.suggestMoves`）。

边界：**不处理调休、节假日、寒暑假**（就是"按星期几往后数"），
机构确认这类情况手动处理；节数上限 200 节（防手滑）。

### 6.2 课时不足就不排课（`lessons.create` / `lessons.update` / `createSeries`）

机构口径是「**宁可少排，也不要欠账**」—— 欠着的课时事后很难收回来。因此**排课这件事**
在服务端有三道复核，判定只有一处（`insufficientLessons`）：

| 入口 | 课时不够时 |
| --- | --- |
| `lessons.create` | **拒绝**并说明是谁不够、还能排几节（`课时不足：某某（还能排 0 节）…`） |
| `lessons.createSeries` | **封顶**到还能排的节数，返回 `cappedBy`（砍掉几节）与 `shortageMessage` |
| `lessons.update` | 改动**碰到课时三要素**（`subject` / `studentIds` / `status`）且改完是「已排」时**同样复核**；只改备注或时间不查 |

复核口径：`剩余课时（该科目在读数 enrollment） − 已排未上节数`，多人班课取**剩余最少的那位**。
`lessons.update` 复核时会用 `excludeLessonId` **把自己排除**掉 —— 否则给一节已排的课改个备注，
会被自己算成"已排 1 节"而误拒。

> 为什么改课也要查：不然后门是现成的 —— `create` 被拦，就把旧课改成想排的科目/学生，
> 或者把「已取消」翻回「已排」，一样是多了一节课、一样是欠账。

**超用仍然可能发生**（退课、调减课时、多人课中途退课），此时**必须上报**：
`lessons.markCompleted` 返回 `overused[]`（谁、哪门课、超几节），界面据此提示。
不允许静默截断成"剩余 0"—— 那会让账永远对不上。

### 7. 运维与审计

`exportDataset`、`exportDatabase`、`importDatabase`、`imports.apply`、`imports.fromSite`、`hasBackup`、`restoreBackup`、
`reset`、`setOperator`、`logs.list`、`logs.clear`。

**两种"导入"别混**：

| | `importDatabase`（整库导入） | `imports.apply`（批量导入） |
| --- | --- | --- |
| 语义 | **整体替换**整个数据库 | **只新增**记录（同名跳过） |
| 用途 | 换机器、换数据库、搬回一份备份 | 把 Excel / 表格里的名单一次录进来 |
| 对象 | 全部数据 | 学生 / 教师 / 教室 / 课程，一次一种 |
| 输入 | 本系统导出的 JSON 全文 | CSV 或 JSON 文本 + 实体名 |
| 后悔药 | 导入前自动备份（`restoreBackup` 可回） | 同样在导入前留一份（同一个键） |
| 幂等 | 是（同一份文件重复导入结果相同） | 是（重复导入会被判重跳过） |

`imports.apply`（从 CSV/JSON 文本）与 `imports.fromSite`（从网站内容：**教师资料（含 AI 智能体）**、场地名）
走的是**同一套判定与落库**，只有数据来源不同。冲突处理是这两者共同的能力：

| `onConflict` | 行为 |
| --- | --- |
| `skip`（**默认**） | 同名跳过（在 `skipped` 里逐条说明原因） |
| `overwrite` | 用文件里的值**更新**库里那条（只改导入行真的带值的字段，且不动报课记录/采集表/可用时段等结构性字段） |
| `duplicate` | **两条都留**：第二条加序号后缀（王老师 → 王老师（2）），学生不加后缀（同名同家长可能是兄弟姐妹） |
| `ask` | **纯体检、从不写入**（哪怕没有冲突也不写）：返回 `conflicts`（含"库里那条长什么样"），由人决定后再调一次 |

`perRow`（键为行号）可逐行覆盖全局策略，支持"大部分跳过、个别覆盖"这种真实需求。
`ask` 模式**从不写入**（有冲突时 `needsDecision: true`）—— 这是"手动处理冲突"能成立的前提：
先看清会动到哪些记录，再决定。

`imports.apply` 的要点：**判定与落库都在服务端**（`lib/backend/import.ts` 是同一份实现，
页面用它做预览），成功时返回 `{ added, skipped, problems, headers, unknownHeaders }`，
逐行给出"第几行为什么跳过/没通过"。它**一次落盘、只写一条日志**（日志上限 500 条，
逐行写会把历史冲掉），并且**不导入报课/收款/课时** —— 那些牵动账本，必须走页面流程。

其中 `exportDataset` 是**按需导出**（数据集 × 选中的行 × 格式）：按
`lib/backend/export.ts` 的数据集清单实现（服务端跑的就是它），注意两点 —— `ids` 为空表示全选；
返回的 `count` / `total` 要如实区分（「导了 12 条、共 40 条」不能含糊成「已导出」）。
格式上 CSV 必须带 BOM（Excel 中文不乱码）、ICS 要按 RFC 5545 转义与折行 —— 这些
在 `lib/backend/backup.ts` 里已有实现，照它口径走，别另写一套。

`setOperator` 现在**由服务端自己调**（每个请求按令牌所属账号设置），前端调它不作数 ——
它留在清单里是为了保持 `api` 的形状一致，不代表页面可以自己指定操作人。
`reset` 的语义是**清空业务数据**（回到 `createEmptyDatabase()`：业务表全空 + 网站课程 + 报价配置），
不是"回到示例数据"。

⚠️ 别把两个"备份"搞混：`hasBackup`/`restoreBackup` 指的是**「导入前自动备份」那一份快照**
（存在同一个 KeyValueStore 里的 `nexgenedu.admin.db.backup.v1` 键上，是导入功能的后悔药）；
**每天一份的备份文件**（`server/backups/`，保留 90 份）是另一套，由服务端的备份调度负责，
接口里没有对应方法。

导入必须保持三道保险：**结构校验**（不合格直接拒收且不动现有数据）、
**导入前自动备份**、**版本迁移**。`logs` 已经落在**服务端**（不在浏览器里），
操作人来自会话、前端说了不算；但它还不是不可篡改的审计表 —— 接口里仍有
`logs.clear`，只要登录就能清空，做到"防篡改"要等单账号之外有按人区分的权限，
并且把清空这条收进运维通道（见技术架构第 10 节）。

## 三、服务端必须自己复核的校验

页面侧已经没有这些防线可言（也不需要有）：页面只把方法名与参数发到服务端，
判定全部在服务端发生。下面 12 项（第 8 项是服务端自己那套，其余 11 项跑在服务端复用的那同一份 `api.ts` 里）
每项都对应一个已经踩过的坑，也是**接服务端时的验收项**：

1. **排课冲突**：同一教师 / 教室 / 学生时间不得重叠（相邻时段不算冲突）。
   前端拦得住手滑，拦不住并发 —— 判定必须在服务端。
2. **容量与科目**：学生数不得超过场地容量；科目必须在该教师的可带科目内。
3. **课时扣减幂等**：同一节课重复「标记已上」不得重复扣课时 ——
   同类系统最常见的数据事故。
4. **课时不足就不排课**（✅ **服务端已实现**，见 §6.2）：排课前、以及**改课**时都按
   「剩余课时 − 已排未上」复核，不够就拒绝/封顶并说明是谁不够；扣课时若仍发生超用，
   必须**上报**（`overused`）而不是静默截断 —— 静默会让余额永远对不上账。
5. **金额不变式**：报课的实收必须等于其收款合计减退款合计。
6. **退费金额服务端重算**：前端传来的金额一律视为不可信输入。
7. **请假判定用服务端时间**：客户端时间可改，改一下就能把临时缺课说成提前请假。
8. **登录与鉴权**（✅ **服务端已实现**，见 `docs/后端开发方案.md` §5.6）：
   口令校验、会话签发、接口鉴权全在服务端（`server/auth.mts`）——
   前端只拿令牌，未登录的接口一律 401，操作人由服务端按会话记录。
   实现时别逐个接口加鉴权：**按路径前缀做一处闸门**（第一版漏掉了读接口，
   未登录直接把学生数据交出去了）。
9. **审计日志**：记录操作人、时间、对象与摘要，且前端不可篡改。
   ⚠️ 现状只做到一半：日志在服务端、操作人来自会话，但 `logs.clear` 还在，
   登录者可以清空它 —— 还不是防篡改审计表。
10. **课程名唯一且非空**：课程名是排课、教师科目与报课记录的引用键。
11. **报价合法性**：基础价与系数为正、手续费 0–100、试课门槛 ≥ 1 的整数、课程名不重复。
12. **报价金额由服务端计算**：不接受前端传来的单价或总价。

⚠️ **两处仍然靠不住的**（不是漏做，是当前架构的边界）：**并发**（快照式存储、
无版本号，两个人同时改会互相覆盖）与**权限**（单账号，登录进来的人能看到与修改全部数据）。
见 [技术架构](./技术架构.md) 第 10 节。

## 四、从 localStorage 搬到服务端（✅ 六步都已完成）

> **这一节已经落地**（走的是"服务端复用同一份 `api.ts`"的路线，不是下面第 2、3 步原本设想的"逐个接口重写"）：
> 现状与踩过的坑见 `docs/后端开发方案.md` §5.3 / §5.6 / §5.7。
> 下面保留当时的计划供对照，并逐条标注实际是怎么完成的。

1. ✅ **冻结数据格式**：`lib/backend/types.ts` 一直是唯一契约，迁移载体仍是
   「数据与备份」页导出的 JSON；服务端用同一套 `migrate` 链升级（`server/import-data.mts`）。
2. ✅ **实现接口**：没有逐个接口重写，而是让服务端**复用整份 `api.ts`**：
   通用 CRUD、业务动作、看板全部照原样跑，服务端只提供存储实现（`server/kv-store.mts`）
   与一个通用分发入口 `/api/call`。参考 REST 接口（`/api/students` 等）也在 `server/index.mts` 里，
   但它们读写自己的 SQL 表，**不在页面的数据通路上**。
3. ✅ **前端只改一个文件**：对外类型不变、**所有页面代码一行没动**。
   实际做法是 `lib/backend/api.ts` 增加一个出口判断：设置了 `NEXT_PUBLIC_API_BASE`
   就导出 `lib/backend/remote.ts` 的远端代理（每个方法打到 `/api/call`），否则导出本地实现。
4. ✅ **数据搬迁**：旧导出 JSON 由 `server/import-data.mts` 灌入、核对条数；
   导入前三道保险（结构校验 → 导入前自动备份 → 版本迁移）都在。
5. ✅ **登录换成真的**：`lib/auth/session.ts` 的 `login`/`getSession`/`isLoggedIn`/`logout`
   都改为调服务端（因此**全部是异步的**），口令不再出现在前端代码里，登录页上
   「这是演示登录」的说明也删了。
6. ✅ **退出条件**：服务端通过同一套自检口径，且前端没有任何一处直接读写存储 ——
   证据是 `npm run check:both`：同一套 `check.mts` 对内存与真实 HTTP 后端各跑一遍，
   两边都必须 0 失败。

**落地时新增的两件事**（当时没写在计划里，现在必须有）：服务端会话认证
（`npm run check:auth` 用真实 HTTP 验证未登录 401、退出即失效、操作人来自会话）
与每天自动备份 + 恢复演练（`npm run drill:restore`：备份 → 验备份文件本身 → 删库 →
只靠备份恢复 → 核对一致）。

## 五、自检怎么保证这份文档不过期

`npm run check` 里有一节专门比对：

- `lib/backend/contract.ts` 的方法清单 ↔ `api.ts` 的真实形状（双向）；
- 本文档必须提到**每一个**方法名，漏掉就失败；
- 服务端校验清单必须覆盖 冲突 / 幂等 / 金额 / 鉴权 / 审计 五项；
- 迁移步骤必须含「退出条件」。

也就是说：加了方法不更新文档，自检会红。

另外几个门禁**也要起服务端**（CI 里跑不了，属于本机门禁）：
`npm run check:both`（同一套 `check.mts` 对内存与真实 HTTP 后端各跑一遍）、
`npm run check:auth`（用真实 HTTP 验未登录 401、令牌、退出、操作人来自会话）、
`npm run accept`（逐页验收，对后台各页面做真实读写）、
`npm run drill:restore`（备份 → 验备份文件 → 删库 → 只靠备份恢复 → 核对一致）。
本文档改的是接口契约与校验清单，改完至少要把 `npm run check` 跑绿 —— 它就是上面那四条比对。
