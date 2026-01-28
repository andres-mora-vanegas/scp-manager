# Quick Start Guide

## 🚀 Building the Application

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Build CSS
```bash
npm run build:css
```

### Step 3: Build the Application

**For Linux (current platform):**
```bash
npm run build:linux
```

**For Windows:**
```bash
npm run build:win
```

**For macOS:**
```bash
npm run build:mac
```

**For current platform:**
```bash
npm run build
```

## 📦 Build Output

After building, find your distributable files in the `dist/` directory:

- **Linux**: `SCP Manager-1.0.0.AppImage` and `scp-manager_1.0.0_amd64.deb`
- **Windows**: `SCP Manager Setup 1.0.0.exe`
- **macOS**: `SCP Manager-1.0.0.dmg`

## 🎯 Next Steps

### 1. Test the Build
```bash
# Run the built application
./dist/SCP\ Manager-1.0.0.AppImage  # Linux AppImage
# OR
dpkg -i dist/scp-manager_1.0.0_amd64.deb  # Linux .deb
```

### 2. Distribution Options

**Option A: Share AppImage (Linux - Portable)**
- The `.AppImage` file is portable and doesn't require installation
- Users can run it directly: `chmod +x SCP\ Manager-1.0.0.AppImage && ./SCP\ Manager-1.0.0.AppImage`

**Option B: Share Installer**
- `.deb` for Debian/Ubuntu Linux
- `.exe` for Windows
- `.dmg` for macOS

### 3. Optional: Add Application Icon

Create an `assets/` directory and add:
- `icon.png` (512x512) - for Linux
- `icon.ico` (256x256) - for Windows  
- `icon.icns` (512x512) - for macOS

### 4. Version Management

Before each release, update the version in `package.json`:
```json
"version": "1.0.1"  // Increment as needed
```

## 🔧 Development Commands

```bash
# Run in development mode
npm run dev

# Watch SCSS changes
npm run watch:css

# Format code
npm run format

# Lint code
npm run lint
```

## 📝 Notes

- The build process automatically compiles SCSS before building
- All source files are included except development-only files
- Database files are stored in the user's app data directory
- Preferences (editor settings, dark mode) are saved locally

