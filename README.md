# NexGenEdu · 新径教育

[![Deploy to GitHub Pages](https://github.com/JeremyThierryChan/NexGenEdu/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/JeremyThierryChan/NexGenEdu/actions/workflows/deploy-pages.yml)
[![Site](https://img.shields.io/badge/site-online-2c5c7d)](https://jeremythierrychan.github.io/NexGenEdu/)

> 辅导机构轻量化管理系统 V1 —— 对外宣传网站 + 轻量教务后台

在线预览：**https://jeremythierrychan.github.io/NexGenEdu/**

面向中小型辅导机构的管理系统。目标很具体：**管理员打开系统，10 秒内知道今天谁上课、在哪里上课、老师是谁，以及每个学生还剩多少课时。**

当前处于**纯前端阶段**：不接数据库、不写后端、不做登录，页面所需的业务数据全部来自 Markdown 文件。等 UI 与业务逻辑稳定后，再接入 PostgreSQL，届时**只替换数据访问层，页面代码基本不动**。

<!-- 待补充：首页截图。建议放在 docs/screenshots/home.png 后取消注释
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

**Phase 1（项目基础）已完成**，`lint` / `typecheck` / `build` 全部通过。

### 已完成

- Next.js 15 App Router + TypeScript strict + Tailwind CSS 4 脚手架
- 设计系统：品牌色、状态色、中性色阶、圆角与字体，集中在 `app/globals.css`
- 基础组件：`Button` `Card` `Badge` `Container` `Section`
- 布局组件：`Header`（含移动端折叠菜单）`Footer` `Logo`
- 宣传网站 5 个页面可访问：`/` `/courses` `/teachers` `/about` `/contact`

### 待实现

- 内容数据层已接入：全站文案与数据集中在 `data/site/content.md` **一个文件**，
  改完保存、刷新页面即生效（无需重启 dev server）
- 内容结构：每页一个 `## 页面: xxx` 段落，段落开头是短字段，正文里用
  `#### 名称 | 内容` 写列表项，增删一行即增删一项
- 后台 `/admin` 仅有布局与概览页，业务功能待 Phase 4
- `/admin` 下的所有后台页面均未开始

## 技术栈

| 类别 | 选择 |
| --- | --- |
| 框架 | [Next.js 15](https://nextjs.org)（App Router，单体前端，无独立后端） |
| 语言 | TypeScript 5.9（`strict` + `noUncheckedIndexedAccess`，不使用 `any`） |
| 样式 | [Tailwind CSS 4](https://tailwindcss.com)（CSS-first `@theme` 设计令牌） |
| UI | 自建轻量组件库（`components/ui`），不引入重型组件库 |
| 数据 | Markdown 文件 + 数据访问层（当前阶段的「伪数据库」） |
| 字体 | 系统字体栈（不依赖外部字体 CDN，构建可完全离线完成） |
| 包管理 | npm |

**明确不引入**：数据库（PostgreSQL / MySQL / MongoDB / Redis）、API Server、ORM、状态管理库、
组件库、CSS-in-JS、图表库。V1 需要的东西用 Next.js 自带能力 + 少量自建代码即可覆盖。

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

每个阶段完成后固定执行：`lint` → `typecheck` → `build`。

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
| Phase 2 | Markdown 数据层：类型定义、数据访问层、示例数据 | 待开始 |
| Phase 3 | 宣传网站内容接入 Markdown（课程、教师、关于、联系） | 计划中 |
| Phase 4 | 教务后台：Dashboard、学生、教师、教室、课程、日历 | 计划中 |
| Phase 5 | 核心业务：排课、冲突检测、课程状态、课时扣减、快捷搜索 | 计划中 |
| Phase 6 | 响应式与 UI 打磨 | 计划中 |
| Phase 7 | 部署 | 计划中 |

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

| 文档 | 内容 |
| --- | --- |
| [PROJECT.md](./PROJECT.md) | 项目目标、范围、详细架构、设计决策记录、开发进度 |
| [README.md](./README.md) | 本文件：面向新读者与开发者的概览 |

## 许可

本项目为私有项目，暂未指定开源许可协议。
