const DEFAULT_SETTINGS = {
    vmwareExePath: "D:\\Program Files (x86)\\VMware\\VMware Workstation\\vmware.exe",
    vmrunPath: "D:\\Program Files (x86)\\VMware\\VMware Workstation\\vmrun.exe",
    vdiskPath: "D:\\Program Files (x86)\\VMware\\VMware Workstation\\vmware-vdiskmanager.exe",
    ovftoolPath: "D:\\Program Files (x86)\\VMware\\VMware Workstation\\OVFTool\\ovftool.exe",
    labRootDir: "D:\\labox",
    vmSuspendSeconds: 300,
    manualFontScale: 1,
    sshTerminalFontSize: 14,
    manageExternalVms: false,
    instructionsImported: false,
    rockyOvaPath: "D:\\labox\\RockyBase.ova",
    resourceAliases: {
        RockyBase: "D:\\labox\\RockyBase.ova"
    }
};

DEFAULT_SETTINGS.vmwareInstallDir = "D:\\Program Files (x86)\\VMware\\VMware Workstation";

const emptyData = {
    courses: {},
    modules: {},
    labs: {},
    resourceProfiles: {},
    resourceInstances: {},
    settings: DEFAULT_SETTINGS
};

var appData = normalizeAppData(emptyData);
var activeSection = "workspace";
var workspaceView = "home";
var activeCourseId = "";
var activeModuleId = "";
var activeLabId = "";
var editingCourseId = "";
var editingModuleId = "";
var editingLabId = "";
var pendingDeleteAction = null;
var pendingImportPreview = null;
var resourceStatusMap = {};
var vmManagerState = { loading: false, loaded: false, error: "", vms: [], importing: false, importMessage: "" };
var labRuntimeDefinitionCache = new Map();
var terminalUiState = { tabs: [], activeTabKey: "", codeBlocks: [] };
var clonedSessionMap = {};
var lifecycleState = { activeLabId: "", activeInstances: [] };
var autoInitRequestedLabs = new Set();
var autoPrepareRequestedLabs = new Set();
var autoProvisionPausedLabs = new Set();
var resourceVmRuntimeMap = {};
var vmWakingResources = new Set();
var vmConnectionRefreshPromises = new Map();
var activeLabVmPollHandle = null;
var activeLabVmPollToken = 0;
var terminalSessionState = { activeSessionKey: "", sessions: {} };
var resourceStatusToastState = {};
var treePaneCollapsed = false;
var treeSearchQuery = "";
var manualFontScale = 1;
var sshRetryState = { attempts: 0, timer: null };
var workspaceBatchState = { active: false, total: 0, current: 0, message: "", resourceName: "" };
var inlineCheckpointUiState = {};
var manualMaterialUiState = {};
var manualReadingState = { saveTimer: null, restoreToken: 0 };

function ensureTerminalShell() {
    const terminal = document.getElementById("terminal-container");
    if (!terminal || document.getElementById("terminal-tabs")) return;

    const shell = document.createElement("div");
    shell.className = "terminal-shell";

    const tabs = document.createElement("div");
    tabs.id = "terminal-tabs";
    tabs.className = "terminal-tabs";

    const stage = document.createElement("div");
    stage.className = "terminal-stage";

    const overlay = document.createElement("div");
    overlay.id = "terminal-overlay";
    overlay.className = "terminal-overlay hidden";

    const wakingBanner = document.createElement("div");
    wakingBanner.id = "terminal-waking-banner";
    wakingBanner.className = "terminal-waking-banner hidden";

    terminal.parentNode.insertBefore(shell, terminal);
    shell.appendChild(tabs);
    shell.appendChild(stage);
    stage.appendChild(wakingBanner);
    stage.appendChild(overlay);
    stage.appendChild(terminal);
}

ensureTerminalShell();
const term = new Terminal({
    theme: { background: "#000000" },
    fontSize: 14,
    cursorStyle: "bar",
    cursorInactiveStyle: "none",
    cursorBlink: true,
    fontFamily: 'Consolas, "Cascadia Mono", "Courier New", "Microsoft YaHei UI", monospace'
});
const fitAddon = new FitAddon.FitAddon();
window.fitAddon = fitAddon;
term.loadAddon(fitAddon);
term.open(document.getElementById("terminal-container"));
window.term = term;
var terminalZoomState = { fontSize: 14, min: 10, max: 24, step: 1 };

function applyTerminalFontSize(nextFontSize, { fit = true } = {}) {
    const normalized = Math.max(terminalZoomState.min, Math.min(terminalZoomState.max, Number(nextFontSize) || terminalZoomState.fontSize));
    terminalZoomState.fontSize = normalized;
    term.options.fontSize = normalized;
    if (fit && window.fitAddon) {
        setTimeout(() => {
            window.fitAddon.fit();
            const route = getActiveTerminalRoute();
            if (route && window.api?.resizeTerminal) {
                window.api.resizeTerminal({ sessionKey: route.sessionKey, cols: term.cols, rows: term.rows });
            }
        }, 0);
    }
}

window.applyTerminalFontSize = applyTerminalFontSize;

async function copyTextToClipboard(text) {
    const value = String(text || "");
    if (!value) return false;

    try {
        if (window.api?.writeClipboardText) {
            window.api.writeClipboardText(value);
            if (!window.api?.readClipboardText || window.api.readClipboardText() === value) return true;
        }
    } catch {}

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }
    } catch {}

    try {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "readonly");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        textarea.style.pointerEvents = "none";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        return copied;
    } catch {
        return false;
    }
}

async function readTextFromClipboard() {
    try {
        if (window.api?.readClipboardText) {
            const value = window.api.readClipboardText();
            if (typeof value === "string") return value;
        }
    } catch {}

    try {
        if (navigator.clipboard?.readText) {
            return await navigator.clipboard.readText();
        }
    } catch {}

    return "";
}

window.copyTextToClipboard = copyTextToClipboard;
window.readTextFromClipboard = readTextFromClipboard;
window.ensureTerminalShell = ensureTerminalShell;

window.addEventListener("focus", () => {
    if (activeSection === "workspace" && workspaceView === "lab") {
        focusTerminal();
    }
});

function getActiveTerminalRoute() {
    const lab = getActiveLab();
    if (!lab) return null;
    const activeTabKey = terminalUiState.activeTabKey || getPrimaryResourceNameForLab(lab);
    const resourceName = (typeof resolveBaseResourceName === "function" ? resolveBaseResourceName : (k) => k)(activeTabKey);
    const boundInstance = getBoundInstanceForLab(lab, resourceName);
    const profile = getProfileForResource(lab, resourceName);
    if (!profile) return null;
    return {
        lab,
        resourceName,
        boundInstance,
        profile,
        sessionKey: getTerminalSessionKey(lab, activeTabKey)
    };
}

function normalizeTerminalInputData(data) {
    return String(data || "")
        .replace(/\u3000/g, " ")
        .replace(/\u00a0/g, " ");
}

function focusTerminal() {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable)) return;
    const manualScroll = document.querySelector(".manual-scroll");
    const manualScrollTop = manualScroll ? manualScroll.scrollTop : 0;
    const manualScrollLeft = manualScroll ? manualScroll.scrollLeft : 0;
    try {
        const textarea = document.querySelector("#terminal-container textarea, #terminal-container .xterm-helper-textarea");
        if (textarea && typeof textarea.focus === "function") {
            textarea.focus({ preventScroll: true });
        } else {
            term.focus();
        }
    } catch {}
    if (manualScroll) {
        requestAnimationFrame(() => {
            manualScroll.scrollTop = manualScrollTop;
            manualScroll.scrollLeft = manualScrollLeft;
        });
    }
}

window.focusTerminal = focusTerminal;


// 新增一个判断：当前焦点是否已经在终端里
function isTerminalFocused() {
    const container = document.getElementById("terminal-container");
    // 检查活动元素是否在终端容器内（xterm 使用的是隐藏的 textarea 接收输入）
    return container && container.contains(document.activeElement);
}
window.isTerminalFocused = isTerminalFocused;


function shouldAutoFocusTerminal() {
    if (activeSection !== "workspace" || workspaceView !== "lab" || !getActiveLab()) return false;
    const activeModal = document.querySelector(".modal-overlay.active");
    if (activeModal) return false;
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable)) return false;
    return true;
}

function requestTerminalFocus(delayMs = 0, attempts = 3) {
    const safeAttempts = Math.max(1, Number(attempts) || 1);
    const safeDelay = Math.max(0, Number(delayMs) || 0);
    for (let index = 0; index < safeAttempts; index += 1) {
        setTimeout(() => {
            if (!shouldAutoFocusTerminal()) return;
            focusTerminal();
        }, safeDelay + index * 140);
    }
}

// 新增一个判断：当前焦点是否已经在终端里
window.requestTerminalFocus = requestTerminalFocus;

