# NexGenEdu · 辅导机构轻量化管理系统 V1

## 1. 项目目标

为辅导机构提供一个「先把每天真正会用到的功能做好」的轻量化系统。V1 聚焦五件事：

**学生 · 教师 · 教室 · 课程 · 课时**

终极验收目标：**管理员打开系统，10 秒内知道今天谁上课、在哪里上课、老师是谁，以及每个学生还剩多少课时。**

本项目不是 ERP，当前阶段不是 SaaS。

## 2. 当前范围

### 本阶段做（纯前端）

- 对外宣传网站：首页 / 课程 / 教师 / 关于我们 / 联系我们
- 教务后台 UI 框架：Dashboard / 学生 / 教师 / 教室 / 课程 / 日历
- Markdown 作为「伪数据库」，通过数据访问层读取
- 前端排课、冲突检测、课时扣减、快捷搜索

### 本阶段明确不做

数据库（PostgreSQL / MySQL / MongoDB / Redis）、API Server、ORM、真实登录与 RBAC、支付、
微信登录、短信、AI 功能、微服务、多校区 / 多机构 / SaaS、财务与工资、CRM、题库与组卷、
复杂报表、家长 / 学生 / 教师账号。

## 3. 技术栈

| 项目 | 选择 | 说明 |
| --- | --- | --- |
| 框架 | Next.js 15.5.25（App Router） | 单体前端，无独立后端 |
| 语言 | TypeScript 5.9（`strict` + `noUncheckedIndexedAccess`） | 不使用 `any` |
| 样式 | Tailwind CSS 4.3（CSS-first `@theme`） | 设计令牌集中在 `app/globals.css` |
| UI | 自建小组件库（`components/ui`） | 不引入重型组件库 |
| 数据 | Markdown + 数据访问层 | 当前阶段的「伪数据库」 |
| 包管理 | npm（项目本地 cache：`.npm-cache/`） | 受本机权限限制，见第 9 节 |
| 字体 | 系统字体栈 | 不依赖外部字体 CDN，构建可离线完成 |

**架构主线（保证未来迁移成本低）**

```
当前：Markdown  →  lib/data（数据访问层）  →  React / Next.js UI
未来：PostgreSQL →  API / Server Actions   →  lib/data（同一套函数签名）→ UI 不变
```

UI 不感知数据来自 Markdown、localStorage 还是 PostgreSQL。

## 4. 目录结构

```
app/
├── layout.tsx            # 根布局：html/body + 全局样式
├── globals.css           # 设计令牌（品牌色 / 字体 / 圆角）与基础样式
├── (site)/               # A. 对外宣传网站
│   ├── layout.tsx        #   顶部导航 + 页脚
│   ├── page.tsx          #   首页 /
│   ├── about/            #   /about
│   ├── courses/          #   /courses
│   ├── teachers/         #   /teachers
│   ├── contact/          #   /contact
│   └── quote/            #   /quote 智能报价（下拉选择 + 报价计算）
└── admin/                # B. 教务后台（布局已搭建，业务待 Phase 4）

components/
├── ui/                   # Button / Card / Badge / Container / Section / PageHeading
├── layout/               # Logo / Header / Footer / AdminSidebar
├── site/                 # 宣传网站区块组件（PageHeader / FeatureCard / EmptyState）
├── courses/              # CourseCard
├── teachers/             # TeacherCard
├── pricing/              # EstimateForm（报价表单）
└── students/ classrooms/ lessons/ dashboard/   # 后台业务组件（Phase 4+）

lib/
├── data/
│   ├── site.ts           # 数据访问层：页面唯一的数据入口
│   └── content.ts        # 单文件内容源解析（## 页面 / ### 分组 / #### 条目）
├── markdown.ts           # frontmatter / Markdown 极简解析与渲染
├── types/site.ts         # 内容类型定义
├── pricing/quote.ts      # 报价公式（改报价规则只改这个文件）
├── site/nav.ts           # 导航与页头 CTA 的结构配置
├── scheduling/           # 排课与冲突检测（Phase 5）
└── utils/cn.ts

data/site/
├── content.md            # 网站内容唯一来源（品牌 / 5 个页面文案与数据）
├── pricing.md            # 报价页的可选项与基础价格
└── *.ts                  # 由 scripts/sync-content.mjs 从上面的 .md 自动生成

scripts/
├── dev.mjs               # 开发入口：监听 .md 改动自动同步 + 启动 next dev
└── sync-content.mjs      # 把 .md 编译为 .ts 内容模块
```

## 4.1 内容数据层（全部内容集中在 1 个文件）

