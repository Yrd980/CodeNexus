# Changelog

记录 CodeNexus 作为“研究协议仓”的关键变化。

## [0.3.0] - 2026-03-16

### 长跑

- 新增 `scripts/openclaw_long_run.py`，把 Trending 批次、repo review、checkpoint、自更新串成可长跑 loop
- 批次结果现在会落到运行目录里，保留 `latest-manifest / latest-review / latest-checkpoint / state / checkpoints.jsonl`
- 自更新健康检查升级为同时校验 `openclaw_trending_pipeline.py / agentic_review_loop.py / openclaw_long_run.py`
- Trending parser 过滤 sponsor 链接，单个仓库 sync 失败也不会拖垮整批

## [0.2.0] - 2026-03-16

### 收缩

- 删除旧的代码包目录思路，不再维持 `foundation / modules / patterns / starters`
- 将仓库重新定位为 `.prompts/ + scripts/` 的轻骨架
- OpenClaw 管线改成事实采集、验证 backlog、贡献假设分离的结构
- 删除原型测试文件，健康检查改为脚本语法检查

## [0.1.0] - 2026-03-13

### 初始化

- 建立最初版本的提示词体系
- 建立与 OpenClaw 的联动机制
- 写下初版设计哲学