function isEditableDomTarget(target) {
    const element = target instanceof HTMLElement ? target : null;
    if (!element) return false;
    if (element.isContentEditable) return true;
    const tagName = String(element.tagName || "").toUpperCase();
    return ["INPUT", "TEXTAREA", "SELECT"].includes(tagName);
}

function shouldForceTerminalSpaceForward(event) {
    if (!event || event.defaultPrevented) return false;
    if (event.isComposing) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.key !== " " && event.code !== "Space") return false;
    if (activeSection !== "workspace" || workspaceView !== "lab" || !getActiveLab()) return false;
    if (isEditableDomTarget(event.target)) return false;
    if (isEditableDomTarget(document.activeElement)) return false;
    return true;
}

function forwardTerminalInput(data) {
    if (!data) return false;
    const route = getActiveTerminalRoute();
    if (!route) return false;
    window.api.sendInput({
        type: route.boundInstance?.runnerType || route.profile.runnerType,
        data: normalizeTerminalInputData(data),
        sessionKey: route.sessionKey
    });
    return true;
}

// 修改按键监听器
document.addEventListener("keydown", (event) => {
    if (!shouldForceTerminalSpaceForward(event)) return;

    // 如果焦点已经点进去了，不要干扰 xterm 自己的逻辑
    if (isTerminalFocused()) return;

    // 核心修复：如果焦点在外面（比如刚点完重置按钮），拦截这次空格
    event.preventDefault(); 
    event.stopPropagation();
    
    // 1. 强行夺回焦点
    focusTerminal();
    
    // 2. 关键：手动补发这个空格字符到后端
    forwardTerminalInput(" "); 
}, true);

term.onSelectionChange(() => {
    const selection = term.getSelection();
    if (!selection) return;
    copyTextToClipboard(selection);
});

if (term.element) {
    term.element.addEventListener("mousedown", () => {
        focusTerminal();
    }, true);

    term.element.addEventListener("click", () => {
        focusTerminal();
    }, true);

    term.element.addEventListener("mouseup", () => {
        const selection = term.getSelection();
        if (!selection) return;
        setTimeout(() => copyTextToClipboard(selection), 0);
    });

    term.element.addEventListener("contextmenu", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const clipboardText = await readTextFromClipboard();
        if (!clipboardText) return;
        forwardTerminalInput(clipboardText);
        focusTerminal();
    }, true);

    term.element.addEventListener("wheel", (event) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        event.stopPropagation();
        const direction = event.deltaY < 0 ? 1 : -1;
        applyTerminalFontSize(terminalZoomState.fontSize + direction * terminalZoomState.step);
    }, { passive: false });
}

function getTerminalSessionKey(lab, resourceName = "") {
    const labId = lab?.id || "global";
    const targetResource = String(resourceName || "").trim() || getPrimaryResourceNameForLab(lab);
    return `${labId}:${targetResource}`;
}

function ensureTerminalSession(sessionKey) {
    if (!terminalSessionState.sessions[sessionKey]) {
        terminalSessionState.sessions[sessionKey] = {
            buffer: "",
            status: "idle",
            connected: false,
            authPromptEligible: false,
            authPromptInFlight: false
        };
    }
    return terminalSessionState.sessions[sessionKey];
}

function resolveTerminalSessionKey(sessionKey = "") {
    const rawKey = String(sessionKey || "").trim();
    if (!rawKey || rawKey === "default") return terminalSessionState.activeSessionKey || "global:default";
    return rawKey;
}

function normalizeTerminalDataPayload(payload) {
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        return {
            sessionKey: resolveTerminalSessionKey(payload.sessionKey),
            data: String(payload.data || "")
        };
    }
    return {
        sessionKey: resolveTerminalSessionKey(""),
        data: String(payload || "")
    };
}

function normalizeTerminalStatusPayload(payload) {
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        return {
            sessionKey: resolveTerminalSessionKey(payload.sessionKey),
            status: String(payload.status || "")
        };
    }
    return {
        sessionKey: resolveTerminalSessionKey(""),
        status: String(payload || "")
    };
}

function getReadableSshStatus(status) {
    const rawStatus = String((status && typeof status === "object" ? status.status : status) || "");
    if (rawStatus === "connected") return "Online";
    if (rawStatus === "disconnected") return "Disconnected";
    if (rawStatus === "connecting") return "Connecting...";
    if (/Timed out while waiting for handshake|ETIMEDOUT|ECONNREFUSED/i.test(rawStatus)) return "Connecting...";
    return rawStatus || "Idle";
}

function isAuthenticationFailureStatus(status = "") {
    return /All configured authentication methods failed|Permission denied|authentication failed|User authentication failure/i.test(String(status || ""));
}

function parseSessionKeyRoute(sessionKey = "") {
    const rawKey = String(sessionKey || "").trim();
    const separatorIndex = rawKey.indexOf(":");
    if (separatorIndex <= 0) return { labId: "", resourceName: "" };
    return {
        labId: rawKey.slice(0, separatorIndex),
        resourceName: rawKey.slice(separatorIndex + 1)
    };
}

function getBoundInstanceBySessionKey(sessionKey = "") {
    const route = parseSessionKeyRoute(sessionKey);
    if (!route.labId) return null;
    const lab = getLab(route.labId);
    if (!lab) return null;
    return getBoundInstanceForLab(lab, route.resourceName);
}

async function promptForUpdatedSshPassword(sessionKey = "", status = "") {
    const session = ensureTerminalSession(sessionKey);
    if (!session.authPromptEligible || session.authPromptInFlight) return;
    const instance = getBoundInstanceBySessionKey(sessionKey);
    if (!instance?.connection?.host) return;
    if (typeof window.openVmTextPrompt !== "function") return;

    session.authPromptInFlight = true;
    session.authPromptEligible = false;

    try {
        const currentPassword = String(instance.connection?.password || "");
        const defaultHint = currentPassword === "123"
            ? "当前主机已连通，但默认密码 123 认证失败。请输入修改后的密码。"
            : "当前主机已连通，但认证失败。请输入正确的 SSH 密码。";
        const nextPassword = await window.openVmTextPrompt(
            "SSH 密码已变更",
            `${defaultHint}\n错误信息：${status || "认证失败"}`,
            "",
            "password"
        );
        if (!nextPassword) return;

        if (!instance.connection || typeof instance.connection !== "object") {
            instance.connection = { host: "", username: "root", password: "" };
        }
        instance.connection.password = nextPassword;
        if (appData.resourceInstances[instance.id]) {
            appData.resourceInstances[instance.id].connection.password = nextPassword;
        }
        await sync();

        if (typeof showToast === "function") {
            showToast("密码已更新", "正在使用新密码重新连接资源。", "success");
        }

        const route = parseSessionKeyRoute(sessionKey);
        if (route.resourceName && typeof window.reconnectResource === "function") {
            window.reconnectResource(route.resourceName, true);
        }
    } finally {
        session.authPromptInFlight = false;
    }
}

async function refreshVmResourceConnection(instance, { persist = true } = {}) {
    const currentInstance = instance?.id ? (appData.resourceInstances[instance.id] || instance) : instance;
    if (!currentInstance || currentInstance.providerType !== "vmware_vm" || !currentInstance.vmxPath) return currentInstance;
    if (!window.api?.getVMPowerState || !window.api?.getVMIP) return currentInstance;

    const refreshKey = currentInstance.id || currentInstance.vmxPath;
    if (vmConnectionRefreshPromises.has(refreshKey)) return vmConnectionRefreshPromises.get(refreshKey);

    const task = (async () => {
        let powerState = String(resourceVmRuntimeMap[currentInstance.id]?.powerState || "");
        try {
            powerState = await window.api.getVMPowerState(currentInstance.vmxPath) || powerState;
        } catch {}

        let latestIp = "";
        if (powerState === "running") {
            try {
                latestIp = await window.api.getVMIP(currentInstance.vmxPath) || "";
            } catch {}
        }

        const existingHost = String(currentInstance.connection?.host || "");
        const resolvedHost = String(latestIp || existingHost || "");
        const previousSnapshot = resourceVmRuntimeMap[currentInstance.id] || {};
        resourceVmRuntimeMap[currentInstance.id] = {
            powerState: powerState || previousSnapshot.powerState || "",
            ip: resolvedHost || ""
        };

        let shouldPersist = false;
        const storedInstance = appData.resourceInstances[currentInstance.id];
        if (resolvedHost && storedInstance) {
            if (!storedInstance.connection || typeof storedInstance.connection !== "object") {
                storedInstance.connection = { host: "", username: "root", password: "" };
            }
            if (storedInstance.connection.host !== resolvedHost) {
                storedInstance.connection.host = resolvedHost;
                shouldPersist = true;
            }
        }

        if (resolvedHost) {
            if (!currentInstance.connection || typeof currentInstance.connection !== "object") {
                currentInstance.connection = { host: "", username: "root", password: "" };
            }
            currentInstance.connection.host = resolvedHost;
        }

        if (persist && shouldPersist) {
            await sync();
        }

        return appData.resourceInstances[currentInstance.id] || currentInstance;
    })();

    vmConnectionRefreshPromises.set(refreshKey, task);
    try {
        return await task;
    } finally {
        vmConnectionRefreshPromises.delete(refreshKey);
    }
}

