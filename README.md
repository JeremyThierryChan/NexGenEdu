# NexGenEdu · 新径教育

[![Deploy to GitHub Pages](https://github.com/JeremyThierryChan/NexGenEdu/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/JeremyThierryChan/NexGenEdu/actions/workflows/deploy-pages.yml)
[![Site](https://img.shields.io/badge/site-online-2c5c7d)](https://jeremythierrychan.github.io/NexGenEdu/)

> 辅导机构轻量化管理系统 V1 —— 对外宣传网站 + 轻量教务后台

在线预览：**https://jeremythierrychan.github.io/NexGenEdu/**

面向中小型辅导机构的管理系统。目标很具体：**管理员打开系统，10 秒内知道今天谁上课、在哪里上课、老师是谁，以及每个学生还剩多少课时。**

架构上分两层：**对外宣传网站**是纯静态站（内容来自 Markdown，部署在 GitHub Pages）；**教务后台**已经接上**真实后端**（本机 Node + SQLite + 服务端会话认证 + 每天自动备份），页面代码没变 —— 换后端只替换了数据访问层（见 [docs/后端开发方案.md](./docs/后端开发方案.md)）。

<!-- 待补充：截图。命名与放置方式见 docs/screenshots/README.md
![首页](docs/screenshots/home.png)
-->

## 目录

- [项目简介](#项目简介)
- [当前状态](#当前状态)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [部署](#部署)
- [可用命令](#可用命令)
- [项目结构](#项目结构)
- [架构设计](#架构设计)
- [数据模型](#数据模型)
- [路线图](#路线图)
- [开发约定](#开发约定)
- [文档](#文档)

## 项目简介

V1 只围绕五件事：**学生 · 教师 · 教室 · 课程 · 课时**。

要回答的核心问题：

| 问题 | 对应功能 |
| --- | --- |
| 今天有哪些课程？ | 后台 Dashboard 今日课程 |
| 某个学生还有多少节课？ | 学生课时余额与课时流水 |
| 某个学生 / 老师什么时候上课？ | 学生详情 · 教师详情 |
| 某个教室现在是否空闲？什么时候有空？ | 教室占用状态与教室课表 |
| 如何快速安排一节课？ | 排课表单 + 教师 / 教室 / 学生冲突检测 |

系统分为两部分，共享同一套品牌色、字体与设计语言，但信息密度不同：

- **对外宣传网站**（`/`）—— 面向访客，大留白、大标题，重点讲品牌、课程、教师与联系方式
- **教务后台**（`/admin`）—— 面向管理员，紧凑排版、表格优先，重点讲效率

## 当前状态

**宣传网站与教务后台都已可用**，`lint` / `typecheck` / `check`（600+ 项断言）/ `build` 全部通过，并已部署到 GitHub Pages。

### 对外宣传网站

- 页面：首页、课程（6 栏目 → 32 张卡片 → 卡片详情页）、特色课程、教师、学生案例、常见问题、时间安排、智能报价、关于、联系我们；
- 内容全部在 `data/site/*.md` 里维护，改完跑 `npm run sync-content` 即生效（无需重启 dev server）；
- 智能报价：学习阶段 / 课程 / 科目 / 班型 / 时长 / 节数，算出课单价、总价与试课费。

### 教务后台（`/admin`，14 个页面）

页面只调 `lib/backend/api.ts`；本机使用时这个对象被换成对后端 `POST /api/call` 的代理，
**服务端跑的是同一份 `api.ts`** —— 于是业务口径（课时、金额、冲突判定、报价）天然只有一份。

- 今日概览、咨询（排课可行性）、学生档案（含信息采集表）、教师、教室、课程安排、日历、课表与占用、统计、待跟进、收费、报价、课程库、数据与备份；
- 课时与金额都走账本：报课/续费/退课、收款/退款、请假扣课时、补课、撤销，每次改动留操作日志（操作人由服务端按会话记录）；
- 报价与教师分成是**可配置数据**，后台可直接给家长试算；
- 登录已改为**服务端会话**：口令在后端生成（首次启动打印一次），前端只拿令牌，未登录的接口一律 401；
- **每天自动备份**一份到 `server/backups/`（保留最近 90 份），并用 `npm run drill:restore` 演练过「删库 → 只靠备份文件恢复」。

### 明确还没做（不是遗漏，是范围外）

部署到公网（HTTPS / 反向代理）、多人并发与按人分权限（RBAC）、家长与学生账号、支付、短信/微信通知、多校区 —— 详见 [路线图](#路线图) 与 [PROJECT.md](./PROJECT.md)。

### 已知边界

- 后台按**单用户本机使用**设计：没有并发控制（两人同时改同一份数据会互相覆盖），
  只有一个账号，不做按人分权限；
- 数据在 `server/data/nexgenedu.db`（不进 git）。备份是自动的（每天一份、保留 90 份），
  但**跨机器搬运**仍要用「数据与备份」页导出的 JSON；
- 后台改价不会自动出现在宣传页，需要「导出配置 → 替换 `data/site/pricing.md`」才会上线
  （内容文件的真源归属见 [docs/后端开发方案.md](./docs/后端开发方案.md) §10.1）；
- 线上那份后台连不上后端（静态站），因此**只能在本机使用**：页面会明确提示这一点。

## 技术栈

| 类别 | 选择 |
| --- | --- |
| 框架 | [Next.js 15](https://nextjs.org)（App Router；静态导出宣传站 + 本机后端） |
| 语言 | TypeScript 5.9（`strict` + `noUncheckedIndexedAccess`，不使用 `any`） |
| 样式 | [Tailwind CSS 4](https://tailwindcss.com)（CSS-first `@theme` 设计令牌） |
| UI | 自建轻量组件库（`components/ui`），不引入重型组件库 |
| 数据 | Markdown 内容文件（宣传站） + SQLite（后台，`better-sqlite3`） |
| 字体 | 系统字体栈（不依赖外部字体 CDN，构建可完全离线完成） |
| 包管理 | npm |

**明确不引入**（现在仍然如此）：PostgreSQL / MySQL / Redis、ORM、状态管理库、
组件库、CSS-in-JS、图表库。后端只用 Node 内置模块 + `better-sqlite3`，
业务逻辑复用前端那份实现（`lib/backend/api.ts`），不重写第二遍。

## 快速开始

环境要求：**Node.js ≥ 18.18**（推荐 20 或更高）。

```bash
git clone https://github.com/JeremyThierryChan/NexGenEdu.git
cd NexGenEdu
npm install
npm run dev
```

打开 http://localhost:3000 查看宣传网站。

> 若 `npm install` 报错 `EACCES` / 无法写入 `~/.npm`，改用项目本地缓存目录：
> `npm install --cache ./.npm-cache`（该目录已在 `.gitignore` 中）。

## 可用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发服务器（http://localhost:3000） |
| `npm run build` | 生产构建 |
| `npm start` | 运行生产构建产物 |
| `npm run lint` | ESLint 检查 |
| `npm run typecheck` | TypeScript 类型检查（`tsc --noEmit`） |
| `npm run check` | 自检：内容、报价、服务层、接口契约共 700+ 条断言 |
| `npm run check:both` | **同一套自检对两种后端各跑一遍**（内存 + 真实 HTTP 服务端） |
| `npm run check:auth` | 服务端认证自检（未登录 401、令牌、退出、操作人来自会话） |
| `npm run server` | 启动后端（本机 Node + SQLite，默认只绑 127.0.0.1:4000） |
| `npm run server:backup` | 手动备份一次（`-- --list` 看清单，`-- --force` 忽略"今天已备份"） |
| `npm run accept` | 逐页验收：起临时后端，对 14 个页面做真实读写（43 项） |
| `npm run drill:restore` | 恢复演练：备份 → 删库 → 只靠备份文件恢复 → 核对数据 |

每个阶段完成后固定执行：`lint` → `typecheck` → `check:both`（或 `check`）→ `build`。

## 部署

宣传网站通过 **GitHub Actions 自动部署到 GitHub Pages**，推送到 `main` 即触发。

- 工作流：`.github/workflows/deploy-pages.yml`
- 线上地址：https://jeremythierrychan.github.io/NexGenEdu/
- 站点为**纯静态导出**产物（`output: "export"` → `out/`），不使用任何服务端运行时

### 子路径是怎么处理的

项目站点部署在 `/<repo>/` 子路径下，前缀只能在构建时注入，因此 CI 里设置了环境变量：

```bash
NEXT_PUBLIC_BASE_PATH=/NexGenEdu npm run build
```

`next.config.ts` 会据此开启 `basePath` + `assetPrefix`。**本地开发不要设置该变量**，
否则 `http://localhost:3000` 会被重定向到 `/NexGenEdu`。

### 静态导出带来的约束

静态导出意味着**所有数据必须在构建时可得**：Markdown 数据层（Phase 2）在构建期间读取并
渲染为 HTML，这与「未来替换为 PostgreSQL」的规划一致 —— 届时改为在构建时或通过
Server Actions 取数，页面代码不变。它也意味着后台的 `localStorage` 写操作无法跨设备共享，
属于本阶段的已知限制。

### 首次部署前的一次性设置

仓库的 Pages 已配置为 `build_type: workflow`。若在其它 fork / 新仓库部署，需要先到
**Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**，
否则部署步骤会失败。

## 项目结构

```
app/
├── layout.tsx            根布局：html/body + 全局样式
├── globals.css           设计令牌与基础样式（品牌色的唯一来源）
├── (site)/               对外宣传网站路由组（有独立的导航与页脚布局）
│   ├── page.tsx          首页             /
│   ├── courses/          课程             /courses
│   ├── teachers/         教师团队         /teachers
│   ├── about/            关于我们         /about
│   └── contact/          联系我们         /contact
└── admin/                教务后台路由组（Phase 4 起实现）
    ├── students/         学生管理
    ├── teachers/         教师管理
    ├── classrooms/       教室管理
    ├── lessons/          课程安排与排课
    └── calendar/         日历（日 / 周视图）

components/
├── ui/                   基础组件：Button / Card / Badge / Container / Section
├── layout/               Logo / Header / Footer（后续加 AdminSidebar / AdminHeader）
├── site/                 宣传网站专用区块组件
└── students/ teachers/ classrooms/ lessons/ dashboard/    后台业务组件

lib/
├── types/                领域类型定义
├── data/                 数据访问层：页面获取数据的唯一入口
├── scheduling/           排课与冲突检测逻辑
├── site/                 站点配置与导航
└── utils/                通用工具

data/                     Markdown「伪数据库」
├── students/ teachers/ classrooms/ lessons/ site/
```

## 架构设计

核心原则是**数据层与 UI 解耦**。页面只调用 `lib/data` 暴露的函数，不直接读文件、不解析 Markdown：

```ts
// 页面里只允许出现这样的调用
const lessons = await getLessonsByDate("2026-09-15");
const student = await getStudentById("student_001");
```

数据流向在接入数据库前后保持一致，迁移时改动被限制在数据层内部：

```
现在：  Markdown 文件   →  lib/data（数据访问层）  →  React / Next.js UI
                  ↓ 只替换这一段
未来：  PostgreSQL      →  API / Server Actions  →  lib/data（函数签名不变）→ UI 不变
```

因此 UI 不需要知道数据究竟来自 Markdown、`localStorage` 还是 PostgreSQL。

> **关于后台的数据变更**：Markdown 在浏览器运行时不可写，所以后台的写操作（排课、课程完成、
> 课时扣减）会在 Phase 5 通过数据层封装到 `localStorage`，仅作为开发阶段的临时方案，
> 不承担并发与事务职责。业务校验逻辑在数据层重新执行一次，不只依赖 UI。

## 数据模型

五个核心实体，字段设计直接对齐未来的 PostgreSQL Schema，均带稳定 `id` 与 `createdAt` / `updatedAt`：

| 实体 | 关键字段 |
| --- | --- |
| `Student` | `id` `name` `grade` `phone` `status` `creditBalance` |
| `Teacher` | `id` `name` `subjects[]` `phone` `status` |
| `Classroom` | `id` `name` `capacity` `status` |
| `Lesson` | `id` `studentId` `teacherId` `classroomId` `date` `startTime` `endTime` `status` `creditCost` `note` `createdAt` `updatedAt` |
| `CreditTransaction` | `id` `studentId` `lessonId?` `amount` `type` `balanceAfter` `createdAt` |

设计要点：

- 课时余额**不以 `credit_balance` 为唯一真实来源**，同时记录 `CreditTransaction` 流水，
  每笔充值、消耗、取消返还都有记录，便于未来对账。
- 关系通过 `studentId` / `teacherId` / `classroomId` 外键字段表达，与数据库外键一一对应。
- 课程状态：`scheduled` / `completed` / `cancelled` / `rescheduled`。

## 路线图

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| Phase 1 | 项目基础：脚手架、设计系统、布局与基础 UI、宣传网站骨架 | ✅ 已完成 |
| Phase 2 | Markdown 数据层：类型定义、数据访问层 | ✅ 已完成 |
| Phase 3 | 宣传网站内容接入 Markdown（课程、教师、关于、联系、报价） | ✅ 已完成 |
| Phase 4 | 教务后台：概览、学生、教师、教室、课程、日历 | ✅ 已完成（原文为"伪后端版本"，现已接真实后端） |
| Phase 5 | 核心业务：排课、冲突检测、课时扣减、收费与退费、请假补课、统计、搜索与日志 | ✅ 已完成（同上） |
| Phase 6 | 响应式与 UI 打磨 | ⏳ 各页面已按断点适配；真实截图与细节打磨待补 |
| Phase 7 | 部署：GitHub Actions → GitHub Pages | ✅ 已完成（宣传站）；后台不部署到公网，见下 |
| — | 咨询线索与排课可行性判定 | ✅ 已完成 |
| — | 报价与教师分成规则进后端（可配置、可试算、可导出） | ✅ 已完成 |
| — | 文档：使用手册、内容维护手册、技术架构、部署与发布 | ✅ 已完成 |
| Phase 8 | **接真实服务端与数据库**（本机 Node + SQLite，页面代码不动） | ✅ 已完成：迁移六步全部走完（含服务端会话认证与"两种后端跑同一套自检"） |
| Phase 8.1 | 备份与恢复：每天自动备份 + 保留份数 + **恢复演练** | ✅ 已完成（`npm run server:backup` / `npm run drill:restore`） |
| 下一步 | 网站内容进库作为**只读镜像**（`site_content` 表，见后端开发方案 §10.1） | 未开始（表已建好，尚无同步脚本） |
| 下一步 | Phase 6 的 UI 打磨（人眼逐页确认渲染与交互）与截图 | 未开始 |

**明确延期（V1 不做）**：财务与工资、支付与微信支付、微信登录、短信、企业微信、
家长 / 学生 / 教师账号、RBAC 与复杂权限、多校区与多机构、SaaS、题库与自动组卷、
AI 学情分析与批改、CRM、库存采购、合同发票、复杂报表。

## 开发约定

1. **数据层与 UI 分离**：页面不得出现 `fs.readFile` 或 Markdown 解析逻辑。
2. **业务逻辑与 UI 分离**：冲突检测等规则放在 `lib/scheduling`，不写死在组件里。
3. **类型优先**：使用明确的 TypeScript 类型，不使用 `any`。
4. **组件保持小型化**：不要把整个页面写进一个巨大文件。
5. **不提前设计**：不为未确定的功能建立复杂架构。
6. **不编造数据**：数据未接入时展示空状态，而不是假数据。

## 文档

| 文档 | 给谁看 | 内容 |
| --- | --- | --- |
| [README.md](./README.md) | 所有人 | 本文件：项目概览与快速开始 |
| [docs/使用手册.md](./docs/使用手册.md) | 机构员工 | 后台怎么用：排课、报课收费、咨询、报价、请假补课、备份 |
| [docs/内容维护手册.md](./docs/内容维护手册.md) | 运营 / 负责人 | 怎么改课程、价格、FAQ、教师等内容并发布上线 |
| [docs/技术架构.md](./docs/技术架构.md) | 开发者 / 接手的人 | 架构全景、目录职责、数据模型、领域模块、自检体系 |
| [docs/部署与发布.md](./docs/部署与发布.md) | 开发者 | 本地命令、构建、CI、上线核对与常见故障 |
| [docs/后台API约定.md](./docs/后台API约定.md) | 接后端的人 | 106 个接口的分组、服务端必须复核的校验、迁移步骤 |
| [docs/后端开发方案.md](./docs/后端开发方案.md) | 要写后端的人 | 开发阶段用本机 Node + SQLite 单文件（不上 Docker）的落地顺序与纪律 |
| [PROJECT.md](./PROJECT.md) | 开发者 | 分主题的设计决策记录（「当时为什么这么定」） |
| [docs/README.md](./docs/README.md) | 所有人 | docs 目录索引 |

## 许可

本项目为私有项目，暂未指定开源许可协议。
