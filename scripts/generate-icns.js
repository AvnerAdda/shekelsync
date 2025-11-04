#!/usr/bin/env node
/**
 * Generate .icns file for macOS from PNG
 * This script creates an iconset and converts it to .icns format
 *
 * Requirements: macOS with iconutil command
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PNG_SOURCE = path.join(__dirname, '..', 'build-resources', 'logo.png');
const ICNS_OUTPUT = path.join(__dirname, '..', 'build-resources', 'logo.icns');
const ICONSET_DIR = path.join(__dirname, '..', 'build-resources', 'logo.iconset');

// Check if running on macOS
if (process.platform !== 'darwin') {
  console.log('⚠️  .icns generation is only available on macOS');
  console.log('   The app will use logo.png as fallback on this platform');
  process.exit(0);
}

// Check if iconutil is available
try {
  execSync('which iconutil', { stdio: 'ignore' });
} catch (error) {
  console.error('❌ iconutil command not found. Please ensure you are running on macOS.');
  process.exit(1);
}

// Check if source PNG exists
if (!fs.existsSync(PNG_SOURCE)) {
  console.error(`❌ Source PNG not found: ${PNG_SOURCE}`);
  process.exit(1);
}

try {
  console.log('🎨 Generating macOS .icns file...');

  // Create iconset directory
  if (fs.existsSync(ICONSET_DIR)) {
    fs.rmSync(ICONSET_DIR, { recursive: true });
  }
  fs.mkdirSync(ICONSET_DIR);

  // Required icon sizes for macOS
  const sizes = [
    { size: 16, scale: 1 },
    { size: 16, scale: 2 },
    { size: 32, scale: 1 },
    { size: 32, scale: 2 },
    { size: 128, scale: 1 },
    { size: 128, scale: 2 },
    { size: 256, scale: 1 },
    { size: 256, scale: 2 },
    { size: 512, scale: 1 },
    { size: 512, scale: 2 },
  ];

  // Check if sips command is available (built-in on macOS)
  console.log('📐 Resizing images...');
  sizes.forEach(({ size, scale }) => {
    const actualSize = size * scale;
    const suffix = scale === 2 ? '@2x' : '';
    const filename = `icon_${size}x${size}${suffix}.png`;
    const outputPath = path.join(ICONSET_DIR, filename);

    try {
      execSync(`sips -z ${actualSize} ${actualSize} "${PNG_SOURCE}" --out "${outputPath}"`, {
        stdio: 'ignore'
      });
      console.log(`  ✓ ${filename}`);
    } catch (error) {
      console.error(`  ✗ Failed to create ${filename}`);
      throw error;
    }
  });

  // Convert iconset to icns
  console.log('🔨 Converting to .icns...');
  execSync(`iconutil -c icns "${ICONSET_DIR}" -o "${ICNS_OUTPUT}"`, { stdio: 'inherit' });

  // Clean up iconset directory
  fs.rmSync(ICONSET_DIR, { recursive: true });

  console.log(`✅ Successfully created: ${ICNS_OUTPUT}`);

} catch (error) {
  console.error('❌ Error generating .icns file:', error.message);
  process.exit(1);
}
