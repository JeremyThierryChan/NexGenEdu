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

**宣传网站与教务后台都已可用**：`lint` / `typecheck` / `check`（当前 700+ 项断言，以命令输出为准）/ `build` 全部通过，
另有 `check:both` / `check:auth` / `accept`（逐页验收）/ `drill:restore`（恢复演练）在本机对**真实后端**跑通。
**宣传网站**已部署到 GitHub Pages；**教务后台不上公网**，连的是这台电脑上的 Node + SQLite 后端。

### 对外宣传网站

- 页面：首页、课程（当前 6 栏目 → 当前 32 张卡片 → 卡片详情页）、特色课程、教师、学生案例、常见问题、时间安排、智能报价、关于、联系我们；
- 内容全部在 `data/site/*.md` 里维护，改完跑 `npm run sync-content` 即生效（无需重启 dev server）；
- 智能报价：学习阶段 / 课程 / 科目 / 班型 / 时长 / 节数，算出课单价、总价与试课费。

### 教务后台（`/admin`，当前 17 个页面）

页面只调 `lib/backend/api.ts`；本机使用时这个对象被换成对后端 `POST /api/call` 的代理，
**服务端跑的是同一份 `api.ts`** —— 于是业务口径（课时、金额、冲突判定、报价）天然只有一份。

- 今日概览、咨询（排课可行性）、学生档案（含信息采集表）、教师、教室、课程安排、日历、**节假日**、课表与占用、统计、待跟进、收费、报价、课程库、数据与备份、**账号**；
- 课时与金额都走账本：报课/续费/退课、收款/退款、请假扣课时、补课、撤销，每次改动留操作日志（操作人由服务端按会话记录）；
- 报价与教师分成是**可配置数据**，后台可直接给家长试算；
- **按周批量排课**：一次排一串（每周几 × 节数），默认按"该科目剩余课时"给建议节数；**先预览每一节的冲突**再写入，冲突的跳过并逐条说明；
- **批量导入**：学生 / 教师 / 教室 / 课程可用 CSV 或 JSON 成批导入（各实体页右上角「批量导入」，或「数据与备份」页的面板）；
  带模板下载、导入前预览与逐行报错；**同名冲突先体检再让人选**（覆盖 / 跳过 / 保留两份，支持逐条），选之前不写入；
  另外支持**从网站内容导入**教师与场地名（课程有「从网站同步课程」，学生网站上没有）；
- 顶栏有**后端/数据库连接状态信号**（真实探活，只认自报为本系统的后端）；连不上时可以**手动指定后端地址**，或一键自动探测本机常见端口；
- 登录是**服务端会话**：口令来自 `NEXGENEDU_ADMIN_PASSWORD`，没设就首次启动随机生成一份（写在 `server/data/admin-credential.json`，权限 0600）并在启动日志里打印一次 —— **口令不进数据库**，前端只拿令牌；`/api/` 下除 `/api/login`、`/api/logout`、`/api/session` 外一律要登录（一处闸门），后端**重启需要重新登录**；
- **账号管理在后台「账号」页**（只有技术管理员能进）：加人、改角色（可多选）、绑定教师（下拉里选、不用抄 id）、重置口令、停用 / 删除，**改完立刻生效**（不必重启后端）；服务端那四条路由是独立端点（`/api/accounts`），不是 `/api/call` 的方法 —— 账号表是服务端进程里的文件，做成服务层方法在浏览器里没有意义；
- **节假日表**（法定假日与调休上班日）：一年一个文件 `data/holidays/<年>.json`，由后端抓两个公开来源
  （Apple 的「中国大陆节假日」日历 + 国务院公告口径的 JSON）**逐日比对一致才写入** —— 对不上就拒绝并列出差异，
  因为这种数据错了会直接影响排课与家长沟通；界面上能看到两个来源的地址、指纹与校验结论，也能一眼看出缺哪一年
  （国务院通常在上一年 11 月公布次年安排，公布前没有数据是正常的）。`npm run holidays:fetch` 可命令行更新。
  **它不改排课**：批量排课仍是「按星期几往后数」，调休与节假日仍要手动处理（见 [使用手册 §8.1](./docs/使用手册.md)）；
