const path = require('path');
const fsSync = require('fs');
const { execFile } = require('child_process');

const DEFAULT_VMWARE_DIR = process.env.ProgramFiles && fsSync.existsSync(path.join(process.env.ProgramFiles, 'VMware/VMware Workstation'))
  ? path.join(process.env.ProgramFiles, 'VMware/VMware Workstation')
  : (process.env['ProgramFiles(x86)'] && fsSync.existsSync(path.join(process.env['ProgramFiles(x86)'], 'VMware/VMware Workstation'))
    ? path.join(process.env['ProgramFiles(x86)'], 'VMware/VMware Workstation')
    : 'C:/Program Files (x86)/VMware/VMware Workstation');
const DEFAULT_VMWARE_EXE = path.join(DEFAULT_VMWARE_DIR, 'vmware.exe');
const DEFAULT_VMRUN_EXE = path.join(DEFAULT_VMWARE_DIR, 'vmrun.exe');
const DEFAULT_VDISK_EXE = path.join(DEFAULT_VMWARE_DIR, 'vmware-vdiskmanager.exe');
const DEFAULT_OVFTOOL_EXE = path.join(DEFAULT_VMWARE_DIR, 'OVFTool', 'ovftool.exe');
const DEFAULT_STORAGE_DIR = 'D:/labox/LinuxPathData';
const DEFAULT_LAB_ROOT_DIR = 'D:/labox';
const DEFAULT_ROCKY_OVA = path.join(DEFAULT_STORAGE_DIR, 'vm', 'RockyBase.ova');
const BASE_VM_NAME = 'RockyBase';
const BASE_VM_DIR = path.join(DEFAULT_LAB_ROOT_DIR, 'vm', BASE_VM_NAME);
const BASE_VM_VMX = path.join(BASE_VM_DIR, `${BASE_VM_NAME}.vmx`);
const LEGACY_BASE_VM_DIR = path.join(DEFAULT_STORAGE_DIR, 'vmware_runtime', BASE_VM_NAME);

const BASE_SNAPSHOT_NAME = 'clean';

function ensureFileExists(filePath, label) {
  if (!fsSync.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function resolveVmwarePaths(profile = {}, settings = {}) {
  const vmwareExe = settings.vmwareExePath || DEFAULT_VMWARE_EXE;
  const vmrunExe = settings.vmrunPath || DEFAULT_VMRUN_EXE;
  const vdiskExe = settings.vdiskPath || DEFAULT_VDISK_EXE;
  const ovftoolExe = settings.ovftoolPath || DEFAULT_OVFTOOL_EXE;
  const ovaPath = profile.ovaPath || profile.isoPath || settings.rockyOvaPath || DEFAULT_ROCKY_OVA;
  const labRootDir = getLabRootDir(settings);
  ensureFileExists(vmwareExe, 'vmware.exe');
  ensureFileExists(vmrunExe, 'vmrun.exe');
  ensureFileExists(vdiskExe, 'vmware-vdiskmanager.exe');
  ensureFileExists(ovftoolExe, 'ovftool.exe');
  ensureFileExists(ovaPath, 'RockyBase OVA');
  return { vmwareExe, vmrunExe, vdiskExe, ovftoolExe, ovaPath, labRootDir };
}

function getLabRootDir(settings = {}) {
  return settings.labRootDir || DEFAULT_LAB_ROOT_DIR;
}

function getVmRootDir(settings = {}) {
  const rootDir = path.win32.normalize(getLabRootDir(settings));
  return path.win32.basename(rootDir).toLowerCase() === 'vm'
    ? rootDir
    : path.win32.join(rootDir, 'vm');
}

function normalizeVmPath(vmxPath) {
  const raw = String(vmxPath || '').trim();
  if (!raw) return '';
  const normalized = path.win32.normalize(raw).trim();
  return normalized === '.' ? '' : normalized;
}

function buildVmEntry(vmxPath) {
    const normalized = normalizeVmPath(vmxPath);
    if (!normalized || !normalized.toLowerCase().endsWith('.vmx')) return null;
    let displayName = path.win32.basename(normalized, '.vmx');
  try {
    const content = fsSync.readFileSync(normalized, 'utf8');
    const match = content.match(/^\s*displayName\s*=\s*"(.+)"\s*$/m);
    if (match?.[1]) displayName = match[1].trim();
  } catch {}
  return { name: displayName, path: normalized };
}

function findFirstVmx(rootDir) {
  if (!fsSync.existsSync(rootDir)) return null;
  const pending = [rootDir];
  while (pending.length) {
    const current = pending.shift();
    const entries = fsSync.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.win32.join(current, entry.name);
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.vmx')) return fullPath;
      if (entry.isDirectory()) pending.push(fullPath);
    }
  }
  return null;
}

function findNamedVmx(rootDir, vmName) {
  if (!fsSync.existsSync(rootDir)) return null;
  const pending = [rootDir];
  const expected = `${String(vmName || '').toLowerCase()}.vmx`;
  while (pending.length) {
    const current = pending.shift();
    const entries = fsSync.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.win32.join(current, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === expected) return fullPath;
      if (entry.isDirectory()) pending.push(fullPath);
    }
  }
  return null;
}

