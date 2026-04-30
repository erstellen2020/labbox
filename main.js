const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const fsSync = require('fs');
const { execFile } = require('child_process');
const { registerStorageIpc } = require('./main-storage');
const {
  registerVmwareIpc,
  resolveVmwarePaths,
  getBaseVmVmxPath,
  getVmRootDir,
  findNamedVmx,
  flattenNestedVmFolder,
  BASE_VM_NAME,
  BASE_SNAPSHOT_NAME,
  DEFAULT_OVFTOOL_EXE,
  DEFAULT_VMRUN_EXE,
  addManualVmPath,
  removeManualVmPath
} = require('./main-vmware');
const { registerRuntimeIpc } = require('./main-runtime');

function ignoreBrokenPipe(stream) {
  if (!stream || typeof stream.on !== 'function') return;
  stream.on('error', (error) => {
    if (error?.code === 'EPIPE') return;
    throw error;
  });
}

ignoreBrokenPipe(process.stdout);
ignoreBrokenPipe(process.stderr);

process.on('uncaughtException', (error) => {
  if (error?.code === 'EPIPE') return;
  throw error;
});

const STORAGE_DIR = 'D:\\labox\\LinuxPathData';
const STORAGE_FILE = path.join(STORAGE_DIR, 'courses_config.json');
const MANUAL_ASSET_DIR = path.join(STORAGE_DIR, 'manual_assets');
const RESOURCE_INSTANCE_DIR = path.join(STORAGE_DIR, 'resource_instances');
const VMWARE_ROOT_DIR = path.join(STORAGE_DIR, 'vmware_runtime');
const ELECTRON_DATA_DIR = path.join(STORAGE_DIR, 'electron_runtime');
const ELECTRON_CACHE_DIR = path.join(ELECTRON_DATA_DIR, 'cache');
const LAB_READY_SNAPSHOT_NAME = 'lab_ready';

[STORAGE_DIR, MANUAL_ASSET_DIR, RESOURCE_INSTANCE_DIR, VMWARE_ROOT_DIR, ELECTRON_DATA_DIR, ELECTRON_CACHE_DIR].forEach((dirPath) => {
  if (!fsSync.existsSync(dirPath)) fsSync.mkdirSync(dirPath, { recursive: true });
});

app.setPath('userData', ELECTRON_DATA_DIR);
app.setPath('sessionData', ELECTRON_DATA_DIR);
app.commandLine.appendSwitch('disk-cache-dir', ELECTRON_CACHE_DIR);
app.commandLine.appendSwitch('user-data-dir', ELECTRON_DATA_DIR);

let mainWindow = null;

function pushResourceStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('resource-status', payload);
  }
}

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

function assertPathWithin(rootDir, targetPath) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(targetPath);
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(rootWithSep)) {
    throw new Error(`Refusing to touch unmanaged path: ${resolvedTarget}`);
  }
  return resolvedTarget;
}

function slugifyVmName(value, fallback = 'linux-lab') {
  return String(value || '')
    .trim()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || fallback;
}

function scanVmxFiles(rootDir, collector = []) {
  if (!rootDir || !fsSync.existsSync(rootDir)) return collector;
  const entries = fsSync.readdirSync(rootDir, { withFileTypes: true });
  entries.forEach((entry) => {
    const fullPath = path.win32.join(rootDir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.vmx')) {
      collector.push(fullPath);
      return;
    }
    if (entry.isDirectory()) {
      scanVmxFiles(fullPath, collector);
    }
  });
  return collector;
}

function readVmxDisplayName(vmxPath) {
  try {
    const content = fsSync.readFileSync(vmxPath, 'utf8');
    const matched = content.match(/^\s*displayName\s*=\s*"(.+)"\s*$/m);
    return matched?.[1]?.trim() || path.win32.basename(vmxPath, '.vmx');
  } catch {
    return path.win32.basename(vmxPath, '.vmx');
  }
}

async function writeVmxDisplayName(vmxPath, displayName) {
  const desiredName = String(displayName || '').trim();
  if (!desiredName) return;
  const content = await fs.readFile(vmxPath, 'utf8');
  const sanitizedContent = content.replace(/^\s*displayname\s*=\s*".*"\s*$(?:\r?\n)?/gim, '');
  const nextContent = `${sanitizedContent.trimEnd()}\r\ndisplayName = "${desiredName}"\r\n`;
  await fs.writeFile(vmxPath, nextContent, 'utf8');
}

