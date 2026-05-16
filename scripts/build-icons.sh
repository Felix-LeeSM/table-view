#!/usr/bin/env bash
# Regenerate every platform icon from the layered source in src-tauri/icons-src/.
#
# Layers
#   composite.svg  — full colored artwork (brown gradient + 2 cards),
#                    1024 canvas. The single source for the macOS .icon. We
#                    don't decompose into separate background/midground/
#                    foreground PNG layers because `actool` then treats them
#                    as monochrome silhouettes for Liquid Glass tinting,
#                    bleaching out our brand colors. Single layer + glass:false
#                    in icon.json preserves the colors while still letting
#                    Tahoe apply its squircle mask + subtle lighting.
#   foreground.svg — cards on transparent canvas, used as the Windows ICO
#                    source and the Android `android_fg` adaptive layer.
#   background.svg — brown gradient on full canvas, used as Android `android_bg`.
#
# Per-platform handling
#   macOS  — single-layer .icon → Assets.car (actool), CFBundleIconName=AppIcon.
#            Tahoe auto-applies squircle + Liquid Glass material highlights.
#   Windows — cards-only transparent ICO (no brown background, no squircle).
#   Android — adaptive icon: gradient as android_bg, cards as android_fg.
#   Other  — `tauri icon` default raster set generated from the squircle
#            composite in public/logo-mark.svg.
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
# Composite is the only PNG that ends up inside the .icon package (Liquid Glass).
# The other two are auxiliary rasters used downstream by tauri-icon (Android
# adaptive layers + Windows ICO source); they live in a tmp dir to avoid
# leaving stale build artifacts in the tracked tree.
RASTER_DIR="$(mktemp -d)"
trap 'rm -rf "$RASTER_DIR"' EXIT
rsvg-convert -w 1024 -h 1024 "$SRC/composite.svg"  -o "$ICON_PKG/Assets/composite.png"
rsvg-convert -w 1024 -h 1024 "$SRC/background.svg" -o "$RASTER_DIR/background.png"
rsvg-convert -w 1024 -h 1024 "$SRC/foreground.svg" -o "$RASTER_DIR/foreground.png"

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
# Default raster (icon.icns / icon.png / iOS) generated from public/logo-mark.svg
# (the squircle composite used in the React UI too); Android adaptive layers come
# from the rasterized backg / foreground in the tmp dir above.
cat > "$RASTER_DIR/manifest.json" <<EOF
{
  "default": "$ROOT/public/logo-mark.svg",
  "android_bg": "$RASTER_DIR/background.png",
  "android_fg": "$RASTER_DIR/foreground.png",
  "android_fg_scale": 80,
  "bg_color": "#5b1f0b"
}
EOF
cd "$ROOT/src-tauri"
npx --no-install @tauri-apps/cli icon "$RASTER_DIR/manifest.json" --output "$ICONS"
cd "$ROOT"

echo "==> overwriting Windows .ico with cards-only transparent version"
# foreground.png is cards on transparent background — exactly what we want for
# Windows taskbar/start-menu icons. Multi-resolution ICO (16/32/48/64/128/256).
magick "$RASTER_DIR/foreground.png" \
  -define icon:auto-resize=256,128,64,48,32,16 \
  "$ICONS/icon.ico"

echo "==> updating root logo.png from default raster"
cp "$ICONS/icon.png" "$ROOT/logo.png"

echo "==> done"
echo "    Liquid Glass : $COMPILED/{Assets.car,AppIcon.icns}"
echo "    Windows ICO  : $ICONS/icon.ico"
echo "    Android adp. : $ICONS/android/mipmap-*/ic_launcher{,_foreground,_round}.png"
