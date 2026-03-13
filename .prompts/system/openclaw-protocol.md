# 🦞 OpenClaw 投喂协议

> 定义 OpenClaw 向 CodeNexus 投喂代码的标准流程和格式。
> 这个文件同时存在于 OpenClaw 和 CodeNexus 两个仓库。

## 流程

```
1. OpenClaw 发现优质项目
2. 用 code-extractor.md 分析项目 → 得到分析报告 JSON
3. 用 code-refiner.md 炼化代码 → 得到标准模块文件
4. （可选）给原项目提 PR 回馈社区
5. 向 CodeNexus 提 PR，分支命名：openclaw/<module-path>
6. CodeNexus 用 pr-reviewer.md 审核
7. 合并入库
```

## PR 格式

### 分支命名
```
openclaw/foundation-auth-jwt
openclaw/patterns-rate-limiter
openclaw/modules-payments-stripe
```

### Commit Message
```
feat(foundation/auth): add JWT refresh token flow

Source: https://github.com/xxx/yyy
Extracted by: OpenClaw 🦞
Maturity: draft
```

### PR 描述模板

```markdown
## 🦞 OpenClaw 投喂

**来源项目**：[项目名](URL) ⭐ {{stars}}
**提取模块**：`{{nexus_path}}`
**语言**：{{language}}

### 这个模块做什么
（一段话）

### 为什么值得沉淀
（从原项目学到的核心认知）

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
