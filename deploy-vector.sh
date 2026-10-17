#!/usr/bin/env bash
# ==============================================================================
# GitHub Stars Manager — 向量搜索一键部署脚本 (macOS & Linux)
# ==============================================================================

# 定位脚本所在根目录
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  DIR="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"

cd "$SCRIPT_DIR"

# 检查 Node.js 是否安装
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "❌ 未检测到 Node.js，请先安装 Node.js (推荐 v18 或更高版本):"
  echo "   官方网站: https://nodejs.org/"
  echo ""
  if [ -t 0 ]; then
    read -p "按回车键退出..." dummy
  fi
  exit 1
fi

# 执行核心部署向导（关闭 set -e 以便在出错时捕获错误，避免 GUI 双击闪退）
node scripts/deploy-vector.mjs "$@"
EXIT_CODE=$?

# 如果是双击运行（通过终端打开），避免窗口瞬间关闭看不到结果
if [ -t 0 ] && [ -z "$CI" ] && [ "$#" -eq 0 ]; then
  echo ""
  read -p "部署脚本执行完毕，按回车键退出..." dummy
fi

exit $EXIT_CODE
