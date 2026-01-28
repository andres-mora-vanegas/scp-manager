const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const SSHConnection = require('./ssh-connection');

// Global connection instance
let sshConnection = null;
let currentPath = '/';
// Multiple file editing support
let editingFiles = new Map(); // Map<remotePath, {localPath, filename, watcher}>

// DOM Elements - Connection Form
const connectionForm = document.getElementById('connectionForm');
const connectionView = document.getElementById('connectionView');
const authMethodRadios = document.querySelectorAll('input[name="authMethod"]');
const passwordSection = document.getElementById('passwordSection');
const keyfileSection = document.getElementById('keyfileSection');
const passwordInput = document.getElementById('password');
const togglePasswordBtn = document.getElementById('togglePassword');
const browseKeyfileBtn = document.getElementById('browseKeyfile');
const keyfileInput = document.getElementById('keyfile');
const cancelBtn = document.getElementById('cancelBtn');
const connectBtn = document.getElementById('connectBtn');

// DOM Elements - File Browser
const fileBrowserView = document.getElementById('fileBrowserView');
const connectionTitle = document.getElementById('connectionTitle');
const statusText = document.getElementById('statusText');
const disconnectBtn = document.getElementById('disconnectBtn');
const homeBtn = document.getElementById('homeBtn');
const upBtn = document.getElementById('upBtn');
const refreshBtn = document.getElementById('refreshBtn');
const currentPathDisplay = document.getElementById('currentPath');
const fileList = document.getElementById('fileList');
const fileCount = document.getElementById('fileCount');
const editingStatus = document.getElementById('editingStatus');
const editingFilesList = document.getElementById('editingFilesList');
const contextMenu = document.getElementById('contextMenu');
const editFileOption = document.getElementById('editFileOption');
const downloadFileOption = document.getElementById('downloadFileOption');
const savedConnectionsList = document.getElementById('savedConnectionsList');
const saveConnectionCheckbox = document.getElementById('saveConnection');
const refreshConnectionsBtn = document.getElementById('refreshConnectionsBtn');
const exportConnectionsBtn = document.getElementById('exportConnectionsBtn');
const importConnectionsBtn = document.getElementById('importConnectionsBtn');
const formTitle = document.getElementById('formTitle');

// Track currently loaded connection for editing
let currentEditingConnectionId = null;
const useSudoCheckbox = document.getElementById('useSudo');
const sudoSection = document.getElementById('sudoSection');
const sudoPasswordInput = document.getElementById('sudoPassword');
const toggleSudoPasswordBtn = document.getElementById('toggleSudoPassword');

// Handle authentication method change
authMethodRadios.forEach(radio => {
  radio.addEventListener('change', e => {
    if (e.target.value === 'password') {
      passwordSection.style.display = 'block';
      keyfileSection.style.display = 'none';
      passwordInput.required = true;
      keyfileInput.required = false;
    } else {
      passwordSection.style.display = 'none';
      keyfileSection.style.display = 'block';
      passwordInput.required = false;
      keyfileInput.required = true;
    }
  });
});

// Toggle password visibility
let passwordVisible = false;
togglePasswordBtn.addEventListener('click', () => {
  passwordVisible = !passwordVisible;
  passwordInput.type = passwordVisible ? 'text' : 'password';
  togglePasswordBtn.querySelector('.eye-icon').textContent = passwordVisible ? '🙈' : '👁️';
});

// Toggle sudo password visibility
let sudoPasswordVisible = false;
toggleSudoPasswordBtn.addEventListener('click', () => {
  sudoPasswordVisible = !sudoPasswordVisible;
  sudoPasswordInput.type = sudoPasswordVisible ? 'text' : 'password';
  toggleSudoPasswordBtn.querySelector('.eye-icon').textContent = sudoPasswordVisible ? '🙈' : '👁️';
});

// Handle sudo checkbox
useSudoCheckbox.addEventListener('change', e => {
  if (e.target.checked) {
    sudoSection.style.display = 'block';
  } else {
    sudoSection.style.display = 'none';
    sudoPasswordInput.value = '';
  }
});

// Custom Select Dropdown Functionality
const connectionTypeSelect = document.getElementById('connectionTypeSelect');
const connectionTypeOptions = document.getElementById('connectionTypeOptions');
const connectionTypeHidden = document.getElementById('connectionType');
const connectionTypeTrigger = connectionTypeSelect?.querySelector('.custom-select-trigger');
const connectionTypeValue = connectionTypeSelect?.querySelector('.custom-select-value');