function appendTerminalData(payload) {
    const incoming = normalizeTerminalDataPayload(payload);
    if (!incoming.data) return;
    const session = ensureTerminalSession(incoming.sessionKey);
    session.buffer += incoming.data;
    if (terminalSessionState.activeSessionKey === incoming.sessionKey) {
        term.write(incoming.data);
    }
}

function applyTerminalStatus(payload) {
    const incoming = normalizeTerminalStatusPayload(payload);
    const session = ensureTerminalSession(incoming.sessionKey);
    session.status = incoming.status || "idle";
    session.connected = incoming.status === "connected";

    if (incoming.status === "connected") {
        clearSshRetryTimer();
        sshRetryState.attempts = 0;
        session.authPromptEligible = false;
        session.authPromptInFlight = false;
        const route = parseSessionKeyRoute(incoming.sessionKey);
        if (route.labId && route.resourceName) {
            const lab = getLab(route.labId);
            const instance = lab ? getBoundInstanceForLab(lab, route.resourceName) : null;
            const profile = lab ? getProfileForResource(lab, route.resourceName) : null;
            if (instance) {
                instance.status = "ready";
                if (appData.resourceInstances[instance.id]) {
                    appData.resourceInstances[instance.id].status = "ready";
                }
            }
            if (profile) {
                const statusKey = getStatusKey(profile);
                resourceStatusMap[statusKey] = {
                    statusKey,
                    state: "ready",
                    progressPercent: 100,
                    title: profile.name,
                    message: "环境已就绪"
                };
            }
        }
        if (incoming.sessionKey === terminalSessionState.activeSessionKey) {
            requestTerminalFocus(40, 3);
        }
    } else if (/Timed out while waiting for handshake|ETIMEDOUT|ECONNREFUSED|ECONNRESET/i.test(incoming.status) && incoming.sessionKey === terminalSessionState.activeSessionKey) {
        scheduleSshRetry();
    }

    if (isAuthenticationFailureStatus(incoming.status)) {
        promptForUpdatedSshPassword(incoming.sessionKey, incoming.status).catch(() => {});
    }

    if (terminalSessionState.activeSessionKey === incoming.sessionKey) {
        syncSshStatusLabel();
    }
}

function renderTerminalBufferForSession(sessionKey) {
    const session = ensureTerminalSession(sessionKey);
    if (terminalSessionState.activeSessionKey === sessionKey) {
        if (window.api?.resizeTerminal) {
            window.api.resizeTerminal({ sessionKey, cols: term.cols, rows: term.rows });
        }
        syncSshStatusLabel();
        requestTerminalFocus(0, 2);
        return;
    }
    terminalSessionState.activeSessionKey = sessionKey;
    term.reset();
    if (session.buffer) term.write(session.buffer);
    requestTerminalFocus(0, 3);
    if (window.api?.resizeTerminal) {
        window.api.resizeTerminal({ sessionKey, cols: term.cols, rows: term.rows });
    }
    syncSshStatusLabel();
}

function syncSshStatusLabel() {
    const el = document.getElementById("ssh-status");
    if (!el) return;
    const session = ensureTerminalSession(terminalSessionState.activeSessionKey || "global:default");
    const status = session.status || "idle";
    
    if (status === "connected") {
        el.innerText = "● 已连接 (Online)";
        el.style.color = "#28a745";
    } else if (status === "connecting") {
        el.innerText = "正在拨号...";
        el.style.color = "#f59e0b";
    } else {
        el.innerText = status;
        el.style.color = "#ff7b72";
    }
}
term.onData(data => {
    forwardTerminalInput(normalizeTerminalInputData(data));
});

term.onResize(({ cols, rows }) => {
    const route = getActiveTerminalRoute();
    if (!route) return;
    
    window.api.resizeTerminal({
        sessionKey: route.sessionKey,
        cols: cols,
        rows: rows
    });
});

// 自动适应窗口大小
window.addEventListener('resize', () => {
    clearTimeout(window._termResizeT);
    window._termResizeT = setTimeout(() => {
        window.fitAddon.fit();
        // fit() 内部会触发 term.onResize 进而同步给后端
    }, 100);
});

window.api.onData((payload) => appendTerminalData(payload));

if (window.api.onResourceStatus) {
    window.api.onResourceStatus(payload => {
        if (!payload?.statusKey) return;
        const prev = resourceStatusMap[payload.statusKey];
        resourceStatusMap[payload.statusKey] = payload;
        const toastSignature = `${payload.state}:${payload.message || ""}`;
        if (resourceStatusToastState[payload.statusKey] !== toastSignature && typeof window.showToast === "function") {
            if (payload.state === "ready") {
                window.showToast(payload.title || "资源已就绪", payload.message || "实验环境已经准备完成。", "success");
            } else if (payload.state === "failed") {
                window.showToast(payload.title || "资源失败", payload.message || "实验环境初始化失败。", "fail");
            } else if (payload.state === "provisioning" && (!prev || prev.message !== payload.message)) {
                window.showToast(payload.title || "资源处理中", payload.message || "实验环境正在准备中。");
            }
            resourceStatusToastState[payload.statusKey] = toastSignature;
        }
        if (window.renderApp) window.renderApp();
    });
}

function uid(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
    return new Date().toISOString();
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function slugify(value) {
    return String(value || "")
        .trim()
        .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "item";
}

function normalizeResourceAliases(rawAliases = {}, rockyOvaPath = "") {
    const aliases = {};
    const source = rawAliases && typeof rawAliases === "object" && !Array.isArray(rawAliases) ? rawAliases : {};
    Object.keys(source).forEach(key => {
        const alias = String(key || "").trim();
        const targetPath = String(source[key] || "").trim();
        if (alias && targetPath) aliases[alias] = targetPath;
    });
    if (rockyOvaPath && !Object.keys(aliases).some(alias => alias.toLowerCase() === "rockybase")) {
        aliases.RockyBase = rockyOvaPath;
    }
    return aliases;
}

function parseResourceAliasesText(rawText = "") {
    const aliases = {};
    const errors = [];
    String(rawText || "").split(/\r?\n/).forEach((line, index) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;
        const separatorIndex = trimmed.includes("=") ? trimmed.indexOf("=") : trimmed.indexOf(":");
        if (separatorIndex <= 0) {
            errors.push(`Line ${index + 1}: ${trimmed}`);
            return;
        }
        const alias = trimmed.slice(0, separatorIndex).trim();
        const targetPath = trimmed.slice(separatorIndex + 1).trim();
        if (!alias || !targetPath) {
            errors.push(`Line ${index + 1}: ${trimmed}`);
            return;
        }
        aliases[alias] = targetPath;
    });
    return { aliases, errors };
}

function serializeResourceAliasesText(resourceAliases = {}, rockyOvaPath = "") {
    const aliases = normalizeResourceAliases(resourceAliases, rockyOvaPath);
    return Object.keys(aliases)
        .sort((left, right) => left.localeCompare(right))
        .map(alias => `${alias}=${aliases[alias]}`)
        .join("\n");
}

function findResourceAliasPath(alias, settings = appData?.settings || DEFAULT_SETTINGS) {
    const targetAlias = String(alias || "").trim().toLowerCase();
    if (!targetAlias) return "";
    const aliases = normalizeResourceAliases(settings?.resourceAliases || {}, settings?.rockyOvaPath || "");
    const matchedKey = Object.keys(aliases).find(item => item.toLowerCase() === targetAlias);
    return matchedKey ? aliases[matchedKey] : "";
}

function getSettingsRuntimeSignature(settings = {}) {
    const aliases = normalizeResourceAliases(settings.resourceAliases || {}, settings.rockyOvaPath || "");
    const aliasSignature = Object.keys(aliases)
        .sort((left, right) => left.localeCompare(right))
        .map(alias => `${alias}=${aliases[alias]}`)
        .join("|");
    return `${settings.rockyOvaPath || ""}::${aliasSignature}`;
}

function mapProviderToRunner(providerType) {
    if (providerType === "local_python") return "python";
    if (providerType === "local_java") return "java";
    return "ssh";
}

function normalizeProviderType(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return "";
    if (raw === "ssh" || raw === "manual_ssh") return "manual_ssh";
    if (raw === "vmware" || raw === "vmware_vm") return "vmware_vm";
    if (raw === "python" || raw === "local_python" || raw === "python_local") return "local_python";
    if (raw === "java" || raw === "local_java" || raw === "java_local") return "local_java";
    return "";
}

