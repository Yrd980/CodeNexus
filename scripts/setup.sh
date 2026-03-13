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
echo "  • Browse modules:     ls foundation/ modules/ patterns/"
echo "  • Use a module:       cp -r foundation/auth/src/ your-project/lib/auth/"
echo "  • Review prompts:     cat .prompts/system/code-extractor.md"
echo "  • Claude Code:        claude  (reads CLAUDE.md automatically)"
