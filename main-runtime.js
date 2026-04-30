const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const fsSync = require('fs');
const { spawn, exec, execFile } = require('child_process');
const { Client } = require('ssh2');
let pty = null;
try {
  pty = require('node-pty');
} catch {}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 1024 * 1024 * 20, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function assertManagedPath(rootDir, targetPath) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(targetPath);
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(rootWithSep)) {
    throw new Error(`Refusing to touch unmanaged path: ${resolvedTarget}`);
  }
  return resolvedTarget;
}

function parseConnectionTarget(value) {
  const raw = String(value || '').trim();
  if (!raw) return { host: '', port: 22 };

  const ipv6Match = raw.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (ipv6Match) {
    return {
      host: ipv6Match[1],
      port: ipv6Match[2] ? Number(ipv6Match[2]) : 22
    };
  }

  const colonCount = (raw.match(/:/g) || []).length;
  if (colonCount === 1) {
    const [host, portText] = raw.split(':');
    if (host && /^\d+$/.test(portText || '')) {
      return { host, port: Number(portText) };
    }
  }

  return { host: raw, port: 22 };
}

function pushTerminalMessage(event, sessionKey, text) {
  if (!text) return;
  try {
    event.sender.send('terminal-incoming', {
      sessionKey: String(sessionKey || 'default'),
      data: String(text)
    });
  } catch {}
}

async function connectSsh(connection) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const target = parseConnectionTarget(connection?.host);
    const password = String(connection?.password || '');
    let settled = false;
    function finish(error, client) {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(client);
    }
    conn.on('ready', () => finish(null, conn));
    conn.on('error', (error) => finish(error));
    conn.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finishKeyboard) => {
      finishKeyboard(prompts.map(() => password));
    });
    conn.connect({
      host: target.host,
      port: target.port,
      username: String(connection?.username || 'root').trim() || 'root',
      password,
      readyTimeout: 1000 * 30,
      keepaliveInterval: 1000 * 10,
      keepaliveCountMax: 3,
      tryKeyboard: true
    });
  });
}

function execSshCommand(conn, command, { pipeToTerminal = false, event, sessionKey = 'default' } = {}) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (error, stream) => {
      if (error) { reject(error); return; }
      let stdout = '';
      let stderr = '';
      stream.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        if (pipeToTerminal) pushTerminalMessage(event, sessionKey, text);
      });
      stream.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        if (pipeToTerminal) pushTerminalMessage(event, sessionKey, text);
      });
      stream.on('close', (code) => {
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(stderr.trim() || stdout.trim() || `SSH exited with ${code}`));
      });
    });
  });
}

function shellQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\\''`)}'`;
}

function normalizePreseedFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.map((item, index) => {
    if (!item || typeof item !== 'object') return null;
    const source = String(item.source || item.path || item.from || '').trim();
    const targetPath = String(item.targetPath || item.target_path || item.target || item.to || item.dest || '').trim();
    if (!source || !targetPath) return null;
    return {
      id: String(item.id || `file-${index + 1}`).trim(),
      source,
      targetPath,
      optional: item.optional === true
    };
  }).filter(Boolean);
}

function resolveLocalPreseedFiles(files, packageDir = '') {
  const baseDir = String(packageDir || '').trim()
    ? path.resolve(String(packageDir || '').trim())
    : process.cwd();

  return normalizePreseedFiles(files).map((file) => {
    const localPath = path.isAbsolute(file.source)
      ? path.resolve(file.source)
      : path.resolve(baseDir, file.source);
    const remotePath = file.targetPath.endsWith('/')
      ? path.posix.join(file.targetPath, path.posix.basename(file.source))
      : file.targetPath;
    return {
      ...file,
      localPath,
      remotePath
    };
  });
}

function openSftp(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((error, sftp) => {
      if (error) reject(error);
      else resolve(sftp);
    });
  });
}

