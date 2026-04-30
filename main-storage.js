const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const iconv = require('iconv-lite');
const { fileURLToPath } = require('url');

function looksMojibake(value = '') {
  return /[鍒褰鏈璧勬簮鐜鎿嶄綔瀹為獙绋嬪厛闆嗙兢杩涢樁]/.test(String(value || ''));
}

function repairText(value) {
  const text = String(value || '');
  if (!text || !looksMojibake(text)) return text;
  try {
    const repaired = iconv.decode(iconv.encode(text, 'gbk'), 'utf8');
    return repaired && repaired !== text ? repaired : text;
  } catch {
    return text;
  }
}

function repairImportedValue(value) {
  if (Array.isArray(value)) return value.map(repairImportedValue);
  if (value && typeof value === 'object') {
    const next = {};
    Object.keys(value).forEach((key) => {
      next[key] = repairImportedValue(value[key]);
    });
    return next;
  }
  if (typeof value === 'string') return repairText(value);
  return value;
}

async function resolveImportedSpec(spec, baseDir) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return spec;
  const resolved = { ...spec };
  resolved.__manualBaseDir = path.resolve(baseDir);
  const manualFile = String(spec.manual_file || spec.manualPath || spec.manual_path || '').trim();
  if (manualFile) {
    const manualPath = path.resolve(baseDir, manualFile);
    resolved.manual = await fs.readFile(manualPath, 'utf-8');
    resolved.manual_file = manualFile;
    resolved.__manualSourcePath = manualPath;
    resolved.__manualBaseDir = path.dirname(manualPath);
  }
  return resolved;
}

async function resolveImportedData(data, baseDir) {
  if (Array.isArray(data)) {
    const result = [];
    for (const item of data) {
      result.push(await resolveImportedSpec(item, baseDir));
    }
    return result;
  }
  return resolveImportedSpec(data, baseDir);
}

async function walkJsonFiles(rootDir) {
  const results = [];
  const pending = [path.resolve(rootDir)];

  while (pending.length) {
    const current = pending.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        results.push(fullPath);
      }
    }
  }

  results.sort((left, right) => left.localeCompare(right, 'zh-CN'));
  return results;
}

async function loadImportedSpecsFromDirectory(directoryPath) {
  const dirPath = path.resolve(String(directoryPath || '').trim());
  const filePaths = await walkJsonFiles(dirPath);
  const items = [];
  const warnings = [];

  for (const filePath of filePaths) {
    try {
      const baseDir = path.dirname(filePath);
      const rawData = repairImportedValue(JSON.parse(await fs.readFile(filePath, 'utf-8')));
      const resolvedData = repairImportedValue(await resolveImportedData(rawData, baseDir));
      const specs = Array.isArray(resolvedData) ? resolvedData : [resolvedData];
      specs.forEach((spec, index) => {
        if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
          warnings.push(`已跳过 ${path.relative(dirPath, filePath)} 中第 ${index + 1} 项：不是有效对象。`);
          return;
        }
        items.push({
          ...spec,
          __importSourceFile: filePath,
          __importSourceDir: baseDir
        });
      });
    } catch (error) {
      warnings.push(`读取 ${path.relative(dirPath, filePath)} 失败：${String(error?.message || error)}`);
    }
  }

  return {
    data: items,
    directoryPath: dirPath,
    fileCount: filePaths.length,
    warnings
  };
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

