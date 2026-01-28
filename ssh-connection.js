const { Client } = require('ssh2');
const path = require('path');

// Helper function to join paths
function joinPath(base, ...parts) {
  let result = base;
  for (const part of parts) {
    if (part) {
      result = result.replace(/\/+$/, '') + '/' + part.replace(/^\/+/, '');
    }
  }
  return result.replace(/\/+/g, '/') || '/';
}

class SSHConnection {
  constructor(config) {
    this.config = config;
    this.client = new Client();
    this.sftp = null;
    this.connected = false;
    this.useSudo = config.useSudo || false;
    this.sudoPassword = config.sudoPassword || config.password || null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const connConfig = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        readyTimeout: 20000,
        keepaliveInterval: 10000,
      };

      // Add authentication
      if (this.config.password) {
        connConfig.password = this.config.password;
      } else if (this.config.privateKey) {
        connConfig.privateKey = this.config.privateKey;
        // If passphrase is provided for encrypted keys
        if (this.config.passphrase) {
          connConfig.passphrase = this.config.passphrase;
        }
      }

      this.client.on('ready', () => {
        this.connected = true;

        // Open SFTP session
        this.client.sftp((err, sftp) => {
          if (err) {
            reject(err);
            return;
          }
          this.sftp = sftp;
          resolve(this);
        });
      });

      this.client.on('error', err => {
        this.connected = false;
        reject(err);
      });