function defaultSummaryForProvider(providerType) {
    if (providerType === "manual_ssh") return "1 台可连接的 SSH 服务器";
    if (providerType === "vmware_vm") return "1 台由软件初始化的 VMware 虚拟机";
    if (providerType === "local_python") return "1 套本地 Python 运行环境";
    if (providerType === "local_java") return "1 套本地 Java 运行环境";
    return "1 份可运行资源";
}

function defaultProfileName(courseName, moduleName, providerType) {
    const label = {
        manual_ssh: "SSH 资源",
        vmware_vm: "VMware 资源",
        local_python: "Python 资源",
        local_java: "Java 资源"
    };
    return `${courseName || "课程"}-${moduleName || "目录"}-${label[providerType] || "资源"}`;
}

function normalizeSettings(settings = {}) {
    const vmwareInstallDir = settings.vmwareInstallDir
        || (() => {
            const vmwareExePath = String(settings.vmwareExePath || "").trim();
            if (vmwareExePath && /[\\/]/.test(vmwareExePath)) {
                return vmwareExePath.replace(/[\\/]vmware\.exe$/i, "");
            }
            return DEFAULT_SETTINGS.vmwareInstallDir;
        })();
    const rockyOvaPath = settings.rockyOvaPath || DEFAULT_SETTINGS.rockyOvaPath;
    const manualFontScale = Math.max(0.85, Math.min(1.8, Number(settings.manualFontScale) || DEFAULT_SETTINGS.manualFontScale));
    const sshTerminalFontSize = Math.max(10, Math.min(24, Number(settings.sshTerminalFontSize) || DEFAULT_SETTINGS.sshTerminalFontSize));
    return {
        vmwareInstallDir,
        vmwareExePath: settings.vmwareExePath || `${vmwareInstallDir}\\vmware.exe`,
        vmrunPath: settings.vmrunPath || `${vmwareInstallDir}\\vmrun.exe`,
        vdiskPath: settings.vdiskPath || `${vmwareInstallDir}\\vmware-vdiskmanager.exe`,
        ovftoolPath: settings.ovftoolPath || `${vmwareInstallDir}\\OVFTool\\ovftool.exe`,
        labRootDir: settings.labRootDir || DEFAULT_SETTINGS.labRootDir,
        vmSuspendSeconds: Number(settings.vmSuspendSeconds || DEFAULT_SETTINGS.vmSuspendSeconds) || DEFAULT_SETTINGS.vmSuspendSeconds,
        manualFontScale,
        sshTerminalFontSize,
        manageExternalVms: settings.manageExternalVms === true,
        rockyOvaPath,
        resourceAliases: normalizeResourceAliases(settings.resourceAliases || {}, rockyOvaPath)
    };
}

function normalizeCourse(id, course = {}) {
    return {
        id,
        name: typeof course.name === "string" ? course.name : "",
        icon: typeof course.icon === "string" && course.icon.trim() ? course.icon : "📦",
        description: typeof course.description === "string" ? course.description : ""
    };
}

function normalizeModule(id, module = {}) {
    return {
        id,
        courseId: typeof module.courseId === "string" ? module.courseId : "",
        name: typeof module.name === "string" ? module.name : "",
        description: typeof module.description === "string" ? module.description : "",
        defaultResourceProfileId: typeof module.defaultResourceProfileId === "string" ? module.defaultResourceProfileId : ""
    };
}

function normalizeLab(id, lab = {}) {
    const rawBoundInstances = lab.boundInstances && typeof lab.boundInstances === "object" && !Array.isArray(lab.boundInstances)
        ? lab.boundInstances
        : {};
    const boundInstances = {};
    Object.keys(rawBoundInstances).forEach((key) => {
        const resourceName = String(key || "").trim();
        const instanceId = String(rawBoundInstances[key] || "").trim();
        if (resourceName && instanceId) boundInstances[resourceName] = instanceId;
    });
    const legacyBoundInstanceId = typeof lab.boundInstanceId === "string" ? lab.boundInstanceId.trim() : "";
    if (legacyBoundInstanceId && !Object.keys(boundInstances).length) {
        boundInstances.default = legacyBoundInstanceId;
    }
    const passedCheckpoints = {};
    const rawPassedCheckpoints = lab.passedCheckpoints && typeof lab.passedCheckpoints === "object" && !Array.isArray(lab.passedCheckpoints)
        ? lab.passedCheckpoints
        : {};
    Object.keys(rawPassedCheckpoints).forEach((key) => {
        const checkpointId = String(key || "").trim();
        if (!checkpointId) return;
        passedCheckpoints[checkpointId] = typeof rawPassedCheckpoints[key] === "string"
            ? rawPassedCheckpoints[key]
            : nowIso();
    });
    const rawManualReadingState = lab.manualReadingState && typeof lab.manualReadingState === "object" && !Array.isArray(lab.manualReadingState)
        ? lab.manualReadingState
        : null;
    const manualReadingState = rawManualReadingState
        ? {
            signature: typeof rawManualReadingState.signature === "string" ? rawManualReadingState.signature : "",
            scrollTop: Math.max(0, Number(rawManualReadingState.scrollTop || 0) || 0),
            scrollRatio: Math.max(0, Math.min(1, Number(rawManualReadingState.scrollRatio || 0) || 0)),
            updatedAt: typeof rawManualReadingState.updatedAt === "string" ? rawManualReadingState.updatedAt : ""
        }
        : null;
    return {
        id,
        courseId: typeof lab.courseId === "string" ? lab.courseId : "",
        moduleId: typeof lab.moduleId === "string" ? lab.moduleId : "",
        title: typeof lab.title === "string" ? lab.title : "",
        manual: typeof lab.manual === "string" ? lab.manual : "",
        check: typeof lab.check === "string" ? lab.check : "",
        resourceProfileId: typeof lab.resourceProfileId === "string" ? lab.resourceProfileId : "",
        boundInstances,
        passedCheckpoints,
        completed: Boolean(lab.completed),
        manualReadingState,
        importMeta: lab.importMeta && typeof lab.importMeta === "object" ? lab.importMeta : null
    };
}

function normalizeResourceProfile(id, profile = {}) {
    const providerType = normalizeProviderType(profile.providerType || profile.provider || profile.type || profile.runnerType);
    return {
        id,
        name: typeof profile.name === "string" && profile.name.trim() ? profile.name : "未命名资源画像",
        providerType: providerType || "manual_ssh",
        runnerType: profile.runnerType || mapProviderToRunner(providerType || "manual_ssh"),
        summary: typeof profile.summary === "string" && profile.summary.trim() ? profile.summary : defaultSummaryForProvider(providerType || "manual_ssh"),
        reuseKey: typeof profile.reuseKey === "string" ? profile.reuseKey : "",
        note: typeof profile.note === "string" ? profile.note : "",
        osName: typeof profile.osName === "string" ? profile.osName : "",
        ovaPath: typeof profile.ovaPath === "string" ? profile.ovaPath : (typeof profile.isoPath === "string" ? profile.isoPath : ""),
        vmCpu: Number(profile.vmCpu || profile.cpu || 1) || 1,
        vmMemoryMB: Number(profile.vmMemoryMB || profile.memoryMB || profile.memory || 1024) || 1024,
        vmDiskGB: Number(profile.vmDiskGB || profile.diskGB || profile.disk || 40) || 40,
        guestUsername: typeof profile.guestUsername === "string" && profile.guestUsername ? profile.guestUsername : "root",
        guestPassword: typeof profile.guestPassword === "string" && profile.guestPassword ? profile.guestPassword : "123",
        vmwareTemplate: typeof profile.vmwareTemplate === "string" && profile.vmwareTemplate ? profile.vmwareTemplate : "RockyBase",
        vmwareSnapshot: typeof profile.vmwareSnapshot === "string" ? profile.vmwareSnapshot : "",
        reuseEnabled: profile.reuseEnabled !== false && profile.reusable !== false
    };
}

function normalizeConnection(connection = {}) {
    return {
        host: typeof connection.host === "string" ? connection.host : "",
        username: typeof connection.username === "string" && connection.username ? connection.username : "root",
        password: typeof connection.password === "string" ? connection.password : ""
    };
}

