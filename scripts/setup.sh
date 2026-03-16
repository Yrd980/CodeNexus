#!/bin/bash
# CodeNexus 初始化脚本
# 用于在新环境中设置 CodeNexus 开发环境

set -e

echo "🔗 CodeNexus Setup"
echo "=================="

# 检查基础工具
check_tool() {
  if command -v "$1" &> /dev/null; then
    echo "✅ $1 found"
  else
    echo "⚠️  $1 not found — install it for full functionality"
  fi
}

echo ""
echo "Checking tools..."
check_tool node
check_tool npm
check_tool python3
check_tool docker
check_tool git

echo ""
echo "🔗 CodeNexus is ready!"
echo ""
echo "Quick start:"
echo "  • Read protocol:      cat .prompts/system/openclaw-protocol.md"
echo "  • Read extractor:     cat .prompts/system/code-extractor.md"
echo "  • Build review queue: python scripts/agentic_review_loop.py"
echo "  • Run trending:       python scripts/openclaw_trending_pipeline.py --limit 5"
echo "  • Run one batch:      python scripts/openclaw_long_run.py --max-batches 1 --sleep-seconds 0"
echo "  • Run forever:        python scripts/openclaw_long_run.py --forever --sleep-seconds 900"
echo "  • Review artifact:    ./scripts/validate.sh ./research/my-finding"
echo "  • Review prompts:     cat .prompts/system/agentic-reviewer.md"
echo "  • Run Codex:          codex"
