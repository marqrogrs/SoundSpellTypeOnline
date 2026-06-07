#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

NODE_OPTIONS=--max-old-space-size=8192 FUNCTIONS_DISCOVERY_TIMEOUT=180 firebase deploy --only functions "$@"