function normalizeResourceInstance(id, instance = {}) {
    const providerType = normalizeProviderType(instance.providerType || instance.provider || instance.type);
    return {
        id,
        profileId: typeof instance.profileId === "string" ? instance.profileId : "",
        providerType: providerType || "manual_ssh",
        runnerType: instance.runnerType || mapProviderToRunner(providerType || "manual_ssh"),
        label: typeof instance.label === "string" && instance.label.trim() ? instance.label : "未命名资源实例",
        status: typeof instance.status === "string" ? instance.status : "ready",
        reusable: instance.reusable !== false,
        createdByApp: Boolean(instance.createdByApp),
        lastUsedAt: typeof instance.lastUsedAt === "string" ? instance.lastUsedAt : "",
        reuseKey: typeof instance.reuseKey === "string" ? instance.reuseKey : "",
        workspaceDir: typeof instance.workspaceDir === "string" ? instance.workspaceDir : "",
        vmxPath: typeof instance.vmxPath === "string" ? instance.vmxPath : "",
        vmDisplayName: typeof instance.vmDisplayName === "string" ? instance.vmDisplayName : "",
        labId: typeof instance.labId === "string" ? instance.labId : "",
        resourceName: typeof instance.resourceName === "string" ? instance.resourceName : "",
        vmCpu: Number(instance.vmCpu || instance.cpu || 0) || 0,
        vmMemoryMB: Number(instance.vmMemoryMB || instance.memoryMB || instance.memory || 0) || 0,
        vmDiskGB: Number(instance.vmDiskGB || instance.diskGB || instance.disk || 0) || 0,
        resetSnapshot: typeof instance.resetSnapshot === "string" ? instance.resetSnapshot : "",
        notes: typeof instance.notes === "string" ? instance.notes : "",
        connection: normalizeConnection(instance.connection || {})
    };
}

function getCourseIdByModuleIdFallback(modules, moduleId) {
    return modules[moduleId]?.courseId || "";
}

function migrateLegacyData(data = {}) {
    if (data.resourceProfiles || data.resourceInstances || data.settings) {
        return data;
    }

    const migrated = {
        courses: {},
        modules: {},
        labs: {},
        resourceProfiles: {},
        resourceInstances: {},
        settings: DEFAULT_SETTINGS
    };

    if (data.modules && data.labs) {
        const envTemplates = data.envTemplates || {};

        Object.keys(data.courses || {}).forEach(courseId => {
            migrated.courses[courseId] = {
                name: data.courses[courseId]?.name || "未命名课程",
                icon: data.courses[courseId]?.icon || "📦",
                description: data.courses[courseId]?.description || ""
            };
        });

        Object.keys(data.modules || {}).forEach(moduleId => {
            const oldModule = data.modules[moduleId] || {};
            const runtimeType = oldModule.runtimeType || "ssh";
            const providerType = runtimeType === "ssh" ? "manual_ssh" : runtimeType === "java" ? "local_java" : "local_python";
            const profileId = `profile_${moduleId}`;

            migrated.resourceProfiles[profileId] = {
                name: `${oldModule.name || "目录"}默认资源`,
                providerType,
                runnerType: runtimeType,
                summary: defaultSummaryForProvider(providerType),
                reuseKey: `${oldModule.courseId || ""}:${oldModule.name || moduleId}:${providerType}`,
                note: oldModule.runtimeNote || "",
                vmwareTemplate: envTemplates[oldModule.envId]?.name || "",
                vmwareSnapshot: ""
            };

            migrated.modules[moduleId] = {
                courseId: oldModule.courseId,
                name: oldModule.name || "未命名目录",
                description: oldModule.description || "",
                defaultResourceProfileId: profileId
            };

            (oldModule.sshServers || []).forEach((server, index) => {
                const instanceId = `instance_${moduleId}_${index}`;
                migrated.resourceInstances[instanceId] = {
                    profileId,
                    providerType: "manual_ssh",
                    runnerType: "ssh",
                    label: server.name || server.host || `服务器 ${index + 1}`,
                    status: "ready",
                    reusable: true,
                    createdByApp: false,
                    lastUsedAt: "",
                    reuseKey: `${oldModule.courseId || ""}:${oldModule.name || moduleId}:manual_ssh`,
                    workspaceDir: "",
                    notes: "从旧版 SSH 配置迁移",
                    connection: normalizeConnection(server)
                };
            });
        });

        Object.keys(data.labs || {}).forEach(labId => {
            const oldLab = data.labs[labId] || {};
            migrated.labs[labId] = {
                courseId: oldLab.courseId || getCourseIdByModuleIdFallback(data.modules || {}, oldLab.moduleId),
                moduleId: oldLab.moduleId,
                title: oldLab.title || "未命名实验",
                manual: oldLab.manual || "",
                check: oldLab.check || "",
                resourceProfileId: "",
                boundInstances: {},
                completed: Boolean(oldLab.completed),
                importMeta: oldLab.importMeta || null
            };
        });

        return migrated;
    }

    Object.keys(data.courses || {}).forEach(courseId => {
        const course = data.courses[courseId] || {};
        migrated.courses[courseId] = {
            name: course.name || "未命名课程",
            icon: course.icon || "📦",
            description: course.description || ""
        };
    });

    return migrated;
}

function normalizeAppData(data = {}) {
    const migrated = migrateLegacyData(data);
    const normalized = {
        courses: {},
        modules: {},
        labs: {},
        resourceProfiles: {},
        resourceInstances: {},
        settings: normalizeSettings(migrated.settings || {})
    };

    Object.keys(migrated.courses || {}).forEach(id => normalized.courses[id] = normalizeCourse(id, migrated.courses[id]));
    Object.keys(migrated.modules || {}).forEach(id => normalized.modules[id] = normalizeModule(id, migrated.modules[id]));
    Object.keys(migrated.labs || {}).forEach(id => normalized.labs[id] = normalizeLab(id, migrated.labs[id]));
    Object.keys(migrated.resourceProfiles || {}).forEach(id => normalized.resourceProfiles[id] = normalizeResourceProfile(id, migrated.resourceProfiles[id]));
    Object.keys(migrated.resourceInstances || {}).forEach(id => normalized.resourceInstances[id] = normalizeResourceInstance(id, migrated.resourceInstances[id]));

    return normalized;
}

function splitFrontMatter(rawText) {
    const text = String(rawText || "");
    const frontMatterMatch = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n)?([\s\S]*)$/);
    if (frontMatterMatch) {
        return { hasFrontMatter: true, frontMatter: frontMatterMatch[1], body: frontMatterMatch[2] };
    }
    const fencedYamlMatch = text.match(/^```(?:yaml|yml)\s*\r?\n([\s\S]*?)\r?\n```\s*(?:\r?\n)?([\s\S]*)$/i);
    if (fencedYamlMatch) {
        return { hasFrontMatter: true, frontMatter: fencedYamlMatch[1], body: fencedYamlMatch[2] };
    }
    return { hasFrontMatter: false, frontMatter: "", body: text };
}

function normalizeManifestReuse(value) {
    if (value === undefined || value === null || value === "") return true;
    if (typeof value === "boolean") return value;
    const normalized = String(value || "").trim().toLowerCase();
    if (["yes", "true", "on", "1"].includes(normalized)) return true;
    if (["no", "false", "off", "0"].includes(normalized)) return false;
    return true;
}

function normalizeManifestResource(resource = {}, index = 0) {
    if (!resource || typeof resource !== "object") return null;
    const name = String(resource.name || resource.hostname || `node-${index + 1}`).trim();
    const os = String(resource.os || resource.image || resource.template || "").trim();
    const cpu = Number(resource.cpu || resource.vcpu || 1) || 1;
    const memory = Number(resource.memory || resource.memory_mb || resource.memoryMB || 1024) || 1024;
    const diskRaw = resource.disk === undefined ? "default" : resource.disk;
    const disk = typeof diskRaw === "number" ? diskRaw : String(diskRaw || "default").trim() || "default";
    const reuse = normalizeManifestReuse(resource.reuse);
    const setupScript = typeof resource.setup_script === "string"
        ? resource.setup_script.trim()
        : (typeof resource.setupScript === "string" ? resource.setupScript.trim() : "");
    return { name, os, cpu, memory, disk, setupScript, reuse };
}

function normalizeManifestCommand(command = {}, index = 0) {
    if (!command || typeof command !== "object") return null;
    const target = String(command.target || command.resource || command.resourceName || command.name || "").trim();
    const run = typeof command.run === "string"
        ? command.run.trim()
        : (typeof command.command === "string" ? command.command.trim() : "");
    if (!target || !run) return null;
    return {
        id: String(command.id || `command-${index + 1}`).trim(),
        target,
        run
    };
}

function normalizeManifestFile(file = {}, index = 0) {
    if (!file || typeof file !== "object") return null;
    const target = String(file.target || file.resource || file.resourceName || file.name || "").trim();
    const source = String(file.source || file.path || file.from || "").trim();
    const targetPath = String(file.target_path || file.targetPath || file.to || file.dest || file.destination || "").trim();
    if (!target || !source || !targetPath) return null;
    return {
        id: String(file.id || `file-${index + 1}`).trim(),
        target,
        source,
        targetPath,
        optional: file.optional === true
    };
}

