#!/bin/bash
# 从 OpenClaw 提取结果同步到 CodeNexus
# 用法: ./scripts/sync-from-openclaw.sh <extraction_dir> <nexus_module_path>
# 示例: ./scripts/sync-from-openclaw.sh /path/to/extraction foundation/auth

set -e

EXTRACTION_DIR="${1:?Usage: sync-from-openclaw.sh <extraction_dir> <nexus_module_path>}"
MODULE_PATH="${2:?Usage: sync-from-openclaw.sh <extraction_dir> <nexus_module_path>}"

echo "🦞→🔗 Syncing: $EXTRACTION_DIR → $MODULE_PATH"

# 创建目标目录
mkdir -p "$MODULE_PATH"/{src,tests}

# 复制文件
if [ -d "$EXTRACTION_DIR/src" ]; then
  cp -r "$EXTRACTION_DIR/src/"* "$MODULE_PATH/src/"
  echo "  ✅ Source code copied"
fi

if [ -d "$EXTRACTION_DIR/tests" ]; then
  cp -r "$EXTRACTION_DIR/tests/"* "$MODULE_PATH/tests/"
  echo "  ✅ Tests copied"
fi

for file in README.md .meta.yml package.json pyproject.toml docker-compose.yml; do
  if [ -f "$EXTRACTION_DIR/$file" ]; then
    cp "$EXTRACTION_DIR/$file" "$MODULE_PATH/"
    echo "  ✅ $file copied"
  fi
done

echo ""
echo "📋 Next steps:"
echo "  1. Review:   cat $MODULE_PATH/README.md"
echo "  2. Validate: ./scripts/validate.sh $MODULE_PATH"
echo "  3. Commit:   git add $MODULE_PATH && git commit -m 'feat($MODULE_PATH): add via OpenClaw'"
echo "  4. Push:     git push origin openclaw/$(echo $MODULE_PATH | tr '/' '-')"
