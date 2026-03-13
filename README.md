# 🔗 CodeNexus

> Startup 工程师的代码军火库 —— 持续进化的 Best Practice 代码知识库

## 理念

CodeNexus 不是 boilerplate，不是 awesome-list。

它是一个**活的代码知识库**——每一行代码都能跑，每一个模块都附带"为什么这样写"的设计决策，并且随着认知更新持续迭代。

## 特点

- 🏃 **可运行** — 不是片段，是能跑的模块
- 🧠 **有观点** — 每个模块说明为什么选这个方案
- 🔄 **持续进化** — 随 best practice 变化而更新，附带变更记录
- 🔍 **来源可溯** — 每个模块标注灵感来源和学习笔记
- 🤖 **AI 原生** — 附带提示词，Claude / OpenClaw 能直接基于此库编程和进化

## 结构

```
CodeNexus/
├── foundation/     🏗️ 基础设施（auth, db, api, infra, monitoring, ci-cd）
├── modules/        📦 业务模块（payments, notifications, search, ai, realtime）
├── patterns/       🧩 设计模式（限流, 队列, 缓存, 重试, 事件驱动）
├── starters/       🚀 完整启动模板（SaaS, API, CLI, 浏览器扩展）
├── .prompts/       🧠 提示词 & 知识卡片
└── .claude/        🤖 Claude Code 项目指令
```

## 与 OpenClaw 🦞 的关系

[OpenClaw](https://github.com/Yrd980/openclaw) 是我们的小龙虾代码猎手——它在 GitHub 上发现优质项目、给原项目提 PR 贡献回馈，同时提取精华沉淀到 CodeNexus。

```
GitHub 优质项目 ──→ OpenClaw 🦞 ──→ 分析提取 ──→ CodeNexus 🔗
                       │
                       └──→ 给原项目提 PR（回馈社区）
```

## 模块成熟度

每个模块通过 `.meta.yml` 标记成熟度：

| 等级 | 含义 |
|------|------|
| `draft` | 初始沉淀，待验证 |
| `tested` | 通过测试，可在小项目使用 |
| `stable` | 经过实际项目验证 |
| `battle-tested` | 多个生产环境验证 |

## 快速开始

```bash
# 克隆
git clone git@github.com:Yrd980/CodeNexus.git
cd CodeNexus

# 使用某个模块（示例）
cp -r foundation/auth/src/ your-project/lib/auth/

# 用 Claude Code 基于 CodeNexus 开发
cd your-project
claude  # Claude 会自动参考 CodeNexus 的知识
```

## 参与

- 通过 Issue 讨论 best practice 的变更
- 通过 OpenClaw 🦞 提交新的代码发现
- 直接 PR 改进现有模块