function normalizeManifestCheck(check, legacyCommand = "") {
    if (typeof check === "string" && check.trim()) {
        return { command: check.trim(), successMsg: "验证通过", failMsg: "验证未通过，请检查操作步骤。", hint: "" };
    }
    if (check && typeof check === "object") {
        const command = String(check.command || check.cmd || legacyCommand || "").trim();
        if (!command) return null;
        return {
            command,
            successMsg: String(check.success_msg || check.successMessage || "验证通过").trim(),
            failMsg: String(check.fail_msg || check.failMessage || "验证未通过，请检查操作步骤。").trim(),
            hint: String(check.verify_hint || check.hint || check.fail_hint || "").trim()
        };
    }
    if (legacyCommand && String(legacyCommand).trim()) {
        return {
            command: String(legacyCommand).trim(),
            successMsg: "验证通过",
            failMsg: "验证未通过，请检查操作步骤。",
            hint: ""
        };
    }
    return null;
}

function createStableCheckpointId(labId, check = {}, index = 0) {
    const source = `${labId || "lab"}:${check.title || ""}:${check.cmd || check.command || ""}:${index}`;
    let hash = 0;
    for (let i = 0; i < source.length; i += 1) {
        hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
    }
    return `checkpoint_${index + 1}_${Math.abs(hash).toString(36)}`;
}

function inferCheckpointResourceName(sourceText = "", resourceNames = []) {
    let matched = "";
    let matchedIndex = -1;
    resourceNames.forEach((resourceName) => {
        const marker = `@${resourceName}`;
        const index = String(sourceText || "").lastIndexOf(marker);
        if (index > matchedIndex) {
            matchedIndex = index;
            matched = resourceName;
        }
    });
    return matched;
}

function extractInlineCheckpointsFromManual(markdown = "", labId = "", resourceNames = []) {
    const checkpoints = [];
    let checkpointIndex = 0;
    const transformedMarkdown = String(markdown || "").replace(/<!--\s*lab-check:\s*([\s\S]*?)-->/g, (matched, rawJson, offset, fullText) => {
        try {
            const parsed = JSON.parse(String(rawJson || "").trim());
            const cmd = String(parsed.cmd || parsed.command || "").trim();
            if (!cmd) return "";
            const title = String(parsed.title || `步骤 ${checkpointIndex + 1} 验证`).trim() || `步骤 ${checkpointIndex + 1} 验证`;
            const explicitId = String(parsed.id || "").trim();
            const id = explicitId || createStableCheckpointId(labId, parsed, checkpointIndex);
            const lookback = String(fullText || "").slice(Math.max(0, offset - 320), offset);
            checkpoints.push({
                id,
                index: checkpointIndex,
                title,
                cmd,
                hint: String(parsed.hint || parsed.fail_hint || parsed.failHint || "").trim(),
                successMsg: String(parsed.success_msg || parsed.successMessage || "验证通过").trim(),
                failMsg: String(parsed.fail_msg || parsed.failMessage || "验证未通过").trim(),
                resourceName: String(parsed.target || parsed.resource || parsed.resourceName || inferCheckpointResourceName(lookback, resourceNames) || "").trim()
            });
            checkpointIndex += 1;
            return `\n\n@@INLINE_CHECKPOINT:${id}@@\n\n`;
        } catch {
            return "";
        }
    });
    return { markdown: transformedMarkdown, checkpoints };
}

function parseLabManifest(rawManual) {
    const source = String(rawManual || "");
    const parts = splitFrontMatter(source);
    let data = {};
    let error = "";
    if (parts.hasFrontMatter && parts.frontMatter.trim()) {
        try {
            if (window.jsyaml?.load) data = window.jsyaml.load(parts.frontMatter) || {};
            else error = "js-yaml is not available in the renderer.";
        } catch (parseError) {
            error = parseError.message || "Failed to parse YAML front matter.";
        }
    }
    const resources = Array.isArray(data.resources)
        ? data.resources.map((item, index) => normalizeManifestResource(item, index)).filter(Boolean)
        : [];
    const commands = Array.isArray(data.commands)
        ? data.commands.map((item, index) => normalizeManifestCommand(item, index)).filter(Boolean)
        : [];
    const files = Array.isArray(data.files)
        ? data.files.map((item, index) => normalizeManifestFile(item, index)).filter(Boolean)
        : [];
    return {
        hasFrontMatter: parts.hasFrontMatter,
        source,
        body: parts.hasFrontMatter ? parts.body : source,
        raw: data && typeof data === "object" ? data : {},
        resources,
        commands,
        files,
        setupScript: typeof data.setup === "string"
            ? data.setup.trim()
            : (typeof data.setup_script === "string" ? data.setup_script.trim() : ""),
        check: (() => {
            const normalized = normalizeManifestCheck(data.check);
            if (!normalized) return null;
            if (!normalized.hint && data.verify_hint) normalized.hint = String(data.verify_hint).trim();
            return normalized;
        })(),
        error
    };
}

function getStoredProfileForLab(lab) {
    if (!lab) return null;
    return lab.resourceProfileId ? getResourceProfile(lab.resourceProfileId) : getModuleDefaultProfile(lab.moduleId);
}

function buildManifestResourceReuseKey(lab, manifest = {}, resource = {}) {
    const moduleKey = slugify(lab?.moduleId || "module");
    const labKey = slugify(lab?.id || "lab");
    const resourceKey = slugify(resource?.name || "default");
    const osKey = slugify(resource?.os || "RockyBase");
    const cpu = Math.max(1, Number(resource?.cpu || 1) || 1);
    const memory = Math.max(256, Number(resource?.memory || 1024) || 1024);
    const diskRaw = typeof resource?.disk === "number"
        ? String(resource.disk)
        : (String(resource?.disk || "default").trim() || "default");
    if (resource?.reuse === false) {
        return `manifest-lab-exclusive:${labKey}:${resourceKey}:${osKey}:cpu${cpu}:mem${memory}:disk${slugify(diskRaw)}`;
    }
    return `manifest-module:${moduleKey}:${resourceKey}:${osKey}:cpu${cpu}:mem${memory}:disk${slugify(diskRaw)}`;
}

function buildManifestProfileForLab(lab, manifest) {
    const primaryResource = manifest?.resources?.[0];
    if (!lab || !primaryResource) return null;
    const resourceAlias = primaryResource.os || "RockyBase";
    const resolvedOvaPath = findResourceAliasPath(resourceAlias, appData.settings) || appData.settings.rockyOvaPath;
    const summary = manifest.resources.length > 1
        ? `${manifest.resources.length} manifest resources declared. Auto provision uses ${primaryResource.name}.`
        : `${primaryResource.name} from alias ${resourceAlias}.`;
    const note = (primaryResource?.setupScript || manifest.setupScript)
        ? "Manifest setup script will run after the VM is provisioned."
        : "Provisioned from the lab manifest.";
    return normalizeResourceProfile(`manifest_profile_${lab.id}`, {
        name: `${lab.title || "Lab"} · ${primaryResource.name}`,
        providerType: "vmware_vm",
        runnerType: "ssh",
        summary,
        reuseKey: buildManifestResourceReuseKey(lab, manifest, primaryResource),
        reuseEnabled: primaryResource.reuse !== false,
        note,
        osName: resourceAlias,
        ovaPath: resolvedOvaPath,
        vmCpu: primaryResource.cpu,
        vmMemoryMB: primaryResource.memory,
        vmDiskGB: typeof primaryResource.disk === "number" ? primaryResource.disk : 40,
        guestUsername: "root",
        guestPassword: "123",
        vmwareTemplate: resourceAlias,
        vmwareSnapshot: "clean"
    });
}

function getLabRuntimeDefinition(lab) {
    if (!lab) {
        return {
            manifest: { hasFrontMatter: false, source: "", body: "", raw: {}, resources: [], commands: [], files: [], setupScript: "", check: null, error: "" },
            manualMarkdown: "",
            rawManualMarkdown: "",
            manualBaseDir: "",
            manualSourcePath: "",
            profile: null,
            storedProfile: null,
            manifestProfile: null,
            primaryResource: null,
            resources: [],
            commands: [],
            files: [],
            inlineChecks: [],
            setupScript: "",
            check: null,
            warnings: []
        };
    }
    const manualBaseDir = String(lab?.importMeta?.manualBaseDir || lab?.importMeta?.packageDir || "").trim();
    const manualSourcePath = String(lab?.importMeta?.manualSourcePath || "").trim();
    const cacheKey = `${lab.id || ""}::${lab.manual || ""}::${lab.check || ""}::${lab.resourceProfileId || ""}::${lab.moduleId || ""}::${manualBaseDir}::${manualSourcePath}::${getSettingsRuntimeSignature(appData.settings || {})}`;
    const cached = labRuntimeDefinitionCache.get(lab.id || "");
    if (cached?.key === cacheKey) return cached.value;

    const manifest = parseLabManifest(lab.manual || "");
    const storedProfile = getStoredProfileForLab(lab);
    const manifestProfile = buildManifestProfileForLab(lab, manifest);
    const primaryResource = manifest.resources[0] || null;
    const warnings = [];
    if (manifest.error) warnings.push(`Manifest parse failed: ${manifest.error}`);
    if (primaryResource?.os && !findResourceAliasPath(primaryResource.os, appData.settings)) {
        warnings.push(`Resource alias "${primaryResource.os}" is not configured. Falling back to the RockyBase OVA path.`);
    }
    const inlineCheckpointRuntime = extractInlineCheckpointsFromManual(
        (manifest.body || lab.manual || "").trim(),
        lab.id || "",
        manifest.resources.map((item) => item.name)
    );
    const value = {
        manifest,
        manualMarkdown: inlineCheckpointRuntime.markdown,
        rawManualMarkdown: (manifest.body || lab.manual || "").trim(),
        manualBaseDir,
        manualSourcePath,
        profile: manifestProfile || storedProfile,
        storedProfile,
        manifestProfile,
        primaryResource,
        resources: manifest.resources,
        commands: manifest.commands,
        files: manifest.files,
        inlineChecks: inlineCheckpointRuntime.checkpoints,
        setupScript: manifest.setupScript,
        check: normalizeManifestCheck(manifest.check, lab?.check || ""),
        warnings
    };
    labRuntimeDefinitionCache.set(lab.id || "", { key: cacheKey, value });
    return value;
}

