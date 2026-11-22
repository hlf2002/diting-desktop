#!/usr/bin/env bash
# 谛听 macOS 发布脚本：构建 → 签名校验 → zip → dmg → GitHub Release
#
# 用法：
#   bash scripts/release-mac.sh                 # 全量构建 + 签名 + 打包 + 上传
#   bash scripts/release-mac.sh --skip-build    # 复用 out/ 下已有 .app，只打包上传
#   bash scripts/release-mac.sh --no-upload     # 只产出产物，不发 release
#
# 前置条件（缺一不可）：
#   1. 钥匙串里有 "Developer ID Application: Shooter Technology (Zhuhai) Co., Ltd (FY4X5PTS6Q)"
#      且屏幕已解锁（锁屏状态下 codesign 取私钥会报 errSecInternalComponent）
#   2. gh CLI 已登录（hlf2002）
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
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --no-upload) UPLOAD=0 ;;
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
已使用 Developer ID 签名；如需通过 Gatekeeper，首次打开请在 Finder 中右键「打开」。"
  fi
  gh release upload "$TAG" "$ZIP" "$DMG" -R "$REPO" --clobber
  gh release view "$TAG" -R "$REPO" --json url,assets -q '.url, (.assets[].name)'
else
  echo "== 已跳过上传（--no-upload）"
fi

echo "== 完成"