function decodeHtmlEntities(value = '') {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function decodeUriSafe(value = '') {
  try {
    return decodeURI(String(value || ''));
  } catch {
    return String(value || '');
  }
}

function trimMarkdownDestination(rawTarget = '') {
  const decoded = decodeHtmlEntities(rawTarget).trim();
  if (!decoded) return '';
  if (decoded.startsWith('<') && decoded.endsWith('>')) {
    return decoded.slice(1, -1).trim();
  }
  const titleMatch = decoded.match(/^(.+?)\s+(['"])(.*)\2$/);
  return (titleMatch ? titleMatch[1] : decoded).trim();
}

function isWindowsAbsolutePath(value = '') {
  return /^[a-zA-Z]:[\\/]/.test(String(value || ''));
}

function isUncPath(value = '') {
  return /^(?:\\\\|\/\/)[^\\/]+[\\/]/.test(String(value || ''));
}

function isAbsoluteFilePath(value = '') {
  const text = String(value || '');
  return isWindowsAbsolutePath(text) || isUncPath(text) || text.startsWith('/');
}

function isSupportedLocalAssetTarget(value = '') {
  const target = String(value || '').trim();
  if (!target) return false;
  if (/^data:/i.test(target)) return false;
  if (/^(?:https?|blob|mailto|tel):/i.test(target)) return false;
  if (/^(?:javascript|vbscript):/i.test(target)) return false;
  if (/^file:/i.test(target)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !isWindowsAbsolutePath(target)) return false;
  return true;
}

function resolveLocalAssetPath(rawTarget, baseDir = '') {
  const target = trimMarkdownDestination(rawTarget);
  if (!isSupportedLocalAssetTarget(target)) return '';
  if (/^file:/i.test(target)) {
    try {
      return fileURLToPath(target);
    } catch {
      return '';
    }
  }
  const decodedTarget = decodeUriSafe(target);
  if (isAbsoluteFilePath(decodedTarget)) return path.normalize(decodedTarget);
  if (!baseDir) return '';
  return path.resolve(baseDir, decodedTarget);
}

function sanitizeFileNamePart(value = '', fallback = 'asset') {
  const sanitized = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return sanitized || fallback;
}

function normalizeManagedAssetPath(value = '') {
  return String(value || '').replace(/\\/g, '/');
}

async function fileExists(sourcePath) {
  try {
    const stats = await fs.stat(sourcePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function stageImportedManualAssets(payload = {}, manualAssetRootDir = '') {
  const labId = String(payload.labId || '').trim();
  const sourceManual = String(payload.manual || '');
  const resolvedBaseDir = String(payload.baseDir || '').trim() || (() => {
    const sourcePath = String(payload.sourcePath || '').trim();
    return sourcePath ? path.dirname(sourcePath) : '';
  })();
  const copiedAssets = [];
  const warnings = [];

  if (!labId) {
    return { ok: false, error: '缺少实验标识，无法准备导入图片资源。' };
  }

  const assetRoot = path.resolve(manualAssetRootDir || '');
  if (!assetRoot) {
    return { ok: false, error: '软件图片托管目录未配置。' };
  }

  const assetDir = assertPathWithin(assetRoot, path.join(assetRoot, labId));
  await fs.rm(assetDir, { recursive: true, force: true });

  if (!sourceManual.trim()) {
    return { ok: true, manual: sourceManual, copiedAssets, warnings, managedAssetDir: '' };
  }

  const copyCache = new Map();
  const usedNames = new Set();
  let nextAssetIndex = 1;

  async function copyAssetFromTarget(rawTarget) {
    const sourcePath = resolveLocalAssetPath(rawTarget, resolvedBaseDir);
    if (!sourcePath) {
      const normalizedTarget = trimMarkdownDestination(rawTarget);
      if (normalizedTarget && isSupportedLocalAssetTarget(normalizedTarget) && !isAbsoluteFilePath(normalizedTarget)) {
        warnings.push(`无法解析相对图片路径：${normalizedTarget}`);
      }
      return null;
    }

    const cacheKey = process.platform === 'win32' ? sourcePath.toLowerCase() : sourcePath;
    if (copyCache.has(cacheKey)) return copyCache.get(cacheKey);

    if (!(await fileExists(sourcePath))) {
      warnings.push(`未找到图片文件：${sourcePath}`);
      return null;
    }

    await fs.mkdir(assetDir, { recursive: true });
    const parsed = path.parse(sourcePath);
    const baseName = sanitizeFileNamePart(parsed.name, 'asset');
    const ext = parsed.ext || '';
    const prefix = String(nextAssetIndex).padStart(2, '0');
    let candidate = `${prefix}-${baseName}${ext}`;
    let suffix = 2;
    while (usedNames.has(candidate.toLowerCase())) {
      candidate = `${prefix}-${baseName}-${suffix}${ext}`;
      suffix += 1;
    }
    nextAssetIndex += 1;
    usedNames.add(candidate.toLowerCase());

    const destPath = assertPathWithin(assetDir, path.join(assetDir, candidate));
    await fs.copyFile(sourcePath, destPath);
    const copied = {
      sourcePath,
      destPath,
      markdownPath: normalizeManagedAssetPath(destPath)
    };
    copiedAssets.push(copied);
    copyCache.set(cacheKey, copied);
    return copied;
  }

  async function rewriteMarkdownImages(markdown) {
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let cursor = 0;
    let output = '';
    let match;

    while ((match = imageRegex.exec(markdown)) !== null) {
      output += markdown.slice(cursor, match.index);
      const copied = await copyAssetFromTarget(match[2]);
      output += copied ? `![${match[1]}](${copied.markdownPath})` : match[0];
      cursor = match.index + match[0].length;
    }

    output += markdown.slice(cursor);
    return output;
  }

  async function rewriteHtmlImages(markdown) {
    const imageRegex = /<img\b([^>]*?)\bsrc=(["'])(.*?)\2([^>]*)>/gi;
    let cursor = 0;
    let output = '';
    let match;

    while ((match = imageRegex.exec(markdown)) !== null) {
      output += markdown.slice(cursor, match.index);
      const copied = await copyAssetFromTarget(match[3]);
      output += copied
        ? `<img${match[1]}src=${match[2]}${copied.markdownPath}${match[2]}${match[4]}>`
        : match[0];
      cursor = match.index + match[0].length;
    }

    output += markdown.slice(cursor);
    return output;
  }

  const withMarkdownImages = await rewriteMarkdownImages(sourceManual);
  const rewrittenManual = await rewriteHtmlImages(withMarkdownImages);

  if (!copiedAssets.length) {
    await fs.rm(assetDir, { recursive: true, force: true });
  }

  return {
    ok: true,
    manual: rewrittenManual,
    copiedAssets,
    warnings,
    managedAssetDir: copiedAssets.length ? assetDir : ''
  };
}

function registerStorageIpc({ ipcMain, dialog, STORAGE_FILE, MANUAL_ASSET_DIR }) {
  ipcMain.handle('read-local-data', async () => {
    try {
      if (fsSync.existsSync(STORAGE_FILE)) {
        const raw = await fs.readFile(STORAGE_FILE, 'utf-8');
        if (!raw || !raw.trim()) return null;
        return repairImportedValue(JSON.parse(raw));
      }
    } catch (e) {
      console.warn('[storage] Failed to parse storage file, resetting:', e.message);
    }
    return null;
  });

  ipcMain.handle('write-local-data', async (e, data) => {
    try {
      await fs.writeFile(STORAGE_FILE, JSON.stringify(data, null, 2));
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('import-local', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
    if (canceled) return null;
    return loadImportedSpecsFromDirectory(filePaths[0]);
  });

  ipcMain.handle('choose-directory', async (event, payload = {}) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: String(payload.title || '选择目录'),
      defaultPath: String(payload.defaultPath || '').trim() || undefined,
      properties: ['openDirectory']
    });
    if (canceled || !filePaths?.length) return '';
    return String(filePaths[0] || '');
  });

  ipcMain.handle('choose-file', async (event, payload = {}) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: String(payload.title || '选择文件'),
      defaultPath: String(payload.defaultPath || '').trim() || undefined,
      properties: ['openFile'],
      filters: Array.isArray(payload.filters) ? payload.filters : undefined
    });
    if (canceled || !filePaths?.length) return '';
    return String(filePaths[0] || '');
  });

  ipcMain.handle('stage-imported-manual-assets', async (event, payload = {}) => {
    try {
      return await stageImportedManualAssets(payload, MANUAL_ASSET_DIR);
    } catch (error) {
      return {
        ok: false,
        error: String(error?.message || error || '导入图片资源失败')
      };
    }
  });

  ipcMain.handle('import-instructions', async () => {
    try {
      const { app } = require('electron');
      const candidateDirs = [
        path.join(process.resourcesPath || '', 'instructions'),
        path.join(app.getAppPath(), 'instructions')
      ].filter(Boolean);
      const instructionsDir = candidateDirs.find((dir) => fsSync.existsSync(dir));
      if (!instructionsDir) return null;
      return await loadImportedSpecsFromDirectory(instructionsDir);
    } catch (e) {
      console.warn('[storage] Failed to auto-import instructions:', e.message);
      return null;
    }
  });
}

module.exports = { registerStorageIpc };
