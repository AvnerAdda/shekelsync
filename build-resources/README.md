# Build Resources for ShekelSync Electron App

This directory contains assets needed for building the Electron application.

## Application Icons

### Available Files
- ✅ `icon.svg` - Source SVG logo (shekel symbol with green branding)
- ✅ `logo.png` - High-resolution PNG (used for Linux/fallback)
- ✅ `logo.ico` - Multi-size Windows icon (16x16 to 256x256)
- ⚠️ `logo.icns` - macOS icon bundle (generate on macOS with `npm run icons:icns`)

### Platform Usage
- **Windows**: Uses `logo.ico`
- **macOS**: Uses `logo.icns` (falls back to `logo.png` if not available)
- **Linux**: Uses `logo.png`

## Generating macOS Icons

The `.icns` file must be generated on macOS:

```bash
npm run icons:icns
```

This script:
1. Creates an iconset with all required sizes (16x16 to 1024x1024)
2. Converts the iconset to `.icns` format using macOS `iconutil`
3. Places the result in this directory

**Note**: On non-macOS systems, the app will automatically use `logo.png` as a fallback.

## Icon Design

The current icon features:
- Shekel symbol (₪) in white
- Green circular background (#2E7D32)
- "ShekelSync" text
- Sync arrows motif
- Professional, recognizable at all sizes

## Updating Icons

To update the application icon:
1. Edit `icon.svg` with your preferred SVG editor
2. Generate PNG: `inkscape icon.svg --export-filename=logo.png --export-width=1024`
3. Generate ICO: Use online converter or ImageMagick
4. Generate ICNS on macOS: `npm run icons:icns`

## Build Configuration

Icons are referenced in:
- `electron/main.js` - Runtime window icon
- `app/package.json` - electron-builder configuration