# CodeNexus

> 给 OpenClaw / Codex 用的研究协议仓，不再是假装包罗万象的“模块超市”。

## 现在这是什么

CodeNexus 现在主要保留两类东西：

- `.prompts/`：研究、提炼、验证、复审的提示词和模板
- `scripts/`：处理手动仓库队列、运行验证链路、主动审查产物的脚本
- `MANUAL_REPO_QUEUE.md`：手动投喂仓库 URL 的入口，会和现有分析链路合并

另外它现在多了一条主动审稿入口：

- `scripts/agentic_review_loop.py`：主动扫描 `.prompts/`、`scripts/` 和指定产物目录，生成 review queue
- `scripts/openclaw_long_run.py`：按批次处理手动仓库队列、写 checkpoint、批次间自更新
- `scripts/openclaw_watchdog.py`：持续监视 long-run worker，挂掉或心跳过期时自动拉起
- `scripts/openclaw_runtime_verifier.py`：对 top candidates 真跑 startup / build 路径，落下 runtime truth 结论

也就是说，它更像一套“怎么研究代码、怎么判断价值、怎么沉淀结果”的操作系统，而不是一堆老题材代码包的展厅。

## 目录

```text
CodeNexus/
├── .prompts/   # 分析、提炼、复审、协议、模板
├── MANUAL_REPO_QUEUE.md  # 手动仓库队列
├── scripts/    # 手动队列管线、同步脚本、审查脚本
├── PHILOSOPHY.md
└── CHANGELOG.md
```

## 与 OpenClaw 的关系

OpenClaw 负责发现和分析外部项目。

CodeNexus 负责约束它：

- 不要把热度当价值
- 不要把静态阅读当理解
- 不要把水 PR 当贡献
- 不要把过时主题继续当中心

## 快速开始

```bash
git clone git@github.com:Yrd980/CodeNexus.git
cd CodeNexus

# 看协议
cat .prompts/system/openclaw-protocol.md

# 看项目分析 prompt
cat .prompts/system/code-extractor.md

# 生成主动 review queue
python scripts/agentic_review_loop.py

# 手动填仓库 URL（系统会自动读取这个文件）
$EDITOR MANUAL_REPO_QUEUE.md

# 跑一次手动仓库队列分析
python scripts/openclaw_repo_queue_pipeline.py

# 跑一次完整批次循环
python scripts/openclaw_long_run.py --max-batches 1 --sleep-seconds 0

# 只跑 runtime truth 执行器
python scripts/openclaw_runtime_verifier.py --manifest runtime/openclaw/latest-manifest.json --runtime-root runtime/openclaw --output runtime/openclaw/latest-runtime-verification.json

# 进入长跑模式
python scripts/openclaw_long_run.py --forever --sleep-seconds 900

# 进入 watchdog 托管模式
python scripts/openclaw_watchdog.py --runtime-root runtime/openclaw-live --sleep-seconds 600

# 审查某个产物目录
./scripts/validate.sh ./research/my-finding
```

长跑输出默认写到 `runtime/openclaw/`，其中会保留：

- `state.json`
- `checkpoints.jsonl`
- `latest-manifest.json`
- `latest-review.json`
- `latest-runtime-verification.json`
- `latest-checkpoint.json`
- `heartbeat.json`
- `worker.pid.json`
- `watchdog.json`
- `watchdog-events.jsonl`
- `verification-memory.json`
- `batches/<timestamp>/...`

默认情况下，`openclaw_repo_queue_pipeline.py` 和 `openclaw_long_run.py` 都会读取仓库根目录下的 `MANUAL_REPO_QUEUE.md`，并且只处理手动输入的仓库。

也就是说，现在的 discovery 默认是：

- 手动粘贴进 `MANUAL_REPO_QUEUE.md` 的仓库 URL

手动队列只影响“发现和入队”，不会替换现有的 review、checkpoint、runtime truth、watchdog 这套后续链路。

## 当前取向

- 更偏 AI-native、automation、retrieval、evaluation、workflow、browser/tooling
- 少做“旧时代 SaaS 工具箱目录学”
- 把证据、动作、验证 backlog 明确分开
- 把静态规范继续推成主动 review loop
- 让产物审查输出 backlog，而不是只输出 pass/fail
- 让 OpenClaw 以批次 checkpoint 的方式长跑，并在批次之间 `git pull --ff-only`
- 让 top candidates 真跑 runtime truth，而不是只把 `next_step` 写进 JSON
- 遇到会 sync / restart / 写本地状态的危险 startup 时，先拦住再回退到更安全的 sanity path

## 参与

- 直接改 prompt 和协议
- 改 `scripts/` 里的研究管线
- 删除已经没有价值的旧假设，而不是给它们换个新包装
