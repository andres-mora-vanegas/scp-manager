# SCP Manager

An Electron-based SCP/SFTP file manager alternative to WinSCP.

## Features

- 🔐 Secure SCP/SFTP connections
- 📁 File browser with directory navigation
- ✏️ Edit files with your preferred editor
- 💾 Save and manage multiple connections
- 🔑 Support for password and public key authentication
- 🔄 Auto-sync file changes
- 🌙 Dark mode support
- 📤 Export/Import connections (encrypted)
- ⚙️ Customizable editor selection
- 🔒 Sudo support for elevated file operations
- 🔗 Symbolic link support

## Installation

### From Source

1. Clone the repository:
```bash
git clone <repository-url>
cd scp-manager
```

2. Install dependencies:
```bash
npm install
```

3. Build CSS:
```bash
npm run build:css
```

4. Run the application:
```bash
npm start
```

## Development

### Prerequisites
- Node.js (v16 or higher)
- npm

### Development Mode
```bash
npm run dev
```

### Watch SCSS Changes
```bash
npm run watch:css
```

### Code Quality
```bash
# Format code
npm run format

# Check formatting
npm run format:check

# Lint code
npm run lint

# Fix linting issues
npm run lint:fix
```

## Building

See [BUILD.md](./BUILD.md) for detailed build instructions.

### Quick Build
```bash
# Build for current platform
npm run build

# Build for specific platform
npm run build:linux   # Linux
npm run build:win     # Windows
npm run build:mac     # macOS
```

## Usage

1. **Create a Connection**
   - Fill in host, port, username
   - Choose authentication method (password or public key)
   - Optionally set a connection name
   - Check "Save connection" to persist it

2. **Connect**
   - Click "Connect" button
   - Browse files and directories

3. **Edit Files**
   - Double-click a file or right-click → "Edit File"
   - File opens in your configured editor
   - Changes auto-sync to server

4. **Manage Connections**
   - View saved connections in the sidebar
   - Click to load a connection
   - Export/Import connections using the sidebar buttons

5. **Settings**
   - Click the ⚙️ icon in the header
   - Configure your preferred editor
   - Toggle dark mode with 🌙/☀️ icon

## Project Structure

```
scp-manager/
├── main.js              # Electron main process
├── renderer.js          # UI logic and IPC handlers
├── ssh-connection.js    # SSH/SFTP connection logic
├── database.js          # SQLite database operations
├── styles.scss          # SCSS styles (source)
├── styles.css           # Compiled CSS
├── index.html           # UI markup
└── package.json         # Dependencies and scripts
```

## Technologies

- **Electron** - Desktop application framework
- **ssh2** - SSH/SFTP client library
- **sql.js** - SQLite database (pure JavaScript)
- **SCSS** - CSS preprocessor
- **Prettier** - Code formatter
- **ESLint** - Code linter

## License

MIT

