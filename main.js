const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { getDatabase } = require('./database');
const fs = require('fs');
const os = require('os');
const { spawn, execSync } = require('child_process');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, 'assets', 'icon.png'), // Optional icon
    titleBarStyle: 'default',
    show: false,
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handler for file dialog
ipcMain.handle('show-open-dialog', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

// IPC handlers for database operations
ipcMain.handle('db-save-connection', async (event, connectionData) => {
  try {
    const db = await getDatabase();
    const id = await db.saveConnection(connectionData);
    return { success: true, id };
  } catch (error) {
    console.error('Error saving connection:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('db-get-all-connections', async event => {
  try {
    const db = await getDatabase();
    const connections = await db.getAllConnections();
    // Remove encrypted passwords from list
    return connections.map(conn => ({
      ...conn,
      password_encrypted: undefined,
    }));
  } catch (error) {
    console.error('Error getting connections:', error);
    return [];
  }
});

ipcMain.handle('db-get-connection', async (event, id) => {
  try {
    const db = await getDatabase();
    const connection = await db.getConnection(id);
    return connection;
  } catch (error) {
    console.error('Error getting connection:', error);
    return null;
  }
});

ipcMain.handle('db-delete-connection', async (event, id) => {
  try {
    const db = await getDatabase();
    await db.deleteConnection(id);
    return { success: true };
  } catch (error) {
    console.error('Error deleting connection:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('db-update-connection', async (event, id, connectionData) => {
  try {
    const db = await getDatabase();
    await db.updateConnection(id, connectionData);
    return { success: true };
  } catch (error) {
    console.error('Error updating connection:', error);
    return { success: false, error: error.message };
  }
});

// Get available editors on the system
function getAvailableEditors() {
  const editors = [];
  const commonEditors = [
    { name: 'VS Code', command: 'code', args: ['--wait'] },
    { name: 'Sublime Text', command: 'subl', args: [] },
    { name: 'Atom', command: 'atom', args: [] },
    { name: 'Gedit', command: 'gedit', args: [] },
    { name: 'Nano', command: 'nano', args: [] },
    { name: 'Vim', command: 'vim', args: [] },
    { name: 'Emacs', command: 'emacs', args: [] },
    { name: 'Kate', command: 'kate', args: [] },
    { name: 'Notepad++', command: 'notepad++', args: [] },
    { name: 'Geany', command: 'geany', args: [] },
  ];

  for (const editor of commonEditors) {
    try {
      if (os.platform() === 'win32') {
        // On Windows, try to find in common locations or use where
        execSync(`where ${editor.command}`, { stdio: 'ignore' });
        editors.push(editor);
      } else {
        // On Linux/Mac, use which
        execSync(`which ${editor.command}`, { stdio: 'ignore' });
        editors.push(editor);
      }
    } catch (e) {
      // Editor not found, skip
    }
  }

  return editors;
}

// IPC handler for getting available editors
ipcMain.handle('get-available-editors', async event => {
  try {
    const editors = getAvailableEditors();
    // Also add OS default as an option
    editors.unshift({ name: 'OS Default', command: 'default', args: [] });
    return { success: true, editors };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// IPC handler for opening file in editor
ipcMain.handle('open-file-in-editor', async (event, filePath, editorCommand = null) => {
  try {
    // Use provided editor command or get from preferences
    let editorToUse = editorCommand;

    if (!editorToUse) {
      try {
        const prefsPath = path.join(app.getPath('userData'), 'preferences.json');
        if (fs.existsSync(prefsPath)) {
          const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
          editorToUse = prefs.editor;
        }
      } catch (e) {
        // Use default
      }
    }

    if (!editorToUse || editorToUse === 'default') {
      // Use OS default
      await shell.openPath(filePath);
      return { success: true };
    }

    // Parse editor command (format: "command:arg1:arg2" or just "command")
    const parts = editorToUse.split(':');
    const command = parts[0];
    const args = parts.slice(1).filter(arg => arg); // Filter empty args
    args.push(filePath);

    // Launch editor
    const editorProcess = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
    });

    editorProcess.unref();
    return { success: true };
  } catch (error) {
    // Fallback to OS default on error
    try {
      await shell.openPath(filePath);
      return { success: true };
    } catch (fallbackError) {
      return { success: false, error: error.message };
    }
  }
});

// IPC handler for saving editor preference
ipcMain.handle('save-editor-preference', async (event, editorCommand) => {
  try {
    const prefsPath = path.join(app.getPath('userData'), 'preferences.json');
    let prefs = {};

    if (fs.existsSync(prefsPath)) {
      prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
    }

    prefs.editor = editorCommand;
    fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2), 'utf8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// IPC handler for getting editor preference
ipcMain.handle('get-editor-preference', async event => {
  try {
    const prefsPath = path.join(app.getPath('userData'), 'preferences.json');
    if (fs.existsSync(prefsPath)) {
      const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
      const editor = prefs.editor || 'default';
      return { success: true, editor: editor };
    }
    return { success: true, editor: 'default' };
  } catch (error) {
    return { success: true, editor: 'default' };
  }
});

// IPC handler for getting temp directory
ipcMain.handle('get-temp-dir', async event => {
  return os.tmpdir();
});

// IPC handler for exporting connections
ipcMain.handle('export-connections', async event => {
  try {
    const db = await getDatabase();
    const iniContent = await db.exportConnections();

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Connections',
      defaultPath: 'scp-connections.ini',
      filters: [
        { name: 'INI Files', extensions: ['ini'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, iniContent, 'utf8');
      return { success: true, filePath: result.filePath };
    }

    return { success: false, canceled: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// IPC handler for importing connections
ipcMain.handle('import-connections', async event => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Connections',
      filters: [
        { name: 'INI Files', extensions: ['ini'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const filePath = result.filePaths[0];
    const iniContent = fs.readFileSync(filePath, 'utf8');

    const db = await getDatabase();
    const imported = await db.importConnections(iniContent);

    return { success: true, imported, count: imported.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