      this.client.connect(connConfig);
    });
  }

  listDirectory(path = '.') {
    if (this.useSudo) {
      return this.listDirectoryWithSudo(path);
    }

    return new Promise((resolve, reject) => {
      if (!this.sftp) {
        reject(new Error('SFTP session not established'));
        return;
      }

      this.sftp.readdir(path, async (err, list) => {
        if (err) {
          reject(err);
          return;
        }

        // Format the file list and check for symlinks
        const files = await Promise.all(
          list.map(async item => {
            const filePath = path === '.' ? item.filename : `${path}/${item.filename}`;
            let type = item.attrs.isDirectory() ? 'directory' : 'file';
            let symlinkTarget = null;

            // Check if it's a symbolic link
            try {
              const realPath = await new Promise((resolve, reject) => {
                this.sftp.readlink(filePath, (err, target) => {
                  if (!err && target) {
                    resolve(target);
                  } else {
                    resolve(null);
                  }
                });
              });

              if (realPath) {
                type = 'symlink';
                symlinkTarget = realPath;
                // Check if symlink target is a directory
                try {
                  const targetPath = realPath.startsWith('/') ? realPath : joinPath(path, realPath);
                  await new Promise((resolve, reject) => {
                    this.sftp.opendir(targetPath, (err, handle) => {
                      if (!err && handle) {
                        this.sftp.close(handle);
                        type = 'symlink-dir';
                      }
                      resolve();
                    });
                  });
                } catch (e) {
                  // Target is not a directory or doesn't exist
                }
              }
            } catch (e) {
              // Not a symlink or error reading it
            }

            return {
              filename: item.filename,
              longname: item.longname,
              attrs: item.attrs,
              type: type,
              size: item.attrs.size,
              modified: item.attrs.mtime ? new Date(item.attrs.mtime * 1000) : null,
              permissions: item.attrs.mode ? this.formatPermissions(item.attrs.mode) : null,
              symlinkTarget: symlinkTarget,
            };
          })
        );

        // Sort: directories first, then symlinks, then files, all alphabetically
        files.sort((a, b) => {
          const typeOrder = { directory: 0, 'symlink-dir': 1, symlink: 2, file: 3 };
          const aOrder = typeOrder[a.type] || 3;
          const bOrder = typeOrder[b.type] || 3;
          if (aOrder !== bOrder) return aOrder - bOrder;
          return a.filename.localeCompare(b.filename);
        });

        resolve(files);
      });
    });
  }

  listDirectoryWithSudo(path = '.') {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        reject(new Error('SSH connection not established'));
        return;
      }

      // Escape path for shell
      const escapedPath = path.replace(/'/g, "'\"'\"'");
      const command = this.sudoPassword
        ? `echo '${this.sudoPassword.replace(/'/g, "'\"'\"'")}' | sudo -S ls -la '${escapedPath}' 2>/dev/null || sudo ls -la '${escapedPath}'`
        : `sudo ls -la '${escapedPath}'`;

      this.client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('close', (code, signal) => {
          if (code !== 0 && !stdout) {
            reject(new Error(`Command failed: ${stderr || 'Unknown error'}`));
            return;
          }

          // Parse ls -la output
          const files = this.parseLsOutput(stdout, path);
          resolve(files);
        });

        stream.on('data', data => {
          stdout += data.toString();
        });

        stream.stderr.on('data', data => {
          stderr += data.toString();
        });
      });
    });
  }

  parseLsOutput(output, basePath) {
    const lines = output.split('\n').filter(line => line.trim() && !line.startsWith('total'));
    const files = [];

    for (const line of lines) {
      // Parse ls -la format: permissions links owner group size date time name [-> target]
      // Handle symlinks: filename -> target
      let match = line.match(
        /^([dl-])([rwx-]{9})\s+\d+\s+(\S+)\s+(\S+)\s+(\d+)\s+(\w{3})\s+(\d{1,2})\s+([\d:]+)\s+(.+?)(?:\s+->\s+(.+))?$/
      );
      if (!match) continue;

      const [, typeChar, perms, owner, group, sizeStr, month, day, time, filename, symlinkTarget] =
        match;
      const isDirectory = typeChar === 'd';
      const isSymlink = typeChar === 'l';
      const size = parseInt(sizeStr, 10);

      let type = isDirectory ? 'directory' : 'file';
      let target = null;

      if (isSymlink && symlinkTarget) {
        target = symlinkTarget.trim();
        // Check if symlink target appears to be a directory (ends with / or we can't determine)
        // For now, we'll treat symlinks to directories as 'symlink-dir'
        type = target.endsWith('/') || !target.includes('.') ? 'symlink-dir' : 'symlink';
      }

      // Parse date (simplified - assumes current year)
      let modified = null;
      try {
        const year = new Date().getFullYear();
        const dateStr = `${month} ${day} ${time.includes(':') ? time + ' ' + year : time}`;
        modified = new Date(dateStr);
        if (isNaN(modified.getTime())) {
          modified = new Date();
        }
      } catch (e) {
        modified = new Date();
      }

      files.push({
        filename: filename,
        longname: line.trim(),
        type: type,
        size: size,
        modified: modified,
        permissions: perms,
        owner: owner,
        group: group,
        symlinkTarget: target,
      });
    }

    // Sort: directories first, then symlink-dirs, then symlinks, then files, all alphabetically
    files.sort((a, b) => {
      const typeOrder = { directory: 0, 'symlink-dir': 1, symlink: 2, file: 3 };
      const aOrder = typeOrder[a.type] || 3;
      const bOrder = typeOrder[b.type] || 3;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.filename.localeCompare(b.filename);
    });

    return files;
  }

  formatPermissions(mode) {
    const perms = [];
    const types = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];

    for (let i = 0; i < 3; i++) {
      const shift = (2 - i) * 3;
      const perm = (mode >> shift) & 0x7;
      perms.push(types[perm]);
    }

    return perms.join('');
  }

  getCurrentDirectory() {
    return new Promise((resolve, reject) => {
      if (!this.sftp) {
        reject(new Error('SFTP session not established'));
        return;
      }

      this.sftp.realpath('.', (err, absPath) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(absPath);
      });
    });
  }

  changeDirectory(path) {
    return new Promise((resolve, reject) => {
      if (!this.sftp) {
        reject(new Error('SFTP session not established'));
        return;
      }

      this.sftp.opendir(path, (err, handle) => {
        if (err) {
          reject(err);
          return;
        }

        this.sftp.close(handle, closeErr => {
          if (closeErr) {
            reject(closeErr);
            return;
          }
          resolve(path);
        });
      });
    });
  }

  disconnect() {
    return new Promise((resolve, reject) => {
      try {
        // Close SFTP session
        if (this.sftp) {
          try {
            this.sftp.end();
          } catch (error) {
            // Ignore errors during cleanup
          }
          this.sftp = null;
        }

        // Close SSH client
        if (this.client) {
          try {
            this.client.end();
            this.client.removeAllListeners();
          } catch (error) {
            // Ignore errors during cleanup
          }
          this.connected = false;
        }

        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  downloadFile(remotePath, localPath) {
    if (this.useSudo) {
      return this.downloadFileWithSudo(remotePath, localPath);
    }

    return new Promise((resolve, reject) => {
      if (!this.sftp) {
        reject(new Error('SFTP session not established'));
        return;
      }

      const fs = require('fs');
      const writeStream = fs.createWriteStream(localPath);

      this.sftp.fastGet(remotePath, localPath, err => {
        if (err) {
          reject(err);
          return;
        }
        resolve(localPath);
      });
    });
  }

  downloadFileWithSudo(remotePath, localPath) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        reject(new Error('SSH connection not established'));
        return;
      }

      const fs = require('fs');
      const writeStream = fs.createWriteStream(localPath);
      const escapedPath = remotePath.replace(/'/g, "'\"'\"'");

      const command = this.sudoPassword
        ? `echo '${this.sudoPassword.replace(/'/g, "'\"'\"'")}' | sudo -S cat '${escapedPath}'`
        : `sudo cat '${escapedPath}'`;

      this.client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        stream.on('close', code => {
          if (code !== 0) {
            reject(new Error(`Failed to download file: exit code ${code}`));
            return;
          }
          resolve(localPath);
        });

        stream.on('data', data => {
          writeStream.write(data);
        });

        stream.stderr.on('data', data => {
          // Sudo password prompt might appear on stderr, ignore it
        });

        stream.on('end', () => {
          writeStream.end();
        });
      });
    });
  }

  uploadFile(localPath, remotePath) {
    if (this.useSudo) {
      return this.uploadFileWithSudo(localPath, remotePath);
    }

    return new Promise((resolve, reject) => {
      if (!this.sftp) {
        reject(new Error('SFTP session not established'));
        return;
      }

      this.sftp.fastPut(localPath, remotePath, err => {
        if (err) {
          reject(err);
          return;
        }
        resolve(remotePath);
      });
    });
  }

  uploadFileWithSudo(localPath, remotePath) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        reject(new Error('SSH connection not established'));
        return;
      }

      const fs = require('fs');
      const fileContent = fs.readFileSync(localPath);
      const base64Content = fileContent.toString('base64');
      const escapedPath = remotePath.replace(/'/g, "'\"'\"'");

      // Use base64 encoding to safely transfer file content
      // Decode and write using sudo tee
      const command = this.sudoPassword
        ? `echo '${this.sudoPassword.replace(/'/g, "'\"'\"'")}' | sudo -S sh -c "echo '${base64Content}' | base64 -d > '${escapedPath}'"`
        : `sudo sh -c "echo '${base64Content}' | base64 -d > '${escapedPath}'"`;

      this.client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let stderr = '';

        stream.on('close', code => {
          if (code !== 0) {
            reject(new Error(`Failed to upload file: ${stderr || 'Unknown error'}`));
            return;
          }
          resolve(remotePath);
        });

        stream.stderr.on('data', data => {
          stderr += data.toString();
        });
      });
    });
  }

  isConnected() {
    return this.connected && this.sftp !== null;
  }
}

module.exports = SSHConnection;