**所有面向访客的文案、数字、联系方式都在 `data/site/content.md` 一个文件里。**
改完保存，刷新页面立即生效（dev 模式下该文件是构建依赖，保存即触发重新编译）。

文件按页面分段，共 6 段：

| 段落 | 覆盖范围 | 影响页面 |
| --- | --- | --- |
| `## 页面: 全站` | 品牌名、标语、描述、关键词、联系方式、版权 | 全站标题 / 页头 / 页脚 |
| `## 页面: 首页` | 首屏、首屏数据、教学特色、课程卡片、教室格位、底部 CTA | `/` |
| `## 页面: 课程` | 课程页文案 + 每门课程介绍 | `/courses` |
| `## 页面: 教师` | 教师页文案 + 每位教师的科目/职务/教龄/简介/介绍 | `/teachers`、首页教师卡片 |
| `## 页面: 关于` | 教学理念、校区数据、校区介绍 | `/about` |
| `## 页面: 联系我们` | 联系方式清单、到校路线、预约按钮 | `/contact` |

### 解析器：标题层级即数据结构

`lib/data/content.ts` 的 `buildTree()` 按 Markdown 标题的井号数**如实建树**，
不做「哪一层是分组、哪一层是条目」的推断（早期版本靠层级加减推断，
在 `## 分组 → ### 阶段 → #### 条目` 这类多层结构下反复出错）。
数据层按名字取节点，需要更深层级就继续读 `children`。

约定：

| 写法 | 含义 |
| --- | --- |
| `## 页面: 首页` | 页面分段 |
| `## 分组` / `### 分组` | 分组（页面级） |
| `#### 名称 \| 值` | 条目（值用半角冒号时也可写作 `名称: 值`） |
| `#### 学段：一句话` | 内容小节（正文写在下方）；全角冒号是区分信号 |

### 自检脚本

`npm run check` 会校验数据层条目数量、首页标签与课程页小节的**双向**对应、
以及报价公式的关键用例（断言数量见运行输出）。

**为什么需要它**：解析器层级出错时构建依然成功、首页也正常，
只有课程正文是空的 —— 这类问题靠肉眼检查发现太晚。

### 首页 / 课程页的「栏目 → 卡片 → 标签」结构

首页课程区不再平铺学科，而是先分 6 个栏目，再在栏目下放卡片，
卡片里是可点击的标签：

```
小学课内   小学语文卡 → 标签：小学语文、小学数学、小学英语、小学科学
初中课内   初中语文卡 → 标签：初中语文、初中数学、初中英语、初中科学、初中社会
高中课内   高考语文卡 / 高考数学卡 / 高考外语卡 / 七选三卡
外语       雅思卡 / 欧标语言卡（A1–B2 逐级标签）
课外兴趣   书法与硬笔字卡（含围棋、编程、阅读写作）
成人课程   成人英语口语卡（含零基础外语、出国备考、商务英语）
```

格式为 `#### 卡片名 | 栏目: X · 标签: A、B→目标小节`：

- 不写 `→` 时标签名即目标小节名；写 `→` 时跳到指定小节。
  目前只有 4 处用到：`高考法语→法语B2`、`高考德语→德语B2`、
  `高考意大利语→意大利语B2`、`高考西班牙语→西班牙语B2`
  （高考语言要求≈欧标 B2，直接落在该语种的 B2 小节）。
- 标签对应的是课程页的**小节**（学段小节或选修课），不是 17 张学科卡名，两者不是一回事。
- `npm run check` 双向校验：每个标签都能落到小节（防止改小节名导致跳空），
  且课程页没有「首页进不去」的孤立小节。
- 课程页的父课程标题层级由 `CourseTree` 的 `level` 决定：
  特色课程主页传 2，嵌在带标题的 `Section` 里传 3，避免与 `Section` 的 h2 平级。

### 文件格式

````markdown
## 页面: 首页              ← 页面分段
---
title: 让学习真正发生      ← 该页面的短字段（frontmatter）
---

### 首屏数据               ← 分组
格式为「标签 | 数值」。这段说明不会显示在页面上。

#### 班级规模 | 4–8 人      ← 条目：竖线分隔（列表项）
#### 师生比 | 1 : 6
````

- **短字段**：段落开头的 `--- ... ---` 里，`key: value` 一行一个；数组用 `- 项`。
- **分组**：`### 分组名`；分组标题下的说明文字只写给人看，不显示在页面上。
- **条目**：`#### 名称 | 内容`（列表项）或 `#### 字段: 值`（教师字段）。
  名称取最左侧分隔符：竖线优先，因此「1 : 6」这类含冒号的数值不会被误拆。
