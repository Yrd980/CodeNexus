# 🦞 OpenClaw 投喂协议

> 定义 OpenClaw 向 CodeNexus 投喂代码的最小可信流程。

## 核心原则

- GitHub Trending 是默认起点，先 clone / update，再分析
- 主流程只记录事实、证据、下一步动作，不做伪精确打分
- 语言开放，但 Startup 面向的最终产物要保留一个最小可运行路径
- Docker / devcontainer 只算运行上下文
- PR 假设在拿到 runtime truth 之前必须停留在 `hold`
- 测试不能只是容易通过的 happy path
- 协议和脚本本身也要进入主动 review loop，而不是长期静态摆放

## 流程

```text
1. 发现候选项目
2. clone / update 本地仓库
3. 采集 repo facts：语言、build/test/startup、CI、monorepo、外部服务依赖
4. 提取 README 摘要与代码关键词
5. 形成 evidence manifest
6. 给出下一步动作：research / extract-only / skip
7. 生成 verification backlog
8. 对 top candidates 执行最小 runtime truth，记录 ready / running / blocked / failed
9. 如有必要，只生成 contribution hypothesis，状态固定为 hold
10. 运行 agentic review loop，主动审查 prompt 和脚本本身
11. 批次结束后写 checkpoint 和历史记录
12. 批次之间做 `git pull --ff-only` 自更新，并跑脚本健康检查
13. 如果代码有更新，下一个批次必须从新代码继续，而不是拿旧进程硬跑
```

## 动作定义

- `research`：值得继续深挖，而且已经存在真实入口或验证路径
- `extract-only`：有提炼价值，但目前不值得高投入
- `skip`：证据太弱，继续研究性价比低

## 明确禁止

- 用静态阅读结果直接推进成 PR 决策
- 用数值边界或 cosmetic 改动刷贡献
- 把 Docker 补丁包装成高价值工程贡献

## 反馈闭环

每个批次结束后，至少记录：

- 哪些仓库进入了 `research`
- 哪些仓库只适合 `extract-only`
- 哪些 top candidates 已经拿到了 runtime truth，哪些只是 blocked / failed
- 哪些 PR 假设一直停在 `hold`
- 哪些验证计划后来证明当初理解错了
- 哪些 prompt / script 已经变成静态负担，应该重写或归档
- 上一批次之后是否完成了自更新，以及健康检查有没有通过