function flattenNestedVmFolder(destFolder, vmName) {
  const normalizedDest = path.win32.normalize(destFolder);
  const nestedDir = path.win32.join(normalizedDest, vmName);
  if (!fsSync.existsSync(nestedDir)) return normalizedDest;
  if (!fsSync.statSync(nestedDir).isDirectory()) return normalizedDest;

  const entries = fsSync.readdirSync(nestedDir, { withFileTypes: true });
  entries.forEach((entry) => {
    const source = path.win32.join(nestedDir, entry.name);
    const target = path.win32.join(normalizedDest, entry.name);
    if (fsSync.existsSync(target)) {
      if (entry.isDirectory()) {
        fsSync.rmSync(source, { recursive: true, force: true });
      } else {
        fsSync.rmSync(source, { force: true });
      }
      return;
    }
    fsSync.renameSync(source, target);
  });

  if (fsSync.existsSync(nestedDir) && fsSync.readdirSync(nestedDir).length === 0) {
    fsSync.rmdirSync(nestedDir);
  }

  return normalizedDest;
}

function getBaseVmVmxPath(settings = {}, profile = {}) {
  const preferredOva = profile.ovaPath || settings.rockyOvaPath || DEFAULT_ROCKY_OVA;
  const candidateDirs = [
    path.join(getVmRootDir(settings), BASE_VM_NAME),
    path.join(path.dirname(preferredOva), BASE_VM_NAME),
    BASE_VM_DIR,
    LEGACY_BASE_VM_DIR
  ].filter((item, index, list) => item && list.indexOf(item) === index);

  for (const dir of candidateDirs) {
    const exact = path.join(dir, `${BASE_VM_NAME}.vmx`);
    if (fsSync.existsSync(exact)) return exact;
    const nestedExact = path.join(dir, BASE_VM_NAME, `${BASE_VM_NAME}.vmx`);
    if (fsSync.existsSync(nestedExact)) return nestedExact;
    const found = findNamedVmx(dir, BASE_VM_NAME);
    if (found) return found;
  }
  return null;
}

function getManualVmStorePath(ELECTRON_DATA_DIR) {
  return path.join(ELECTRON_DATA_DIR, 'manual-vms.json');
}