if (connectionTypeSelect && connectionTypeTrigger) {
  // Toggle dropdown
  connectionTypeTrigger.addEventListener('click', e => {
    e.stopPropagation();
    connectionTypeSelect.classList.toggle('open');
  });

  // Handle option selection
  if (connectionTypeOptions) {
    connectionTypeOptions.querySelectorAll('.custom-select-option').forEach(option => {
      option.addEventListener('click', e => {
        e.stopPropagation();
        const value = option.getAttribute('data-value');
        const text = option.textContent;

        // Update hidden input
        connectionTypeHidden.value = value;

        // Trigger change event for form handling
        connectionTypeHidden.dispatchEvent(new Event('change', { bubbles: true }));

        // Update display
        if (connectionTypeValue) {
          connectionTypeValue.textContent = text;
          connectionTypeValue.setAttribute('data-value', value);
        }

        // Update selected state
        connectionTypeOptions.querySelectorAll('.custom-select-option').forEach(opt => {
          opt.classList.remove('selected');
        });
        option.classList.add('selected');

        // Set default port
        const portInput = document.getElementById('port');
        if (portInput && (value === 'scp' || value === 'sftp')) {
          portInput.value = '22';
        }

        // Close dropdown
        connectionTypeSelect.classList.remove('open');
      });
    });
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', e => {
    if (!connectionTypeSelect.contains(e.target)) {
      connectionTypeSelect.classList.remove('open');
    }
  });

  // Initialize selected option
  if (connectionTypeOptions) {
    const defaultOption = connectionTypeOptions.querySelector('[data-value="scp"]');
    if (defaultOption) {
      defaultOption.classList.add('selected');
    }
  }
}

// Browse for key file
browseKeyfileBtn.addEventListener('click', async () => {
  try {
    const result = await ipcRenderer.invoke('show-open-dialog', {
      title: 'Select Private Key File',
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'Private Key Files', extensions: ['pem', 'key', 'rsa', 'id_rsa'] },
      ],
      properties: ['openFile'],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      keyfileInput.value = filePath;

      // Validate that the file exists
      if (!fs.existsSync(filePath)) {
        alert('Selected file does not exist!');
        keyfileInput.value = '';
      }
    }
  } catch (error) {
    console.error('Error selecting key file:', error);
    alert('Error selecting key file: ' + error.message);
  }
});

// Load saved connections on page load
async function loadSavedConnections() {
  try {
    const connections = await ipcRenderer.invoke('db-get-all-connections');
    renderSavedConnections(connections || []);
  } catch (error) {
    console.error('Error loading saved connections:', error);
    renderSavedConnections([]);
  }
}

function renderSavedConnections(connections) {
  if (!connections || connections.length === 0) {
    savedConnectionsList.innerHTML = `
            <div class="empty-connections-message">
                <p>No saved connections</p>
                <small>Create a new connection to get started</small>
            </div>
        `;
    return;
  }

  savedConnectionsList.innerHTML = connections
    .map(
      conn => `
        <div class="saved-connection-item" data-id="${conn.id}">
            <div class="saved-connection-info" onclick="loadSavedConnection(${conn.id})">
                <div class="saved-connection-icon">🔌</div>
                <div class="saved-connection-content">
                    <div class="saved-connection-name">${escapeHtml(conn.name || `${conn.username}@${conn.host}`)}</div>
                    <div class="saved-connection-details">${escapeHtml(conn.host)}:${conn.port}</div>
                </div>
            </div>
            <div class="saved-connection-actions">
                <button class="btn-icon btn-sm" onclick="event.stopPropagation(); loadSavedConnection(${conn.id})" title="Load">
                    <span>📂</span>
                </button>
                <button class="btn-icon btn-sm" onclick="event.stopPropagation(); deleteSavedConnection(${conn.id})" title="Delete">
                    <span>🗑️</span>
                </button>
            </div>
        </div>
    `
    )
    .join('');
}

// Refresh connections button
if (refreshConnectionsBtn) {
  refreshConnectionsBtn.addEventListener('click', async () => {
    await loadSavedConnections();
  });
}

