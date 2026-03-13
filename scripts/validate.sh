#!/bin/bash
# CodeNexus 模块质量校验
# 用法: ./scripts/validate.sh <module_path>
# 示例: ./scripts/validate.sh foundation/auth

set -e

MODULE_PATH="${1:?Usage: validate.sh <module_path>}"

echo "🔍 Validating: $MODULE_PATH"
echo "=========================="

PASS=0
FAIL=0

check() {
  if [ "$2" = "true" ]; then
    echo "  ✅ $1"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $1"
    FAIL=$((FAIL + 1))
  fi
}

# 文件结构检查
check "README.md exists" "$([ -f "$MODULE_PATH/README.md" ] && echo true || echo false)"
check "src/ exists" "$([ -d "$MODULE_PATH/src" ] && echo true || echo false)"
check "tests/ exists" "$([ -d "$MODULE_PATH/tests" ] && echo true || echo false)"
check ".meta.yml exists" "$([ -f "$MODULE_PATH/.meta.yml" ] && echo true || echo false)"

# README 内容检查
if [ -f "$MODULE_PATH/README.md" ]; then
  check "README has '解决什么问题'" "$(grep -q '解决什么问题' "$MODULE_PATH/README.md" && echo true || echo false)"
  check "README has '为什么这样设计'" "$(grep -q '为什么这样设计' "$MODULE_PATH/README.md" && echo true || echo false)"
fi

# .meta.yml 内容检查
if [ -f "$MODULE_PATH/.meta.yml" ]; then
  check ".meta.yml has maturity" "$(grep -q 'maturity:' "$MODULE_PATH/.meta.yml" && echo true || echo false)"
  check ".meta.yml has source" "$(grep -q 'source:' "$MODULE_PATH/.meta.yml" && echo true || echo false)"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  echo "⚠️  Module needs fixes before merging"
  exit 1
else
  echo "✅ Module passes all checks!"
fi
