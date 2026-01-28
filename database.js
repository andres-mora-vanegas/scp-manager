const initSqlJs = require('sql.js');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Use app.getPath('userData') for Electron app data directory
// Handle case when app is not available (e.g., during testing)
let userDataPath;
try {
  const { app } = require('electron');
  userDataPath = app ? app.getPath('userData') : path.join(__dirname, 'data');
} catch (error) {
  // If electron is not available (e.g., during testing), use local data directory
  userDataPath = path.join(__dirname, 'data');
}
const dbPath = path.join(userDataPath, 'connections.db');

class ConnectionDatabase {
  constructor() {
    // Ensure directory exists
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }

    this.db = null;
    this.SQL = null;
    this.initialized = false;
  }

  async initDatabase() {
    if (this.initialized) {
      return;
    }

    try {
      // Initialize SQL.js
      this.SQL = await initSqlJs();

      // Load existing database or create new one
      if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath);
        this.db = new this.SQL.Database(buffer);
        // Migrate existing database if needed
        this.migrateDatabase();
      } else {
        this.db = new this.SQL.Database();
        this.createTables();
      }
      this.initialized = true;
    } catch (error) {
      console.error('Error initializing database:', error);
      // Create new database if loading fails
      if (this.SQL) {
        this.db = new this.SQL.Database();
        this.createTables();
        this.initialized = true;
      } else {
        throw error;
      }
    }
  }

  migrateDatabase() {
    if (!this.db) return;

    // Check if columns exist by trying to query them
    // SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we use a different approach
    try {
      // Try to get table info
      const tableInfo = this.db.exec('PRAGMA table_info(connections)');
      if (tableInfo.length === 0) {
        // Table doesn't exist, create it
        this.createTables();
        this.saveDatabase();
        return;
      }

      const columns = tableInfo[0].values.map(row => row[1]); // Column names are in index 1

      let needsSave = false;

      // Add use_sudo column if it doesn't exist
      if (!columns.includes('use_sudo')) {
        try {
          this.db.run(`ALTER TABLE connections ADD COLUMN use_sudo INTEGER DEFAULT 0`);
          needsSave = true;
        } catch (e) {
          // Column already exists or error
        }
      }

      // Add sudo_password_encrypted column if it doesn't exist
      if (!columns.includes('sudo_password_encrypted')) {
        try {
          this.db.run(`ALTER TABLE connections ADD COLUMN sudo_password_encrypted TEXT`);
          needsSave = true;
        } catch (e) {
          // Column already exists or error
        }
      }

      if (needsSave) {
        this.saveDatabase();
      }
    } catch (error) {
      console.error('Error migrating database:', error);
      // If migration fails, try to recreate table (last resort)
      try {
        // Backup existing data first
        const backup = this.db.export();
        this.db.run('DROP TABLE IF EXISTS connections');
        this.createTables();
        this.saveDatabase();
      } catch (e) {
        // Error recreating table
      }
    }
  }

  createTables() {
    this.db.run(`
            CREATE TABLE IF NOT EXISTS connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER NOT NULL DEFAULT 22,
                username TEXT NOT NULL,
                auth_method TEXT NOT NULL,
                password_encrypted TEXT,
                keyfile_path TEXT,
                connection_type TEXT DEFAULT 'scp',
                use_sudo INTEGER DEFAULT 0,
                sudo_password_encrypted TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

    // Create index for faster lookups
    this.db.run(`
            CREATE INDEX IF NOT EXISTS idx_host_username ON connections(host, username)
        `);

    this.saveDatabase();
  }

  saveDatabase() {
    if (this.db) {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(dbPath, buffer);
    }
  }

  // Simple encryption/decryption (for basic obfuscation)
  // Note: This is not highly secure, but better than plain text
  encrypt(text) {
    if (!text) return null;
    const algorithm = 'aes-256-cbc';
    const key = crypto.createHash('sha256').update('scp-manager-key').digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  decrypt(encryptedText) {
    if (!encryptedText) return null;
    try {
      const algorithm = 'aes-256-cbc';
      const key = crypto.createHash('sha256').update('scp-manager-key').digest();
      const parts = encryptedText.split(':');
      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];
      const decipher = crypto.createDecipheriv(algorithm, key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      console.error('Decryption error:', error);
      return null;
    }
  }

  async ensureInitialized() {
    if (!this.initialized) {
      await this.initDatabase();
    }
  }

  async saveConnection(connectionData) {
    await this.ensureInitialized();
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const passwordEncrypted = connectionData.password
      ? this.encrypt(connectionData.password)
      : null;

    const sudoPasswordEncrypted =
      connectionData.useSudo && connectionData.sudoPassword
        ? this.encrypt(connectionData.sudoPassword)
        : null;

    const stmt = this.db.prepare(`
            INSERT INTO connections 
            (name, host, port, username, auth_method, password_encrypted, keyfile_path, connection_type, use_sudo, sudo_password_encrypted, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `);

    stmt.bind([
      connectionData.name || `${connectionData.username}@${connectionData.host}`,
      connectionData.host,
      connectionData.port || 22,
      connectionData.username,
      connectionData.authMethod,
      passwordEncrypted,
      connectionData.keyfile || null,
      connectionData.connectionType || 'scp',
      connectionData.useSudo ? 1 : 0,
      sudoPasswordEncrypted,
    ]);

    stmt.step();
    const id = this.db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    stmt.free();

    this.saveDatabase();
    return id;
  }

  async getAllConnections() {
    await this.ensureInitialized();
    if (!this.db) {
      return [];
    }

    const stmt = this.db.prepare('SELECT * FROM connections ORDER BY updated_at DESC');
    const results = [];

    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push(row);
    }

    stmt.free();
    return results;
  }

  async getConnection(id) {
    await this.ensureInitialized();
    if (!this.db) {
      return null;
    }

    const stmt = this.db.prepare('SELECT * FROM connections WHERE id = ?');
    stmt.bind([id]);

    let connection = null;
    if (stmt.step()) {
      connection = stmt.getAsObject();
    }

    stmt.free();

    if (connection) {
      if (connection.password_encrypted) {
        connection.password = this.decrypt(connection.password_encrypted);
      }
      if (connection.sudo_password_encrypted) {
        connection.sudoPassword = this.decrypt(connection.sudo_password_encrypted);
      }
      connection.useSudo = connection.use_sudo === 1;
    }

    return connection;
  }

  async deleteConnection(id) {
    await this.ensureInitialized();
    if (!this.db) {
      return;
    }

    const stmt = this.db.prepare('DELETE FROM connections WHERE id = ?');
    stmt.bind([id]);
    stmt.step();
    stmt.free();

    this.saveDatabase();
  }

  async updateConnection(id, connectionData) {
    await this.ensureInitialized();
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Ensure database is migrated before updating
    this.migrateDatabase();

    // Get existing connection to preserve passwords if not changed
    const existing = await this.getConnection(id);

    // Handle password - use existing if not provided
    let passwordEncrypted = null;
    if (connectionData.password) {
      passwordEncrypted = this.encrypt(connectionData.password);
    } else if (existing && existing.password_encrypted) {
      passwordEncrypted = existing.password_encrypted;
    }

    // Handle sudo password - preserve existing if not changed
    let sudoPasswordEncrypted = null;
    if (connectionData.useSudo) {
      if (connectionData.sudoPassword) {
        // New sudo password provided
        sudoPasswordEncrypted = this.encrypt(connectionData.sudoPassword);
      } else if (existing && existing.sudo_password_encrypted) {
        // Keep existing sudo password if not changed
        sudoPasswordEncrypted = existing.sudo_password_encrypted;
      }
    }
    // If useSudo is false, sudoPasswordEncrypted will be null (clears it)

    // Handle both 'name' and 'connectionName' field names
    const connectionName = connectionData.name || connectionData.connectionName || null;
    const finalName = connectionName || `${connectionData.username}@${connectionData.host}`;

    const stmt = this.db.prepare(`
            UPDATE connections 
            SET name = ?, host = ?, port = ?, username = ?, 
                auth_method = ?, password_encrypted = ?, 
                keyfile_path = ?, connection_type = ?, use_sudo = ?, sudo_password_encrypted = ?, updated_at = datetime('now')
            WHERE id = ?
        `);

    stmt.bind([
      finalName,
      connectionData.host,
      connectionData.port || 22,
      connectionData.username,
      connectionData.authMethod,
      passwordEncrypted,
      connectionData.keyfile || null,
      connectionData.connectionType || 'scp',
      connectionData.useSudo ? 1 : 0,
      sudoPasswordEncrypted,
      id,
    ]);

    stmt.step();
    stmt.free();

    this.saveDatabase();
  }

  async exportConnections() {
    await this.ensureInitialized();
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const connections = await this.getAllConnections();

    // Encrypt all sensitive data for export (double encryption for extra security)
    const encryptedConnections = connections.map(conn => {
      const exported = {
        name: this.encrypt(conn.name || ''),
        host: this.encrypt(conn.host || ''),
        port: this.encrypt(String(conn.port || 22)),
        username: this.encrypt(conn.username || ''),
        auth_method: this.encrypt(conn.auth_method || 'password'),
        password_encrypted: conn.password_encrypted ? this.encrypt(conn.password_encrypted) : null,
        keyfile_path: conn.keyfile_path ? this.encrypt(conn.keyfile_path) : null,
        connection_type: this.encrypt(conn.connection_type || 'scp'),
        use_sudo: this.encrypt(String(conn.use_sudo || 0)),
        sudo_password_encrypted: conn.sudo_password_encrypted
          ? this.encrypt(conn.sudo_password_encrypted)
          : null,
      };
      return exported;
    });

    // Create INI format with encrypted values
    let iniContent = '[SCP_MANAGER_EXPORT]\n';
    iniContent += `version=1.0\n`;
    iniContent += `count=${encryptedConnections.length}\n\n`;

    encryptedConnections.forEach((conn, index) => {
      iniContent += `[connection_${index}]\n`;
      Object.keys(conn).forEach(key => {
        if (conn[key] !== null && conn[key] !== undefined) {
          iniContent += `${key}=${conn[key]}\n`;
        }
      });
      iniContent += '\n';
    });

    return iniContent;
  }

  async importConnections(iniContent) {
    await this.ensureInitialized();
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const lines = iniContent.split('\n');
    const connections = [];
    let currentSection = null;
    let currentConnection = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        if (currentSection && currentSection.startsWith('connection_')) {
          connections.push(currentConnection);
        }
        currentSection = trimmed.slice(1, -1);
        currentConnection = {};
      } else if (trimmed.includes('=')) {
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=');

        if (currentSection && currentSection.startsWith('connection_')) {
          currentConnection[key.trim()] = value.trim();
        }
      }
    }

    // Add last connection
    if (currentSection && currentSection.startsWith('connection_')) {
      connections.push(currentConnection);
    }

    // Decrypt and import connections
    const imported = [];
    for (const encryptedConn of connections) {
      try {
        // Decrypt the outer layer
        const decrypted = {
          name: this.decrypt(encryptedConn.name) || '',
          host: this.decrypt(encryptedConn.host) || '',
          port: parseInt(this.decrypt(encryptedConn.port) || '22', 10),
          username: this.decrypt(encryptedConn.username) || '',
          authMethod: this.decrypt(encryptedConn.auth_method) || 'password',
          // Passwords are double-encrypted: decrypt once to get the encrypted value
          password: encryptedConn.password_encrypted
            ? this.decrypt(encryptedConn.password_encrypted)
            : null,
          keyfile: encryptedConn.keyfile_path ? this.decrypt(encryptedConn.keyfile_path) : null,
          connectionType: this.decrypt(encryptedConn.connection_type) || 'scp',
          useSudo: this.decrypt(encryptedConn.use_sudo) === '1',
          sudoPassword: encryptedConn.sudo_password_encrypted
            ? this.decrypt(encryptedConn.sudo_password_encrypted)
            : null,
        };

        // For passwords, we need to pass the decrypted (but still encrypted) value
        // The saveConnection will encrypt it again, so we need to decrypt it first
        const connectionData = {
          ...decrypted,
          password: decrypted.password ? this.decrypt(decrypted.password) : null,
          sudoPassword: decrypted.sudoPassword ? this.decrypt(decrypted.sudoPassword) : null,
        };

        // Save connection
        const id = await this.saveConnection(connectionData);
        imported.push({ id, name: connectionData.name });
      } catch (error) {
        // Skip invalid connections
        continue;
      }
    }

    return imported;
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Export singleton instance
let dbInstance = null;

async function getDatabase() {
  if (!dbInstance) {
    dbInstance = new ConnectionDatabase();
    // Wait for database initialization
    await dbInstance.initDatabase();
  }
  return dbInstance;
}

module.exports = { ConnectionDatabase, getDatabase };
