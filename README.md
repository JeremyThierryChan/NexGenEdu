# NexGenEdu · 新径教育

辅导机构轻量化管理系统 V1 —— 对外宣传网站 + 轻量教务后台。

当前阶段为**纯前端实现**，数据使用 Markdown 文件模拟，尚未接入数据库与后端服务。

> 完整的项目目标、范围、架构与开发进度见 [PROJECT.md](./PROJECT.md)。

## 快速开始

```bash
npm install --cache ./.npm-cache
npm run dev
```

打开 http://localhost:3000

> `--cache ./.npm-cache` 是本机环境要求（`~/.npm` 不可写），详见 PROJECT.md 第 9 节。

## 可用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发服务器 |
| `npm run lint` | ESLint 检查 |
| `npm run typecheck` | TypeScript 类型检查（strict） |
| `npm run build` | 生产构建 |

## 目录概览

```
app/(site)/   对外宣传网站：/ /courses /teachers /about /contact
app/admin/    教务后台（Phase 4 起实现）
components/   ui / layout / site / 后台业务组件
lib/          site 配置、types、data 数据访问层、scheduling 排课逻辑
data/         Markdown「伪数据库」
```

## 核心原则

1. 先做好每天真正会用到的功能，再逐步演化。
2. 数据层与 UI 解耦：页面只调用 `lib/data` 中的函数，不直接解析 Markdown。
3. 不提前开发数据库、登录、支付、AI 等功能。
4. 每完成一个 Phase：`lint` → `typecheck` → `build` → 更新 PROJECT.md → commit。
