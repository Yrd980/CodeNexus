# 🦞 OpenClaw 投喂协议

> 定义 OpenClaw 向 CodeNexus 投喂代码的标准流程和格式。
> 这个文件同时存在于 OpenClaw 和 CodeNexus 两个仓库。

## 核心原则

- GitHub Trending 是默认起点，先 clone 再分析
- PR 要追求真实价值，不追求数量
- 测试不能只是容易通过的 happy path
- 语言开放，但沉淀结果要统一成可运行模块、知识卡片或伪代码模式
- 每一轮都要记录反馈，让 OpenClaw 越来越会判断

## 流程

```text
1. OpenClaw 发现候选项目
2. 直接 clone / update 项目
3. 用 code-extractor.md 分析项目 → 得到分析报告 JSON
4. 用 repo-scorer.md 做分析后归类与优先级判断
5. 用 verification-rubric.md 检查验证证据是否足够
6. 用 pr-opportunity-scorer.md 判断是否存在高价值 PR 机会
7. 用 code-refiner.md 炼化代码 → 得到标准模块 / 知识卡片 / 伪代码模式
8. 如需回馈原项目，先生成 draft proposal，人工审核后再决定是否提 PR
9. 向 CodeNexus 提 PR，分支命名：openclaw/<module-path>
10. CodeNexus 用 pr-reviewer.md 审核
11. 记录结果与反馈，更新下一轮判断标准
```

## 动作决策

对每个候选仓库，只能进入以下动作之一：

- `research`：值得深度研究
- `extract-only`：值得提炼，但不值得对外提 PR
- `draft-for-human-review`：存在高价值 PR 机会，但必须人工审核后再发
- `skip`：分析后判断不值得继续投入

## PR 格式

### 分支命名

```text
openclaw/foundation-auth-jwt
openclaw/patterns-rate-limiter
openclaw/modules-payments-stripe
```

### Commit Message

```text
feat(foundation/auth): add JWT refresh token flow

Source: https://github.com/xxx/yyy
Extracted by: OpenClaw 🦞
Maturity: draft
```

### PR 描述模板

```markdown
## 🦞 OpenClaw 投喂

**来源项目**：[项目名](URL) ⭐ {{stars}}
**候选来源**：{{source}}
**提取模块**：`{{nexus_path}}`
**语言**：{{language}}

### 这个模块做什么
（一段话）

### 为什么值得沉淀
（从原项目学到的核心认知）

### 为什么不是水分投喂
- 真实解决的问题：
- 可迁移的设计：
- 不适合直接照搬的部分：

### 验证证据
- [ ] 真实运行路径验证过
- [ ] 至少一个关键假设被故意打破并观察边界
- [ ] 检查过迁移到陌生上下文后的依赖泄漏风险

### 文件清单
- [ ] `src/` — 可运行源码
- [ ] `tests/` — 测试
- [ ] `README.md` — 含设计决策说明
- [ ] `.meta.yml` — 元信息完整

### 质量自检
- [ ] 能独立运行
- [ ] 去除原项目特有逻辑
- [ ] 配置参数化
- [ ] 类型安全
- [ ] 有错误处理
- [ ] 有测试
```

## 同步脚本用法

```bash
# 在 OpenClaw 中，将提取的模块同步到 CodeNexus
./scripts/sync-to-nexus.sh <extraction_dir> <nexus_module_path>

# 示例
./scripts/sync-to-nexus.sh ./extractions/lucia-auth/ foundation/auth
```

## 反馈闭环

每次批次结束后，OpenClaw 应记录：

- 哪些仓库被跳过，以及为什么
- 哪些提炼结果后来被认为价值不足
- 哪些 PR proposal 被人工否决
- 哪些验证看似通过，但后来证明理解不够

这些反馈会反过来更新评分阈值、prompt 和审核标准。
