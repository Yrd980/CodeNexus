# CodeNexus 设计哲学

## 为什么做这个

市面上有无数的 boilerplate 和 awesome-list，但它们有两个共同问题：

1. **死代码** — 生成后就不管了，三个月就过时
2. **无观点** — 给你十种方案但不告诉你该选哪个

CodeNexus 的理念是：**有观点的、活的代码知识库**。

## 核心信条

### 1. 能跑 > 好看

如果代码不能跑，再优雅也没用。每个模块必须能独立运行或作为模块导入。`git clone` 下来就能用，不需要猜缺什么依赖。

### 2. 有观点 > 大而全

不追求列出所有方案。每个模块代表一个明确的选型决策，README 里写清楚"为什么选 A 不选 B"。Startup 没时间做技术调研，CodeNexus 帮你做好了。

### 3. 进化 > 完美

没有永远的 best practice。每个模块附带认知变更记录，记录"我们当时为什么这样选"和"后来为什么改了"。这个变更过程本身就是知识。

### 4. 溯源 > 原创

CodeNexus 的很多代码灵感来自开源社区。我们通过 `.meta.yml` 标注来源，通过 OpenClaw 给原项目提 PR 回馈。取之开源，回馈开源。

### 5. AI 原生 > AI 辅助

CodeNexus 不只是给人看的，也是给 AI 看的。`.prompts/` 目录下的提示词让 Claude 能直接理解和使用这个知识库。人和 AI 共同维护，共同进化。

## 选型偏好

CodeNexus 的默认技术栈偏好（可以根据场景调整）：

| 领域 | 偏好 | 原因 |
|------|------|------|
| 语言 | TypeScript / Python | Startup 最常用，AI 生态最好 |
| 前端 | Next.js / React | 生态成熟，招人容易 |
| 后端 | Node.js / FastAPI | 快速迭代，类型安全 |
| 数据库 | PostgreSQL + Redis | 覆盖 95% 的场景 |
| 部署 | Docker + Fly.io/Vercel | Startup 友好，低运维 |
| ORM | Prisma / Drizzle | 类型安全，迁移方便 |

这些偏好不是教条。如果某个场景下 Go 或 Rust 更合适，就用 Go 或 Rust。