function sftpFastPut(sftp, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function uploadPreseedFilesOverSsh(conn, event, files, packageDir = '', sessionKey = 'default', { announce = false } = {}) {
  const resolvedFiles = resolveLocalPreseedFiles(files, packageDir);
  if (!resolvedFiles.length) return { ok: true, skipped: true };

  const sftp = await openSftp(conn);
  try {
    for (const file of resolvedFiles) {
      const exists = fsSync.existsSync(file.localPath);
      if (!exists) {
        if (file.optional) continue;
        throw new Error(`Preseed file not found: ${file.localPath}`);
      }

      const remoteDir = path.posix.dirname(file.remotePath);
      await execSshCommand(conn, `mkdir -p ${shellQuote(remoteDir)}`);
      if (announce) {
        pushTerminalMessage(event, sessionKey, `\r\n--- 正在下发文件 ${path.basename(file.localPath)} -> ${file.remotePath} ---\r\n`);
      }
      await sftpFastPut(sftp, file.localPath, file.remotePath);
    }
    return { ok: true };
  } finally {
    try { if (typeof sftp.end === 'function') sftp.end(); } catch {}
  }
}

async function runSetupScriptOverSsh(event, connection, script, sessionKey = 'default') {
  const host = String(connection?.host || '').trim();
  const setupScript = String(script || '').trim();
  if (!host || !setupScript) return { ok: true, skipped: true };
  const encodedScript = Buffer.from(setupScript, 'utf8').toString('base64');
  const remoteCommand = `cat <<'__LABBOX_SETUP__' | base64 -d | bash\n${encodedScript}\n__LABBOX_SETUP__`;
  pushTerminalMessage(event, sessionKey, '\r\n--- 系统正在初始化实验环境 ---\r\n');
  const conn = await connectSsh(connection);
  try {
    await execSshCommand(conn, remoteCommand, { pipeToTerminal: true, event, sessionKey });
    pushTerminalMessage(event, sessionKey, '\r\n--- 实验环境初始化完成 ---\r\n');
    return { ok: true };
  } finally {
    conn.end();
  }
}

async function bootstrapResourceOverSsh(event, connection, { script = '', files = [], packageDir = '', announceFiles = false } = {}, sessionKey = 'default') {
  const host = String(connection?.host || '').trim();
  const setupScript = String(script || '').trim();
  const normalizedFiles = normalizePreseedFiles(files);
  if (!host || (!setupScript && !normalizedFiles.length)) return { ok: true, skipped: true };

  const conn = await connectSsh(connection);
  try {
    if (normalizedFiles.length) {
      await uploadPreseedFilesOverSsh(conn, event, normalizedFiles, packageDir, sessionKey, { announce: announceFiles });
    }
    if (setupScript) {
      const encodedScript = Buffer.from(setupScript, 'utf8').toString('base64');
      const remoteCommand = `cat <<'__LABBOX_SETUP__' | base64 -d | bash\n${encodedScript}\n__LABBOX_SETUP__`;
      pushTerminalMessage(event, sessionKey, '\r\n--- 系统正在初始化实验环境 ---\r\n');
      await execSshCommand(conn, remoteCommand, { pipeToTerminal: true, event, sessionKey });
      pushTerminalMessage(event, sessionKey, '\r\n--- 实验环境初始化完成 ---\r\n');
    }
    return { ok: true };
  } finally {
    conn.end();
  }
}

async function waitForSshReady(connection, { attempts = 12, delayMs = 5000, event = null, sessionKey = 'default' } = {}) {
  const host = String(connection?.host || '').trim();
  if (!host) throw new Error('Missing SSH host.');

  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let conn = null;
    try {
      conn = await connectSsh(connection);
      conn.end();
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        if (event) {
          pushTerminalMessage(event, sessionKey, `\r\n--- SSH 尚未就绪，正在重试 (${attempt + 1}/${attempts}) ---\r\n`);
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    } finally {
      try { if (conn) conn.end(); } catch {}
    }
  }

  throw lastError || new Error('SSH is not ready yet.');
}

function getVmrunExe(settings = {}, fallbackPath = '') {
  return String(settings?.vmrunPath || fallbackPath || '').trim();
}

function getVmSuspendDelayMs(settings = {}) {
  const seconds = Number(settings?.vmSuspendSeconds || 300);
  return Math.max(0, seconds) * 1000;
}

function isVmAlreadyRunningError(error) {
  return /already running|cannot start because.*running|is in use/i.test(String(error?.stderr || error?.message || ''));
}

function isVmNotRunningError(error) {
  return /not running|not powered on|cannot suspend/i.test(String(error?.stderr || error?.message || ''));
}

function getVmDirectory(vmxPath = '') {
  const normalized = path.win32.normalize(String(vmxPath || '').trim());
  return normalized ? path.win32.dirname(normalized) : '';
}

function hasSuspendArtifact(vmxPath = '') {
  const vmDir = getVmDirectory(vmxPath);
  if (!vmDir || !fsSync.existsSync(vmDir)) return false;
  try {
    return fsSync.readdirSync(vmDir).some((entry) => entry.toLowerCase().endsWith('.vmss'));
  } catch {
    return false;
  }
}

async function waitForVmSuspendState(vmxPath = '', timeoutMs = 10000) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (Date.now() < deadline) {
    if (hasSuspendArtifact(vmxPath)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return hasSuspendArtifact(vmxPath);
}

async function runVmrunCommand(vmrunExe, args, options = {}) {
  if (!vmrunExe) throw new Error('Missing vmrun path.');
  return execFileAsync(vmrunExe, ['-T', 'ws', ...args], options);
}

async function ensureVmInstanceActive(instance, settings = {}, fallbackVmrunExe = '') {
  if (instance?.providerType !== 'vmware_vm' || !instance?.vmxPath) return;
  const vmrunExe = getVmrunExe(settings, fallbackVmrunExe);
  try {
    await runVmrunCommand(vmrunExe, ['start', instance.vmxPath, 'nogui'], { timeout: 1000 * 60 });
  } catch (error) {
    if (!isVmAlreadyRunningError(error)) throw error;
  }
}

async function suspendVmInstance(instance, settings = {}, fallbackVmrunExe = '') {
  if (instance?.providerType !== 'vmware_vm' || !instance?.vmxPath) return;
  const vmrunExe = getVmrunExe(settings, fallbackVmrunExe);
  try {
    await runVmrunCommand(vmrunExe, ['suspend', instance.vmxPath], { timeout: 1000 * 60 });
  } catch (error) {
    if (isVmNotRunningError(error)) return;
    const suspended = await waitForVmSuspendState(instance.vmxPath, 10000);
    if (!suspended) throw error;
  }
}

async function suspendInstancesImmediately(instances = [], settings = {}, fallbackVmrunExe = '') {
  const uniqueInstances = Array.isArray(instances)
    ? instances.filter((instance, index, list) => {
        const instanceId = String(instance?.id || '').trim();
        if (!instanceId) return false;
        return list.findIndex((item) => String(item?.id || '').trim() === instanceId) === index;
      })
    : [];

  for (const instance of uniqueInstances) {
    await suspendVmInstance(instance, settings, fallbackVmrunExe);
  }
}

function registerRuntimeIpc({
  ipcMain,
  RESOURCE_INSTANCE_DIR,
  pushResourceStatus,
  resolveVmwarePaths,
  ensureBaseVmReady,
  cloneBaseVm,
  capturePreparedSnapshot,
  restorePreparedSnapshot,
  deleteManagedCloneFiles,
  DEFAULT_VMRUN_EXE
}) {
  const sshSessions = new Map();
  let localProcess = null;
  const suspendTimers = new Map();

  function getSshSession(sessionKey = 'default') {
    const key = String(sessionKey || 'default');
    if (!sshSessions.has(key)) {
      sshSessions.set(key, {
        key,
        ptyProcess: null,
        conn: null,
        shellStream: null,
        connectionConfig: null,
        status: 'idle',
        connected: false
      });
    }
    return sshSessions.get(key);
  }

  function clearSshSession(sessionKey = 'default') {
    const session = getSshSession(sessionKey);
    try { if (session.ptyProcess) session.ptyProcess.kill(); } catch {}
    try { if (session.shellStream) session.shellStream.end(); } catch {}
    try { if (session.conn) session.conn.end(); } catch {}
    session.ptyProcess = null;
    session.conn = null;
    session.shellStream = null;
    session.connectionConfig = null;
    session.connected = false;
    session.status = 'disconnected';
  }

  function replySshStatus(event, sessionKey, status) {
    event.reply('ssh-status', { sessionKey, status });
  }

  function replyTerminalIncoming(event, sessionKey, data) {
    event.reply('terminal-incoming', { sessionKey, data });
  }

  ipcMain.on('ssh-connect', (event, config) => {
    const sessionKey = String(config?.sessionKey || 'default');
    const session = getSshSession(sessionKey);
    const cols = Number(config?.cols || 120);
    const rows = Number(config?.rows || 32);

    const target = parseConnectionTarget(config?.host);
    const username = String(config?.username || 'root').trim() || 'root';
    const password = String(config?.password || '');

    if (!target.host) {
      replySshStatus(event, sessionKey, 'Connection Error: Missing host');
      return;
    }

    clearSshSession(sessionKey);
    session.connectionConfig = {
      host: target.host,
      port: target.port,
      username,
      password
    };
    session.status = 'connecting';
    session.connected = false;
    replySshStatus(event, sessionKey, 'connecting');

    const conn = new Client();
    session.conn = conn;

    conn.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finishKeyboard) => {
      finishKeyboard(prompts.map(() => password));
    });

    conn.on('banner', (message) => {
      replyTerminalIncoming(event, sessionKey, String(message || ''));
    });

    conn.on('ready', () => {
      conn.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) {
          session.status = `Shell Error: ${err.message}`;
          session.connected = false;
          replySshStatus(event, sessionKey, session.status);
          try { conn.end(); } catch {}
          return;
        }

        if (session.conn !== conn) {
          try { stream.end(); } catch {}
          try { conn.end(); } catch {}
          return;
        }

        session.shellStream = stream;
        session.status = 'connected';
        session.connected = true;
        replySshStatus(event, sessionKey, 'connected');

        stream.on('data', (d) => replyTerminalIncoming(event, sessionKey, d.toString()));
        if (stream.stderr && typeof stream.stderr.on === 'function') {
          stream.stderr.on('data', (d) => replyTerminalIncoming(event, sessionKey, d.toString()));
        }
        stream.on('close', () => {
          if (session.conn === conn) {
            session.shellStream = null;
            session.connected = false;
            session.status = 'disconnected';
            replySshStatus(event, sessionKey, 'disconnected');
          }
          try { conn.end(); } catch {}
        });
      });
    }).on('error', (err) => {
      if (session.conn !== conn) return;
      session.connected = false;
      session.status = `Connection Error: ${err.message}`;
      replySshStatus(event, sessionKey, session.status);
    }).on('close', () => {
      if (session.conn !== conn) return;
      session.conn = null;
      if (!session.shellStream) {
        session.connected = false;
        if (session.status === 'connected' || session.status === 'connecting') {
          session.status = 'disconnected';
          replySshStatus(event, sessionKey, 'disconnected');
        }
      }
    }).connect({
      host: target.host,
      port: target.port,
      username,
      password,
      readyTimeout: 30000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
      tryKeyboard: true
    });
  });

  ipcMain.on('terminal-input', (event, { data, sessionKey }) => {
    const session = getSshSession(sessionKey);
    if (session.ptyProcess) {
      session.ptyProcess.write(data);
    } else if (session.shellStream) { 
      // 核心修复：去掉 && session.connected 的严格限制
      // 只要 shellStream 流存在（哪怕状态还没同步为 connected），就尝试写入
      try {
        session.shellStream.write(data);
      } catch (e) {
        // 防止流正在关闭时写入导致的崩溃
        console.error("Terminal input delivery failed:", e);
      }
    }
  });

  ipcMain.on('terminal-resize', (event, { sessionKey, cols, rows }) => {
      const session = getSshSession(sessionKey);
      const c = Number(cols);
      const r = Number(rows);
      if (c <= 0 || r <= 0) return;
      
      // 1. 鍚屾 node-pty (濡傛灉鍔犺浇浜嗘湰鍦?SSH 瀹㈡埛绔?
      if (session.ptyProcess) {
          try { session.ptyProcess.resize(c, r); } catch(e){}
      }
      
      // 2. 鍚屾杩滅▼ SSH 娴?(鏍稿績锛氳В鍐?vi/top 鍏ㄥ睆闂)
       if (session.shellStream) {
           try { session.shellStream.setWindow(r, c, 0, 0); } catch(e){}
       }
   });

  ipcMain.handle('set-lab-activity', async (event, payload = {}) => {
    const settings = payload?.settings || {};
    const activeInstances = Array.isArray(payload?.activeInstances) ? payload.activeInstances : [];
    const previousInstances = Array.isArray(payload?.previousInstances) ? payload.previousInstances : [];
    const activeIds = new Set(activeInstances.map((item) => String(item?.id || '')).filter(Boolean));

    activeIds.forEach((instanceId) => {
      const timer = suspendTimers.get(instanceId);
      if (timer) {
        clearTimeout(timer);
        suspendTimers.delete(instanceId);
      }
    });

    const suspendDelayMs = getVmSuspendDelayMs(settings);
    previousInstances.forEach((instance) => {
      const instanceId = String(instance?.id || '').trim();
      if (!instanceId || activeIds.has(instanceId) || instance?.providerType !== 'vmware_vm' || !instance?.vmxPath) return;

      const existingTimer = suspendTimers.get(instanceId);
      if (existingTimer) clearTimeout(existingTimer);

      if (suspendDelayMs <= 0) return;
      const timer = setTimeout(async () => {
        suspendTimers.delete(instanceId);
        try {
          await suspendVmInstance(instance, settings, DEFAULT_VMRUN_EXE);
        } catch {}
      }, suspendDelayMs);
      suspendTimers.set(instanceId, timer);
    });

    for (const instance of activeInstances) {
      try {
        await ensureVmInstanceActive(instance, settings, DEFAULT_VMRUN_EXE);
      } catch {}
    }

    return { ok: true };
  });

  ipcMain.handle('leave-lab-now', async (event, payload = {}) => {
    const settings = payload?.settings || {};
    const activeInstances = Array.isArray(payload?.activeInstances) ? payload.activeInstances : [];

    activeInstances.forEach((instance) => {
      const instanceId = String(instance?.id || '').trim();
      if (!instanceId) return;
      const timer = suspendTimers.get(instanceId);
      if (timer) {
        clearTimeout(timer);
        suspendTimers.delete(instanceId);
      }
    });

    try {
      await suspendInstancesImmediately(activeInstances, settings, DEFAULT_VMRUN_EXE);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('initialize-resource', async (event, payload) => {
    try {
      const instanceId = payload?.instanceId;
      const profile = payload?.profile || {};
      const settings = payload?.settings || {};
      const statusKey = payload?.statusKey || instanceId;
      const setupSessionKey = payload?.context?.labId && payload?.context?.resourceName
        ? `${payload.context.labId}:${payload.context.resourceName}`
        : 'default';

      if (!instanceId || !profile.providerType) throw new Error('Missing instanceId or profile');

      const instanceDir = path.join(RESOURCE_INSTANCE_DIR, instanceId);
      await fs.mkdir(instanceDir, { recursive: true });

      let instance;
      if (profile.providerType === 'vmware_vm') {
        const cfg = resolveVmwarePaths(profile, settings);
        await ensureBaseVmReady(profile, cfg, { statusKey, title: profile.name });
        instance = await cloneBaseVm(profile, payload.context, instanceId, cfg, { statusKey, title: profile.name });
        if (payload.setupScript && instance.connection?.host) {
          await bootstrapResourceOverSsh(event, instance.connection, {
            script: payload.setupScript,
            files: [],
            packageDir: payload?.context?.packageDir || ''
          }, setupSessionKey);
        }
        instance = await capturePreparedSnapshot(profile, instance, cfg, { statusKey, title: profile.name });
      } else {
        throw new Error('Unsupported provider for init');
      }

      if (instance.connection?.host) {
        await waitForSshReady(instance.connection, { event, sessionKey: setupSessionKey });
      }

      pushResourceStatus({ statusKey, state: 'ready', progressPercent: 100, message: '环境已就绪' });
      return { ok: true, instance };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('apply-resource-files', async (event, payload = {}) => {
    try {
      const connection = payload?.connection || {};
      const packageDir = String(payload?.packageDir || '').trim();
      const sessionKey = String(payload?.sessionKey || 'default');
      const files = normalizePreseedFiles(payload?.files || []);

      if (!String(connection.host || '').trim()) throw new Error('当前资源还没有可用的 SSH 地址。');
      if (!files.length) return { ok: true, skipped: true, count: 0 };

      await waitForSshReady(connection, { event, sessionKey, attempts: 6, delayMs: 3000 });
      await bootstrapResourceOverSsh(event, connection, { script: '', files, packageDir, announceFiles: true }, sessionKey);
      const session = getSshSession(sessionKey);
      if (session?.shellStream && session.connected) {
        try {
          session.shellStream.write('\n');
        } catch {}
      } else {
        pushTerminalMessage(event, sessionKey, '\r\n');
      }
      return { ok: true, count: files.length };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('reset-resource-environment', async (event, payload) => {
    try {
      const instanceId = String(payload?.instanceId || '').trim();
      const profile = payload?.profile || {};
      const settings = payload?.settings || {};
      const instance = payload?.instance || {};
      const statusKey = payload?.statusKey || profile.reuseKey || instanceId;
      const setupSessionKey = payload?.context?.labId && payload?.context?.resourceName
        ? `${payload.context.labId}:${payload.context.resourceName}`
        : 'default';

      if (!instanceId || !profile.providerType) throw new Error('Missing instanceId or profile');
      if (profile.providerType !== 'vmware_vm') throw new Error('当前资源不支持环境重置。');

      const cfg = resolveVmwarePaths(profile, settings);
      let nextInstance;

      try {
        nextInstance = await restorePreparedSnapshot(profile, instance, cfg, { statusKey, title: profile.name });
      } catch (error) {
        const canRecreate = instance?.createdByApp && /初始快照|snapshot/i.test(String(error?.message || ""));
        if (!canRecreate) throw error;
        await deleteManagedCloneFiles(instance, cfg);
        await ensureBaseVmReady(profile, cfg, { statusKey, title: profile.name });
        nextInstance = await cloneBaseVm(profile, payload.context, instanceId, cfg, { statusKey, title: profile.name });
        if (payload.setupScript && nextInstance.connection?.host) {
          await bootstrapResourceOverSsh(event, nextInstance.connection, {
            script: payload.setupScript,
            files: [],
            packageDir: payload?.context?.packageDir || ''
          }, setupSessionKey);
        }
        nextInstance = await capturePreparedSnapshot(profile, nextInstance, cfg, { statusKey, title: profile.name });
      }

      if (nextInstance.connection?.host) {
        await waitForSshReady(nextInstance.connection, { event, sessionKey: setupSessionKey });
      }

      pushResourceStatus({ statusKey, state: 'ready', progressPercent: 100, message: '环境已重置' });
      return { ok: true, instance: nextInstance };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('delete-resource-instance', async (event, payload) => {
    try {
      const instanceId = String(payload?.instanceId || '').trim();
      const instance = payload?.instance || {};
      const settings = payload?.settings || {};
      if (!instanceId) return { ok: false, error: 'Missing ID' };
      const timer = suspendTimers.get(instanceId);
      if (timer) {
        clearTimeout(timer);
        suspendTimers.delete(instanceId);
      }
      if (instance?.providerType === 'vmware_vm' && instance?.createdByApp) {
        await deleteManagedCloneFiles(instance, {
          vmrunExe: getVmrunExe(settings, DEFAULT_VMRUN_EXE),
          labRootDir: settings.labRootDir
        });
      }
      const instanceDir = path.join(RESOURCE_INSTANCE_DIR, instanceId);
      if (fsSync.existsSync(instanceDir)) await fs.rm(instanceDir, { recursive: true, force: true });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.on('init-local-shell', (event) => {
    if (localProcess) localProcess.kill();
    const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
    localProcess = spawn(shell, [], { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    localProcess.stdout.on('data', (d) => event.reply('terminal-incoming', d.toString()));
    localProcess.stderr.on('data', (d) => event.reply('terminal-incoming', d.toString()));
  });

  ipcMain.handle('upload-file-to-resource', async (event, payload = {}) => {
    try {
      const sessionKey = String(payload?.sessionKey || 'default');
      const localPath = String(payload?.localPath || '').trim();
      const remotePath = String(payload?.remotePath || '').trim();
      const session = getSshSession(sessionKey);

      if (!session || !session.conn || !session.connected) {
        throw new Error('SSH 连接未就绪。');
      }
      if (!localPath) throw new Error('未指定本地文件路径。');

      const fileName = path.basename(localPath);
      const targetPath = remotePath ? (remotePath.endsWith('/') ? remotePath + fileName : remotePath) : `/root/${fileName}`;

      return new Promise((resolve, reject) => {
        session.conn.sftp((err, sftp) => {
          if (err) return reject(new Error('SFTP 初始化失败: ' + err.message));
          
          const readStream = fsSync.createReadStream(localPath);
          const writeStream = sftp.createWriteStream(targetPath);

          writeStream.on('close', () => {
            pushTerminalMessage(event, sessionKey, `\r\n[系统] 文件已上传至: ${targetPath}\r\n`);
            
            // 自动发送一个回车给 Shell，以刷新提示符
            if (session.shellStream) {
              try {
                session.shellStream.write('\n');
              } catch (e) {
                console.error("Failed to send newline after upload:", e);
              }
            }
            
            resolve({ ok: true, path: targetPath });
          });

          writeStream.on('error', (err) => {
            reject(new Error('文件写入失败: ' + err.message));
          });

          readStream.on('error', (err) => {
            reject(new Error('读取本地文件失败: ' + err.message));
          });

          readStream.pipe(writeStream);
        });
      });
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('verify-lab', async (event, payload = {}) => {
    const { cmd, sessionKey, connection, background } = payload;
    const session = getSshSession(sessionKey);
    if (!String(cmd || '').trim()) return false;

    const explicitConnection = connection && typeof connection === 'object' && String(connection.host || '').trim()
      ? connection
      : null;
    const tempConnection = explicitConnection || session.connectionConfig;

    if (!background && session.conn) {
      try {
        await execSshCommand(session.conn, cmd);
        return true;
      } catch {
        return false;
      }
    }

    if (tempConnection) {
      let tempConn = null;
      try {
        tempConn = await connectSsh(tempConnection);
        await execSshCommand(tempConn, cmd);
        return true;
      } catch {
        return false;
      } finally {
        try { if (tempConn) tempConn.end(); } catch {}
      }
    }

    if (session.conn) {
      try {
        await execSshCommand(session.conn, cmd);
        return true;
      } catch {
        return false;
      }
    }

    return false;
  });
}

module.exports = { registerRuntimeIpc };