function readManualVmPaths(ELECTRON_DATA_DIR) {
  const storePath = getManualVmStorePath(ELECTRON_DATA_DIR);
  if (!fsSync.existsSync(storePath)) return [];
  try {
    const parsed = JSON.parse(fsSync.readFileSync(storePath, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeVmPath).filter(Boolean);
  } catch {
    return [];
  }
}

function writeManualVmPaths(ELECTRON_DATA_DIR, paths) {
  const unique = paths.map(normalizeVmPath).filter((item, index, list) => item && list.indexOf(item) === index);
  fsSync.writeFileSync(getManualVmStorePath(ELECTRON_DATA_DIR), JSON.stringify(unique, null, 2), 'utf8');
}

function addManualVmPath(ELECTRON_DATA_DIR, vmxPath) {
  const normalized = normalizeVmPath(vmxPath);
  const current = readManualVmPaths(ELECTRON_DATA_DIR);
  if (!current.includes(normalized)) {
    current.push(normalized);
    writeManualVmPaths(ELECTRON_DATA_DIR, current);
  }
}

function removeManualVmPath(ELECTRON_DATA_DIR, vmxPath) {
  const normalized = normalizeVmPath(vmxPath);
  writeManualVmPaths(ELECTRON_DATA_DIR, readManualVmPaths(ELECTRON_DATA_DIR).filter(item => item.toLowerCase() !== normalized.toLowerCase()));
}

function getRunningStatus(vmrunPath, vmxPath) {
  return new Promise((resolve) => {
    execFile(vmrunPath, ['-T', 'ws', 'list'], (err, stdout) => {
      if (err) return resolve(false);
      const target = normalizeVmPath(vmxPath).toLowerCase().replace(/\//g, '\\');
      const lines = stdout.split('\n').map(line => line.trim().toLowerCase().replace(/\//g, '\\'));
      resolve(lines.some(line => line === target || line.includes(target)));
    });
  });
}

function listRunningVmPaths(vmrunPath) {
  return new Promise((resolve) => {
    execFile(vmrunPath, ['-T', 'ws', 'list'], (err, stdout) => {
      if (err) return resolve([]);
      const lines = stdout
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .filter(line => !/^total running vms/i.test(line))
        .map(line => line.toLowerCase().replace(/\//g, '\\'));
      resolve(lines);
    });
  });
}

function isVmRunningFromList(runningVmPaths, vmxPath) {
  const target = normalizeVmPath(vmxPath).toLowerCase().replace(/\//g, '\\');
  return runningVmPaths.some(line => line === target || line.includes(target));
}

function getVmSnapshots(vmrunPath, vmxPath) {
  return new Promise((resolve) => {
    execFile(vmrunPath, ['-T', 'ws', 'listSnapshots', vmxPath], (err, stdout) => {
      if (err) return resolve([]);
      const lines = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const snapshots = lines.filter(line => !line.toLowerCase().startsWith('total snapshots'));
      resolve(snapshots);
    });
  });
}

function getVmDirFromVmx(vmxPath) {
  const normalized = normalizeVmPath(vmxPath);
  return normalized ? path.win32.dirname(normalized) : '';
}

function assertSafeVmDir(vmDir, vmxPath) {
  const normalizedDir = path.win32.normalize(String(vmDir || '').trim());
  if (!normalizedDir || normalizedDir === '.') {
    throw new Error('Refusing to delete an empty VM directory.');
  }
  const parsed = path.win32.parse(normalizedDir);
  if (!parsed.root || normalizedDir.toLowerCase() === parsed.root.toLowerCase()) {
    throw new Error(`Refusing to delete root directory: ${normalizedDir}`);
  }
  const normalizedVmx = normalizeVmPath(vmxPath);
  if (!normalizedVmx) {
    throw new Error('VMX path is empty.');
  }
  const expectedDir = path.win32.dirname(normalizedVmx);
  if (path.win32.normalize(expectedDir).toLowerCase() !== normalizedDir.toLowerCase()) {
    throw new Error(`VM directory mismatch: ${normalizedDir}`);
  }
}

function isDirectoryEmpty(dirPath) {
  if (!dirPath || !fsSync.existsSync(dirPath)) return true;
  return fsSync.readdirSync(dirPath).length === 0;
}

function cleanupEmptyVmContainerDirs(vmDir, vmxPath) {
  const normalizedVmDir = path.win32.normalize(String(vmDir || '').trim());
  const normalizedVmx = normalizeVmPath(vmxPath);
  if (!normalizedVmDir || !normalizedVmx) return { removedDirs: [], preservedDir: '' };

  const vmFileName = path.win32.basename(normalizedVmx, '.vmx').toLowerCase();
  let currentDir = path.win32.dirname(normalizedVmDir);
  const removedDirs = [];

  while (currentDir && fsSync.existsSync(currentDir) && isDirectoryEmpty(currentDir)) {
    const dirName = path.win32.basename(currentDir).toLowerCase();
    if (dirName !== vmFileName) return { removedDirs, preservedDir: currentDir };
    const parentDir = path.win32.dirname(currentDir);
    const parsed = path.win32.parse(currentDir);
    if (!parsed.root || currentDir.toLowerCase() === parsed.root.toLowerCase()) return { removedDirs, preservedDir: currentDir };
    fsSync.rmdirSync(currentDir);
    removedDirs.push(currentDir);
    currentDir = parentDir;
  }

  if (currentDir && fsSync.existsSync(currentDir) && !isDirectoryEmpty(currentDir) && path.win32.basename(currentDir).toLowerCase() === vmFileName) {
    return { removedDirs, preservedDir: currentDir };
  }

  return { removedDirs, preservedDir: '' };
}

function findLockArtifacts(rootDir) {
  if (!rootDir || !fsSync.existsSync(rootDir)) return [];
  const pending = [rootDir];
  const results = [];
  while (pending.length) {
    const current = pending.shift();
    const entries = fsSync.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.win32.join(current, entry.name);
      if (entry.name.toLowerCase().includes('.lck')) {
        results.push(fullPath);
        continue;
      }
      if (entry.isDirectory()) pending.push(fullPath);
    }
  }
  return results;
}

function deleteVmFilesFromDisk(ELECTRON_DATA_DIR, vmxPath) {
  const normalized = normalizeVmPath(vmxPath);
  const vmDir = getVmDirFromVmx(normalized);
  if (!vmDir) {
    return { success: false, msg: 'No valid VM directory found.' };
  }
  if (!fsSync.existsSync(vmDir)) {
    removeManualVmPath(ELECTRON_DATA_DIR, normalized);
    return { success: true, msg: '虚拟机文件已经不存在。' };
  }
  fsSync.rmSync(vmDir, { recursive: true, force: true });
  removeManualVmPath(ELECTRON_DATA_DIR, normalized);
  return { success: true, msg: '虚拟机文件已从磁盘删除。' };
}

function finalizeVmDeletion(ELECTRON_DATA_DIR, vmxPath) {
  const normalized = normalizeVmPath(vmxPath);
  const vmDir = getVmDirFromVmx(normalized);
  if (!vmDir) {
    return { success: false, msg: 'No valid VM directory found.' };
  }
  if (!fsSync.existsSync(vmDir)) {
    removeManualVmPath(ELECTRON_DATA_DIR, normalized);
    return { success: true, msg: 'VM directory is already gone.' };
  }
  assertSafeVmDir(vmDir, normalized);
  const lockArtifacts = findLockArtifacts(vmDir);
  if (lockArtifacts.length) {
    return {
      success: false,
      msg: `检测到 VMware 锁文件，虚拟机可能仍被 VMware Workstation 占用。请先关闭相关窗口后再试。\n${lockArtifacts.join('\n')}`
    };
  }
  fsSync.rmSync(vmDir, { recursive: true, force: true });
  if (fsSync.existsSync(vmDir)) {
    return { success: false, msg: `Failed to remove VM directory: ${vmDir}` };
  }
  const cleanupInfo = cleanupEmptyVmContainerDirs(vmDir, normalized);
  removeManualVmPath(ELECTRON_DATA_DIR, normalized);
  if (cleanupInfo.preservedDir) {
    return { success: true, msg: `虚拟机已删除，但目录非空，已保留：${cleanupInfo.preservedDir}` };
  }
  return { success: true, msg: '虚拟机文件已从磁盘删除。' };
}

async function listVms({ inventoryPath, vmrunPath, ELECTRON_DATA_DIR, RESOURCE_INSTANCE_DIR, settings }) {
  const vmMap = new Map();
  if (settings?.manageExternalVms === true && inventoryPath && fsSync.existsSync(inventoryPath)) {
    const content = fsSync.readFileSync(inventoryPath, 'utf8');
    const regex = /vmlist\d+\.config\s*=\s*"(.*)"/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const vmxPath = normalizeVmPath(match[1]);
      if (vmxPath && vmxPath.toLowerCase().endsWith('.vmx') && fsSync.existsSync(vmxPath)) {
        const entry = buildVmEntry(vmxPath);
        if (entry) vmMap.set(vmxPath.toLowerCase(), entry);
      }
    }
  }
  readManualVmPaths(ELECTRON_DATA_DIR).forEach((manualPath) => {
    if (manualPath && manualPath.toLowerCase().endsWith('.vmx') && fsSync.existsSync(manualPath)) {
      const entry = buildVmEntry(manualPath);
      if (entry) vmMap.set(manualPath.toLowerCase(), entry);
    }
  });
  const managedVmRoot = getVmRootDir(settings);
  if (managedVmRoot && fsSync.existsSync(managedVmRoot)) {
    fsSync.readdirSync(managedVmRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .forEach((entry) => {
        const vmxPath = findFirstVmx(path.win32.join(managedVmRoot, entry.name));
        if (!vmxPath || !fsSync.existsSync(vmxPath)) return;
        const vmEntry = buildVmEntry(vmxPath);
        if (vmEntry) vmMap.set(vmxPath.toLowerCase(), vmEntry);
      });
  }
  if (RESOURCE_INSTANCE_DIR && fsSync.existsSync(RESOURCE_INSTANCE_DIR)) {
    fsSync.readdirSync(RESOURCE_INSTANCE_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .forEach((entry) => {
        const vmxPath = findFirstVmx(path.win32.join(RESOURCE_INSTANCE_DIR, entry.name));
        if (!vmxPath || !fsSync.existsSync(vmxPath)) return;
        const vmEntry = buildVmEntry(vmxPath);
        if (vmEntry) vmMap.set(vmxPath.toLowerCase(), vmEntry);
      });
  }

  const items = Array.from(vmMap.values());
  const baseVmx = normalizeVmPath(getBaseVmVmxPath(settings));
  const runningVmPaths = await listRunningVmPaths(vmrunPath);
  return Promise.all(items.map(async (vm) => {
    const isTemplate = Boolean(baseVmx) && normalizeVmPath(vm.path).toLowerCase() === baseVmx.toLowerCase();
    const snapshots = isTemplate ? await getVmSnapshots(vmrunPath, vm.path) : [];
    return {
      ...vm,
      running: isVmRunningFromList(runningVmPaths, vm.path),
      isTemplate,
      snapshots,
      hasCleanSnapshot: snapshots.includes(BASE_SNAPSHOT_NAME)
    };
  }));
}

async function importVmFromOva({ ovftoolPath, ovaPath, targetName, targetRoot, ELECTRON_DATA_DIR, execFileAsync, replaceExisting = false, vmrunPath = "" }) {
  const vmName = String(targetName || '').trim();
  if (!vmName) return { success: false, msg: '虚拟机名称不能为空。' };
  if (!fsSync.existsSync(ovftoolPath)) return { success: false, msg: '未找到 OVFTool。' };
  if (!fsSync.existsSync(ovaPath)) return { success: false, msg: `未找到 OVA：${ovaPath}` };

  const destFolder = path.win32.join(targetRoot, vmName);
  if (!fsSync.existsSync(targetRoot)) {
    fsSync.mkdirSync(targetRoot, { recursive: true });
  }
  if (fsSync.existsSync(destFolder)) {
    if (!replaceExisting) return { success: false, msg: '同名虚拟机目录已存在。' };
    const existingVmx = findFirstVmx(destFolder);
    if (existingVmx && vmrunPath && fsSync.existsSync(vmrunPath)) {
      const running = await getRunningStatus(vmrunPath, existingVmx);
      if (running) {
        try {
          await execFileAsync(vmrunPath, ['-T', 'ws', 'stop', existingVmx, 'soft']);
        } catch {
          try {
            await execFileAsync(vmrunPath, ['-T', 'ws', 'stop', existingVmx, 'hard']);
          } catch {}
        }
      }
      removeManualVmPath(ELECTRON_DATA_DIR, existingVmx);
    }
    fsSync.rmSync(destFolder, { recursive: true, force: true });
  }

  try {
    await execFileAsync(ovftoolPath, ['--acceptAllEulas', '--overwrite', `--name=${vmName}`, ovaPath, targetRoot]);
    flattenNestedVmFolder(destFolder, vmName);
    const importedVmx = findNamedVmx(destFolder, vmName) || findFirstVmx(destFolder);
    if (!importedVmx) return { success: false, msg: '导入完成，但未找到 VMX 文件。' };
    addManualVmPath(ELECTRON_DATA_DIR, importedVmx);
    return { success: true, msg: '虚拟机创建成功。', vmxPath: importedVmx };
  } catch (error) {
    return { success: false, msg: error.stderr || error.message || '导入 OVA 失败。' };
  }
}

async function runVmCommand({ action, vmxPath, extra, vmrunPath, ELECTRON_DATA_DIR, execFileAsync }) {
  const normalizedVmx = normalizeVmPath(vmxPath);
  const isRunning = await getRunningStatus(vmrunPath, normalizedVmx);
  if (action === 'reset' && !isRunning) return { success: false, msg: '虚拟机已关机，无法重启。' };
  if (action === 'clone' && isRunning) return { success: false, msg: '请先关闭虚拟机，再执行链接克隆。' };
  if (action === 'deleteVM' && isRunning) return { success: false, msg: '请先关闭虚拟机，再执行删除。' };

  let args = ['-T', 'ws', action, normalizedVmx];
  let createdCloneVmx = null;
  if (action === 'start') args.push('nogui');
  if (action === 'stop') args.push('soft');
  if (action === 'snapshot') {
    if (!extra) return { success: false, msg: '快照名称不能为空。' };
    args.push(extra);
  }
  if (action === 'clone') {
    const newName = String(extra || '').trim();
    if (!newName) return { success: false, msg: '克隆名称不能为空。' };
    const sourceFolder = path.win32.dirname(normalizedVmx);
    const parentDir = path.win32.dirname(sourceFolder);
    const destFolder = path.win32.join(parentDir, newName);
    const destVmx = path.win32.join(destFolder, `${newName}.vmx`);
    if (fsSync.existsSync(destFolder) || fsSync.existsSync(destVmx)) return { success: false, msg: '同级目录中已存在同名虚拟机。' };
    createdCloneVmx = destVmx;
    args = ['-T', 'ws', 'clone', normalizedVmx, destVmx, 'linked', `-snapshot=${BASE_SNAPSHOT_NAME}`, `-cloneName=${newName}`];
  }

  try {
    const res = await execFileAsync(vmrunPath, args);
    if (action === 'clone' && createdCloneVmx) addManualVmPath(ELECTRON_DATA_DIR, createdCloneVmx);
    if (action === 'deleteVM') {
      const cleanup = finalizeVmDeletion(ELECTRON_DATA_DIR, normalizedVmx);
      if (!cleanup.success) return cleanup;
      return { success: true, msg: cleanup.msg || res.stdout || '' };
    }
    return { success: true, msg: res.stdout || '' };
  } catch (error) {
    if (action === 'deleteVM') {
      let fallback;
      try {
        fallback = finalizeVmDeletion(ELECTRON_DATA_DIR, normalizedVmx);
      } catch (cleanupError) {
        return { success: false, msg: cleanupError.message || error.stderr || error.message };
      }
      if (fallback.success) return fallback;
    }
    return { success: false, msg: error.stderr || error.message };
  }
}

async function getVmIp(vmrunPath, vmxPath) {
  return new Promise((resolve) => {
    execFile(vmrunPath, ['-T', 'ws', 'getGuestIPAddress', vmxPath], (err, stdout) => {
      resolve(err ? '' : stdout.trim());
    });
  });
}

async function getVmPowerState(vmrunPath, vmxPath) {
  const normalizedVmx = normalizeVmPath(vmxPath);
  if (!normalizedVmx) return 'stopped';
  const running = await getRunningStatus(vmrunPath, normalizedVmx);
  if (running) return 'running';

  const vmDir = getVmDirFromVmx(normalizedVmx);
  if (vmDir && fsSync.existsSync(vmDir)) {
    const hasSuspendArtifact = fsSync.readdirSync(vmDir).some((entry) => entry.toLowerCase().endsWith('.vmss'));
    if (hasSuspendArtifact) return 'suspended';
  }
  return 'stopped';
}

async function importVmFromOva({ ovftoolPath, ovaPath, targetName, targetRoot, ELECTRON_DATA_DIR, execFileAsync, replaceExisting = false, vmrunPath = "" }) {
  const vmName = String(targetName || '').trim();
  if (!vmName) return { success: false, msg: '虚拟机名称不能为空。' };
  if (!fsSync.existsSync(ovftoolPath)) return { success: false, msg: '未找到 OVFTool。' };
  if (!fsSync.existsSync(ovaPath)) return { success: false, msg: `未找到 OVA：${ovaPath}` };

  if (!fsSync.existsSync(targetRoot)) {
    fsSync.mkdirSync(targetRoot, { recursive: true });
  }

  const destFolder = path.win32.join(targetRoot, vmName);
  if (fsSync.existsSync(destFolder)) {
    if (!replaceExisting) return { success: false, msg: '同名虚拟机目录已存在。' };
    const existingVmx = findFirstVmx(destFolder);
    if (existingVmx && vmrunPath && fsSync.existsSync(vmrunPath)) {
      const running = await getRunningStatus(vmrunPath, existingVmx);
      if (running) {
        try {
          await execFileAsync(vmrunPath, ['-T', 'ws', 'stop', existingVmx, 'soft']);
        } catch {
          try {
            await execFileAsync(vmrunPath, ['-T', 'ws', 'stop', existingVmx, 'hard']);
          } catch {}
        }
      }
      removeManualVmPath(ELECTRON_DATA_DIR, existingVmx);
    }
    fsSync.rmSync(destFolder, { recursive: true, force: true });
  }

  try {
    await execFileAsync(ovftoolPath, ['--acceptAllEulas', '--overwrite', `--name=${vmName}`, ovaPath, destFolder]);
    const importedVmx = findFirstVmx(destFolder);
    if (!importedVmx) return { success: false, msg: '导入完成，但未找到 VMX 文件。' };

    addManualVmPath(ELECTRON_DATA_DIR, importedVmx);

    if (vmrunPath && fsSync.existsSync(vmrunPath)) {
      await execFileAsync(vmrunPath, ['-T', 'ws', 'snapshot', importedVmx, BASE_SNAPSHOT_NAME]);
    }

    return { success: true, msg: '虚拟机创建成功，并已创建 clean 快照。', vmxPath: importedVmx };
  } catch (error) {
    return { success: false, msg: error.stderr || error.message || '导入 OVA 失败。' };
  }
}

function registerVmwareIpc({
  ipcMain,
  readSettings,
  execFileAsync,
  VMWARE_ROOT_DIR,
  RESOURCE_INSTANCE_DIR,
  DEFAULT_OVFTOOL_EXE,
  DEFAULT_VMRUN_EXE,
  ELECTRON_DATA_DIR,
  STORAGE_DIR
}) {
  ipcMain.handle('get-vms', async () => {
    const settings = await readSettings();
    return listVms({
      inventoryPath: path.join(process.env.APPDATA || '', 'VMware', 'inventory.vmls'),
      vmrunPath: settings.vmrunPath || DEFAULT_VMRUN_EXE,
      ELECTRON_DATA_DIR,
      RESOURCE_INSTANCE_DIR,
      settings
    });
  });

  ipcMain.handle('get-vm-status', async (event, vmxPath) => {
    const settings = await readSettings();
    return getRunningStatus(settings.vmrunPath || DEFAULT_VMRUN_EXE, vmxPath);
  });

  ipcMain.handle('get-vm-ip', async (event, vmxPath) => {
    const settings = await readSettings();
    return getVmIp(settings.vmrunPath || DEFAULT_VMRUN_EXE, vmxPath);
  });

  ipcMain.handle('get-vm-power-state', async (event, vmxPath) => {
    const settings = await readSettings();
    return getVmPowerState(settings.vmrunPath || DEFAULT_VMRUN_EXE, vmxPath);
  });

  ipcMain.handle('create-vm-from-ova', async (event, payload) => {
    const settings = await readSettings();
    return importVmFromOva({
      ovftoolPath: settings.ovftoolPath || DEFAULT_OVFTOOL_EXE,
      ovaPath: settings.rockyOvaPath,
      targetName: payload?.name,
      targetRoot: getVmRootDir(settings),
      replaceExisting: payload?.replaceExisting === true,
      vmrunPath: settings.vmrunPath || DEFAULT_VMRUN_EXE,
      ELECTRON_DATA_DIR,
      execFileAsync
    });
  });

  ipcMain.handle('vm-command', async (event, payload) => {
    const settings = await readSettings();
    return runVmCommand({
      action: payload?.action,
      vmxPath: payload?.vmxPath,
      extra: payload?.extra,
      vmrunPath: settings.vmrunPath || DEFAULT_VMRUN_EXE,
      ELECTRON_DATA_DIR,
      execFileAsync
    });
  });

  return { findFirstVmx, BASE_VM_DIR, BASE_VM_NAME, BASE_SNAPSHOT_NAME, addManualVmPath, removeManualVmPath };
}

// Override duplicated/corrupted VMware helpers with the canonical implementation.
function deleteVmFilesFromDisk(ELECTRON_DATA_DIR, vmxPath) {
  const normalized = normalizeVmPath(vmxPath);
  const vmDir = getVmDirFromVmx(normalized);
  if (!vmDir) {
    return { success: false, msg: 'No valid VM directory found.' };
  }
  if (!fsSync.existsSync(vmDir)) {
    removeManualVmPath(ELECTRON_DATA_DIR, normalized);
    return { success: true, msg: '虚拟机文件已经不存在。' };
  }
  fsSync.rmSync(vmDir, { recursive: true, force: true });
  removeManualVmPath(ELECTRON_DATA_DIR, normalized);
  return { success: true, msg: '虚拟机文件已从磁盘删除。' };
}

function finalizeVmDeletion(ELECTRON_DATA_DIR, vmxPath) {
  const normalized = normalizeVmPath(vmxPath);
  const vmDir = getVmDirFromVmx(normalized);
  if (!vmDir) {
    return { success: false, msg: 'No valid VM directory found.' };
  }
  if (!fsSync.existsSync(vmDir)) {
    removeManualVmPath(ELECTRON_DATA_DIR, normalized);
    return { success: true, msg: 'VM directory is already gone.' };
  }
  assertSafeVmDir(vmDir, normalized);
  const lockArtifacts = findLockArtifacts(vmDir);
  if (lockArtifacts.length) {
    return {
      success: false,
      msg: `检测到 VMware 锁文件，虚拟机可能仍被 VMware Workstation 占用。请先关闭相关窗口后再试。\n${lockArtifacts.join('\n')}`
    };
  }
  fsSync.rmSync(vmDir, { recursive: true, force: true });
  if (fsSync.existsSync(vmDir)) {
    return { success: false, msg: `Failed to remove VM directory: ${vmDir}` };
  }
  const cleanupInfo = cleanupEmptyVmContainerDirs(vmDir, normalized);
  removeManualVmPath(ELECTRON_DATA_DIR, normalized);
  if (cleanupInfo.preservedDir) {
    return { success: true, msg: `虚拟机已删除，但目录非空，已保留：${cleanupInfo.preservedDir}` };
  }
  return { success: true, msg: '虚拟机文件已从磁盘删除。' };
}

async function importVmFromOva({ ovftoolPath, ovaPath, targetName, targetRoot, ELECTRON_DATA_DIR, execFileAsync, replaceExisting = false, vmrunPath = "" }) {
  const vmName = String(targetName || '').trim();
  if (!vmName) return { success: false, msg: '虚拟机名称不能为空。' };
  if (!fsSync.existsSync(ovftoolPath)) return { success: false, msg: '未找到 OVFTool。' };
  if (!fsSync.existsSync(ovaPath)) return { success: false, msg: `未找到 OVA：${ovaPath}` };

  const destFolder = path.win32.join(targetRoot, vmName);
  if (!fsSync.existsSync(targetRoot)) {
    fsSync.mkdirSync(targetRoot, { recursive: true });
  }
  if (fsSync.existsSync(destFolder)) {
    if (!replaceExisting) return { success: false, msg: '同名虚拟机目录已存在。' };
    const existingVmx = findFirstVmx(destFolder);
    if (existingVmx && vmrunPath && fsSync.existsSync(vmrunPath)) {
      const running = await getRunningStatus(vmrunPath, existingVmx);
      if (running) {
        try {
          await execFileAsync(vmrunPath, ['-T', 'ws', 'stop', existingVmx, 'soft']);
        } catch {
          try {
            await execFileAsync(vmrunPath, ['-T', 'ws', 'stop', existingVmx, 'hard']);
          } catch {}
        }
      }
      removeManualVmPath(ELECTRON_DATA_DIR, existingVmx);
    }
    fsSync.rmSync(destFolder, { recursive: true, force: true });
  }

  try {
    await execFileAsync(ovftoolPath, ['--acceptAllEulas', '--overwrite', `--name=${vmName}`, ovaPath, targetRoot]);
    flattenNestedVmFolder(destFolder, vmName);
    const importedVmx = findNamedVmx(destFolder, vmName) || findFirstVmx(destFolder);
    if (!importedVmx) return { success: false, msg: '导入完成，但未找到 VMX 文件。' };
    addManualVmPath(ELECTRON_DATA_DIR, importedVmx);
    if (vmrunPath && fsSync.existsSync(vmrunPath)) {
      await execFileAsync(vmrunPath, ['-T', 'ws', 'snapshot', importedVmx, BASE_SNAPSHOT_NAME]);
    }
    return { success: true, msg: '虚拟机创建成功，并已创建 clean 快照。', vmxPath: importedVmx };
  } catch (error) {
    return { success: false, msg: error.stderr || error.message || '导入 OVA 失败。' };
  }
}

async function runVmCommand({ action, vmxPath, extra, vmrunPath, ELECTRON_DATA_DIR, execFileAsync }) {
  const normalizedVmx = normalizeVmPath(vmxPath);
  const isRunning = await getRunningStatus(vmrunPath, normalizedVmx);
  if (action === 'reset' && !isRunning) return { success: false, msg: '虚拟机已关机，无法重启。' };
  if (action === 'clone' && isRunning) return { success: false, msg: '请先关闭虚拟机，再执行链接克隆。' };
  if (action === 'deleteVM' && isRunning) return { success: false, msg: '请先关闭虚拟机，再执行删除。' };

  let args = ['-T', 'ws', action, normalizedVmx];
  let createdCloneVmx = null;
  if (action === 'start') args.push('nogui');
  if (action === 'stop') args.push('soft');
  if (action === 'snapshot') {
    if (!extra) return { success: false, msg: '快照名称不能为空。' };
    args.push(extra);
  }
  if (action === 'clone') {
    const newName = String(extra || '').trim();
    if (!newName) return { success: false, msg: '克隆名称不能为空。' };
    const sourceFolder = path.win32.dirname(normalizedVmx);
    const parentDir = path.win32.dirname(sourceFolder);
    const destFolder = path.win32.join(parentDir, newName);
    const destVmx = path.win32.join(destFolder, `${newName}.vmx`);
    if (fsSync.existsSync(destFolder) || fsSync.existsSync(destVmx)) return { success: false, msg: '同级目录中已存在同名虚拟机。' };
    createdCloneVmx = destVmx;
    args = ['-T', 'ws', 'clone', normalizedVmx, destVmx, 'linked', `-snapshot=${BASE_SNAPSHOT_NAME}`, `-cloneName=${newName}`];
  }

  try {
    const res = await execFileAsync(vmrunPath, args);
    if (action === 'clone' && createdCloneVmx) addManualVmPath(ELECTRON_DATA_DIR, createdCloneVmx);
    if (action === 'deleteVM') {
      const cleanup = finalizeVmDeletion(ELECTRON_DATA_DIR, normalizedVmx);
      if (!cleanup.success) return cleanup;
      return { success: true, msg: cleanup.msg || res.stdout || '' };
    }
    return { success: true, msg: res.stdout || '' };
  } catch (error) {
    if (action === 'deleteVM') {
      let fallback;
      try {
        fallback = finalizeVmDeletion(ELECTRON_DATA_DIR, normalizedVmx);
      } catch (cleanupError) {
        return { success: false, msg: cleanupError.message || error.stderr || error.message };
      }
      if (fallback.success) return fallback;
    }
    return { success: false, msg: error.stderr || error.message };
  }
}

module.exports = {
  registerVmwareIpc,
  resolveVmwarePaths,
  getBaseVmVmxPath,
  getVmRootDir,
  findFirstVmx,
  findNamedVmx,
  flattenNestedVmFolder,
  BASE_VM_DIR,
  BASE_VM_NAME,
  BASE_SNAPSHOT_NAME,
  DEFAULT_OVFTOOL_EXE,
  DEFAULT_VMRUN_EXE,
  importVmFromOva,
  addManualVmPath,
  removeManualVmPath
};