// Export connections
if (exportConnectionsBtn) {
  exportConnectionsBtn.addEventListener('click', async () => {
    try {
      const result = await ipcRenderer.invoke('export-connections');
      if (result.success && !result.canceled) {
        alert(`Connections exported successfully to:\n${result.filePath}`);
      } else if (result.canceled) {
        // User canceled, do nothing
      } else {
        alert('Error exporting connections: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      alert('Error exporting connections: ' + error.message);
    }
  });
}

// Import connections
if (importConnectionsBtn) {
  importConnectionsBtn.addEventListener('click', async () => {
    try {
      const confirmImport = confirm(
        'This will import connections from the selected file. Continue?'
      );
      if (!confirmImport) return;

      const result = await ipcRenderer.invoke('import-connections');
      if (result.success && !result.canceled) {
        await loadSavedConnections();
        alert(`Successfully imported ${result.count} connection(s).`);
      } else if (result.canceled) {
        // User canceled, do nothing
      } else {
        alert('Error importing connections: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      alert('Error importing connections: ' + error.message);
    }
  });
}

// Make functions available globally for onclick handlers
window.loadSavedConnection = async function (id) {
  try {
    const connection = await ipcRenderer.invoke('db-get-connection', id);
    if (connection) {
      // Store the connection ID for updating
      currentEditingConnectionId = id;

      // Update form title
      if (formTitle) {
        formTitle.textContent = connection.name || 'Edit Connection';
      }

      // Update button text
      if (connectBtn) {
        connectBtn.textContent = 'Update & Connect';
      }

      // Ensure save checkbox is checked when editing
      if (saveConnectionCheckbox) {
        saveConnectionCheckbox.checked = true;
      }

      // Populate form
      const connectionType = connection.connection_type || 'scp';
      const connectionTypeHidden = document.getElementById('connectionType');
      const connectionTypeSelect = document.getElementById('connectionTypeSelect');
      const connectionTypeValue = connectionTypeSelect?.querySelector('.custom-select-value');
      const connectionTypeOptions = document.getElementById('connectionTypeOptions');

      if (connectionTypeHidden) {
        connectionTypeHidden.value = connectionType;
      }

      // Update custom select display
      if (connectionTypeValue && connectionTypeOptions) {
        const option = connectionTypeOptions.querySelector(`[data-value="${connectionType}"]`);
        if (option) {
          connectionTypeValue.textContent = option.textContent;
          connectionTypeValue.setAttribute('data-value', connectionType);

          // Update selected state
          connectionTypeOptions.querySelectorAll('.custom-select-option').forEach(opt => {
            opt.classList.remove('selected');
          });
          option.classList.add('selected');
        }
      }
      document.getElementById('host').value = connection.host;
      document.getElementById('port').value = connection.port || 22;
      document.getElementById('username').value = connection.username;
      document.getElementById('connectionName').value = connection.name || '';

      if (connection.auth_method === 'password') {
        document.getElementById('authPassword').checked = true;
        passwordSection.style.display = 'block';
        keyfileSection.style.display = 'none';
        passwordInput.value = connection.password || '';
        passwordInput.required = true;
        keyfileInput.required = false;
      } else {
        document.getElementById('authKeyfile').checked = true;
        passwordSection.style.display = 'none';
        keyfileSection.style.display = 'block';
        keyfileInput.value = connection.keyfile_path || '';
        passwordInput.required = false;
        keyfileInput.required = true;

        if (connection.keyfile_path && fs.existsSync(connection.keyfile_path)) {
          try {
            const privateKey = fs.readFileSync(connection.keyfile_path, 'utf8');
            // Store for later use
            keyfileInput.dataset.privateKey = privateKey;
          } catch (error) {
            console.error('Error reading key file:', error);
          }
        }
      }

      // Load sudo settings
      if (connection.useSudo) {
        useSudoCheckbox.checked = true;
        sudoSection.style.display = 'block';
        sudoPasswordInput.value = connection.sudoPassword || '';
      } else {
        useSudoCheckbox.checked = false;
        sudoSection.style.display = 'none';
        sudoPasswordInput.value = '';
      }

      // Highlight selected connection in sidebar
      document.querySelectorAll('.saved-connection-item').forEach(item => {
        item.classList.remove('selected');
      });
      const selectedItem = document.querySelector(`.saved-connection-item[data-id="${id}"]`);
      if (selectedItem) {
        selectedItem.classList.add('selected');
      }
    }
  } catch (error) {
    console.error('Error loading connection:', error);
    alert('Error loading saved connection: ' + error.message);
  }
};

window.deleteSavedConnection = async function (id) {
  if (confirm('Are you sure you want to delete this saved connection?')) {
    try {
      await ipcRenderer.invoke('db-delete-connection', id);
      await loadSavedConnections();
      // Clear form if deleted connection was selected
      if (currentEditingConnectionId === id) {
        currentEditingConnectionId = null;
        if (formTitle) {
          formTitle.textContent = 'New Connection';
        }
        if (connectBtn) {
          connectBtn.textContent = 'Connect';
        }
        connectionForm.reset();
      }
    } catch (error) {
      console.error('Error deleting connection:', error);
      alert('Error deleting connection: ' + error.message);
    }
  }
};

// Handle form submission
connectionForm.addEventListener('submit', async e => {
  e.preventDefault();

  const formData = {
    connectionType: document.getElementById('connectionType').value,
    host: document.getElementById('host').value.trim(),
    port: parseInt(document.getElementById('port').value) || 22,
    username: document.getElementById('username').value.trim(),
    authMethod: document.querySelector('input[name="authMethod"]:checked').value,
    connectionName: document.getElementById('connectionName').value.trim() || null,
    useSudo: useSudoCheckbox.checked,
    sudoPassword: useSudoCheckbox.checked ? sudoPasswordInput.value || null : null,
  };

  // Add authentication data based on method
  if (formData.authMethod === 'password') {
    formData.password = passwordInput.value;
    if (!formData.password) {
      alert('Please enter a password');
      return;
    }
  } else {
    const keyfilePath = keyfileInput.value.trim();
    if (!keyfilePath) {
      alert('Please select a private key file');
      return;
    }

    if (!fs.existsSync(keyfilePath)) {
      alert('Selected key file does not exist!');
      return;
    }

    formData.keyfile = keyfilePath;

    // Try to read the private key
    try {
      formData.privateKey = keyfileInput.dataset.privateKey || fs.readFileSync(keyfilePath, 'utf8');
    } catch (error) {
      alert('Error reading key file: ' + error.message);
      return;
    }
  }

  // Validate connection data
  if (!formData.host || !formData.username) {
    alert('Please fill in all required fields');
    return;
  }

  // Disable connect button and show loading state
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting...';

  try {
    // Create SSH connection
    sshConnection = new SSHConnection(formData);

    // Attempt to connect
    await sshConnection.connect();

    // Save or update connection if checkbox is checked
    if (saveConnectionCheckbox.checked) {
      try {
        if (currentEditingConnectionId) {
          // Update existing connection
          await ipcRenderer.invoke('db-update-connection', currentEditingConnectionId, formData);
        } else {
          // Create new connection
          await ipcRenderer.invoke('db-save-connection', formData);
        }
        await loadSavedConnections();
      } catch (error) {
        console.error('Error saving/updating connection:', error);
        // Don't fail the connection if save fails
      }
    }

    // Connection successful - switch to file browser view
    const connectionName = formData.connectionName || `${formData.username}@${formData.host}`;
    connectionTitle.textContent = connectionName;
    statusText.textContent = 'Connected';

    // Hide connection form and show file browser
    connectionView.style.display = 'none';
    fileBrowserView.style.display = 'flex';

    // Ensure disconnect button handler is attached
    setupDisconnectHandler();

    // Get initial directory listing
    currentPath = '/';
    await loadDirectory(currentPath);
  } catch (error) {
    // Connection failed - show error
    alert(`Connection failed: ${error.message}`);
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect';
  }
});

// Handle cancel button
cancelBtn.addEventListener('click', () => {
  // Clear form
  connectionForm.reset();
  passwordSection.style.display = 'block';
  keyfileSection.style.display = 'none';
  sudoSection.style.display = 'none';
  document.getElementById('authPassword').checked = true;
  useSudoCheckbox.checked = false;
  passwordInput.type = 'password';
  passwordVisible = false;
  togglePasswordBtn.querySelector('.eye-icon').textContent = '👁️';
  sudoPasswordInput.type = 'password';
  sudoPasswordVisible = false;
  toggleSudoPasswordBtn.querySelector('.eye-icon').textContent = '👁️';

  // Reset form title and button
  if (formTitle) {
    formTitle.textContent = 'New Connection';
  }
  if (connectBtn) {
    connectBtn.textContent = 'Connect';
  }

  // Clear editing state
  currentEditingConnectionId = null;

  // Clear selected connection in sidebar
  document.querySelectorAll('.saved-connection-item').forEach(item => {
    item.classList.remove('selected');
  });
});

// Set default port based on connection type
if (connectionTypeHidden) {
  connectionTypeHidden.addEventListener('change', e => {
    const portInput = document.getElementById('port');
    if (portInput && (e.target.value === 'scp' || e.target.value === 'sftp')) {
      portInput.value = '22';
    }
  });
}

// Helper function to join paths correctly
function joinPath(base, ...parts) {
  let result = base;
  for (const part of parts) {
    if (part) {
      result = result.replace(/\/+$/, '') + '/' + part.replace(/^\/+/, '');
    }
  }
  return result.replace(/\/+/g, '/') || '/';
}

// Helper function to resolve symlink target path
function resolveSymlinkTarget(target, currentDir) {
  if (!target) return currentDir;

  // If target is absolute path, return as is
  if (target.startsWith('/')) {
    return target;
  }

  // Handle relative paths with .. and .
  const parts = currentDir.split('/').filter(p => p);
  const targetParts = target.split('/').filter(p => p);

  for (const part of targetParts) {
    if (part === '..') {
      if (parts.length > 0) {
        parts.pop();
      }
    } else if (part !== '.') {
      parts.push(part);
    }
  }

  return '/' + parts.join('/');
}

// File Browser Functions
async function loadDirectory(dirPath) {
  if (!sshConnection || !sshConnection.isConnected()) {
    showError('Not connected to server');
    return;
  }

  fileList.innerHTML = '<div class="loading-message">Loading...</div>';
  currentPathDisplay.textContent = dirPath;

  try {
    const files = await sshConnection.listDirectory(dirPath);
    currentPath = dirPath;
    displayFiles(files, dirPath);
    updateFileCount(files.length);
  } catch (error) {
    showError(`Error loading directory: ${error.message}`);
    console.error('Directory load error:', error);
  }
}

function displayFiles(files, dirPath) {
  if (files.length === 0) {
    fileList.innerHTML = '<div class="empty-message">Directory is empty</div>';
    return;
  }

  fileList.innerHTML = files
    .map(file => {
      let icon = '📄';
      if (file.type === 'directory') {
        icon = '📁';
      } else if (file.type === 'symlink' || file.type === 'symlink-dir') {
        icon = '🔗';
      }

      const size =
        file.type === 'directory' || file.type === 'symlink-dir' ? '-' : formatFileSize(file.size);
      const modified = file.modified ? formatDate(file.modified) : '-';
      const permissions = file.permissions || '-';

      // Show symlink target if available
      const filenameDisplay = file.symlinkTarget
        ? `${escapeHtml(file.filename)} → ${escapeHtml(file.symlinkTarget)}`
        : escapeHtml(file.filename);

      return `
            <div class="file-item ${file.type}" data-filename="${escapeHtml(file.filename)}" data-type="${file.type}" data-symlink-target="${file.symlinkTarget ? escapeHtml(file.symlinkTarget) : ''}">
                <div class="file-name">
                    <span class="file-icon">${icon}</span>
                    <span class="file-name-text" title="${file.symlinkTarget ? `Symlink to: ${escapeHtml(file.symlinkTarget)}` : ''}">${filenameDisplay}</span>
                </div>
                <div class="file-size">${size}</div>
                <div class="file-modified">${modified}</div>
                <div class="file-permissions">${permissions}</div>
            </div>
        `;
    })
    .join('');

  // Add click handlers
  fileList.querySelectorAll('.file-item').forEach(item => {
    item.addEventListener('click', () => {
      const filename = item.dataset.filename;
      const type = item.dataset.type;
      const symlinkTarget = item.dataset.symlinkTarget;
      const fullPath = joinPath(dirPath, filename);

      if (type === 'directory') {
        loadDirectory(fullPath);
      } else if (type === 'symlink-dir' && symlinkTarget) {
        // Navigate to symlink target (which is a directory)
        const targetPath = resolveSymlinkTarget(symlinkTarget, dirPath);
        loadDirectory(targetPath);
      } else if (type === 'symlink' && symlinkTarget) {
        // Navigate to symlink target
        const targetPath = resolveSymlinkTarget(symlinkTarget, dirPath);
        loadDirectory(targetPath);
      } else {
        // Handle file click (could open/download file)
      }
    });

    item.addEventListener('dblclick', () => {
      const filename = item.dataset.filename;
      const type = item.dataset.type;
      const symlinkTarget = item.dataset.symlinkTarget;
      const fullPath = joinPath(dirPath, filename);

      if (type === 'directory') {
        loadDirectory(fullPath);
      } else if (type === 'symlink-dir' && symlinkTarget) {
        // Navigate to symlink target (which is a directory)
        const targetPath = resolveSymlinkTarget(symlinkTarget, dirPath);
        loadDirectory(targetPath);
      } else if (type === 'symlink' && symlinkTarget) {
        // Navigate to symlink target
        const targetPath = resolveSymlinkTarget(symlinkTarget, dirPath);
        loadDirectory(targetPath);
      } else {
        // Double-click file to edit
        editFile(fullPath, filename);
      }
    });

    // Right-click context menu
    item.addEventListener('contextmenu', e => {
      e.preventDefault();
      const filename = item.dataset.filename;
      const type = item.dataset.type;
      const fullPath = joinPath(dirPath, filename);

      if (type === 'file') {
        showContextMenu(e, fullPath, filename);
      }
    });
  });
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function formatDate(date) {
  if (!date) return '-';
  const now = new Date();
  const diff = now - date;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return date.toLocaleTimeString();
  } else if (days < 7) {
    return `${days} day${days > 1 ? 's' : ''} ago`;
  } else {
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  }
}

function updateFileCount(count) {
  fileCount.textContent = `${count} item${count !== 1 ? 's' : ''}`;
}

function showError(message) {
  fileList.innerHTML = `<div class="error-message">${escapeHtml(message)}</div>`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Navigation handlers
homeBtn.addEventListener('click', () => {
  loadDirectory('/');
});

upBtn.addEventListener('click', () => {
  if (currentPath === '/') return;
  // Get parent directory
  const parts = currentPath.split('/').filter(p => p);
  if (parts.length === 0) return;
  parts.pop();
  const parentPath = '/' + parts.join('/');
  loadDirectory(parentPath || '/');
});

refreshBtn.addEventListener('click', () => {
  loadDirectory(currentPath);
});

// Context menu handlers
function showContextMenu(event, filePath, filename) {
  contextMenu.style.display = 'block';
  contextMenu.style.left = event.pageX + 'px';
  contextMenu.style.top = event.pageY + 'px';

  editFileOption.onclick = () => {
    editFile(filePath, filename);
    hideContextMenu();
  };

  downloadFileOption.onclick = () => {
    downloadFile(filePath, filename);
    hideContextMenu();
  };
}

function hideContextMenu() {
  contextMenu.style.display = 'none';
}

document.addEventListener('click', e => {
  if (!contextMenu.contains(e.target)) {
    hideContextMenu();
  }
});

// File editing functionality
async function editFile(remotePath, filename) {
  if (!sshConnection || !sshConnection.isConnected()) {
    alert('Not connected to server');
    return;
  }

  // Check if file is already being edited
  if (editingFiles.has(remotePath)) {
    alert('This file is already being edited');
    return;
  }

  try {
    // Get temp directory
    const tempDir = await ipcRenderer.invoke('get-temp-dir');
    const localPath = path.join(tempDir, `scp-manager-${Date.now()}-${filename}`);

    // Download file
    await sshConnection.downloadFile(remotePath, localPath);

    // Store editing info
    const editingInfo = {
      localPath: localPath,
      remotePath: remotePath,
      filename: filename,
      watcher: null,
    };

    editingFiles.set(remotePath, editingInfo);

    // Update UI
    updateEditingStatus();

    // Open file in selected editor
    const editorPref = await ipcRenderer.invoke('get-editor-preference');
    const editorCommand =
      editorPref.success && editorPref.editor !== 'default' ? editorPref.editor : null;
    const result = await ipcRenderer.invoke('open-file-in-editor', localPath, editorCommand);
    if (!result.success) {
      throw new Error(result.error || 'Failed to open file in editor');
    }

    // Watch file for changes
    watchFileForChanges(editingInfo);
  } catch (error) {
    console.error('Error editing file:', error);
    alert(`Error editing file: ${error.message}`);
    // Clean up on error
    editingFiles.delete(remotePath);
    updateEditingStatus();
  }
}

function watchFileForChanges(editingInfo) {
  const { localPath, remotePath, filename } = editingInfo;

  // Stop existing watcher if any
  if (editingInfo.watcher) {
    editingInfo.watcher.stop();
  }

  let uploadTimeout = null;
  let inactivityTimeout = null;
  let lastModified = fs.statSync(localPath).mtime.getTime();
  let lastCheckTime = Date.now();

  // Function to check if file is still being edited
  function checkFileActivity() {
    if (!fs.existsSync(localPath)) {
      // File was deleted, stop editing
      stopEditing(remotePath);
      return;
    }

    try {
      const stats = fs.statSync(localPath);
      const timeSinceLastModification = Date.now() - stats.mtime.getTime();

      // If file hasn't been modified in 10 seconds, assume editor might be closed
      // Check more frequently for faster cleanup
      if (timeSinceLastModification > 10000) {
        // 10 seconds
        // File hasn't been modified for 10 seconds, likely editor is closed
        stopEditing(remotePath);
        return;
      }

      // Schedule next check more frequently
      inactivityTimeout = setTimeout(checkFileActivity, 5000); // Check every 5 seconds
    } catch (error) {
      // File might not exist anymore
      stopEditing(remotePath);
    }
  }

  editingInfo.watcher = fs.watchFile(localPath, { interval: 1000 }, async (curr, prev) => {
    if (curr.mtime.getTime() !== lastModified) {
      lastModified = curr.mtime.getTime();
      lastCheckTime = Date.now();

      // Reset inactivity timeout
      if (inactivityTimeout) {
        clearTimeout(inactivityTimeout);
      }
      inactivityTimeout = setTimeout(checkFileActivity, 10000); // Check after 10 seconds of inactivity

      // Debounce uploads
      if (uploadTimeout) {
        clearTimeout(uploadTimeout);
      }

      uploadTimeout = setTimeout(async () => {
        try {
          await sshConnection.uploadFile(localPath, remotePath);

          // Update UI to show saved status
          updateEditingStatus();

          // Refresh directory listing
          await loadDirectory(currentPath);
        } catch (error) {
          console.error('Error uploading file:', error);
          alert(`Error saving file: ${error.message}`);
        }
      }, 2000); // Wait 2 seconds after last change
    }
  });

  // Start inactivity check - check after 10 seconds
  inactivityTimeout = setTimeout(checkFileActivity, 10000);
  editingInfo.inactivityTimeout = inactivityTimeout;
}

function updateEditingStatus() {
  if (editingFiles.size === 0) {
    editingStatus.style.display = 'none';
    return;
  }

  editingStatus.style.display = 'flex';

  // Create list of editing files with close buttons
  editingFilesList.innerHTML = Array.from(editingFiles.entries())
    .map(([remotePath, info]) => {
      const displayName = path.basename(info.remotePath);
      return `
            <div class="editing-file-item" data-path="${escapeHtml(remotePath)}">
                <span class="editing-file-name">${escapeHtml(displayName)}</span>
                <button class="btn-icon btn-xs stop-editing-btn" data-path="${escapeHtml(remotePath)}" title="Stop editing">
                    <span>✕</span>
                </button>
            </div>
        `;
    })
    .join('');

  // Attach event listeners to stop editing buttons using event delegation
  editingFilesList.querySelectorAll('.stop-editing-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const path = btn.getAttribute('data-path');
      if (path) {
        await stopEditing(path);
      }
    });
  });
}

// Make stopEditingFile available globally
window.stopEditingFile = async function (remotePath) {
  await stopEditing(remotePath);
};

async function stopEditing(remotePath = null) {
  // If no specific path provided, stop all editing
  const filesToStop = remotePath
    ? [[remotePath, editingFiles.get(remotePath)]].filter(([_, info]) => info)
    : Array.from(editingFiles.entries());

  for (const [path, info] of filesToStop) {
    if (!info) continue;

    // Stop inactivity timeout
    if (info.inactivityTimeout) {
      clearTimeout(info.inactivityTimeout);
      info.inactivityTimeout = null;
    }

    // Stop file watcher
    if (info.watcher) {
      info.watcher.stop();
      info.watcher = null;
    }

    // Final upload if file exists
    if (info.localPath && fs.existsSync(info.localPath)) {
      try {
        // Final upload
        await sshConnection.uploadFile(info.localPath, info.remotePath);

        // Clean up temp file
        try {
          fs.unlinkSync(info.localPath);
        } catch (error) {
          // File might already be deleted
        }
      } catch (error) {
        // Error uploading, but continue cleanup
      }
    }

    // Remove from editing files
    editingFiles.delete(path);
  }

  // Update UI
  updateEditingStatus();

  // Refresh directory listing
  if (currentPath) {
    await loadDirectory(currentPath);
  }
}

// Download file functionality
async function downloadFile(remotePath, filename) {
  if (!sshConnection || !sshConnection.isConnected()) {
    alert('Not connected to server');
    return;
  }

  try {
    const result = await ipcRenderer.invoke('show-open-dialog', {
      title: 'Save File',
      defaultPath: filename,
      properties: ['openDirectory'],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const saveDir = result.filePaths[0];
      const localPath = path.join(saveDir, filename);

      await sshConnection.downloadFile(remotePath, localPath);
      alert(`File downloaded to: ${localPath}`);
    }
  } catch (error) {
    console.error('Error downloading file:', error);
    alert(`Error downloading file: ${error.message}`);
  }
}

// Disconnect handler function
async function handleDisconnect() {
  try {
    // Stop all editing files
    if (editingFiles && editingFiles.size > 0) {
      await stopEditing();
    }

    // Disconnect SSH connection
    if (sshConnection) {
      try {
        await sshConnection.disconnect();
      } catch (error) {
        // Continue even if disconnect fails
      }
      sshConnection = null;
    }

    // Switch back to connection view
    if (fileBrowserView) {
      fileBrowserView.style.display = 'none';
    }
    if (connectionView) {
      connectionView.style.display = 'flex';
    }

    // Reset form
    if (connectionForm) {
      connectionForm.reset();
    }

    if (passwordSection) {
      passwordSection.style.display = 'block';
    }
    if (keyfileSection) {
      keyfileSection.style.display = 'none';
    }
    if (sudoSection) {
      sudoSection.style.display = 'none';
    }

    const authPasswordRadio = document.getElementById('authPassword');
    if (authPasswordRadio) {
      authPasswordRadio.checked = true;
    }

    if (useSudoCheckbox) {
      useSudoCheckbox.checked = false;
    }

    if (passwordInput) {
      passwordInput.type = 'password';
      passwordVisible = false;
    }
    if (togglePasswordBtn) {
      const eyeIcon = togglePasswordBtn.querySelector('.eye-icon');
      if (eyeIcon) {
        eyeIcon.textContent = '👁️';
      }
    }

    if (sudoPasswordInput) {
      sudoPasswordInput.type = 'password';
      sudoPasswordVisible = false;
    }
    if (toggleSudoPasswordBtn) {
      const eyeIcon = toggleSudoPasswordBtn.querySelector('.eye-icon');
      if (eyeIcon) {
        eyeIcon.textContent = '👁️';
      }
    }

    if (connectBtn) {
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect';
    }

    if (formTitle) {
      formTitle.textContent = 'New Connection';
    }

    // Clear editing state
    currentEditingConnectionId = null;

    // Clear selected connection in sidebar
    document.querySelectorAll('.saved-connection-item').forEach(item => {
      item.classList.remove('selected');
    });

    // Reset current path
    currentPath = '/';

    // Reload saved connections
    await loadSavedConnections();
  } catch (error) {
    alert('Error disconnecting: ' + error.message);
  }
}

// Setup disconnect handler
function setupDisconnectHandler() {
  const btn = document.getElementById('disconnectBtn');
  if (!btn) {
    return false;
  }

  // Remove existing listener by cloning
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);

  // Attach new listener
  newBtn.addEventListener('click', async e => {
    e.preventDefault();
    e.stopPropagation();
    await handleDisconnect();
  });

  return true;
}

// Setup disconnect handler when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setupDisconnectHandler();
  });
} else {
  setupDisconnectHandler();
}

