#!/usr/bin/env bash
# 谛听 macOS 发布脚本：构建 → 签名校验 → zip → dmg → GitHub Release
#
# 用法：
#   bash scripts/release-mac.sh                 # 全量构建 + 签名 + 公证 + 打包 + 上传
#   bash scripts/release-mac.sh --skip-build    # 复用 out/ 下已有 .app，只公证+打包上传
#   bash scripts/release-mac.sh --no-upload     # 只产出产物，不发 release
#   bash scripts/release-mac.sh --skip-notarize # 不公证（仅签名，Gatekeeper 会拦首次打开）
#   bash scripts/release-mac.sh --skip-qiniu     # 不上传七牛（默认每次都传）
#
# 七牛：产物传 res-7373 的 diting/ 下，key 固定不带版本号
#      （diting/diting-mac-arm64.dmg / .zip），每次发版覆盖同名对象。
#
# 前置条件（缺一不可）：
#   1. 钥匙串里有 "Developer ID Application: Shooter Technology (Zhuhai) Co., Ltd (FY4X5PTS6Q)"
#      且屏幕已解锁（锁屏状态下 codesign 取私钥会报 errSecInternalComponent）
#   2. gh CLI 已登录（hlf2002）
#   3. 公证凭据：APPLE_ID / APPLE_PASSWORD(App 专用密码) / APPLE_TEAM_ID
#      默认从 ~/.config/diting/notarize.env 读（chmod 600，不进仓库）
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

VERSION="$(node -p "require('./package.json').version")"
IDENTITY="${OSX_SIGN_IDENTITY:-Developer ID Application: Shooter Technology (Zhuhai) Co., Ltd (FY4X5PTS6Q)}"
REPO="${REPO:-hlf2002/diting-desktop}"
TAG="${TAG:-v$VERSION}"
APP_NAME="谛听"        # dmg 卷名 / Finder 显示名
APP_BUNDLE="diting"    # .app 文件名与可执行名（ASCII，避免编码坑）
APP_PATH="out/${APP_BUNDLE}-darwin-arm64/${APP_BUNDLE}.app"
SKIP_BUILD=0
UPLOAD=1
NOTARIZE=1
QINIU=1
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --no-upload) UPLOAD=0 ;;
    --skip-notarize) NOTARIZE=0 ;;
    --skip-qiniu) QINIU=0 ;;
    *) echo "未知参数: $arg"; exit 1 ;;
  esac
done

echo "== 版本 $VERSION / tag $TAG / repo $REPO"

# 1) 证书存在性
if ! security find-identity -v -p codesigning 2>/dev/null | grep -qF "$IDENTITY"; then
  echo "FATAL: 钥匙串中找不到签名证书：$IDENTITY"
  exit 1
fi

# 2) 构建（electron-vite build + electron-forge make；dmg 交给本脚本，forge 只出 zip）
if [ "$SKIP_BUILD" = 0 ]; then
  echo "== 构建中（签名身份：$IDENTITY）"
  # 构建阶段的 forge 公证没有意义（本脚本随后会显式重签，旧票失效），一律屏蔽
  env -u APPLE_ID -u APPLE_PASSWORD -u APPLE_TEAM_ID \
    OSX_SIGN_IDENTITY="$IDENTITY" pnpm run build:electron
fi

if [ ! -d "$APP_PATH" ]; then
  echo "FATAL: 找不到 $APP_PATH"
  exit 1
fi

# 2.4) Finder / Dock 显示名：electron-packager 会用 name（diting）覆盖 CFBundleDisplayName，
#      必须在签名前改回中文名，否则用户看到的是 diting
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName ${APP_NAME}" "$APP_PATH/Contents/Info.plist"
echo "== CFBundleDisplayName → ${APP_NAME}"

# 2.5) 显式重签：forge 内部的签名受环境影响可能降级成 ad-hoc，这里统一用 Developer ID 重签一次
echo "== 重签 $APP_PATH"
OSX_SIGN_IDENTITY="$IDENTITY" node scripts/sign-app.mjs "$APP_PATH"

# 3) 签名校验：必须是 Developer ID，不能是 ad-hoc
echo "== 校验签名"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
SIGN_INFO="$(codesign -dv --verbose=4 "$APP_PATH" 2>&1 || true)"
echo "$SIGN_INFO" | grep -E "Authority=|TeamIdentifier=|flags=" | head -5
if ! echo "$SIGN_INFO" | grep -qF "Developer ID Application: Shooter Technology"; then
  echo "FATAL: .app 仍是 ad-hoc 签名（未打上 Developer ID 证书），拒绝发布"
  exit 2
fi

