#!/bin/bash
# 标准构建入口(与 DSH 插件生产线 dev_build_plugin 契约对齐)。
# 用法:bash scripts/build.sh [DSH_CHECKOUT=/path/to/deepseek-harness]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# DSH 检出:显式 DSH_CHECKOUT 优先,否则 ~/.dsh/source/current
CHECKOUT="${DSH_CHECKOUT:-$HOME/.dsh/source/current}"
if [ ! -d "$CHECKOUT/packages" ]; then
  echo "error: DSH checkout not found (set DSH_CHECKOUT or create ~/.dsh/source/current)" >&2
  exit 1
fi

echo "==> dsh-headroom build (checkout: $CHECKOUT)"
pnpm install
pnpm typecheck
pnpm test
pnpm build
echo "==> done: lib/index.js + lib/client.js"
