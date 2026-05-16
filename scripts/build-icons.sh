#!/usr/bin/env bash
# Regenerate every platform icon from the layered source in src-tauri/icons-src/.
#
# Layers
#   background.svg — brown gradient (no inset, fills canvas)
#   midground.svg  — back card, semi-transparent (inset to 824/1024 safe-area)
#   foreground.svg — front card + text lines (inset to 824/1024)
#
# Per-platform handling
#   macOS  — Liquid Glass via .icon → Assets.car (actool), CFBundleIconName=AppIcon
#   Windows — cards-only transparent ICO (no brown background, no squircle)
#   Android — adaptive icon: brown gradient as android_bg, cards as android_fg
#   Other  — `tauri icon` default raster set (PNG/iOS) generated from the
#            squircle composite in public/logo-mark.svg
#
# Required tools
#   rsvg-convert  (brew install librsvg)
#   magick        (brew install imagemagick)
#   actool        (full Xcode; `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`)
#   pnpm tauri    (project deps)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/src-tauri/icons-src"
ICON_PKG="$ROOT/src-tauri/AppIcon.icon"
COMPILED="$ROOT/src-tauri/icons/Compiled"
ICONS="$ROOT/src-tauri/icons"

command -v rsvg-convert >/dev/null || { echo "rsvg-convert missing — brew install librsvg" >&2; exit 1; }
command -v magick       >/dev/null || { echo "magick missing — brew install imagemagick"  >&2; exit 1; }
command -v actool       >/dev/null || { echo "actool missing — full Xcode + xcode-select" >&2; exit 1; }

echo "==> rasterizing layers"
mkdir -p "$ICON_PKG/Assets"
rsvg-convert -w 1024 -h 1024 "$SRC/background.svg" -o "$ICON_PKG/Assets/background.png"
rsvg-convert -w 1024 -h 1024 "$SRC/midground.svg"  -o "$ICON_PKG/Assets/midground.png"
rsvg-convert -w 1024 -h 1024 "$SRC/foreground.svg" -o "$ICON_PKG/Assets/foreground.png"

echo "==> compiling .icon (Liquid Glass)"
mkdir -p "$COMPILED"
actool "$ICON_PKG" \
  --compile "$COMPILED" \
  --output-format human-readable-text --notices --warnings --errors \
  --output-partial-info-plist "$COMPILED/partial-info.plist" \
  --app-icon AppIcon --include-all-app-icons \
  --enable-on-demand-resources NO \
  --development-region en \
  --target-device mac \
  --minimum-deployment-target 26.0 \
  --platform macosx

echo "==> generating default raster set via tauri icon (manifest = adaptive Android)"
# Manifest is written to a tmp dir so we don't pollute the source tree. The
# default raster (icon.icns / icon.png / iOS) is generated from the squircle
# composite in public/logo-mark.svg; Android adaptive layers come straight from
# the rasterized 1024 PNGs in AppIcon.icon/Assets/.
MANIFEST_DIR="$(mktemp -d)"
trap 'rm -rf "$MANIFEST_DIR"' EXIT
cat > "$MANIFEST_DIR/manifest.json" <<EOF
{
  "default": "$ROOT/public/logo-mark.svg",
  "android_bg": "$ICON_PKG/Assets/background.png",
  "android_fg": "$ICON_PKG/Assets/foreground.png",
  "android_fg_scale": 80,
  "bg_color": "#5b1f0b"
}
EOF
cd "$ROOT/src-tauri"
npx --no-install @tauri-apps/cli icon "$MANIFEST_DIR/manifest.json" --output "$ICONS"
cd "$ROOT"

echo "==> overwriting Windows .ico with cards-only transparent version"
# foreground.png is cards on transparent background — exactly what we want for
# Windows taskbar/start-menu icons. Multi-resolution ICO (16/32/48/64/128/256).
magick "$ICON_PKG/Assets/foreground.png" \
  -define icon:auto-resize=256,128,64,48,32,16 \
  "$ICONS/icon.ico"

echo "==> updating root logo.png from default raster"
cp "$ICONS/icon.png" "$ROOT/logo.png"

echo "==> done"
echo "    Liquid Glass : $COMPILED/{Assets.car,AppIcon.icns}"
echo "    Windows ICO  : $ICONS/icon.ico"
echo "    Android adp. : $ICONS/android/mipmap-*/ic_launcher{,_foreground,_round}.png"