- 后端默认**只绑 `127.0.0.1`**（`NEXGENEDU_HOST` 可覆盖），公开的只有 `GET /health`（只回服务名与库文件名，细节在要登录的 `GET /api/status`）；
- **每天自动备份**一份到 `server/backups/`（保留最近 90 份，`NEXGENEDU_BACKUP_KEEP` 可改），并用 `npm run drill:restore` 演练过「删库 → 只靠备份文件恢复」。

### 明确还没做（不是遗漏，是范围外）

部署到公网（HTTPS / 反向代理）、多人并发与按人分权限（RBAC）、家长与学生账号、支付、短信/微信通知、多校区 —— 详见 [路线图](#路线图) 与 [PROJECT.md](./PROJECT.md)。

### 已知边界

- 后台按**单用户本机使用**设计（同一时间基本是一个人用）：**同一条记录**的并发编辑
  已经有乐观锁保护 —— 后提交的人会收到「刚被别人改过，请刷新」，而不是静默覆盖掉别人
  改的一整份（记录带 `version`，写接口可以接 `expectedVersion`；见
  [docs/后台API约定.md](./docs/后台API约定.md) §6.6）；
  但**跨记录**（"要么全成要么全不成"的多表动作）与**跨进程**（两个后端进程写同一份快照）
  的并发**仍不在范围内**。账号与角色已经落到服务端（谁能看哪一页、能调哪些接口），
  **行级范围也已经落地**：普通教师只看得到自己带的课与自己课上的学生（别人的学生、别人的课表、
  钱都不在其中；口径与接口清单见 [docs/后台API约定.md](./docs/后台API约定.md) §三）；
- 数据在 `server/data/nexgenedu.db`（不进 git）。备份是自动的（每天一份、保留 90 份），
  但**跨机器搬运**仍要用「数据与备份」页导出的 JSON；
- 后端**只绑本机 `127.0.0.1`**（局域网也访问不到），且**重启后要重新登录** —— 会话只在服务端内存里，刻意不落盘；
- 后台改价不会自动出现在宣传页，需要「导出配置 → 替换 `data/site/pricing.md`」才会上线
  （内容文件的真源归属见 [docs/后端开发方案.md](./docs/后端开发方案.md) §10.1）；
- 线上那份后台连不上后端（静态站），因此**只能在本机使用**：页面会明确提示这一点；
- ~~网站内容进库做只读镜像~~ ✅ **已改为更好的做法**（v15）：教师 / 课程卡片 / 课程正文 / 报价都进了库，
  网站构站时以后端为准、连不上就回落模版，后台还能编辑课程正文（见技术架构 §5.1）。

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

**设备要求很低**：任何能跑 Node ≥ 22.6 与浏览器的电脑都够 ——
实测 800 名学生 / 4 万节课时单次写入约 50ms、进程内存约 380MB
（`npm run bench:capacity`，见 [后端开发方案 §5.8](./docs/后端开发方案.md)）。
真正需要升级配置的触发条件是"要多人同时用"，那是并发问题不是性能问题。

环境要求：**Node.js ≥ 22.6**（CI 用 22，本机与 Actions 都在 22 上验证）。
请务必用 22.6 以上：本项目的 npm 脚本（`check`、`server`、`check:both`、`accept`…）都用
`--experimental-strip-types` 直接跑 `.mts`/`.mjs`，Node 18/20 会报 `unknown option`。
（宣传站的 `next build` 本身在更老的 Node 上也能跑，但那样你只有半个项目能用。）

```bash
git clone https://github.com/JeremyThierryChan/NexGenEdu.git
cd NexGenEdu
npm install
npm run dev
```

打开 http://localhost:3000 查看宣传网站。

### 用后台（本机后端）

后台的数据不在浏览器里，而在本机的 SQLite 里，所以要同时起**两个**进程：

```bash
cp .env.example .env.local    # 里面已写好 NEXT_PUBLIC_API_BASE=http://localhost:4000
npm run server                # 终端 A：后端（默认 4000），启动日志会打印登录口令
npm run dev                   # 终端 B：前端（3000），打开 http://localhost:3000/admin
```

- 登录口令来自环境变量 `NEXGENEDU_ADMIN_PASSWORD`；没设就首次启动随机生成一份，写进 `server/data/admin-credential.json`（0600）**并且只在启动日志里打印一次**，请自己存好；
- **后端重启后需要重新登录**（会话只在服务端内存里）；
- 数据文件是 `server/data/nexgenedu.db`，每天自动备份到 `server/backups/`；不设 `NEXT_PUBLIC_API_BASE` 时后台连不上后端，页面会提示「后台需要本机后端」。

> 若 `npm install` 报错 `EACCES` / 无法写入 `~/.npm`，改用项目本地缓存目录：
> `npm install --cache ./.npm-cache`（该目录已在 `.gitignore` 中）。

## 可用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发服务器（默认 3000；**被占用时 Next 会自动改用 3001**，以终端打印的 `Local:` 为准） |
| `npm run build` | 生产构建（同步内容 + 静态导出到 `out/`） |
| `npm start` | 运行生产构建产物 |
| `npm run lint` | ESLint 检查 |
| `npm run typecheck` | TypeScript 类型检查（`tsc --noEmit`） |
| `npm run sync-content` | `data/site/*.md` → `data/site/*.ts` |
| `npm run check` | 自检：内容、报价、服务层、接口契约（当前 700+ 项断言，以命令输出为准） |
| `npm run check:404` | 校验 404 产物（分流、样式、文案） |
| `npm run check:links` | 校验产物里的全部站内链接 |
| `npm run check:all` | 上面三个 check 连着跑 |
| `npm run check:both` | **同一套自检对两种后端各跑一遍**（内存 + 真实 HTTP 服务端） |
| `npm run check:auth` | 服务端认证自检（未登录 401、令牌、退出、操作人来自会话、角色闸门、行级范围、**账号管理**：写盘立刻生效 / 锁死保护 / 只读钩子拒写） |
| `npm run server` | 启动后端（本机 Node + SQLite，默认只绑 127.0.0.1:4000） |
| `npm run server:migrate` | 跑数据库迁移（迁移前自动备份一份带 `nexgenedu-migrate-` 前缀的快照） |
| `npm run server:health` | 探活：`curl` 一下公开的 `GET /health` |
| `npm run server:import` | 把 JSON 导入库里（导错可用备份回滚） |
| `npm run server:backup` | 手动备份一次（`-- --list` 看清单，`-- --force` 忽略"今天已备份"） |
| `npm run accept` | 逐页验收：自己起临时后端，对后台各页面做真实读写（当前 43 项，以命令输出为准） |
| `npm run drill:restore` | 恢复演练：备份 → 删库 → 只靠备份文件恢复 → 核对数据 |

**CI 只跑构站需要的那几条**（`lint` → `sync-content` → `typecheck` → `check` → `build` → `check:404` → `check:links`）；
`check:both` / `check:auth` / `accept` / `drill:restore` 都要起服务端，所以是**本机门禁**，推送前自己跑一遍。

每个阶段完成后固定执行：`lint` → `typecheck` → `check:both`（或 `check`）→ `build`。

## 部署

宣传网站通过 **GitHub Actions 自动部署到 GitHub Pages**，推送到 `main` 即触发。

- 工作流：`.github/workflows/deploy-pages.yml`
- 线上地址：https://jeremythierrychan.github.io/NexGenEdu/
- **宣传站**是纯静态导出产物（`output: "export"` → `out/`），不使用任何服务端运行时；
- **后台不部署到公网**：它要连本机的 Node + SQLite 后端（见 [用后台](#用后台本机后端)），
  线上那份页面会直接提示「后台需要本机后端」，而不是给一个登不上的登录框。原因与触发条件见 [docs/后端开发方案.md](./docs/后端开发方案.md) §7。

### 子路径是怎么处理的

项目站点部署在 `/<repo>/` 子路径下，前缀只能在构建时注入，因此 CI 里设置了环境变量：

```bash
NEXT_PUBLIC_BASE_PATH=/NexGenEdu npm run build
```

`next.config.ts` 会据此开启 `basePath` + `assetPrefix`。**本地开发不要设置该变量**，
否则 `http://localhost:3000` 会被重定向到 `/NexGenEdu`。

### 静态导出带来的约束

静态导出意味着**宣传站的数据必须在构建时可得**：内容数据层在构建期间读取 Markdown 并
渲染为 HTML，因此线上要看到内容改动就得重新构建并部署（本地 dev 下跑一次 `npm run sync-content` 即生效）。
**后台不受这条约束**：它本来就不在静态产物里 —— 页面通过 `POST /api/call` 调本机后端，
数据在 `server/data/nexgenedu.db`，与浏览器缓存、清缓存、换设备都无关。
前端只拿一个会话令牌，而且**后端重启后要重新登录**。

> **历史**：伪后端阶段后台的写操作曾经放在浏览器本地存储里，只作开发期临时方案。
> 接上本机后端之后这段已经不存在，页面代码也没改 —— 换的只是数据访问层。

### 首次部署前的一次性设置

仓库的 Pages 已配置为 `build_type: workflow`。若在其它 fork / 新仓库部署，需要先到
**Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**，
否则部署步骤会失败。

## 项目结构

```
app/
├── layout.tsx            根布局：html/body + 全局样式
├── globals.css           设计令牌与基础样式（品牌色的唯一来源）
├── not-found.tsx         404 页面（一份产物、网站版与后台版两种内容，按路径分流）
├── (site)/               对外宣传网站路由组（有独立的导航与页脚布局）
│   ├── page.tsx          首页             /
│   ├── courses/          课程             /courses
│   ├── teachers/         教师团队         /teachers
│   ├── cases/ faq/ schedule/ quote/       学生案例 / 常见问题 / 时间安排 / 智能报价
│   └── about/ contact/   关于我们 / 联系我们
└── admin/                教务后台路由组
    ├── login/            登录页（口令在服务端）    /admin/login
    └── (dashboard)/      后台页面（整棵子树被 RequireAuth 包住）
        ├── students/ teachers/ classrooms/          学生 / 教师 / 教室
        ├── lessons/ calendar/ timetable/            课程安排 / 日历 / 课表与占用
        └── inquiries/ followups/ finance/ pricing/   咨询 / 待跟进 / 收费 / 报价
            courses/ stats/ scripts/ data/            课程库 / 统计 / 话术 / 数据与备份
            accounts/                                  账号（加人 / 角色 / 重置口令，技术管理员）

components/
├── ui/ layout/           基础组件与页头页脚侧边栏
├── site/ courses/ teachers/ pricing/    宣传网站区块组件
└── admin/                后台控件与业务面板（学生档案、排课、报价、登录表单…）

lib/
├── data/                 宣传站数据访问层：页面取数的唯一入口（`content.ts` 解析 Markdown）
├── backend/              **服务层**：`api.ts`（当前 98 个方法，以 `contract.ts` 为准）+ 领域纯函数（排课与冲突、课时账本、报价、统计…）
│   ├── initial.ts        空库起点（正式使用从这里开始；`seed.ts` 只是自检/演示夹具）
│   └── remote.ts         本机使用时把 `api` 换成对后端 `POST /api/call` 的代理
├── auth/                 `session.ts`（登录）、`token.ts`（前端唯一持有的凭证：令牌）
├── site/ pricing/        导航配置、站点侧报价薄适配
├── types/ utils/ markdown.ts    站点类型、通用工具、Markdown 解析原语

server/                   本机后端（Node + SQLite，不上 Docker）
├── index.mts             HTTP、`/api/call`、鉴权闸门、每天自动备份调度
├── auth.mts              口令与会话（口令不进数据库，前端只拿令牌）
├── backup.mts backup-cli.mts    备份与清理（保留 90 份）、手动备份命令
├── db.mts migrate.mts kv-store.mts   SQLite 连接、迁移器、`kv` 表上的 KeyValueStore
└── import-data.mts reset-data.mts clear-payments.mts    运维脚本

scripts/                  内容同步（`sync-content.mjs`）、开发包装（`dev.mjs`），以及自检与验收脚本：
                          `check.mts`、`check-both.mts`、`check-auth.mts`、`accept-run.mts`/`accept-check.mts`、
                          `drill-restore.mts`、`temp-server.mts`（临时服务端夹具）、`check-404.mjs`、`check-links.mjs`

data/site/                Markdown「伪数据库」：网站内容源（模版兜底 + 一次性导入的来源）
```

## 架构设计

核心原则是**数据层与 UI 解耦**。宣传站的页面只调用 `lib/data` 暴露的函数，不直接读文件、不解析 Markdown：

```ts
// 宣传站页面里只允许出现这样的调用（内容来自 lib/data）
const content = getFaqContent();
const page = getPage("schedule", "课程时间安排");
```

后台走的是另一条路，但同样只有一层：页面只认 `lib/backend/api.ts` 的那些方法，
本机使用时这个对象被换成对后端的代理，**服务端跑的是同一份 `api.ts`**：

```
宣传站：  Markdown 文件  →  lib/data（数据访问层）  →  React / Next.js UI

后台：    页面  →  lib/backend/api.ts  →（本机：remote.ts 代理）→  POST /api/call
                                                              ↓
                                        服务端：同一份 api.ts（存储换成 SQLite 的 kv 表）
```

这么做的好处是业务口径（课时、金额、冲突判定、报价公式）**只实现一份**，
「宣传页一个价、后台另一个价」这类分叉从结构上就不可能发生；
换存储也只换掉最下面那一段，页面代码一行都不用改。

> **历史**：伪后端阶段后台把写操作（排课、课程完成、课时扣减）放在浏览器本地存储里，
> 只作开发期临时方案，不承担并发与事务职责。接上本机后端之后这段已经不存在：
> 数据在 `server/data/nexgenedu.db`，业务校验在服务端按会话复核一次，不只依赖界面。

## 数据模型

五个核心实体，字段设计对齐数据库表结构（真要上 PostgreSQL 时按这些字段建表），均带稳定 `id` 与 `createdAt` / `updatedAt`：

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
- 存储形态是**快照式**的：当前 SQLite 里整库一份 JSON 存在 `kv` 表（由 `lib/backend/api.ts` 通过
  `KeyValueStore` 读写），不是每个实体一张表 —— 实体边界留在代码里，等真有并发/远程需求时再拆表。

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

1. **数据层与 UI 分离**：宣传站页面不得出现 `fs.readFile` 或 Markdown 解析逻辑，一律走 `lib/data`。
2. **业务逻辑与 UI 分离**：冲突检测、课时与金额不变式等规则放在服务层 `lib/backend/`（`api.ts` 的 `lessons.findConflicts`、`availability.ts`、`timetable.ts`…），不写死在组件里。
3. **类型优先**：使用明确的 TypeScript 类型，不使用 `any`。
4. **组件保持小型化**：不要把整个页面写进一个巨大文件。
5. **不提前设计**：不为未确定的功能建立复杂架构。
6. **不编造数据**：数据未接入时展示空状态，而不是假数据。
7. **服务端不信任前端**：鉴权、冲突、容量、幂等、金额这些判定，服务端都要自己复核一遍（清单见 [docs/后台API约定.md](./docs/后台API约定.md)）；界面上的提示只是体验，不是边界。

## 文档

| 文档 | 给谁看 | 内容 |
| --- | --- | --- |
| [README.md](./README.md) | 所有人 | 本文件：项目概览与快速开始 |
| [docs/使用手册.md](./docs/使用手册.md) | 机构员工 | 后台怎么用：排课、报课收费、咨询、报价、请假补课、备份 |
| [docs/内容维护手册.md](./docs/内容维护手册.md) | 运营 / 负责人 | 怎么改课程、价格、FAQ、教师等内容并发布上线 |
| [docs/技术架构.md](./docs/技术架构.md) | 开发者 / 接手的人 | 架构全景、目录职责、数据模型、领域模块、自检体系 |
| [docs/部署与发布.md](./docs/部署与发布.md) | 开发者 | 本机环境与命令、起后端与登录、构建、CI、上线核对与常见故障、回滚 |
| [docs/后台API约定.md](./docs/后台API约定.md) | 接后端的人 | 当前 98 个接口的分组、服务端必须复核的校验、迁移步骤 |
| [docs/后端开发方案.md](./docs/后端开发方案.md) | 要写 / 维护后端的人 | 本机 Node + SQLite 单文件（不上 Docker）的落地顺序与纪律：会话认证、两种后端跑同一套自检、每天自动备份与恢复演练 |
| [PROJECT.md](./PROJECT.md) | 开发者 | 分主题的设计决策记录（「当时为什么这么定」） |
| [docs/README.md](./docs/README.md) | 所有人 | docs 目录索引 |

## 许可

本项目为私有项目，暂未指定开源许可协议。