async function sanitizeCloneVmx(vmxPath, displayName, hardware = {}) {
  const cpuCount = Math.max(1, Number(hardware.vmCpu || hardware.cpu || 1) || 1);
  const memoryMB = Math.max(256, Number(hardware.vmMemoryMB || hardware.memoryMB || hardware.memory || 1024) || 1024);
  const content = await fs.readFile(vmxPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const preservedLines = lines.filter((line) => {
    const key = String(line.split('=')[0] || '').trim().toLowerCase();
    return ![
      'displayname',
      'numvcpus',
      'memsize',
      'ide1:0.filename',
      'ide1:0.present',
      'ide1:0.startconnected',
      'filesearchpath'
    ].includes(key);
  });
  const nextContent = `${preservedLines.join('\r\n').trimEnd()}\r\ndisplayName = "${displayName}"\r\nnumvcpus = "${cpuCount}"\r\nmemsize = "${memoryMB}"\r\nide1:0.present = "FALSE"\r\nide1:0.startConnected = "FALSE"\r\n`;
  await fs.writeFile(vmxPath, nextContent, 'utf8');
}

async function buildVmrunStartError(cfg, vmxPath, error) {
  const baseMessage = String(error?.stderr || error?.message || 'vmrun start failed').trim();
  let diagnostics = '';
  try {
    await runVmrun(cfg, ['list']);
  } catch (listError) {
    diagnostics = String(listError?.stderr || listError?.message || '').trim();
  }

  const detail = [
    `启动虚拟机失败：${vmxPath}`,
    baseMessage
  ];
  if (diagnostics) detail.push(`vmrun list 诊断：${diagnostics}`);
  detail.push('可先关闭并重新打开 VMware Workstation，再重试初始化。');
  return detail.join('\n');
}

function formatLabVmName(index) {
  const numeric = Number(index) || 1;
  return numeric <= 999 ? `lab${String(numeric).padStart(3, '0')}` : `lab${numeric}`;
}

function collectExistingLabVmIndexes(vmRootDir) {
  const indexes = new Set();
  const recordName = (value) => {
    const matched = String(value || '').trim().match(/^lab(\d+)$/i);
    if (matched) indexes.add(Number(matched[1]));
  };

  if (vmRootDir && fsSync.existsSync(vmRootDir)) {
    fsSync.readdirSync(vmRootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .forEach((entry) => recordName(entry.name));
  }

  scanVmxFiles(vmRootDir).forEach((vmxPath) => {
    recordName(path.win32.basename(vmxPath, '.vmx'));
    recordName(readVmxDisplayName(vmxPath));
  });

  scanVmxFiles(RESOURCE_INSTANCE_DIR).forEach((vmxPath) => {
    recordName(path.win32.basename(vmxPath, '.vmx'));
    recordName(readVmxDisplayName(vmxPath));
  });

  return indexes;
}

function buildVmIdentity(context, instanceId, vmRootDir) {
  const resourceName = String(context?.resourceName || context?.labTitle || 'service').trim() || 'service';
  const existingIndexes = collectExistingLabVmIndexes(vmRootDir);
  let nextIndex = 1;
  while (existingIndexes.has(nextIndex)) nextIndex += 1;
  const vmName = formatLabVmName(nextIndex);

  return {
    folderName: vmName,
    displayName: vmName,
    resourceName
  };
}

async function createUniqueCloneDir(parentDir, folderName) {
  let candidateDir = path.win32.join(parentDir, folderName);
  let suffix = 2;
  while (fsSync.existsSync(candidateDir)) {
    candidateDir = path.win32.join(parentDir, `${folderName}-${suffix}`);
    suffix += 1;
  }
  await fs.mkdir(candidateDir, { recursive: true });
  return candidateDir;
}

async function readStoredSettings() {
  try {
    if (!fsSync.existsSync(STORAGE_FILE)) return {};
    const data = JSON.parse(await fs.readFile(STORAGE_FILE, 'utf8'));
    return data?.settings || {};
  } catch {
    return {};
  }
}

async function runVmrun(cfg, args, options = {}) {
  return execFileAsync(cfg.vmrunExe, ['-T', 'ws', ...args], options);
}

function isVmrunPowerStateError(error) {
  const message = String(error?.stderr || error?.stdout || error?.message || '');
  return /not powered on|not running|invalid power state|suspended/i.test(message);
}

async function stopVmIfRunning(cfg, vmxPath) {
  try {
    await runVmrun(cfg, ['stop', vmxPath, 'soft'], { timeout: 1000 * 60 });
    return;
  } catch (error) {
    if (isVmrunPowerStateError(error)) return;
  }

  try {
    await runVmrun(cfg, ['stop', vmxPath, 'hard'], { timeout: 1000 * 30 });
  } catch (error) {
    if (!isVmrunPowerStateError(error)) throw error;
  }
}

async function listVmSnapshots(cfg, vmxPath) {
  try {
    const result = await runVmrun(cfg, ['listSnapshots', vmxPath]);
    return String(result.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^total snapshots/i.test(line));
  } catch {
    return [];
  }
}

async function deleteSnapshotIfExists(cfg, vmxPath, snapshotName) {
  const snapshots = await listVmSnapshots(cfg, vmxPath);
  if (!snapshots.includes(snapshotName)) return;
  try {
    await runVmrun(cfg, ['deleteSnapshot', vmxPath, snapshotName]);
  } catch {}
}

async function waitForVmIp(cfg, vmxPath, timeoutMs = 1000 * 60 * 10) {
  const result = await runVmrun(cfg, ['getGuestIPAddress', vmxPath, '-wait'], { timeout: timeoutMs });
  return String(result.stdout || '').trim();
}

async function deleteManagedCloneFiles(instance, cfg) {
  const vmxPath = String(instance?.vmxPath || '').trim();
  if (!vmxPath) return;
  const workspaceDir = String(instance?.workspaceDir || path.win32.dirname(vmxPath)).trim();
  if (!workspaceDir) {
    removeManualVmPath(ELECTRON_DATA_DIR, vmxPath);
    return;
  }
  const managedRoots = [
    getVmRootDir({ labRootDir: cfg.labRootDir }),
    RESOURCE_INSTANCE_DIR
  ];
  const isManagedPath = managedRoots.some((rootDir) => {
    try {
      assertPathWithin(rootDir, workspaceDir);
      return true;
    } catch {
      return false;
    }
  });
  if (!isManagedPath) {
    throw new Error(`Refusing to delete unmanaged VM workspace: ${workspaceDir}`);
  }
  const vmxExists = fsSync.existsSync(vmxPath);
  const workspaceExists = fsSync.existsSync(workspaceDir);
  if (vmxExists) {
    try {
      await stopVmIfRunning(cfg, vmxPath);
    } catch {}
  }
  if (workspaceExists) {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
  removeManualVmPath(ELECTRON_DATA_DIR, vmxPath);
}

// Override legacy snapshot helpers with the current "running-state snapshot" behavior.
async function capturePreparedSnapshot(profile, instance, cfg, statusMeta = {}) {
  if (!instance?.vmxPath) throw new Error('Missing VMX path for prepared snapshot.');
  pushResourceStatus({ ...statusMeta, state: 'provisioning', progressPercent: 97, message: '正在保存实验初始快照...' });
  const snapshots = await listVmSnapshots(cfg, instance.vmxPath);
  if (!snapshots.includes(LAB_READY_SNAPSHOT_NAME)) {
    await runVmrun(cfg, ['snapshot', instance.vmxPath, LAB_READY_SNAPSHOT_NAME]);
  }
  pushResourceStatus({ ...statusMeta, state: 'provisioning', progressPercent: 98, message: '实验初始快照已记录。' });
  return {
    ...instance,
    status: 'ready',
    resetSnapshot: LAB_READY_SNAPSHOT_NAME,
    lastUsedAt: new Date().toISOString(),
    connection: {
      ...(instance.connection || {}),
      host: instance.connection?.host || ''
    }
  };
}

async function restorePreparedSnapshot(profile, instance, cfg, statusMeta = {}) {
  if (!instance?.vmxPath) throw new Error('Missing VMX path for reset.');
  const snapshotName = String(instance.resetSnapshot || LAB_READY_SNAPSHOT_NAME).trim() || LAB_READY_SNAPSHOT_NAME;
  const snapshots = await listVmSnapshots(cfg, instance.vmxPath);
  if (!snapshots.includes(snapshotName)) {
    throw new Error('当前环境还没有可恢复的实验初始快照。');
  }

  pushResourceStatus({ ...statusMeta, state: 'provisioning', progressPercent: 35, message: '正在恢复实验初始快照...' });
  await runVmrun(cfg, ['revertToSnapshot', instance.vmxPath, snapshotName]);

  let ip = '';
  try {
    pushResourceStatus({ ...statusMeta, state: 'provisioning', progressPercent: 72, message: '正在等待快照中的开机状态恢复...' });
    ip = await waitForVmIp(cfg, instance.vmxPath, 1000 * 60 * 2);
  } catch {
    pushResourceStatus({ ...statusMeta, state: 'provisioning', progressPercent: 72, message: '正在重新启动实验环境...' });
    await runVmrun(cfg, ['start', instance.vmxPath, 'nogui']);
    ip = await waitForVmIp(cfg, instance.vmxPath);
  }

  return {
    ...instance,
    status: 'ready',
    resetSnapshot: snapshotName,
    lastUsedAt: new Date().toISOString(),
    connection: {
      host: ip,
      username: profile?.guestUsername || instance.connection?.username || 'root',
      password: profile?.guestPassword || instance.connection?.password || ''
    }
  };
}

async function importBaseVmFromOva(cfg, statusMeta = {}) {
  pushResourceStatus({ ...statusMeta, state: 'provisioning', progressPercent: 22, message: '正在导入 RockyBase 模板...' });
  const targetRoot = getVmRootDir({ labRootDir: cfg.labRootDir });
  const targetDir = path.win32.join(targetRoot, BASE_VM_NAME);
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetRoot, { recursive: true });
  await execFileAsync(cfg.ovftoolExe, ['--acceptAllEulas', '--overwrite', `--name=${BASE_VM_NAME}`, cfg.ovaPath, targetRoot]);
  flattenNestedVmFolder(targetDir, BASE_VM_NAME);
  const actualVmx = findNamedVmx(targetDir, BASE_VM_NAME) || getBaseVmVmxPath({ rockyOvaPath: cfg.ovaPath, labRootDir: cfg.labRootDir }, { ovaPath: cfg.ovaPath });
  if (!actualVmx) throw new Error('RockyBase 导入完成，但没有找到生成的 VMX 文件。');
  addManualVmPath(ELECTRON_DATA_DIR, actualVmx);
}

async function ensureBaseVmReady(profile, cfg, statusMeta = {}) {
  pushResourceStatus({ ...statusMeta, state: 'provisioning', progressPercent: 8, message: '正在检查 RockyBase 模板...' });
  let baseVmx = getBaseVmVmxPath({ rockyOvaPath: cfg.ovaPath, labRootDir: cfg.labRootDir }, { ovaPath: cfg.ovaPath });
  if (!baseVmx) {
    await importBaseVmFromOva(cfg, statusMeta);
    baseVmx = getBaseVmVmxPath({ rockyOvaPath: cfg.ovaPath, labRootDir: cfg.labRootDir }, { ovaPath: cfg.ovaPath });
  }

  let snapshots = '';
  try {
    snapshots = (await runVmrun(cfg, ['listSnapshots', baseVmx])).stdout;
  } catch {
    snapshots = '';
  }

  if (!snapshots.includes(BASE_SNAPSHOT_NAME)) {
    pushResourceStatus({ ...statusMeta, state: 'provisioning', progressPercent: 60, message: '正在为 RockyBase 创建 clean 快照...' });
    await runVmrun(cfg, ['snapshot', baseVmx, BASE_SNAPSHOT_NAME]);
  }
}

async function cloneBaseVm(profile, context, instanceId, cfg, statusMeta = {}) {
  const baseVmx = getBaseVmVmxPath({ rockyOvaPath: cfg.ovaPath, labRootDir: cfg.labRootDir }, { ovaPath: cfg.ovaPath });
  if (!baseVmx) throw new Error('找不到 RockyBase 模板机。');

  const vmRootDir = getVmRootDir({ labRootDir: cfg.labRootDir });
  const identity = buildVmIdentity(context, instanceId, vmRootDir);
  const cloneDir = await createUniqueCloneDir(vmRootDir, identity.folderName);
  const cloneVmx = path.win32.join(cloneDir, `${path.win32.basename(cloneDir)}.vmx`);

  try {
    pushResourceStatus({ ...statusMeta, state: 'provisioning', progressPercent: 82, message: `正在克隆 ${identity.resourceName} ...` });
    await runVmrun(cfg, ['clone', baseVmx, cloneVmx, 'linked', `-snapshot=${BASE_SNAPSHOT_NAME}`, `-cloneName=${path.win32.basename(cloneDir)}`]);
    await sanitizeCloneVmx(cloneVmx, identity.displayName, {
      vmCpu: profile.vmCpu,
      vmMemoryMB: profile.vmMemoryMB
    });
    addManualVmPath(ELECTRON_DATA_DIR, cloneVmx);

    pushResourceStatus({ ...statusMeta, state: 'provisioning', progressPercent: 90, message: `正在启动 ${identity.displayName} ...` });
    await runVmrun(cfg, ['start', cloneVmx, 'nogui']);

    pushResourceStatus({ ...statusMeta, state: 'provisioning', progressPercent: 96, message: '正在获取虚拟机 IP ...' });
    const ip = await waitForVmIp(cfg, cloneVmx);

    return {
      id: instanceId,
      profileId: '',
      providerType: 'vmware_vm',
      runnerType: 'ssh',
      label: identity.resourceName,
      status: 'ready',
      reusable: profile.reuseEnabled !== false,
      createdByApp: true,
      lastUsedAt: new Date().toISOString(),
      reuseKey: profile.reuseKey || '',
      workspaceDir: cloneDir,
      vmxPath: cloneVmx,
      vmDisplayName: identity.displayName,
      labId: String(context?.labId || ''),
      resourceName: identity.resourceName,
      vmCpu: Number(profile.vmCpu || 0) || 0,
      vmMemoryMB: Number(profile.vmMemoryMB || 0) || 0,
      vmDiskGB: Number(profile.vmDiskGB || 0) || 0,
      resetSnapshot: '',
      notes: `基于 ${BASE_VM_NAME} 的 linked clone 自动创建。`,
      connection: {
        host: ip,
        username: profile.guestUsername || 'root',
        password: profile.guestPassword || '123'
      }
    };
  } catch (error) {
    try {
      await fs.rm(cloneDir, { recursive: true, force: true });
    } catch {}
    throw new Error(await buildVmrunStartError(cfg, cloneVmx, error));
  }
}

// Override corrupted message strings with clean implementations.
async function buildVmrunStartError(cfg, vmxPath, error) {
  const baseMessage = String(error?.stderr || error?.message || 'vmrun start failed').trim();
  let diagnostics = '';
  try {
    await runVmrun(cfg, ['list']);
  } catch (listError) {
    diagnostics = String(listError?.stderr || listError?.message || '').trim();
  }

  const detail = [
    `启动虚拟机失败：${vmxPath}`,
    baseMessage
  ];
  if (diagnostics) detail.push(`vmrun list 诊断：${diagnostics}`);
  detail.push('可先关闭并重新打开 VMware Workstation，再重试初始化。');
  return detail.join('\n');
}

async function capturePreparedSnapshot(profile, instance, cfg, statusMeta = {}) {
  if (!instance?.vmxPath) throw new Error('Missing VMX path for prepared snapshot.');
  pushResourceStatus({ ...statusMeta, state: 'provisioning', progressPercent: 97, message: '正在保存实验初始快照...' });
  const snapshots = await listVmSnapshots(cfg, instance.vmxPath);
  if (!snapshots.includes(LAB_READY_SNAPSHOT_NAME)) {
    await runVmrun(cfg, ['snapshot', instance.vmxPath, LAB_READY_SNAPSHOT_NAME]);
  }
  pushResourceStatus({ ...statusMeta, state: 'provisioning', progressPercent: 98, message: '实验初始快照已记录。' });
  return {
    ...instance,
    status: 'ready',
    resetSnapshot: LAB_READY_SNAPSHOT_NAME,
    lastUsedAt: new Date().toISOString(),
    connection: {
      ...(instance.connection || {}),
      host: instance.connection?.host || ''
    }
  };
}

async function restorePreparedSnapshot(profile, instance, cfg, statusMeta = {}) {
  if (!instance?.vmxPath) throw new Error('Missing VMX path for reset.');
  const snapshotName = String(instance.resetSnapshot || LAB_READY_SNAPSHOT_NAME).trim() || LAB_READY_SNAPSHOT_NAME;
  const snapshots = await listVmSnapshots(cfg, instance.vmxPath);
  if (!snapshots.includes(snapshotName)) {
    throw new Error('当前环境还没有可恢复的实验初始快照。');
  }

  pushResourceStatus({ ...statusMeta, state: 'provisioning', progressPercent: 35, message: '正在恢复实验初始快照...' });
  await runVmrun(cfg, ['revertToSnapshot', instance.vmxPath, snapshotName]);

  let ip = '';
  try {
    pushResourceStatus({ ...statusMeta, state: 'provisioning', progressPercent: 72, message: '正在等待快照中的开机状态恢复...' });
    ip = await waitForVmIp(cfg, instance.vmxPath, 1000 * 60 * 2);
  } catch {
    pushResourceStatus({ ...statusMeta, state: 'provisioning', progressPercent: 72, message: '正在重新启动实验环境...' });
    await runVmrun(cfg, ['start', instance.vmxPath, 'nogui']);
    ip = await waitForVmIp(cfg, instance.vmxPath);
  }

  return {
    ...instance,
    status: 'ready',
    resetSnapshot: snapshotName,
    lastUsedAt: new Date().toISOString(),
    connection: {
      host: ip,
      username: profile?.guestUsername || instance.connection?.username || 'root',
      password: profile?.guestPassword || instance.connection?.password || ''
    }
  };
}

async function importBaseVmFromOva(cfg, statusMeta = {}) {
  pushResourceStatus({ ...statusMeta, state: 'provisioning', progressPercent: 22, message: '正在导入 RockyBase 模板...' });
  const targetRoot = getVmRootDir({ labRootDir: cfg.labRootDir });
  const targetDir = path.win32.join(targetRoot, BASE_VM_NAME);
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetRoot, { recursive: true });
  await execFileAsync(cfg.ovftoolExe, ['--acceptAllEulas', '--overwrite', `--name=${BASE_VM_NAME}`, cfg.ovaPath, targetRoot]);
  flattenNestedVmFolder(targetDir, BASE_VM_NAME);
  const actualVmx = findNamedVmx(targetDir, BASE_VM_NAME) || getBaseVmVmxPath({ rockyOvaPath: cfg.ovaPath, labRootDir: cfg.labRootDir }, { ovaPath: cfg.ovaPath });
  if (!actualVmx) throw new Error('RockyBase 导入完成，但没有找到生成的 VMX 文件。');
  addManualVmPath(ELECTRON_DATA_DIR, actualVmx);
}

async function ensureBaseVmReady(profile, cfg, statusMeta = {}) {
  pushResourceStatus({ ...statusMeta, state: 'provisioning', progressPercent: 8, message: '正在检查 RockyBase 模板...' });
  let baseVmx = getBaseVmVmxPath({ rockyOvaPath: cfg.ovaPath, labRootDir: cfg.labRootDir }, { ovaPath: cfg.ovaPath });
  if (!baseVmx) {
    await importBaseVmFromOva(cfg, statusMeta);
    baseVmx = getBaseVmVmxPath({ rockyOvaPath: cfg.ovaPath, labRootDir: cfg.labRootDir }, { ovaPath: cfg.ovaPath });
  }

  let snapshots = '';
  try {
    snapshots = (await runVmrun(cfg, ['listSnapshots', baseVmx])).stdout;
  } catch {
    snapshots = '';
  }

  if (!snapshots.includes(BASE_SNAPSHOT_NAME)) {
    pushResourceStatus({ ...statusMeta, state: 'provisioning', progressPercent: 60, message: '正在为 RockyBase 创建 clean 快照...' });
    await runVmrun(cfg, ['snapshot', baseVmx, BASE_SNAPSHOT_NAME]);
  }
}

async function cloneBaseVm(profile, context, instanceId, cfg, statusMeta = {}) {
  const baseVmx = getBaseVmVmxPath({ rockyOvaPath: cfg.ovaPath, labRootDir: cfg.labRootDir }, { ovaPath: cfg.ovaPath });
  if (!baseVmx) throw new Error('找不到 RockyBase 模板机。');

  const vmRootDir = getVmRootDir({ labRootDir: cfg.labRootDir });
  const identity = buildVmIdentity(context, instanceId, vmRootDir);
  const cloneDir = await createUniqueCloneDir(vmRootDir, identity.folderName);
  const cloneVmx = path.win32.join(cloneDir, `${path.win32.basename(cloneDir)}.vmx`);

  try {
    pushResourceStatus({ ...statusMeta, state: 'provisioning', progressPercent: 82, message: `正在克隆 ${identity.resourceName} ...` });
    await runVmrun(cfg, ['clone', baseVmx, cloneVmx, 'linked', `-snapshot=${BASE_SNAPSHOT_NAME}`, `-cloneName=${path.win32.basename(cloneDir)}`]);
    await sanitizeCloneVmx(cloneVmx, identity.displayName, {
      vmCpu: profile.vmCpu,
      vmMemoryMB: profile.vmMemoryMB
    });
    addManualVmPath(ELECTRON_DATA_DIR, cloneVmx);

    pushResourceStatus({ ...statusMeta, state: 'provisioning', progressPercent: 90, message: `正在启动 ${identity.displayName} ...` });
    await runVmrun(cfg, ['start', cloneVmx, 'nogui']);

    pushResourceStatus({ ...statusMeta, state: 'provisioning', progressPercent: 96, message: '正在获取虚拟机 IP ...' });
    const ip = await waitForVmIp(cfg, cloneVmx);

    return {
      id: instanceId,
      profileId: '',
      providerType: 'vmware_vm',
      runnerType: 'ssh',
      label: identity.resourceName,
      status: 'ready',
      reusable: profile.reuseEnabled !== false,
      createdByApp: true,
      lastUsedAt: new Date().toISOString(),
      reuseKey: profile.reuseKey || '',
      workspaceDir: cloneDir,
      vmxPath: cloneVmx,
      vmDisplayName: identity.displayName,
      labId: String(context?.labId || ''),
      resourceName: identity.resourceName,
      vmCpu: Number(profile.vmCpu || 0) || 0,
      vmMemoryMB: Number(profile.vmMemoryMB || 0) || 0,
      vmDiskGB: Number(profile.vmDiskGB || 0) || 0,
      resetSnapshot: '',
      notes: `基于 ${BASE_VM_NAME} 的 linked clone 自动创建。`,
      connection: {
        host: ip,
        username: profile.guestUsername || 'root',
        password: profile.guestPassword || '123'
      }
    };
  } catch (error) {
    try {
      await fs.rm(cloneDir, { recursive: true, force: true });
    } catch {}
    throw new Error(await buildVmrunStartError(cfg, cloneVmx, error));
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1450,
    height: 950,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });
  mainWindow.removeMenu();
  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

registerStorageIpc({ ipcMain, dialog, STORAGE_FILE, MANUAL_ASSET_DIR });
ipcMain.handle('open-path', async (event, targetPath) => shell.openPath(targetPath));
ipcMain.handle('open-external-url', async (event, targetUrl) => {
  const url = String(targetUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) return false;
  await shell.openExternal(url);
  return true;
});
ipcMain.handle('path-exists', async (event, targetPath) => {
  try {
    return fsSync.existsSync(String(targetPath || '').trim());
  } catch {
    return false;
  }
});
ipcMain.handle('get-host-resources', async () => {
  return {
    totalMemMB: Math.floor(os.totalmem() / (1024 * 1024)),
    freeMemMB: Math.floor(os.freemem() / (1024 * 1024)),
    cpus: os.cpus().length
  };
});
registerVmwareIpc({
  ipcMain,
  readSettings: readStoredSettings,
  execFileAsync,
  VMWARE_ROOT_DIR,
  RESOURCE_INSTANCE_DIR,
  DEFAULT_OVFTOOL_EXE,
  DEFAULT_VMRUN_EXE,
  ELECTRON_DATA_DIR,
  STORAGE_DIR
});
registerRuntimeIpc({
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
});