function getCourse(courseId) { return appData.courses[courseId] || null; }
function getModule(moduleId) { return appData.modules[moduleId] || null; }
function getLab(labId) { return appData.labs[labId] || null; }
function getActiveLab() { return getLab(activeLabId); }
function getResourceProfile(profileId) { return appData.resourceProfiles[profileId] || null; }
function getResourceInstance(instanceId) { return appData.resourceInstances[instanceId] || null; }
function getModulesByCourse(courseId) { return Object.values(appData.modules).filter(module => module.courseId === courseId); }
function getLabsByModule(moduleId) { return Object.values(appData.labs).filter(lab => lab.moduleId === moduleId); }
function getLabsByCourse(courseId) { return getModulesByCourse(courseId).flatMap(module => getLabsByModule(module.id)); }

function getCourseProgress(courseId) {
    const labs = getLabsByCourse(courseId);
    const total = labs.length;
    const completed = labs.filter(lab => lab.completed).length;
    return { completed, total, percent: total ? Math.round((completed / total) * 100) : 0 };
}

function getModuleProgress(moduleId) {
    const labs = getLabsByModule(moduleId);
    const total = labs.length;
    const completed = labs.filter(lab => lab.completed).length;
    return { completed, total, percent: total ? Math.round((completed / total) * 100) : 0 };
}

function getModuleDefaultProfile(moduleId) {
    const module = getModule(moduleId);
    return module?.defaultResourceProfileId ? getResourceProfile(module.defaultResourceProfileId) : null;
}

function getEffectiveProfileForLab(lab) {
    return getLabRuntimeDefinition(lab).profile;
}

function getStatusKey(profile) {
    return profile ? (profile.reuseKey || profile.id || "") : "";
}

function getPrimaryResourceNameForLab(lab) {
    const runtime = getLabRuntimeDefinition(lab);
    return runtime?.resources?.[0]?.name || "default";
}

function getResourceDefinitionForLab(lab, resourceName = "") {
    const runtime = getLabRuntimeDefinition(lab);
    const targetResource = String(resourceName || "").trim() || getPrimaryResourceNameForLab(lab);
    return runtime?.resources?.find((item) => item.name === targetResource) || runtime?.resources?.[0] || null;
}

function getSetupScriptForResource(lab, resourceName = "") {
    const runtime = getLabRuntimeDefinition(lab);
    const targetResource = getResourceDefinitionForLab(lab, resourceName);
    const scriptParts = [];
    if (runtime?.setupScript) scriptParts.push(runtime.setupScript);
    if (targetResource?.setupScript) scriptParts.push(targetResource.setupScript);
    (runtime?.commands || [])
        .filter((item) => item.target === (targetResource?.name || resourceName || getPrimaryResourceNameForLab(lab)))
        .forEach((item) => scriptParts.push(item.run));
    return scriptParts.filter(Boolean).join("\n\n").trim();
}

function getPreseedFilesForResource(lab, resourceName = "") {
    const runtime = getLabRuntimeDefinition(lab);
    const targetResource = getResourceDefinitionForLab(lab, resourceName);
    const targetName = targetResource?.name || String(resourceName || "").trim() || getPrimaryResourceNameForLab(lab);
    return (runtime?.files || []).filter((item) => item.target === targetName);
}

function isInlineCheckpointPassed(lab, checkpointId = "") {
    const key = String(checkpointId || "").trim();
    return Boolean(key && lab?.passedCheckpoints?.[key]);
}

function markInlineCheckpointPassed(lab, checkpointId = "") {
    if (!lab) return;
    const key = String(checkpointId || "").trim();
    if (!key) return;
    if (!lab.passedCheckpoints || typeof lab.passedCheckpoints !== "object") lab.passedCheckpoints = {};
    lab.passedCheckpoints[key] = nowIso();
}

function resetLabExecutionState(lab) {
    if (!lab) return;
    const runtime = getLabRuntimeDefinition(lab);
    lab.passedCheckpoints = {};
    lab.completed = false;
    (runtime.inlineChecks || []).forEach((checkpoint) => {
        delete inlineCheckpointUiState[checkpoint.id];
    });
}

function clearManualMaterialStateForLab(lab) {
    if (!lab) return;
    const prefix = `${lab.id || "lab"}:`;
    Object.keys(manualMaterialUiState).forEach((key) => {
        if (key.startsWith(prefix)) delete manualMaterialUiState[key];
    });
}

function computeManualReadingSignature(lab) {
    if (!lab) return "";
    const base = [
        lab.id || "",
        lab.importMeta?.sourceId || "",
        lab.importMeta?.manualFile || "",
        lab.importMeta?.manualSourcePath || "",
        lab.manual || ""
    ].join("::");
    let hash = 0;
    for (let index = 0; index < base.length; index += 1) {
        hash = ((hash << 5) - hash + base.charCodeAt(index)) | 0;
    }
    return `m${base.length}:${Math.abs(hash)}`;
}

function clearLabManualReadingState(lab) {
    if (!lab) return;
    lab.manualReadingState = null;
}

function getLabManualReadingState(lab) {
    if (!lab?.manualReadingState) return null;
    const signature = computeManualReadingSignature(lab);
    if (!signature || lab.manualReadingState.signature !== signature) return null;
    return lab.manualReadingState;
}

function persistLabManualReadingState(lab, scrollTop = 0, maxScrollTop = 0) {
    if (!lab) return false;
    const normalizedMax = Math.max(0, Number(maxScrollTop || 0) || 0);
    const normalizedTop = Math.max(0, Number(scrollTop || 0) || 0);
    const signature = computeManualReadingSignature(lab);
    const nextState = {
        signature,
        scrollTop: normalizedTop,
        scrollRatio: normalizedMax > 0 ? Math.max(0, Math.min(1, normalizedTop / normalizedMax)) : 0,
        updatedAt: nowIso()
    };
    const previous = lab.manualReadingState || null;
    if (previous &&
        previous.signature === nextState.signature &&
        Math.abs((previous.scrollTop || 0) - nextState.scrollTop) < 2 &&
        Math.abs((previous.scrollRatio || 0) - nextState.scrollRatio) < 0.002) {
        return false;
    }
    lab.manualReadingState = nextState;
    return true;
}

function resetLabTerminalState(lab) {
    if (!lab) return;
    getAllResourceNamesForLab(lab).forEach((resourceName) => {
        const session = ensureTerminalSession(getTerminalSessionKey(lab, resourceName));
        session.buffer = "";
        session.status = "idle";
        session.connected = false;
    });
    const prefix = `${lab.id}:`;
    Object.keys(clonedSessionMap).filter((k) => k.startsWith(prefix)).forEach((k) => {
        const session = ensureTerminalSession(k);
        session.buffer = "";
        session.status = "idle";
        session.connected = false;
        delete clonedSessionMap[k];
        delete terminalSessionState.sessions[k];
    });
    if (terminalSessionState.activeSessionKey && terminalSessionState.activeSessionKey.startsWith(`${lab.id}:`)) {
        term.reset();
    }
    syncSshStatusLabel();
}

function setWorkspaceBatchProgress(nextState = {}) {
    workspaceBatchState = {
        ...workspaceBatchState,
        ...nextState
    };
}

