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

# 泄漏护栏:构建产物不得含构建机绝对路径(盘符/家目录),防止个人目录进入仓库。
# 模式排除协议冒号(http:// 的 p:/ 不是盘符)与常见反斜杠转义(\\n 等)。
echo "==> leak guard: scanning lib/ for absolute paths"
if grep -RInE '[A-Za-z]:\\[^ntrbf]|[A-Za-z]:/[^/]|/Users/|/home/' lib/; then
  echo "error: lib/ contains absolute paths (see above); fix the bundler plugin before committing" >&2
  exit 1
fi
echo "==> done: lib/index.js + lib/client.js"