- **长文本**：直接写在分组标题下，支持 `**粗体**`、`- 列表`。
- 解析实现在 `lib/markdown.ts` 与 `lib/data/content.ts`，只支持上述子集，零依赖。

### 为什么 .md 还要生成 .ts

内容以 Markdown 维护（便于手改），但 Next 无法可靠地直接把 `.md` 当字符串导入：
其内置处理会把 `·`（U+00B7）序列化成非法的 `\xb7` 转义，产物直接语法报错。
因此 `scripts/sync-content.mjs` 会把 `data/site/*.md` 生成同名的 `.ts` 模块
（`export const contentSource = \`...\``），再由数据层 import。

这一步已自动化，正常使用无需关心：

- `npm run dev` → 启动时同步一次，并监听 `.md` 改动自动同步（刷新页面即生效）
- `npm run build` → 构建前同步一次
- `npm run sync-content` → 手工同步（备用）

### 报价页（/quote）

**报价模型**（数据在 `data/site/pricing.md`，公式在 `lib/pricing/quote.ts`）：

```
1. 课时价   = 基础价 × 科目系数 × 班级系数       （一对一 / 一对二 / 一对三 / 一对多）
   课时价   = 教师课时总费用 ÷ 班级人数           （班课）
2. 时长调整 = 课时价 × 时长乘数                    （1 小时 1.0 / 1.5 小时 1.5 / 2 小时 2.0）
3. 手续费   = 1 节 +10%，其余不加收
   最终单价 = 时长调整后价格 × (1 + 手续费百分比)
4. 正课总价 = 最终单价 × 节数
5. 试课：试课后报课满 10 节则免费；否则按课程原价收 1 节试课费
   总价 = 正课总价 + 试课费
```

| 分组 | 内容 |
| --- | --- |
| 学习阶段 | 6 个阶段 → 课程 → 基础价（元 / 课时），共 22 门 |
| 科目 | 按阶段列科目；系数写成「<科目>系数: 1.2」，未配置按 1.0 |
| 班级类型 | 一对一 1.0 / 一对二 0.7 / 一对三 0.6 / 一对多 0.5 / 班课（按人数分摊） |
| 课时选择 | 1 小时（×1.0）、1.5 小时（×1.5）、2 小时（×2.0）；参与计算但不展示换算 |
| 课程与科目 | `## 学习阶段` → `### 阶段` → `#### 课程: 名称: 价格` / `#### 科目: 科目1、科目2` |
| 报课节数 | **由用户在页面上手动输入**，不写在数据文件里 |
| 手续费规则 | 1 节 +10%，其余不加收（写在 `quote.ts`） |
| 试课 | 试课后报课满 10 节免费；未满 10 节按课程原价收 1 节（写在 `quote.ts`） |
| 其他项目 | 课后晚辅导、考试大师网课等独立产品，不参与课时公式 |

实现要点：

- 「暂未开放」写在字段值里即表示不可选：下拉框中显示但禁选（专业英语全部、
  成人/兴趣的跨国交友、高中政治）。
- 阶段与科目联动：切换阶段会清空课程与科目选择，避免出现不匹配组合。
- **科目可选**：出国考试 / 专业英语 / 成人兴趣没有科目分组，此时不显示科目下拉，
  科目系数按 1 计。
- 班课模式（coefficient 值不是数字，例如「按人数分摊」）会额外显示
  「班级人数」与「教师课时总费用」两个输入框，并按 `费用 ÷ 人数` 计算。
- 所有价格与档位均可增删，页面会自动适配。

**展示口径**：结果只给两项 —— **课单价（元 / 节）** 与 **总价**。
刻意不展示「每课时」与时长换算过程：家长关心的是每节课多少钱、一共多少钱，
中间换算属内部逻辑，摆出来反而增加理解成本。时长仍参与计算，只是不作为展示项。

⚠️ 待确认项：

1. **科目系数**目前全部按 1.0，等实际系数确定后在 pricing.md 给对应科目补一行「<科目名>系数」。
2. **手续费语义**按「加价」实现（1 节 = 课时价 × 1.1）。若应为折扣需改 `quote.ts`。
3. **试课计入的节数**：正课节数按用户填写值计算，试课另计（不免正课节数）。
4. **时长乘数**按线性实现（1.5 小时 = 1.5 倍）。若实际不是简单相乘，
   改 `pricing.md` 里「课时选择」的「乘数」即可，代码不用动。
