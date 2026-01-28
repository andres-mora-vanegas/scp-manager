# Build Instructions

## Prerequisites

1. **Node.js** (v16 or higher recommended)
2. **npm** (comes with Node.js)

## Installation

1. Install dependencies:
```bash
npm install
```

## Development

### Run in Development Mode
```bash
npm run dev
```

### Watch SCSS Changes
```bash
npm run watch:css
```

## Building the Application

### Build for Current Platform
```bash
npm run build
```

### Build for Specific Platforms

**Linux:**
```bash
npm run build:linux
```

**Windows:**
```bash
npm run build:win
```

**macOS:**
```bash
npm run build:mac
```

### Distribution Build (No Publishing)
```bash
npm run dist
```

## Build Output

After building, the distributable files will be in the `dist/` directory:

- **Linux**: `.AppImage` and `.deb` files
- **Windows**: `.exe` installer (NSIS)
- **macOS**: `.dmg` file

## Code Quality

### Format Code
```bash
npm run format
```

### Check Formatting
```bash
npm run format:check
```

### Lint Code
```bash
npm run lint
```

### Fix Linting Issues
```bash
npm run lint:fix
```

## Next Steps After Building

1. **Test the Application**
   - Run the built application from the `dist/` directory
   - Test all features: connections, file editing, import/export, etc.

2. **Distribution**
   - Share the built files from `dist/` directory
   - For Linux: Share the `.AppImage` (portable) or `.deb` (for Debian/Ubuntu)
   - For Windows: Share the `.exe` installer
   - For macOS: Share the `.dmg` file

3. **Optional: Create Application Icon**
   - Add icon files to `assets/` directory:
     - `icon.png` (512x512) for Linux
     - `icon.ico` (256x256) for Windows
     - `icon.icns` (512x512) for macOS
   - Update `main.js` if using different icon paths

4. **Optional: Code Signing** (for distribution)
   - Configure code signing in `package.json` build config
   - Required for macOS notarization and Windows SmartScreen

5. **Version Management**
   - Update version in `package.json` before each release
   - Consider using semantic versioning (e.g., 1.0.1, 1.1.0)

## Troubleshooting

### Build Fails
- Ensure all dependencies are installed: `npm install`
- Check that SCSS compiles: `npm run build:css`
- Verify Node.js version compatibility

### Application Doesn't Start
- Check console for errors
- Verify all required files are included in build
- Ensure database initialization works correctly

### Missing Native Modules
- Some modules may need to be rebuilt for the target platform
- Check electron-builder documentation for native module handling

