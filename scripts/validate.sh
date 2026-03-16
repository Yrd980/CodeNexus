#!/bin/bash
# CodeNexus agentic artifact review wrapper
# Usage: ./scripts/validate.sh <artifact_path> [output_json]
# Example: ./scripts/validate.sh ./research/my-finding

set -euo pipefail

ARTIFACT_PATH="${1:?Usage: validate.sh <artifact_path> [output_json]}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_PATH="${2:-$ARTIFACT_PATH/agentic-review.json}"

if [ ! -e "$ARTIFACT_PATH" ]; then
  echo "Artifact path does not exist: $ARTIFACT_PATH" >&2
  exit 1
fi

echo "Reviewing artifact: $ARTIFACT_PATH"
python3 "$ROOT_DIR/scripts/agentic_review_loop.py" \
  --root "$ROOT_DIR" \
  --output "$OUTPUT_PATH" \
  "$ARTIFACT_PATH"

python3 - "$OUTPUT_PATH" <<'PY'
import json
import sys
from pathlib import Path

output_path = Path(sys.argv[1])
data = json.loads(output_path.read_text(encoding="utf-8"))

print("")
print("Summary:")
for key, value in data["summary"].items():
    print(f"- {key}: {value}")

next_wave = data.get("next_wave", [])
print("")
if next_wave:
    print("Priority actions:")
    for item in next_wave[:5]:
        print(f"- {item['path']}: {item['decision']} ({item['severity']}) -> {item['next_action']}")
else:
    print("Priority actions:")
    print("- keep: no immediate rewrite or archive call.")

print("")
print(f"Review memo written to: {output_path}")
PY