5. 「考试大师网课 + 针对性答疑课」价格未定，当前显示「暂未定」。

### 页面读取方式

页面只调用 `lib/data/site.ts` 的函数（`getSiteBrand` / `getHomeContent` /
`getCoursesPage` / `getTeachersPage` / `getAboutContent` / `getContactContent`），
不直接读文件、不解析 Markdown。未来替换为数据库实现时页面无需修改。

## 5. 数据模型（Phase 2 落地）

五个核心实体，字段设计直接对齐未来 PostgreSQL Schema：

| 实体 | 关键字段 |
| --- | --- |
| `Student` | `id` `name` `grade` `phone` `status` `creditBalance` `createdAt` `updatedAt` |
| `Teacher` | `id` `name` `subjects[]` `phone` `status` `createdAt` `updatedAt` |
| `Classroom` | `id` `name` `capacity` `status` `createdAt` `updatedAt` |
| `Lesson` | `id` `studentId` `teacherId` `classroomId` `date` `startTime` `endTime` `status` `creditCost` `note` |
| `CreditTransaction` | `id` `studentId` `lessonId?` `amount` `type` `balanceAfter` `createdAt` |

设计约定：

- 课时余额不以 `credit_balance` 为唯一真实来源，同时记录 `CreditTransaction` 流水，便于未来对账。
- 所有实体带稳定 `id` 与 `createdAt` / `updatedAt`。
- 关系通过 `studentId` / `teacherId` / `classroomId` 外键字段表达。

## 6. 开发进度

| Phase | 内容 | 状态 |
| --- | --- | --- |
| Phase 1 | 项目基础：Next.js + TS + Tailwind + Layout + 基础 UI + 宣传网站骨架 | ✅ 已完成 |
| Phase 2 | Markdown 数据层：类型 + 数据访问层 + 示例数据 | ⏳ 下一步 |
| Phase 3 | 宣传网站内容接入 Markdown | 待开始 |
| Phase 4 | 后台：Dashboard / 学生 / 教师 / 教室 / 课程 / 日历 | 🚧 框架已搭建（仅布局 + 概览页） |
| Phase 5 | 核心业务：排课 / 冲突检测 / 课程状态 / 课时扣减 / 搜索 | 待开始 |
| — | 宣传网站「智能报价」页：阶段 / 科目 / 班级 / 报课数量四级报价 + 其他项目 | ✅ 已完成 |
| — | 首页与课程页「栏目 → 卡片 → 标签」重构（6 栏目、48 个标签双向校验） | ✅ 已完成 |
| Phase 6 | 响应式与 UI Polish | 待开始 |
| Phase 7 | 部署：GitHub Actions → GitHub Pages | ✅ 已完成（提前） |

### Phase 1 交付说明

- 完成 Next.js 15 + TS strict + Tailwind 4 脚手架，`lint` / `typecheck` / `build` 全部通过。
- 建立设计系统：品牌色（深墨蓝 + 暖琥珀）、状态色（成功 / 预警 / 危险）、中性色阶、圆角与字体。
- 建立布局与基础组件：`Header`（含移动端折叠菜单）、`Footer`、`Logo`、`Button`、`Card`、`Badge`、`Container`、`Section`。
- 宣传网站 5 个页面全部可访问，数据待接入区块使用明确的空状态（`EmptyState`），不展示假数据。

## 7. 常用命令

```bash
npm run dev        # 开发服务器 http://localhost:3000
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run build        # 生产构建（会先同步内容）
npm run sync-content # 手工同步 data/site/*.md（一般不需要）
```

每个 Phase 完成后固定执行：`lint` → `typecheck` → `build` → 更新本文件 → Git commit。

### 运行命令的环境要求

- **npm 必须带本地 cache**：`npm install --cache ./.npm-cache`（原因见第 9 节）。
  构建 / 运行（`dev` / `build` / `start`）**不需要**额外的 cache 参数，可直接 `npm run dev`。
- 若需在非交互环境验证页面，可用 `npx next start -p <端口>` 配合 `curl` 做冒烟测试。
- **想跟线上一致地验证，构建要带 basePath**：
  `NEXT_PUBLIC_BASE_PATH=/NexGenEdu npm run build`。
  `npm run check:404` 按 `NEXT_PUBLIC_BASE_PATH` 推断站内链接前缀，
  不带该变量做本地构建时前缀为空（这本身是正确的，不是失败）。

## 7.1 部署（GitHub Pages）

线上地址：**https://jeremythierrychan.github.io/NexGenEdu/**

