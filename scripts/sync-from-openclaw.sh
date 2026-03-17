#!/bin/bash
# 从 OpenClaw 提取结果同步到本地产物目录
# 用法: ./scripts/sync-from-openclaw.sh <extraction_dir> <artifact_path>
# 示例: ./scripts/sync-from-openclaw.sh /path/to/extraction ./research/my-finding

set -euo pipefail

EXTRACTION_DIR="${1:?Usage: sync-from-openclaw.sh <extraction_dir> <artifact_path>}"
ARTIFACT_PATH="${2:?Usage: sync-from-openclaw.sh <extraction_dir> <artifact_path>}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "🦞→🔗 Syncing: $EXTRACTION_DIR → $ARTIFACT_PATH"

# 创建目标目录
mkdir -p "$ARTIFACT_PATH"

# 复制文件
if [ -d "$EXTRACTION_DIR/src" ]; then
  mkdir -p "$ARTIFACT_PATH/src"
  cp -R "$EXTRACTION_DIR/src/." "$ARTIFACT_PATH/src/"
  echo "  ✅ Source code copied"
fi

for file in README.md .meta.yml package.json pyproject.toml docker-compose.yml; do
  if [ -f "$EXTRACTION_DIR/$file" ]; then
    cp "$EXTRACTION_DIR/$file" "$ARTIFACT_PATH/"
    echo "  ✅ $file copied"
  fi
done

echo ""
echo "📋 Next steps:"
echo "  1. Review:   cat $ARTIFACT_PATH/README.md"
echo "  2. Queue:    $ROOT_DIR/scripts/validate.sh $ARTIFACT_PATH"
echo "               This writes an agentic review queue and next-action backlog."
echo "  3. Pull:     git pull --ff-only"
echo "  4. Commit:   git add $ARTIFACT_PATH && git commit -m 'feat: sync extracted artifact'"