// Initialize saved connections on load
loadSavedConnections();

// Dark mode functionality
let darkMode = localStorage.getItem('darkMode') === 'true';

function applyDarkMode() {
  if (darkMode) {
    document.body.classList.add('dark-mode');
  } else {
    document.body.classList.remove('dark-mode');
  }
}

function toggleDarkMode() {
  darkMode = !darkMode;
  localStorage.setItem('darkMode', darkMode.toString());
  applyDarkMode();
  updateDarkModeIcon();
}

function updateDarkModeIcon() {
  const icon = document.getElementById('darkModeIcon');
  if (icon) {
    icon.textContent = darkMode ? '☀️' : '🌙';
  }
}

// Apply dark mode on load
applyDarkMode();
updateDarkModeIcon();

// Setup dark mode toggle button
document.addEventListener('DOMContentLoaded', () => {
  const darkModeToggle = document.getElementById('darkModeToggle');
  if (darkModeToggle) {
    darkModeToggle.addEventListener('click', toggleDarkMode);
  }

  // Setup settings modal
  setupSettingsModal();
});

// Settings Modal Functionality
async function setupSettingsModal() {
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const editorSelect = document.getElementById('editorSelect');
  const customEditorPath = document.getElementById('customEditorPath');
  const browseEditorBtn = document.getElementById('browseEditorBtn');

  if (!settingsBtn || !settingsModal) return;

  // Load available editors
  async function loadEditors() {
    try {
      const result = await ipcRenderer.invoke('get-available-editors');
      if (result.success && editorSelect) {
        editorSelect.innerHTML = '';
        result.editors.forEach(editor => {
          const option = document.createElement('option');
          option.value =
            editor.command === 'default' ? 'default' : `${editor.command}:${editor.args.join(':')}`;
          option.textContent = editor.name;
          editorSelect.appendChild(option);
        });
        // Add custom option
        const customOption = document.createElement('option');
        customOption.value = 'custom';
        customOption.textContent = 'Custom Editor';
        editorSelect.appendChild(customOption);
      }
    } catch (error) {
      // Error loading editors
    }
  }

  // Load current preference
  async function loadPreference() {
    try {
      const result = await ipcRenderer.invoke('get-editor-preference');
      if (result.success && editorSelect) {
        if (result.editor === 'default') {
          editorSelect.value = 'default';
          if (customEditorPath) customEditorPath.value = '';
        } else {
          // Check if the editor is in the dropdown list
          let foundInList = false;
          for (let option of editorSelect.options) {
            if (option.value === result.editor) {
              editorSelect.value = result.editor;
              foundInList = true;
              if (customEditorPath) customEditorPath.value = '';
              break;
            }
          }
          // If not found in list, it's a custom editor
          if (!foundInList) {
            editorSelect.value = 'custom';
            if (customEditorPath) customEditorPath.value = result.editor;
          }
        }
      }
    } catch (error) {
      // Error loading preference
    }
  }

  // Open modal
  settingsBtn.addEventListener('click', async () => {
    await loadEditors();
    await loadPreference();
    settingsModal.style.display = 'flex';
  });

  // Close modal
  function closeModal() {
    settingsModal.style.display = 'none';
  }

  if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeModal);
  if (cancelSettingsBtn) cancelSettingsBtn.addEventListener('click', closeModal);

  // Browse for editor
  if (browseEditorBtn) {
    browseEditorBtn.addEventListener('click', async () => {
      try {
        const result = await ipcRenderer.invoke('show-open-dialog', {
          title: 'Select Editor Executable',
          filters: [
            { name: 'Executable Files', extensions: ['exe', 'app', ''] },
            { name: 'All Files', extensions: ['*'] },
          ],
          properties: ['openFile'],
        });

        if (!result.canceled && result.filePaths.length > 0 && customEditorPath) {
          customEditorPath.value = result.filePaths[0];
          if (editorSelect) editorSelect.value = 'custom';
        }
      } catch (error) {
        alert('Error selecting editor: ' + error.message);
      }
    });
  }

  // Handle custom editor path input - auto-select custom option
  if (customEditorPath) {
    customEditorPath.addEventListener('input', () => {
      if (customEditorPath.value.trim() && editorSelect) {
        editorSelect.value = 'custom';
      }
    });
  }

  // Save settings
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', async () => {
      try {
        let editorCommand = 'default';

        // Check if custom path is filled (even if dropdown isn't set to custom)
        if (customEditorPath && customEditorPath.value.trim()) {
          editorCommand = customEditorPath.value.trim();
        } else if (
          editorSelect &&
          editorSelect.value !== 'default' &&
          editorSelect.value !== 'custom'
        ) {
          editorCommand = editorSelect.value;
        }

        if (!editorCommand || editorCommand === 'default') {
          editorCommand = 'default';
        }

        const result = await ipcRenderer.invoke('save-editor-preference', editorCommand);
        if (result.success) {
          alert('Settings saved successfully!');
          closeModal();
        } else {
          alert('Error saving settings: ' + (result.error || 'Unknown error'));
        }
      } catch (error) {
        alert('Error saving settings: ' + error.message);
      }
    });
  }

  // Close modal when clicking outside
  settingsModal.addEventListener('click', e => {
    if (e.target === settingsModal) {
      closeModal();
    }
  });
}