| 项 | 值 |
| --- | --- |
| 方式 | GitHub Actions 自动部署 |
| 工作流 | `.github/workflows/deploy-pages.yml` |
| 触发 | push 到 `main`，或手动 `workflow_dispatch` |
| Pages 配置 | `build_type: workflow`（已通过 API 设置，`https_enforced: true`） |
| 产物 | 静态导出 `out/`（`output: "export"`） |

### 静态导出与子路径

- `next.config.ts` 设置 `output: "export"` + `trailingSlash: true`，导出目录形式的 URL
  （`/courses/` → `courses/index.html`），并关闭 `next/image` 优化（静态托管无优化服务）。
- 项目站点位于 `/<repo>/` 子路径，前缀通过 `NEXT_PUBLIC_BASE_PATH` 在**构建时**注入：
  `NEXT_PUBLIC_BASE_PATH=/NexGenEdu npm run build`。CI 中使用
  `${{ github.event.repository.name }}` 动态取得仓库名，fork 后无需修改。
- **本地开发绝对不要设置该变量**，否则 `localhost:3000` 会被重定向到 `/NexGenEdu`。
- 产物中的 `_next/` 目录以 `_` 开头，会被 GitHub Pages 的 Jekyll 处理忽略，
  因此工作流会写入 `out/.nojekyll`。

### 静态导出的架构含义

所有数据必须在构建时可得。这与发展方向一致：Markdown 数据层（Phase 2）在构建期读取，
未来接入 PostgreSQL 时数据层签名不变。需要注意的是，**后台的写操作（排课 / 课时扣减）
在静态站点上无法跨设备共享**，这属于本阶段的已知限制，也是第 8 节中
「运行时数据用 localStorage」方案的另一面。

## 8. 关键设计决策记录

- **不引入组件库**：UI 需求克制（卡片、按钮、徽章、表格），自建组件可保持体积与设计语言可控。
- **宣传网站与后台共用设计语言，但信息密度不同**：`(site)` 路由组大留白、大标题；`admin` 路由组紧凑、表格优先。
- **`app/(site)` 路由组**：让宣传网站与后台拥有各自独立的 layout，互不干扰。
- **`cn()` 不做 Tailwind 冲突消解**：保持零依赖与可预测性，约定调用方 `className` 最后拼接。
- **`next.config.ts` 显式设置 `outputFileTracingRoot`**：本机 HOME 下存在其它 lockfile，需固定项目根目录。

### 管理后台数据变更方案（Phase 5 决策）

后台的排课、课程完成、课时扣减等「写操作」需要区分两类数据：

| 类别 | 来源 | 存储位置 |
| --- | --- | --- |
| 基础档案：学生 / 教师 / 教室 | `data/*.md` | 只读，不修改 |
| 运行时数据：课程安排、课时流水 | 由数据层初始化 | 用户修改部分写入 `localStorage` |

- 原因：Markdown 在前端运行时不可写，后台若只读就无法演示排课；而基础档案无需在 UI 中编辑。
- 数据层对外暴露统一的 Provider 接口，`MarkdownDataProvider` 与（未来的）`PostgresDataProvider` 实现同一套函数签名。
- 运行时数据通过 `createRuntimeStore(storageKey)` 工厂封装，为未来替换为 API 调用预留唯一改动点。
- **`localStorage` 仅为开发阶段的临时方案，不是数据库**：不承担并发、事务、多端一致性职责，
  校验逻辑（如排课冲突）必须在数据层重新执行一次，不能只依赖 UI。

## 9. 本机环境约束（重要）

开发机存在以下网络 / 权限限制，影响构建方式，**不是代码问题**：

1. **`~/.npm` 不可写**（沙箱限制在项目目录内）。
   → 所有 npm 命令使用项目本地 cache：`npm install --cache ./.npm-cache`。
   该目录已加入 `.gitignore`。
2. **Google Fonts 不可达**。
   → 不使用 `next/font/google`，改用系统字体栈，构建可完全离线完成。
3. **`github.com` 连接不稳定**（首次探测超时，推送时偶发 `Connection reset by peer`）。
   → 若 `git push` 失败，改用 HTTP/1.1 重试（已实测有效）：

   ```bash
   git -c http.version=HTTP/1.1 push origin main
   ```

## 10. Git

- 默认分支：`main`
- 远端：`origin` → `https://github.com/JeremyThierryChan/NexGenEdu.git`
- 首次提交已推送（`f7ed6fd`），本地 `main` 与 `origin/main` 一致。
- 后续每个 Phase 完成后 commit 并推送：

```bash
git push
```