function getProfileForResource(lab, resourceName = "") {
    const runtime = getLabRuntimeDefinition(lab);
    const targetResource = getResourceDefinitionForLab(lab, resourceName);
    if (!targetResource) return runtime.profile;
    return normalizeResourceProfile(`manifest_profile_${lab.id}_${slugify(targetResource.name)}`, {
        name: `${lab.title || "Lab"} · ${targetResource.name}`,
        providerType: "vmware_vm",
        runnerType: "ssh",
        summary: `${targetResource.name} from alias ${targetResource.os || "RockyBase"}.`,
        reuseKey: buildManifestResourceReuseKey(lab, runtime.manifest || runtime, targetResource),
        reuseEnabled: targetResource.reuse !== false,
        note: getSetupScriptForResource(lab, targetResource.name) ? "Manifest setup script will run after the VM is provisioned." : "Provisioned from the lab manifest.",
        osName: targetResource.os || "RockyBase",
        ovaPath: findResourceAliasPath(targetResource.os || "RockyBase", appData.settings) || appData.settings.rockyOvaPath,
        vmCpu: targetResource.cpu,
        vmMemoryMB: targetResource.memory,
        vmDiskGB: typeof targetResource.disk === "number" ? targetResource.disk : 40,
        guestUsername: "root",
        guestPassword: "123",
        vmwareTemplate: targetResource.os || "RockyBase",
        vmwareSnapshot: "clean"
    });
}

function getBoundInstanceForLab(lab, resourceName = "") {
    const targetResource = String(resourceName || "").trim() || getPrimaryResourceNameForLab(lab);
    const boundId = lab?.boundInstances?.[targetResource] || lab?.boundInstances?.default || "";
    return boundId ? getResourceInstance(boundId) : null;
}

function getBoundInstancesForLab(lab) {
    const result = {};
    Object.keys(lab?.boundInstances || {}).forEach((resourceName) => {
        const instance = getResourceInstance(lab.boundInstances[resourceName]);
        if (instance) result[resourceName] = instance;
    });
    return result;
}

function setBoundInstanceForLab(lab, resourceName, instanceId) {
    if (!lab) return;
    const key = String(resourceName || "").trim() || getPrimaryResourceNameForLab(lab);
    if (!lab.boundInstances || typeof lab.boundInstances !== "object") lab.boundInstances = {};
    if (instanceId) lab.boundInstances[key] = instanceId;
    else delete lab.boundInstances[key];
}

function clearBoundInstancesForLab(lab) {
    if (!lab) return;
    lab.boundInstances = {};
}

function getAllResourceNamesForLab(lab) {
    const runtime = getLabRuntimeDefinition(lab);
    if (runtime?.resources?.length) return runtime.resources.map((item) => item.name);
    return [getPrimaryResourceNameForLab(lab)];
}

function getRuntimeStatusForResource(lab, resourceName = "") {
    const profile = getProfileForResource(lab, resourceName);
    return profile ? resourceStatusMap[getStatusKey(profile)] || null : null;
}

function getLabsUsingResourceInstance(instanceId) {
    return Object.values(appData.labs).filter((lab) => Object.values(lab.boundInstances || {}).includes(instanceId));
}

function findCompatibleInstances(profile) {
    if (!profile) return [];
    if (profile.reuseEnabled === false) return [];
    return Object.values(appData.resourceInstances).filter(instance => {
        if (instance.providerType !== profile.providerType) return false;
        if (profile.reuseKey && instance.reuseKey) return profile.reuseKey === instance.reuseKey;
        return instance.profileId === profile.id;
    });
}

function pickCompatibleInstance(profile) {
    const candidates = findCompatibleInstances(profile).slice();
    candidates.sort((left, right) => {
        const leftTime = Date.parse(left?.lastUsedAt || "") || 0;
        const rightTime = Date.parse(right?.lastUsedAt || "") || 0;
        if (rightTime !== leftTime) return rightTime - leftTime;
        return String(left?.id || "").localeCompare(String(right?.id || ""));
    });
    return candidates[0] || null;
}

function getRunnerTypeLabel(runnerType) {
    if (runnerType === "python") return "Python";
    if (runnerType === "java") return "Java";
    return "SSH";
}

function getProviderLabel(providerType) {
    if (providerType === "manual_ssh") return "绑定我的 SSH 服务器";
    if (providerType === "vmware_vm") return "软件初始化 VMware 虚拟机";
    if (providerType === "local_python") return "软件初始化 Python 本地环境";
    if (providerType === "local_java") return "软件初始化 Java 本地环境";
    return "未知资源";
}

function sync() {
    return window.api.writeData(appData);
}

function dropResourceInstanceFromState(instanceId = "") {
    const targetId = String(instanceId || "").trim();
    if (!targetId) return false;
    let changed = false;

    if (appData.resourceInstances[targetId]) {
        delete appData.resourceInstances[targetId];
        changed = true;
    }
    if (resourceVmRuntimeMap[targetId]) {
        delete resourceVmRuntimeMap[targetId];
        changed = true;
    }

    Object.values(appData.labs).forEach((lab) => {
        Object.keys(lab.boundInstances || {}).forEach((resourceName) => {
            if (lab.boundInstances[resourceName] === targetId) {
                delete lab.boundInstances[resourceName];
                changed = true;
            }
        });
    });

    return changed;
}

async function hasMissingVmBacking(instance) {
    if (!instance || instance.providerType !== "vmware_vm") return false;
    const vmxPath = String(instance.vmxPath || "").trim();
    if (!vmxPath) return true;
    if (!window.api?.pathExists) return false;
    try {
        return !(await window.api.pathExists(vmxPath));
    } catch {
        return false;
    }
}

async function cleanupMissingVmResourceInstances() {
    const missingInstances = [];
    for (const instance of Object.values(appData.resourceInstances)) {
        if (await hasMissingVmBacking(instance)) {
            missingInstances.push(instance);
        }
    }

    if (!missingInstances.length) return false;

    for (const instance of missingInstances) {
        try {
            await window.api.deleteResourceInstance({
                instanceId: instance.id,
                instance,
                profile: instance.profileId ? getResourceProfile(instance.profileId) : null,
                settings: appData.settings,
                destroyVmFiles: true
            });
        } catch {}
        dropResourceInstanceFromState(instance.id);
    }

    return true;
}

function cleanupStaleResourceInstances() {
    const removeIds = Object.values(appData.resourceInstances)
        .filter((instance) => {
            const noLabUses = getLabsUsingResourceInstance(instance.id).length === 0;
            const referencesMissingLab = instance.labId && !getLab(instance.labId);
            const staleScaffold = instance.providerType === "vmware_vm" &&
                instance.status === "scaffolded" &&
                !instance.connection.host &&
                !instance.workspaceDir;
            const removableOrphan = noLabUses && instance.reusable === false;
            return staleScaffold || removableOrphan || referencesMissingLab;
        })
        .map(instance => instance.id);

    if (!removeIds.length) return false;

    removeIds.forEach(id => {
        dropResourceInstanceFromState(id);
    });

    return true;
}

async function cleanupOrphanResourceInstances() {
    const instances = Object.values(appData.resourceInstances).filter((instance) => {
        const noLabUses = getLabsUsingResourceInstance(instance.id).length === 0;
        const referencesMissingLab = instance.labId && !getLab(instance.labId);
        return noLabUses || referencesMissingLab;
    });

    if (!instances.length) return false;

    for (const instance of instances) {
        try {
            await window.api.deleteResourceInstance({
                instanceId: instance.id,
                instance,
                profile: instance.profileId ? getResourceProfile(instance.profileId) : null,
                settings: appData.settings,
                destroyVmFiles: true
            });
        } catch {}
        dropResourceInstanceFromState(instance.id);
    }

    return true;
}

function clearSshRetryTimer() {
    if (sshRetryState.timer) {
        clearTimeout(sshRetryState.timer);
        sshRetryState.timer = null;
    }
}

function scheduleSshRetry() {
    clearSshRetryTimer();
    if (sshRetryState.attempts >= 6) return;
    sshRetryState.timer = setTimeout(() => {
        sshRetryState.attempts += 1;
        if (typeof window.connectBoundResource === "function") {
            window.connectBoundResource("", true);
        }
    }, 4000);
}

if (window.api?.clearTerminalListeners) {
    window.api.clearTerminalListeners();
    window.api.onData((payload) => appendTerminalData(payload));
    window.api.onStatus((status) => {
        const rawStatus = String((status && typeof status === "object" ? status.status : status) || "");
        if (rawStatus === "connected") {
            clearSshRetryTimer();
            sshRetryState.attempts = 0;
        } else if (/Timed out while waiting for handshake|ETIMEDOUT|ECONNREFUSED/i.test(rawStatus)) {
            scheduleSshRetry();
        }
    });
    window.api.onStatus((payload) => {
        applyTerminalStatus(payload);
        const lab = activeSection === "workspace" && workspaceView === "lab" ? getActiveLab() : null;
        if (lab && typeof window.renderWorkspaceTerminalUi === "function") {
            window.renderWorkspaceTerminalUi(getLabRuntimeDefinition(lab), lab);
        }
    });
}