# 3.5) 公证（notarytool）：签名完成后必须做，否则 Gatekeeper 报 source=Unnotarized Developer ID
if [ "$NOTARIZE" = 1 ]; then
  # 凭据优先取已 export 的环境变量，否则读 ~/.config/diting/notarize.env（不进仓库）
  if [ -z "${APPLE_ID:-}" ] || [ -z "${APPLE_PASSWORD:-}" ] || [ -z "${APPLE_TEAM_ID:-}" ]; then
    if [ -f "$HOME/.config/diting/notarize.env" ]; then
      set -a
      source "$HOME/.config/diting/notarize.env"
      set +a
    fi
  fi
  if [ -z "${APPLE_ID:-}" ] || [ -z "${APPLE_PASSWORD:-}" ] || [ -z "${APPLE_TEAM_ID:-}" ]; then
    echo "FATAL: 缺少 APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID，无法公证（急用可加 --skip-notarize）"
    exit 3
  fi

  SUBMIT_ZIP="out/make/.diting-notarize-submit.zip"
  NOTARY_LOG="out/make/.diting-notarize.log"
  rm -f "$SUBMIT_ZIP"
  echo "== 公证：打包待提交 zip（$(du -h "$APP_PATH" | cut -f1) 的 .app）"
  ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$SUBMIT_ZIP"
  # 上传 200MB+ 常见 1-5 分钟；--wait 等 Apple 出结果，日志留在 out/make 便于失败取证
  if ! xcrun notarytool submit "$SUBMIT_ZIP" \
    --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" \
    --wait 2>&1 | tee "$NOTARY_LOG"; then
    echo "FATAL: notarytool 提交失败，日志见 $NOTARY_LOG"
    exit 4
  fi
  rm -f "$SUBMIT_ZIP"
  if ! grep -q "status: Accepted" "$NOTARY_LOG"; then
    echo "FATAL: 公证被拒（status 非 Accepted），日志见 $NOTARY_LOG"
    exit 4
  fi

  # 票贴在 .app 包内，重打包时 ticket 随包分发，离线首启也不再被拦
  echo "== 公证：贴票到 $APP_PATH"
  xcrun stapler staple "$APP_PATH"
  xcrun stapler validate "$APP_PATH"

  echo "== Gatekeeper 实测（必须 accepted / source=Notarized Developer ID）"
  SPCTL_OUT="$(spctl -a -vvv -t exec "$APP_PATH" 2>&1 || true)"
  echo "$SPCTL_OUT"
  if ! echo "$SPCTL_OUT" | grep -q "source=Notarized Developer ID"; then
    echo "FATAL: spctl 未显示 Notarized Developer ID，公证未生效，拒绝发布"
    exit 5
  fi
else
  echo "== 已跳过公证（--skip-notarize）：首次打开会被 Gatekeeper 拦，需右键「打开」"
fi

# 4) zip（ditto 保留符号链接与扩展属性）
mkdir -p out/make
ZIP="out/make/${APP_BUNDLE}-${VERSION}-darwin-arm64.zip"
echo "== 打包 zip → $ZIP"
rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$ZIP"

# 5) dmg（hdiutil；forge 的 MakerDMG 依赖的 macos-alias 在 Node 26 编译不过）
DMG_ROOT="$(mktemp -d)"
trap 'rm -rf "$DMG_ROOT"' EXIT
DMG="out/make/${APP_BUNDLE}-${VERSION}-darwin-arm64.dmg"
echo "== 打包 dmg → $DMG"
ditto "$APP_PATH" "$DMG_ROOT/${APP_BUNDLE}.app"
ln -s /Applications "$DMG_ROOT/Applications"
rm -f "$DMG"
hdiutil create -volname "$APP_NAME" -srcfolder "$DMG_ROOT" -ov -format UDZO "$DMG" >/dev/null

ls -hl "$ZIP" "$DMG"

# 6) 上传 GitHub Release
if [ "$UPLOAD" = 1 ]; then
  echo "== 上传 Release $TAG"
  if ! gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
    gh release create "$TAG" -R "$REPO" \
      --title "谛听 $VERSION (macOS)" \
      --notes "谛听 $VERSION for macOS（Apple Silicon，需 macOS 13+）。
已使用 Developer ID 签名并通过 Apple 公证（notarized），首次打开无需右键放行。"
  fi
  gh release upload "$TAG" "$ZIP" "$DMG" -R "$REPO" --clobber
  gh release view "$TAG" -R "$REPO" --json url,assets -q '.url, (.assets[].name)'
else
  echo "== 已跳过上传（--no-upload）"
fi

# 7) 上传七牛云（固定 key，不带版本号；每次发版覆盖同名对象）
if [ "$QINIU" = 1 ]; then
  QINIU_BUCKET="${QINIU_BUCKET:-res-7373}"
  QINIU_PREFIX="${QINIU_PREFIX:-diting}"
  # 优先用装了 qiniu SDK 的解释器（走分片续传，几百 MB 更稳）；没有则系统 python3（流式表单）
  QINIU_PY="${QINIU_PY:-$HOME/.venvs/qiniu/bin/python}"
  [ -x "$QINIU_PY" ] || QINIU_PY="$(command -v python3)"
  echo "== 上传七牛 $QINIU_BUCKET:${QINIU_PREFIX}/diting-mac-arm64.{dmg,zip}（$QINIU_PY）"
  for pair in "$DMG:diting-mac-arm64.dmg" "$ZIP:diting-mac-arm64.zip"; do
    src="${pair%%:*}"
    key="${QINIU_PREFIX}/${pair##*:}"
    "$QINIU_PY" scripts/upload-qiniu.py "$src" "$key" --bucket "$QINIU_BUCKET"
  done
  echo "== 七牛地址：https://res.7373.com.cn/${QINIU_PREFIX}/diting-mac-arm64.dmg"
else
  echo "== 已跳过七牛上传（--skip-qiniu）"
fi

echo "== 完成"
