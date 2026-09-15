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
| 包管理 | npm（项目本地 cache：`.npm-cache/`） | 受本机权限限制，见第 8 节 |
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
│   └── contact/          #   /contact
└── admin/                # B. 教务后台（Phase 4 起逐步实现）

components/
├── ui/                   # Button / Card / Badge / Container / Section
├── layout/               # Logo / Header / Footer /（后续 AdminSidebar / AdminHeader）
├── site/                 # 宣传网站专用区块组件
├── students/ teachers/ classrooms/ lessons/ dashboard/   # 后台业务组件（Phase 4+）

lib/
├── site/                 # 站点配置与导航（config.ts / nav.ts）
├── types/                # 领域类型（Phase 2）
├── data/                 # 数据访问层，页面唯一的数据入口（Phase 2）
├── scheduling/           # 排课与冲突检测（Phase 5）
└── utils/                # 通用工具（cn.ts）

data/                     # Markdown「伪数据库」（Phase 2）
├── students/ teachers/ classrooms/ lessons/ site/
```

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
| Phase 4 | 后台：Dashboard / 学生 / 教师 / 教室 / 课程 / 日历 | 待开始 |
| Phase 5 | 核心业务：排课 / 冲突检测 / 课程状态 / 课时扣减 / 搜索 | 待开始 |
| Phase 6 | 响应式与 UI Polish | 待开始 |
| Phase 7 | 部署 | 待开始 |

### Phase 1 交付说明

- 完成 Next.js 15 + TS strict + Tailwind 4 脚手架，`lint` / `typecheck` / `build` 全部通过。
- 建立设计系统：品牌色（深墨蓝 + 暖琥珀）、状态色（成功 / 预警 / 危险）、中性色阶、圆角与字体。
- 建立布局与基础组件：`Header`（含移动端折叠菜单）、`Footer`、`Logo`、`Button`、`Card`、`Badge`、`Container`、`Section`。
- 宣传网站 5 个页面全部可访问，数据待接入区块使用明确的空状态（`EmptyState`），不展示假数据。
- **已知债务**：`lib/site/config.ts` 中的联系方式、首页特色文案为占位常量，Phase 2/3 迁移到 `data/site/*.md`。

## 7. 常用命令

```bash
npm run dev        # 开发服务器 http://localhost:3000
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm run build      # 生产构建
```

每个 Phase 完成后固定执行：`lint` → `typecheck` → `build` → 更新本文件 → Git commit。

## 8. 本机环境约束（重要）

开发机存在两条网络 / 权限限制，影响构建方式，**不是代码问题**：

1. **`github.com:443` 不可达**（npm registry 正常，GitHub 超时）。
   → 本地 commit 正常，`git push` 需在能访问 GitHub 的环境中执行，见第 10 节。
2. **`~/.npm` 不可写**（沙箱限制在项目目录内）。
   → 所有 npm 命令使用项目本地 cache：`npm install --cache ./.npm-cache`。
   该目录已加入 `.gitignore`。
3. **Google Fonts 不可达**。
   → 不使用 `next/font/google`，改用系统字体栈，构建可完全离线完成。

## 9. 关键设计决策记录

- **不引入组件库**：UI 需求克制（卡片、按钮、徽章、表格），自建组件可保持体积与设计语言可控。
- **宣传网站与后台共用设计语言，但信息密度不同**：`(site)` 路由组大留白、大标题；`admin` 路由组紧凑、表格优先。
- **`app/(site)` 路由组**：让宣传网站与后台拥有各自独立的 layout，互不干扰。
- **`cn()` 不做 Tailwind 冲突消解**：保持零依赖与可预测性，约定调用方 `className` 最后拼接。
- **`next.config.ts` 显式设置 `outputFileTracingRoot`**：本机 HOME 下存在其它 lockfile，需固定项目根目录。

## 10. Git

- 默认分支：`main`
- 远端：`origin` → `https://github.com/JeremyThierryChan/NexGenEdu.git`
- 首次推送（需在可访问 GitHub 的网络环境执行）：

```bash
git push -u origin main
```
