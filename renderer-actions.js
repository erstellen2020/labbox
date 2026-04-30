let lastRenderedLabId = ""; 
let isRestoringScroll = false;
let pendingRestoreLabId = null;
let restoreBannerCleanup = null;


function showManualRestoreBanner(lab) {
    const banner = document.getElementById("manual-restore-banner");
    if (!banner || !lab) return;
    if (restoreBannerCleanup) {
        restoreBannerCleanup();
        restoreBannerCleanup = null;
    }
    const savedState = getLabManualReadingState(lab);
    if (!savedState || (savedState.scrollTop <= 0 && savedState.scrollRatio <= 0)) {
        banner.classList.add("hidden");
        return;
    }
    pendingRestoreLabId = lab.id;
    banner.classList.remove("hidden");
    const yesBtn = document.getElementById("manual-restore-yes");
    const noBtn = document.getElementById("manual-restore-no");
    const handleYes = () => {
        banner.classList.add("hidden");
        cleanup();
        restoreManualReadingState(lab);
    };
    const handleNo = () => {
        banner.classList.add("hidden");
        cleanup();
        const scrollEl = document.querySelector(".manual-scroll");
        if (scrollEl) scrollEl.scrollTop = 0;
    };
    const cleanup = () => {
        pendingRestoreLabId = null;
        restoreBannerCleanup = null;
        yesBtn.removeEventListener("click", handleYes);
        noBtn.removeEventListener("click", handleNo);
    };
    restoreBannerCleanup = cleanup;
    yesBtn.addEventListener("click", handleYes);
    noBtn.addEventListener("click", handleNo);
}

function hideManualRestoreBanner() {
    const banner = document.getElementById("manual-restore-banner");
    if (banner) banner.classList.add("hidden");
    if (restoreBannerCleanup) {
        restoreBannerCleanup();
        restoreBannerCleanup = null;
    }
    pendingRestoreLabId = null;
}


function renderCoursePage(container) {
    clearTreeLabPanel();
    const course = getCourse(activeCourseId);
    if (!course) {
        renderDashboard(container);
        return;
    }

    const progress = getCourseProgress(activeCourseId);
    const modules = getModulesByCourse(activeCourseId);

    container.innerHTML = `
        <div class="simple-page">
            <div class="page-toolbar">
                <div>
                    <h1 class="page-title">${escapeHtml(course.icon || "📦")} ${escapeHtml(course.name || "未命名课程")}</h1>
                    <p class="page-subtitle">${escapeHtml(course.description || "当前课程还没有简介。")}</p>
                </div>
                <div class="actions">
                    <button class="btn btn-secondary" onclick="beginImportLabSpecs({ courseId: activeCourseId })">导入实验文件夹</button>
                    <button class="btn btn-secondary" onclick="openCourseModal(activeCourseId)">编辑课程</button>
                    <button class="btn btn-danger" onclick="requestDeleteCourse(activeCourseId)">删除课程</button>
                    <button class="btn btn-primary" onclick="openModuleModal()">新建目录</button>
                </div>
            </div>
            <div class="resource-card-grid">
                <div class="stat-card">
                    <div class="stat-label">课程进度</div>
                    <div class="stat-value">${progress.completed} / ${progress.total}</div>
                    ${renderProgressBar(progress.percent)}
                </div>
                <div class="panel">
                    <div class="stat-label">目录数</div>
                    <div class="stat-value" style="font-size:1.2rem;">${modules.length}</div>
                    <div class="hint">实验导入时会按 \`a_level / b_level\` 自动整理到课程树。</div>
                </div>
            </div>
            <div class="grid">
                ${modules.length ? modules.map((module) => {
                    const moduleProgress = getModuleProgress(module.id);
                    return `
                        <div class="card clickable" onclick="navigateTo('module','${module.id}')">
                            <div class="card-title">${escapeHtml(module.name)}</div>
                            <div class="card-desc">${escapeHtml(module.description || "当前目录还没有说明。")}</div>
                            <div class="badge-row">
                                <span class="badge badge-blue">实验 ${getLabsByModule(module.id).length}</span>
                                <span class="badge badge-green">完成 ${moduleProgress.completed}</span>
                            </div>
                            <div class="card-footer">
                                <div class="progress-text">目录进度：${moduleProgress.completed} / ${moduleProgress.total}</div>
                                ${renderProgressBar(moduleProgress.percent)}
                                <div class="actions">
                                    <button class="btn btn-secondary" onclick="event.stopPropagation(); openModuleModal('${module.id}')">编辑</button>
                                    <button class="btn btn-danger" onclick="event.stopPropagation(); requestDeleteModule('${module.id}')">删除</button>
                                </div>
                            </div>
                        </div>
                    `;
                }).join("") : '<div class="empty-state">当前课程下还没有目录。建议直接导入实验文件夹让系统自动建树，或者 <a href="#" onclick="openModuleModal()" style="color:#2d7ff9; text-decoration:none; font-weight:600;">手动新建目录</a>。</div>'}
            </div>
        </div>
    `;
}

function renderModulePage(container) {
    clearTreeLabPanel();
    const module = getModule(activeModuleId);
    if (!module) {
        renderDashboard(container);
        return;
    }

    const progress = getModuleProgress(activeModuleId);
    const defaultProfile = getModuleDefaultProfile(activeModuleId);
    const labs = getLabsByModule(activeModuleId);

    const getLabStateLabel = (state) => {
        if (state === "ready") return "已就绪";
        if (state === "provisioning") return "准备中";
        if (state === "failed") return "失败";
        return "未初始化";
    };

    container.innerHTML = `
        <div class="simple-page">
            <div class="page-toolbar">
                <div>
                    <h1 class="page-title">${escapeHtml(module.name || "未命名目录")}</h1>
                    <p class="page-subtitle">${escapeHtml(module.description || "当前目录还没有说明。")}</p>
                </div>
                <div class="actions">
                    <button class="btn btn-secondary" onclick="beginImportLabSpecs({ courseId: activeCourseId, moduleId: activeModuleId })">导入实验文件夹</button>
                    <button class="btn btn-secondary" onclick="openModuleModal(activeModuleId)">编辑目录</button>
                    ${defaultProfile && defaultProfile.providerType !== "manual_ssh" ? `<button class="btn btn-secondary" onclick="preheatModuleResource()">预热环境</button>` : ""}
                    <button class="btn btn-danger" onclick="requestDeleteModule(activeModuleId)">删除目录</button>
                    <button class="btn btn-primary" onclick="openLabModal()">新建实验</button>
                </div>
            </div>
            <div class="resource-card-grid">
                <div class="stat-card">
                    <div class="stat-label">目录进度</div>
                    <div class="stat-value">${progress.completed} / ${progress.total}</div>
                    ${renderProgressBar(progress.percent)}
                </div>
                <div class="panel">
                    <div class="stat-label">默认资源</div>
                    <div class="hint">${defaultProfile ? `${escapeHtml(defaultProfile.name)} · ${escapeHtml(getProviderLabel(defaultProfile.providerType))}` : "还没有定义，首次保存实验时可以自动升级为目录默认资源。"}</div>
                </div>
            </div>
            <div class="list">
                ${labs.length ? labs.map((lab) => {
                    const state = getLabState(lab);
                    return `
                        <div class="list-item clickable" onclick="selectLab('${lab.id}')">
                            <div>
                                <div class="list-title">${escapeHtml(lab.title)}</div>
                                <div class="list-meta">${lab.completed ? "✅" : "未完成"} · 资源状态：${getLabStateLabel(state)}</div>
                            </div>
                            <div class="actions">
                                ${renderStatusDot(state)}
                                <button class="btn btn-secondary" onclick="event.stopPropagation(); openLabModal('${lab.id}')">编辑</button>
                                <button class="btn btn-danger" onclick="event.stopPropagation(); requestDeleteLab('${lab.id}')">删除</button>
                            </div>
                        </div>
                    `;
                }).join("") : '<div class="empty-state">当前目录下还没有实验。建议直接导入实验文件夹让系统自动建树，或者 <a href="#" onclick="openLabModal()" style="color:#2d7ff9; text-decoration:none; font-weight:600;">手动新建实验</a>。</div>'}
            </div>
        </div>
    `;
}

function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getResourceTabNames(runtime, boundMap = {}) {
    if (runtime?.resources?.length) return runtime.resources.map((item) => item.name);
    const fallbackNames = Object.keys(boundMap);
    return fallbackNames.length ? fallbackNames : ["default"];
}

function resolveBaseResourceName(tabKey) {
    if (!tabKey) return tabKey;
    const hashIndex = tabKey.indexOf("#");
    if (hashIndex <= 0) return tabKey;
    return tabKey.slice(0, hashIndex);
}

function isClonedTabKey(tabKey) {
    return tabKey && tabKey.indexOf("#") > 0;
}

function getClonedTabsForLab(lab) {
    if (!lab?.id) return [];
    const prefix = `${lab.id}:`;
    return Object.keys(clonedSessionMap)
        .filter((k) => k.startsWith(prefix))
        .map((k) => {
            const info = clonedSessionMap[k];
            const sessionKey = k;
            const tabKey = k.slice(prefix.length);
            const session = ensureTerminalSession(sessionKey);
            const statusLabel = session.connected
                ? "Online"
                : (session.status === "connecting" || /Timed out while waiting for handshake/i.test(session.status || "")
                    ? "Connecting..."
                    : "Offline");
            const state = statusLabel === "Online" ? "ready" : statusLabel === "Connecting..." ? "provisioning" : "idle";
            return {
                key: tabKey,
                label: `${info.baseResourceName} #${info.cloneIndex}`,
                state,
                tooltip: `${info.baseResourceName} 会话 #${info.cloneIndex}`,
                accent: getResourceAccent(info.baseResourceName, [info.baseResourceName]),
                statusLabel,
                isClone: true
            };
        });
}

function getActiveResourceName(runtime, lab) {
    const resourceNames = getResourceTabNames(runtime, getBoundInstancesForLab(lab));
    const allValidKeys = [...resourceNames, ...getClonedTabsForLab(lab).map((t) => t.key)];
    if (!terminalUiState.activeTabKey || !allValidKeys.includes(terminalUiState.activeTabKey)) {
        terminalUiState.activeTabKey = resourceNames[0] || getPrimaryResourceNameForLab(lab);
    }
    return terminalUiState.activeTabKey;
}

function getVmRuntimeSnapshot(instance) {
    if (!instance?.id) return null;
    return resourceVmRuntimeMap[instance.id] || null;
}

function getVmPowerLabel(powerState) {
    if (powerState === "running") return "运行中";
    if (powerState === "suspended") return "已挂起";
    if (powerState === "stopped") return "已关机";
    return "未知";
}

function showToast(title, text, type = "") {
    const stack = document.getElementById("toast-stack");
    if (!stack) return;
    const toast = document.createElement("div");
    toast.className = `toast ${type}`.trim();
    toast.innerHTML = `
        <div class="toast-title">${escapeHtml(title)}</div>
        <div class="toast-text">${escapeHtml(text)}</div>
    `;
    stack.appendChild(toast);
    setTimeout(() => toast.remove(), 3600);
}

function clearTreeLabPanel() {
    const panel = document.getElementById("tree-lab-panel");
    if (!panel) return;
    panel.innerHTML = "";
    const treePane = document.querySelector(".tree-pane");
    if (treePane) {
        treePane.classList.remove("has-detail");
        treePane.classList.remove("compact-detail");
    }
}
function applyTreePaneState() {
    const shell = document.querySelector(".app-shell");
    const toggleButton = document.getElementById("tree-toggle");
    if (!shell) return;
    shell.classList.toggle("tree-pane-collapsed", treePaneCollapsed === true);
    if (toggleButton) toggleButton.innerText = treePaneCollapsed ? "展开" : "折叠";
    const syncLayout = () => {
        if (typeof window.syncWorkspaceSplitLayout === "function") {
            window.syncWorkspaceSplitLayout();
        }
        if (window.fitAddon) {
            window.fitAddon.fit();
        }
    };
    const scheduleSync = (delayMs) => {
        if (typeof window.scheduleWorkspaceLayoutSync === "function") {
            window.scheduleWorkspaceLayoutSync(0, delayMs);
            return;
        }
        setTimeout(syncLayout, delayMs);
    };
    scheduleSync(0);
    scheduleSync(120);
    scheduleSync(280);
}

function toggleTreePane() {
    treePaneCollapsed = !treePaneCollapsed;
    applyTreePaneState();
}

function updateTreePaneDetailDensity() {
    const treePane = document.querySelector(".tree-pane");
    const treeContent = document.getElementById("tree-content");
    const labPanel = document.getElementById("tree-lab-panel");
    if (!treePane || !treeContent || !labPanel || !treePane.classList.contains("has-detail")) return;

    const treeNodes = Array.from(treeContent.children || []).filter((node) => node instanceof HTMLElement);
    let occupiedHeight = 0;
    if (treeNodes.length) {
        const firstNode = treeNodes[0];
        const lastNode = treeNodes[treeNodes.length - 1];
        occupiedHeight = (lastNode.offsetTop + lastNode.offsetHeight) - firstNode.offsetTop;
    }
    const sparseTree = occupiedHeight > 0 && occupiedHeight < 260;
    treePane.classList.toggle("compact-detail", sparseTree);
}

function buildWorkspaceStatusCards(lab, runtime, course, module, activeResourceName, profile, bound, runtimeStatus, vmRuntime) {
    const cards = [
        {
            title: "当前实验",
            value: lab?.title || "",
            meta: `${course?.name || ""} / ${module?.name || ""}`
        },
        {
            title: "当前资源",
            value: activeResourceName,
            meta: [
                profile ? `${getProviderLabel(profile.providerType)} · ${profile.summary}` : "",
                runtimeStatus?.state === "provisioning"
                    ? "初始化中"
                    : (vmRuntime?.powerState ? getVmPowerLabel(vmRuntime.powerState) : (bound ? "已绑定" : "未就绪")),
                vmRuntime?.ip ? `IP ${vmRuntime.ip}` : ""
            ].filter(Boolean).join(" · ")
        }
    ];

    return cards.map((card) => `
        <div class="workspace-status-card">
            <div class="workspace-status-title">${escapeHtml(card.title)}</div>
            <div class="workspace-status-value">${escapeHtml(card.value)}</div>
            <div class="workspace-status-meta">${escapeHtml(card.meta)}</div>
        </div>
    `).join("");
}

function getManualMaterialStateKey(lab, resourceName = "") {
    return `${lab?.id || "lab"}:${String(resourceName || "").trim() || "default"}`;
}

function getManualMaterialGroups(lab, runtime) {
    const fallbackResource = getPrimaryResourceNameForLab(lab);
    const grouped = new Map();
    (runtime?.files || []).forEach((file) => {
        const resourceName = String(file?.target || fallbackResource).trim() || fallbackResource;
        if (!grouped.has(resourceName)) grouped.set(resourceName, []);
        grouped.get(resourceName).push(file);
    });
    return Array.from(grouped.entries()).map(([resourceName, files]) => ({ resourceName, files }));
}

function renderManualProgress(runtime, lab) {
    const progressEl = document.getElementById("manual-progress");
    if (!progressEl) return;
    const groups = getManualMaterialGroups(lab, runtime);
    if (!groups.length) {
        progressEl.innerHTML = "";
        return;
    }

    const activeResourceName = resolveBaseResourceName(getActiveResourceName(runtime, lab));
    progressEl.innerHTML = `
        <div class="manual-material-banner">
            <div class="manual-material-title">本实验需要前置素材</div>
            <div class="manual-material-text">手册里的 \`files\` 不会自动下发。请在对应资源就绪后，按需手动点击导入；如需覆盖目标文件，也可以再次导入。</div>
            <div class="manual-material-groups">
                ${groups.map(({ resourceName, files }) => {
                    const state = manualMaterialUiState[getManualMaterialStateKey(lab, resourceName)] || { status: "idle", message: "" };
                    const bound = getBoundInstanceForLab(lab, resourceName);
                    const fileNames = files
                        .map((file) => escapeHtml(String(file.source || "").split(/[\\/]/).pop() || file.source || "未命名文件"))
                        .slice(0, 3)
                        .join(" · ");
                    const extraCount = files.length > 3 ? ` 等 ${files.length} 个文件` : ` 共 ${files.length} 个文件`;
                    const buttonLabel = state.status === "loading"
                        ? "导入中..."
                        : (state.status === "success" ? "重新导入素材" : "一键导入素材");
                    return `
                        <div class="manual-material-card ${activeResourceName === resourceName ? "is-active" : ""}">
                            <div class="manual-material-resource">@${escapeHtml(resourceName)}</div>
                            <div class="manual-material-meta">${bound ? "资源已绑定" : "资源未绑定，请先准备环境后再手动导入"} · ${fileNames}${extraCount}</div>
                            ${state.message ? `<div class="manual-material-status ${state.status === "fail" ? "is-fail" : state.status === "success" ? "is-success" : ""}">${escapeHtml(state.message)}</div>` : ""}
                            <button type="button" class="btn btn-secondary manual-material-btn" ${state.status === "loading" ? "disabled" : ""} onclick='applyManualFilesForResource(${jsString(resourceName)})'>${buttonLabel}</button>
                        </div>
                    `;
                }).join("")}
            </div>
        </div>
    `;
}

function renderWorkspaceTerminalUi(runtime, lab) {
    const tabsEl = document.getElementById("terminal-tabs");
    const overlayEl = document.getElementById("terminal-overlay");
    if (!tabsEl || !overlayEl) return;

    const resourceNames = getResourceTabNames(runtime, getBoundInstancesForLab(lab));
    const activeTabKey = getActiveResourceName(runtime, lab);
    const activeResourceName = resolveBaseResourceName(activeTabKey);
    const tabs = resourceNames.map((resourceName) => {
        const bound = getBoundInstanceForLab(lab, resourceName);
        const runtimeStatus = getRuntimeStatusForResource(lab, resourceName);
        const vmRuntime = getVmRuntimeSnapshot(bound);
        const accent = getResourceAccent(resourceName, resourceNames);
        const session = ensureTerminalSession(getTerminalSessionKey(lab, resourceName));
        const isWaking = bound?.providerType === "vmware_vm" && vmWakingResources.has(`${lab.id}:${resourceName}`);
        const statusLabel = runtimeStatus?.state === "provisioning"
            ? "Connecting..."
            : session.connected
                ? "Online"
                : isWaking
                    ? "Waking..."
                    : session.status === "connecting" || /Timed out while waiting for handshake/i.test(session.status || "")
                        ? "Connecting..."
                        : bound?.providerType === "vmware_vm" && vmRuntime?.powerState === "running" && (vmRuntime?.ip || bound?.connection?.host)
                            ? "Online"
                            : vmRuntime?.powerState === "suspended"
                                ? "Suspended"
                                : bound ? "Offline" : "Offline";
        const state = statusLabel === "Online" ? "ready" : (statusLabel === "Connecting..." || statusLabel === "Waking...") ? "provisioning" : "idle";
        const profile = getProfileForResource(lab, resourceName);
        const tooltip = [
            statusLabel,
            vmRuntime?.ip ? `IP ${vmRuntime.ip}` : (bound?.connection?.host ? `IP ${bound.connection.host}` : "IP 未就绪"),
            `${profile?.vmCpu || bound?.vmCpu || 0} vCPU`,
            `${profile?.vmMemoryMB || bound?.vmMemoryMB || 0} MB`
        ].join(" · ");
        return { key: resourceName, label: resourceName, state, tooltip, accent, statusLabel, isClone: false, isWaking };
    });

    const clonedTabs = getClonedTabsForLab(lab);
    const allTabs = [...tabs, ...clonedTabs];

    terminalUiState.tabs = allTabs;
    tabsEl.innerHTML = allTabs.map((tab) => `
        <button class="terminal-tab ${activeTabKey === tab.key ? "active" : ""}" style="--resource-accent:${escapeHtml(tab.accent)};" data-tab-key="${escapeHtml(tab.key)}" onclick='setActiveTerminalTab(${jsString(tab.key)})' oncontextmenu='showTabContextMenu(event, ${jsString(tab.key)})'>
            <span class="terminal-tab-label">${tab.isWaking && tab.statusLabel !== "Online" ? '<span class="tab-waking-spinner"></span>' : renderStatusDot(tab.state)} ${escapeHtml(tab.label)}</span>
            <span class="terminal-tab-state">${escapeHtml(tab.statusLabel)}</span>
            <span class="terminal-tab-tooltip"><strong>${escapeHtml(tab.label)}</strong>${escapeHtml(tab.tooltip || "")}</span>
            </button>
            `).join("") + `
            <button class="terminal-leave-btn" style="margin-left:auto; margin-right:8px; border-color: #2d7ff9; color: #8fd0ff;" onclick="uploadFileToActiveResource()" title="上传文件到当前机器">上传文件</button>
            <button class="terminal-leave-btn" onclick="leaveActiveLab()" title="离开实验">离开实验</button>
            `;
    renderTerminalBufferForSession(getTerminalSessionKey(lab, activeTabKey));

    const activeBound = getBoundInstanceForLab(lab, activeResourceName);
    const activeStatus = getRuntimeStatusForResource(lab, activeResourceName);
    const activeVmRuntime = getVmRuntimeSnapshot(activeBound);
    const activeSession = ensureTerminalSession(getTerminalSessionKey(lab, activeTabKey));
    const isActiveWaking = activeBound?.providerType === "vmware_vm" && vmWakingResources.has(`${lab.id}:${activeResourceName}`) && !activeSession.connected;
    const shouldMask = workspaceBatchState.active || !activeBound || activeStatus?.state === "provisioning";
    const overlayMessage = activeStatus?.message || (!activeBound ? `资源 ${activeResourceName} 尚未就绪，正在等待初始化。` : "");
    const effectiveOverlayMessage = workspaceBatchState.active ? workspaceBatchState.message : overlayMessage;

    const wakingBannerEl = document.getElementById("terminal-waking-banner");
    if (wakingBannerEl) {
        wakingBannerEl.classList.toggle("hidden", !isActiveWaking || shouldMask);
        if (isActiveWaking && !shouldMask) {
            wakingBannerEl.innerHTML = `<span class="waking-banner-spinner"></span> 资源正在唤醒，请稍候...`;
        }
    }

    overlayEl.classList.toggle("hidden", !shouldMask);
    overlayEl.innerHTML = shouldMask ? `
        <div class="terminal-overlay-card">
            <div class="terminal-loader"></div>
            <div class="terminal-overlay-title">${activeStatus?.state === "provisioning" ? "环境准备中" : "终端待连接"}</div>
            <div class="terminal-overlay-text">${escapeHtml(activeStatus?.state === "provisioning" ? effectiveOverlayMessage : "正在为你连接远程实验环境...")}</div>
            ${activeVmRuntime?.powerState ? `<div class="terminal-overlay-text">当前电源状态：${escapeHtml(getVmPowerLabel(activeVmRuntime.powerState))}</div>` : ""}
            ${typeof activeStatus?.progressPercent === "number" ? renderProgressBar(activeStatus.progressPercent) : ""}
        </div>
    ` : "";
    if (shouldMask && workspaceBatchState.active) {
        const titleEl = overlayEl.querySelector(".terminal-overlay-title");
        const textEl = overlayEl.querySelector(".terminal-overlay-text");
        const progressHtml = renderProgressBar(workspaceBatchState.total ? Math.round((workspaceBatchState.current / workspaceBatchState.total) * 100) : 0);
        if (titleEl) titleEl.innerText = "正在准备实验环境";
        if (textEl) textEl.innerText = effectiveOverlayMessage || "正在串行准备实验环境...";
        const existingProgress = overlayEl.querySelector(".mini-progress");
        if (existingProgress) existingProgress.outerHTML = progressHtml;
        else overlayEl.querySelector(".terminal-overlay-card")?.insertAdjacentHTML("beforeend", progressHtml);
    }
}

function inferCodeBlockTarget(codeEl, resourceNames) {
    const text = String(codeEl?.textContent || "");
    const previousText = String(codeEl?.parentElement?.previousElementSibling?.textContent || "");
    return resourceNames.find((name) => text.includes(name) || previousText.includes(name)) || "";
}

function getResourceAccent(resourceName, resourceNames = []) {
    const palette = ["#5cc8ff", "#7ee787", "#f2cc60", "#ff9b71", "#c084fc", "#ff7aa2"];
    const index = Math.max(0, resourceNames.indexOf(resourceName));
    return palette[index % palette.length];
}

function getResourceTagStyle(resourceName, resourceNames = []) {
    const accent = getResourceAccent(resourceName, resourceNames);
    return `background:${accent}22;color:${accent};border:1px solid ${accent}66;`;
}

function replaceTextNodeWithMentions(node, resourceNames) {
    const text = String(node.nodeValue || "");
    const matchedNames = resourceNames
        .filter((name) => name && text.includes(`@${name}`))
        .sort((a, b) => b.length - a.length);
    if (!matchedNames.length) return;

    const regex = new RegExp(`(@(?:${matchedNames.map((name) => escapeRegExp(name)).join("|")}))(?![\\w-])`, "g");
    const parts = text.split(regex);
    if (parts.length <= 1) return;

    const fragment = document.createDocumentFragment();
    parts.forEach((part) => {
        if (!part) return;
        if (part.startsWith("@") && matchedNames.includes(part.slice(1))) {
            const resourceName = part.slice(1);
            const button = document.createElement("button");
            button.className = "resource-inline-link";
            button.type = "button";
            button.textContent = part;
            button.title = `Switch to ${resourceName}`;
            button.style.cssText = getResourceTagStyle(resourceName, resourceNames);
            button.onclick = () => setActiveTerminalTab(resourceName);
            fragment.appendChild(button);
            return;
        }
        fragment.appendChild(document.createTextNode(part));
    });
    node.parentNode.replaceChild(fragment, node);
}

function annotateManualResourceMentions(manualEl, resourceNames) {
    if (!manualEl || !resourceNames.length) return;
    const walker = document.createTreeWalker(manualEl, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            if (["CODE", "PRE", "BUTTON", "A"].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
            return resourceNames.some((name) => String(node.nodeValue || "").includes(`@${name}`))
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_REJECT;
        }
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => replaceTextNodeWithMentions(node, resourceNames));
}

async function reconnectResource(resourceName = "", silent = false) {
    const lab = getActiveLab();
    const baseResourceName = resolveBaseResourceName(resourceName || terminalUiState.activeTabKey || getPrimaryResourceNameForLab(lab));
    const targetResource = baseResourceName;
    let instance = getBoundInstanceForLab(lab, targetResource);
    if (!instance || instance.runnerType !== "ssh") {
        if (!silent) alert("当前没有可连接的 SSH 资源。");
        return false;
    }

    if (instance.providerType === "vmware_vm" && typeof refreshVmResourceConnection === "function") {
        try {
            const latestInstance = await refreshVmResourceConnection(instance, { persist: true });
            if (latestInstance) instance = latestInstance;
        } catch {}
    }

    const latestHost = String(resourceVmRuntimeMap[instance.id]?.ip || instance.connection?.host || "").trim();
    if (!latestHost) {
        if (!silent) alert("当前资源还没有可用的 SSH 地址，请稍后再试。");
        return false;
    }

    // 1. 发起连接前，先计算 UI 实际行列数
    const currentCols = window.term?.cols || 120;
    const currentRows = window.term?.rows || 32;

    const session = ensureTerminalSession(getTerminalSessionKey(lab, targetResource));
    session.status = "connecting";
    session.connected = false;
    session.authPromptEligible = !silent;
    session.authPromptInFlight = false;
    if (resolveBaseResourceName(terminalUiState.activeTabKey) === targetResource) syncSshStatusLabel();

    // 2. 发送包含尺寸的连接请求
    window.api.sendConnect({
        sessionKey: getTerminalSessionKey(lab, targetResource),
        host: latestHost,
        username: instance.connection?.username || "root",
        password: instance.connection?.password || "",
        cols: currentCols,
        rows: currentRows
    });
    
    if (!silent) showToast("连接资源", `正在连接 ${targetResource}...`);
    return true;
}
window.reconnectResource = reconnectResource;

function showTabContextMenu(event, tabKey) {
    event.preventDefault();
    event.stopPropagation();
    const existing = document.getElementById("tab-context-menu");
    if (existing) existing.remove();

    const menu = document.createElement("div");
    menu.id = "tab-context-menu";
    menu.className = "tab-context-menu";
    menu.style.left = event.clientX + "px";
    menu.style.top = event.clientY + "px";

    const cloneItem = document.createElement("div");
    cloneItem.className = "tab-context-item";
    cloneItem.textContent = "复制此会话";
    cloneItem.onclick = () => {
        menu.remove();
        cloneTerminalSession(tabKey);
    };
    menu.appendChild(cloneItem);

    if (isClonedTabKey(tabKey)) {
        const closeItem = document.createElement("div");
        closeItem.className = "tab-context-item tab-context-item-danger";
        closeItem.textContent = "关闭此会话";
        closeItem.onclick = () => {
            menu.remove();
            closeClonedSession(tabKey);
        };
        menu.appendChild(closeItem);
    }

    document.body.appendChild(menu);

    const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener("click", closeMenu);
            document.removeEventListener("contextmenu", closeMenu);
        }
    };
    setTimeout(() => {
        document.addEventListener("click", closeMenu);
        document.addEventListener("contextmenu", closeMenu);
    }, 0);
}

async function cloneTerminalSession(tabKey) {
    const lab = getActiveLab();
    if (!lab) return;
    const baseResourceName = resolveBaseResourceName(tabKey);
    const bound = getBoundInstanceForLab(lab, baseResourceName);
    if (!bound || bound.runnerType !== "ssh") {
        alert("当前没有可连接的 SSH 资源。");
        return;
    }

    let instance = bound;
    if (instance.providerType === "vmware_vm" && typeof refreshVmResourceConnection === "function") {
        try {
            const latestInstance = await refreshVmResourceConnection(instance, { persist: true });
            if (latestInstance) instance = latestInstance;
        } catch {}
    }

    const latestHost = String(resourceVmRuntimeMap[instance.id]?.ip || instance.connection?.host || "").trim();
    if (!latestHost) {
        alert("当前资源还没有可用的 SSH 地址，请稍后再试。");
        return;
    }

    const prefix = `${lab.id}:${baseResourceName}#`;
    let maxIndex = 0;
    Object.keys(clonedSessionMap).forEach((k) => {
        if (k.startsWith(prefix)) {
            const idx = parseInt(k.slice(prefix.length), 10);
            if (!isNaN(idx) && idx > maxIndex) maxIndex = idx;
        }
    });
    const cloneIndex = maxIndex + 1;
    const clonedTabKey = `${baseResourceName}#${cloneIndex}`;
    const clonedSessionKey = `${lab.id}:${clonedTabKey}`;

    clonedSessionMap[clonedSessionKey] = { baseResourceName, cloneIndex };

    const session = ensureTerminalSession(clonedSessionKey);
    session.status = "connecting";
    session.connected = false;
    session.authPromptEligible = false;
    session.authPromptInFlight = false;

    const currentCols = window.term?.cols || 120;
    const currentRows = window.term?.rows || 32;

    window.api.sendConnect({
        sessionKey: clonedSessionKey,
        host: latestHost,
        username: instance.connection?.username || "root",
        password: instance.connection?.password || "",
        cols: currentCols,
        rows: currentRows
    });

    terminalUiState.activeTabKey = clonedTabKey;
    renderLabWorkspace();
    showToast("复制会话", `已创建 ${baseResourceName} 的会话 #${cloneIndex}`);
}

function closeClonedSession(tabKey) {
    const lab = getActiveLab();
    if (!lab) return;
    const sessionKey = `${lab.id}:${tabKey}`;
    if (!clonedSessionMap[sessionKey]) return;

    const session = ensureTerminalSession(sessionKey);
    if (session.connected && window.api?.sendInput) {
        try { window.api.sendInput({ sessionKey, data: "exit\r" }); } catch {}
    }

    delete clonedSessionMap[sessionKey];
    setTimeout(() => { delete terminalSessionState.sessions[sessionKey]; }, 2000);

    if (terminalUiState.activeTabKey === tabKey) {
        terminalUiState.activeTabKey = resolveBaseResourceName(tabKey);
    }
    renderLabWorkspace();
}

window.showTabContextMenu = showTabContextMenu;
window.cloneTerminalSession = cloneTerminalSession;
window.closeClonedSession = closeClonedSession;
window.resolveBaseResourceName = resolveBaseResourceName;

function runManualCodeBlock(command, resourceName) {
    const lab = getActiveLab();
    if (!lab) return;

    const activeTabKey = resourceName || terminalUiState.activeTabKey || getPrimaryResourceNameForLab(lab);
    const targetResource = resolveBaseResourceName(activeTabKey);
    terminalUiState.activeTabKey = activeTabKey;
    renderLabWorkspace();

    const profile = getProfileForResource(lab, targetResource);
    const bound = getBoundInstanceForLab(lab, targetResource);
    if (!profile) return;
    if (!bound) {
        alert(`资源 ${targetResource} 还没有就绪，请先等待初始化完成。`);
        return;
    }

    if (bound.runnerType === "ssh") reconnectResource(activeTabKey, true);
    const delay = bound.runnerType === "ssh" ? 220 : 20;
    const sessionKey = getTerminalSessionKey(lab, activeTabKey);
    setTimeout(() => {
        window.api.sendInput({ type: bound.runnerType || profile.runnerType, data: `${command}\n`, sessionKey });
    }, delay);
}

async function copyManualCodeBlock(command, resourceName = "") {
    const text = String(command || "");
    if (!text.trim()) return;
    const copied = typeof window.copyTextToClipboard === "function"
        ? await window.copyTextToClipboard(text)
        : false;
    if (copied && typeof showToast === "function") {
        const detail = resourceName
            ? `已复制，请在 ${resourceName} 终端粘贴执行。`
            : "已复制到剪贴板。";
        showToast("Copy", detail, "success");
    }
    if (!copied && typeof showToast === "function") {
        const detail = resourceName ? `无法复制 ${resourceName} 对应代码块。` : "当前环境没有成功写入剪贴板。";
        showToast("Copy Failed", detail, "fail");
    }
    return copied;
}

function getInlineCheckpointById(runtime, checkpointId = "") {
    return (runtime?.inlineChecks || []).find((item) => item.id === checkpointId) || null;
}

function injectInlineCheckpointMarkerHtml(manualHtml = "", runtime = null) {
    const knownIds = new Set((runtime?.inlineChecks || []).map((item) => item.id));
    return String(manualHtml || "").replace(/<p>@@INLINE_CHECKPOINT:([^@<]+)@@<\/p>/g, (matched, checkpointId) => {
        const id = String(checkpointId || "").trim();
        if (!knownIds.has(id)) return "";
        return `<div class="inline-checkpoint-marker" data-check-id="${escapeHtml(id)}"></div>`;
    });
}

function getInlineCheckpointState(lab, checkpoint) {
    if (!checkpoint) return { status: "idle", message: "" };
    if (isInlineCheckpointPassed(lab, checkpoint.id)) {
        return {
            status: "success",
            message: "已通过"
        };
    }
    return inlineCheckpointUiState[checkpoint.id] || { status: "idle", message: "" };
}

function renderInlineCheckpointElement(checkpoint, state) {
    const wrapper = document.createElement("div");
    wrapper.className = `inline-checkpoint inline-checkpoint-${state.status || "idle"}`;
    wrapper.dataset.checkId = checkpoint.id;

    const icon = state.status === "loading"
        ? "…"
        : state.status === "success"
            ? "✓"
            : state.status === "fail"
                ? "!"
                : "⊕";

    wrapper.innerHTML = `
        <button type="button" class="inline-checkpoint-btn ${state.status === "loading" ? "is-loading" : ""}">
            <span class="inline-checkpoint-icon">${icon}</span>
            <span class="inline-checkpoint-label">${state.status === "loading" ? "正在验证..." : state.status === "success" ? "已通过" : "验证此步"}</span>
        </button>
        <div class="inline-checkpoint-meta">
            <div class="inline-checkpoint-title">${escapeHtml(checkpoint.title || "步骤验证")}</div>
            ${checkpoint.resourceName ? `<div class="inline-checkpoint-resource">@${escapeHtml(checkpoint.resourceName)}</div>` : ""}
            ${state.message && state.status !== "success" ? `<div class="inline-checkpoint-message">${escapeHtml(state.message)}</div>` : ""}
        </div>
    `;
    return wrapper;
}

async function ensureResourceReadyForCheckpoint(lab, resourceName = "") {
    const targetResource = resolveBaseResourceName(resourceName || terminalUiState.activeTabKey || getPrimaryResourceNameForLab(lab));
    if (resourceName && terminalUiState.activeTabKey !== resourceName) {
        terminalUiState.activeTabKey = resourceName;
        if (typeof window.renderWorkspaceTerminalUi === "function") {
            window.renderWorkspaceTerminalUi(getLabRuntimeDefinition(lab), lab);
        }
    }

    let instance = getBoundInstanceForLab(lab, targetResource);
    if (!instance) {
        await initializeResourceForActiveLab();
        instance = getBoundInstanceForLab(lab, targetResource);
    }
    if (!instance) throw new Error(`请先准备 ${targetResource} 环境。`);

    if (instance.providerType === "vmware_vm" && instance.vmxPath) {
        if (typeof window.ensureVmResourcePowered === "function") {
            const latestInstance = await window.ensureVmResourcePowered(targetResource, true);
            if (latestInstance) instance.connection.host = latestInstance.connection?.host || instance.connection.host;
        }
    }

    return { targetResource, instance };
}

async function runInlineCheckpoint(checkpointId) {
    const lab = getActiveLab();
    const runtime = getLabRuntimeDefinition(lab);
    const checkpoint = getInlineCheckpointById(runtime, checkpointId);
    if (!lab || !checkpoint) return;

    inlineCheckpointUiState[checkpoint.id] = { status: "loading", message: "" };
    updateInlineCheckpointElement(checkpoint.id, runtime, lab);

    try {
        const targetResource = resolveBaseResourceName(checkpoint.resourceName || terminalUiState.activeTabKey || getPrimaryResourceNameForLab(lab));
        const { instance } = await ensureResourceReadyForCheckpoint(lab, targetResource);
        const profile = getProfileForResource(lab, targetResource) || runtime.profile;
        const passed = await window.api.verify({
            type: profile?.runnerType || "ssh",
            cmd: checkpoint.cmd,
            sessionKey: getTerminalSessionKey(lab, targetResource),
            connection: instance?.connection || null,
            background: true
        });

        if (passed) {
            markInlineCheckpointPassed(appData.labs[lab.id], checkpoint.id);
            inlineCheckpointUiState[checkpoint.id] = { status: "success", message: checkpoint.successMsg || "验证通过" };
            const allPassed = (runtime.inlineChecks || []).length > 0 && runtime.inlineChecks.every((item) => isInlineCheckpointPassed(appData.labs[lab.id], item.id) || item.id === checkpoint.id);
            if (allPassed) appData.labs[lab.id].completed = true;
            await sync();
        } else {
            inlineCheckpointUiState[checkpoint.id] = { status: "fail", message: checkpoint.hint || checkpoint.failMsg || "请检查当前步骤。" };
        }
    } catch (error) {
        inlineCheckpointUiState[checkpoint.id] = { status: "fail", message: error.message || "验证执行失败。" };
    }

    updateInlineCheckpointElement(checkpoint.id, runtime, lab);
}

function updateInlineCheckpointElement(checkpointId, runtime, lab) {
    const checkpoint = getInlineCheckpointById(runtime, checkpointId);
    if (!checkpoint) return;
    const state = getInlineCheckpointState(lab, checkpoint);
    const existing = document.querySelector(`.inline-checkpoint[data-check-id="${CSS.escape(checkpointId)}"]`);
    if (!existing) {
        renderLabWorkspace();
        return;
    }
    const scrollEl = document.querySelector(".manual-scroll");
    const scrollTopBefore = scrollEl ? scrollEl.scrollTop : 0;

    existing.className = `inline-checkpoint inline-checkpoint-${state.status || "idle"}`;

    const btn = existing.querySelector(".inline-checkpoint-btn");
    if (btn) {
        btn.className = `inline-checkpoint-btn${state.status === "loading" ? " is-loading" : ""}`;
        btn.disabled = state.status === "loading";
        btn.onclick = () => runInlineCheckpoint(checkpoint.id);
        const iconEl = btn.querySelector(".inline-checkpoint-icon");
        const labelEl = btn.querySelector(".inline-checkpoint-label");
        if (iconEl) {
            iconEl.textContent = state.status === "loading" ? "…" : state.status === "success" ? "✓" : state.status === "fail" ? "!" : "⊕";
        }
        if (labelEl) {
            labelEl.textContent = state.status === "loading" ? "正在验证..." : state.status === "success" ? "已通过" : "验证此步";
        }
    }

    const meta = existing.querySelector(".inline-checkpoint-meta");
    if (meta) {
        let msgEl = meta.querySelector(".inline-checkpoint-message");
        if (state.message && state.status !== "success") {
            if (!msgEl) {
                msgEl = document.createElement("div");
                msgEl.className = "inline-checkpoint-message";
                meta.appendChild(msgEl);
            }
            msgEl.textContent = state.message;
        } else if (msgEl) {
            msgEl.remove();
        }
    }

    if (scrollEl && scrollTopBefore > 0) {
        isRestoringScroll = true;
        scrollEl.scrollTop = scrollTopBefore;
        setTimeout(() => { isRestoringScroll = false; }, 50);
    }
}

function hydrateInlineCheckpoints(runtime, lab) {
    const manualEl = document.getElementById("manual");
    if (!manualEl) return;
    Array.from(manualEl.querySelectorAll(".inline-checkpoint-marker")).forEach((marker) => {
        const checkpoint = getInlineCheckpointById(runtime, marker.dataset.checkId || "");
        if (!checkpoint) {
            marker.remove();
            return;
        }
        const state = getInlineCheckpointState(lab, checkpoint);
        const element = renderInlineCheckpointElement(checkpoint, state);
        const button = element.querySelector(".inline-checkpoint-btn");
        if (button) {
            button.disabled = state.status === "loading";
            button.onclick = () => runInlineCheckpoint(checkpoint.id);
        }
        marker.replaceWith(element);
    });
}

function hydrateManualHiddenBlocks(manualEl) {
    if (!manualEl) return;
    Array.from(manualEl.querySelectorAll(".manual-hidden-block")).forEach((block) => {
        const toggle = block.querySelector(".manual-hidden-toggle");
        const content = block.querySelector(".manual-hidden-content");
        if (!toggle || !content) return;

        const syncState = () => {
            const expanded = !content.classList.contains("hidden");
            toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
            toggle.textContent = expanded ? "隐藏内容" : "查看隐藏内容";
            block.classList.toggle("is-open", expanded);
        };

        toggle.onclick = () => {
            content.classList.toggle("hidden");
            syncState();
        };

        syncState();
    });
}

const manualImageViewerState = {
    scale: 1,
    minScale: 1,
    maxScale: 4,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragOriginX: 0,
    dragOriginY: 0
};

function getManualImageViewerElements() {
    return {
        viewer: document.getElementById("manual-image-viewer"),
        stage: document.getElementById("manual-image-stage"),
        image: document.getElementById("manual-image-preview"),
        close: document.getElementById("manual-image-close"),
        zoomIn: document.getElementById("manual-image-zoom-in"),
        zoomOut: document.getElementById("manual-image-zoom-out"),
        reset: document.getElementById("manual-image-reset")
    };
}

function syncManualImageViewerTransform() {
    const { image, stage } = getManualImageViewerElements();
    if (!image || !stage) return;
    image.style.transform = `translate(-50%, -50%) translate(${manualImageViewerState.offsetX}px, ${manualImageViewerState.offsetY}px) scale(${manualImageViewerState.scale})`;
    stage.classList.toggle("is-dragging", manualImageViewerState.dragging);
    stage.style.cursor = manualImageViewerState.scale > 1 ? (manualImageViewerState.dragging ? "grabbing" : "grab") : "zoom-in";
}

function resetManualImageViewerState() {
    manualImageViewerState.scale = 1;
    manualImageViewerState.offsetX = 0;
    manualImageViewerState.offsetY = 0;
    manualImageViewerState.dragging = false;
    syncManualImageViewerTransform();
}

function closeManualImageViewer() {
    const { viewer, image } = getManualImageViewerElements();
    if (!viewer || !image) return;
    viewer.classList.add("hidden");
    image.removeAttribute("src");
    image.alt = "";
    resetManualImageViewerState();
}

function clampManualImageViewerScale(nextScale) {
    return Math.max(manualImageViewerState.minScale, Math.min(manualImageViewerState.maxScale, Number(nextScale) || manualImageViewerState.scale));
}

function setManualImageViewerScale(nextScale) {
    manualImageViewerState.scale = clampManualImageViewerScale(nextScale);
    if (manualImageViewerState.scale <= 1) {
        manualImageViewerState.offsetX = 0;
        manualImageViewerState.offsetY = 0;
    }
    syncManualImageViewerTransform();
}

function openManualImageViewer(src = "", titleText = "") {
    const { viewer, image } = getManualImageViewerElements();
    if (!viewer || !image || !src) return;
    viewer.classList.remove("hidden");
    image.src = src;
    image.alt = titleText || "manual image";
    resetManualImageViewerState();
}

function bindManualImageViewerEvents() {
    const { viewer, stage, image, close, zoomIn, zoomOut, reset } = getManualImageViewerElements();
    if (!viewer || !stage || !image || viewer.dataset.bound) return;
    viewer.dataset.bound = "true";

    viewer.addEventListener("click", (event) => {
        if (event.target === viewer || event.target.classList.contains("manual-image-backdrop")) {
            closeManualImageViewer();
        }
    });

    close?.addEventListener("click", closeManualImageViewer);
    zoomIn?.addEventListener("click", () => setManualImageViewerScale(manualImageViewerState.scale + 0.25));
    zoomOut?.addEventListener("click", () => setManualImageViewerScale(manualImageViewerState.scale - 0.25));
    reset?.addEventListener("click", resetManualImageViewerState);

    stage.addEventListener("wheel", (event) => {
        event.preventDefault();
        const delta = event.deltaY < 0 ? 0.2 : -0.2;
        setManualImageViewerScale(manualImageViewerState.scale + delta);
    }, { passive: false });

    image.addEventListener("mousedown", (event) => {
        if (manualImageViewerState.scale <= 1 || event.button !== 0) return;
        manualImageViewerState.dragging = true;
        manualImageViewerState.dragStartX = event.clientX;
        manualImageViewerState.dragStartY = event.clientY;
        manualImageViewerState.dragOriginX = manualImageViewerState.offsetX;
        manualImageViewerState.dragOriginY = manualImageViewerState.offsetY;
        syncManualImageViewerTransform();
        event.preventDefault();
    });

    document.addEventListener("mousemove", (event) => {
        if (!manualImageViewerState.dragging) return;
        manualImageViewerState.offsetX = manualImageViewerState.dragOriginX + (event.clientX - manualImageViewerState.dragStartX);
        manualImageViewerState.offsetY = manualImageViewerState.dragOriginY + (event.clientY - manualImageViewerState.dragStartY);
        syncManualImageViewerTransform();
    });

    document.addEventListener("mouseup", () => {
        if (!manualImageViewerState.dragging) return;
        manualImageViewerState.dragging = false;
        syncManualImageViewerTransform();
    });

    document.addEventListener("keydown", (event) => {
        if (viewer.classList.contains("hidden")) return;
        if (event.key === "Escape") {
            closeManualImageViewer();
        }
    });
}

function hydrateManualImages(manualEl) {
    if (!manualEl) return;
    bindManualImageViewerEvents();
    Array.from(manualEl.querySelectorAll("img.manual-image")).forEach((image) => {
        if (image.dataset.viewerBound) return;
        image.dataset.viewerBound = "true";
        image.title = image.alt ? `点击放大：${image.alt}` : "点击放大查看";
        image.addEventListener("click", () => {
            openManualImageViewer(image.getAttribute("src") || "", image.getAttribute("alt") || "");
        });
    });
}

function hideManualContextMenu() {
    const menu = document.getElementById("manual-context-menu");
    if (!menu) return;
    menu.classList.add("hidden");
}

function showManualContextMenu(x, y) {
    const menu = document.getElementById("manual-context-menu");
    if (!menu) return;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    menu.classList.remove("hidden");
    const rect = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, Math.max(8, viewportWidth - rect.width - 8)));
    const top = Math.max(8, Math.min(y, Math.max(8, viewportHeight - rect.height - 8)));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}

function hydrateManualSelectionContextMenu(manualEl) {
    if (!manualEl) return;
    const copyButton = document.getElementById("manual-context-copy");
    if (copyButton && !copyButton.dataset.bound) {
        copyButton.dataset.bound = "true";
        copyButton.addEventListener("click", async () => {
            const selectionText = String(window.getSelection?.().toString() || "").trim();
            if (!selectionText) {
                hideManualContextMenu();
                return;
            }
            const copied = typeof window.copyTextToClipboard === "function"
                ? await window.copyTextToClipboard(selectionText)
                : false;
            hideManualContextMenu();
            if (typeof showToast === "function") {
                showToast(copied ? "复制成功" : "复制失败", copied ? "已复制手册选中文本。" : "当前无法写入剪贴板。", copied ? "success" : "fail");
            }
        });
    }

    if (!manualEl.dataset.selectionMenuBound) {
        manualEl.dataset.selectionMenuBound = "true";

        manualEl.addEventListener("contextmenu", (event) => {
            const selection = window.getSelection?.();
            const selectedText = String(selection?.toString() || "").trim();
            if (!selectedText) {
                hideManualContextMenu();
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            showManualContextMenu(event.clientX, event.clientY);
        });

        document.addEventListener("mousedown", (event) => {
            const menu = document.getElementById("manual-context-menu");
            if (!menu || menu.classList.contains("hidden")) return;
            if (menu.contains(event.target)) return;
            hideManualContextMenu();
        }, true);

        window.addEventListener("blur", hideManualContextMenu);
        window.addEventListener("resize", hideManualContextMenu);
        document.addEventListener("scroll", hideManualContextMenu, true);
    }
}

function hydrateManualExternalLinks(manualEl) {
    if (!manualEl || manualEl.dataset.externalLinksBound) return;
    manualEl.dataset.externalLinksBound = "true";

    manualEl.addEventListener("click", async (event) => {
        const link = event.target?.closest?.("a[href]");
        if (!link) return;
        const href = String(link.getAttribute("href") || "").trim();
        if (!/^https?:\/\//i.test(href)) return;

        event.preventDefault();
        event.stopPropagation();

        const confirmed = confirm(`将使用系统默认浏览器打开下面的链接，是否继续？\n\n${href}`);
        if (!confirmed) return;

        try {
            if (window.api?.openExternalUrl) {
                await window.api.openExternalUrl(href);
            } else {
                window.open(href, "_blank", "noopener,noreferrer");
            }
        } catch (error) {
            if (typeof showToast === "function") {
                showToast("打开失败", String(error?.message || error || "无法打开链接。"), "fail");
            }
        }
    }, true);
}

const manualSearchState = {
    query: "",
    matches: [],
    currentIndex: -1,
    active: false
};

function openManualSearchBar() {
    const bar = document.getElementById("manual-search-bar");
    const input = document.getElementById("manual-search-input");
    if (!bar || !input) return;
    bar.classList.remove("hidden");
    input.focus();
    input.select();
    manualSearchState.active = true;
}

function closeManualSearchBar() {
    const bar = document.getElementById("manual-search-bar");
    const input = document.getElementById("manual-search-input");
    if (!bar || !input) return;
    bar.classList.add("hidden");
    input.value = "";
    clearManualSearchHighlights();
    manualSearchState.active = false;
    manualSearchState.query = "";
    manualSearchState.matches = [];
    manualSearchState.currentIndex = -1;
}

function clearManualSearchHighlights() {
    const manualEl = document.getElementById("manual");
    if (!manualEl) return;
    manualEl.querySelectorAll("mark.manual-highlight").forEach((mark) => {
        const parent = mark.parentNode;
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
        parent.normalize();
    });
}

function performManualSearch(query) {
    clearManualSearchHighlights();
    manualSearchState.query = query;
    manualSearchState.matches = [];
    manualSearchState.currentIndex = -1;

    const manualEl = document.getElementById("manual");
    if (!manualEl || !query) {
        updateManualSearchCount();
        return;
    }

    const walker = document.createTreeWalker(manualEl, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
    }

    const lowerQuery = query.toLowerCase();
    textNodes.forEach((node) => {
        const text = node.textContent;
        const lowerText = text.toLowerCase();
        let searchFrom = 0;
        let idx = lowerText.indexOf(lowerQuery, searchFrom);
        if (idx === -1) return;

        const fragment = document.createDocumentFragment();
        let lastEnd = 0;
        while (idx !== -1) {
            fragment.appendChild(document.createTextNode(text.slice(lastEnd, idx)));
            const mark = document.createElement("mark");
            mark.className = "manual-highlight";
            mark.textContent = text.slice(idx, idx + query.length);
            fragment.appendChild(mark);
            manualSearchState.matches.push(mark);
            lastEnd = idx + query.length;
            idx = lowerText.indexOf(lowerQuery, lastEnd);
        }
        fragment.appendChild(document.createTextNode(text.slice(lastEnd)));
        node.parentNode.replaceChild(fragment, node);
    });

    if (manualSearchState.matches.length > 0) {
        manualSearchState.currentIndex = 0;
        manualSearchState.matches[0].classList.add("current");
        manualSearchState.matches[0].scrollIntoView({ block: "center", behavior: "smooth" });
    }
    updateManualSearchCount();
}

function navigateManualSearch(direction) {
    if (!manualSearchState.matches.length) return;
    manualSearchState.matches[manualSearchState.currentIndex]?.classList.remove("current");
    if (direction === "next") {
        manualSearchState.currentIndex = (manualSearchState.currentIndex + 1) % manualSearchState.matches.length;
    } else {
        manualSearchState.currentIndex = (manualSearchState.currentIndex - 1 + manualSearchState.matches.length) % manualSearchState.matches.length;
    }
    manualSearchState.matches[manualSearchState.currentIndex].classList.add("current");
    manualSearchState.matches[manualSearchState.currentIndex].scrollIntoView({ block: "center", behavior: "smooth" });
    updateManualSearchCount();
}

function updateManualSearchCount() {
    const countEl = document.getElementById("manual-search-count");
    if (!countEl) return;
    if (!manualSearchState.matches.length) {
        countEl.textContent = manualSearchState.query ? "0 / 0" : "0 / 0";
    } else {
        countEl.textContent = `${manualSearchState.currentIndex + 1} / ${manualSearchState.matches.length}`;
    }
}

function bindManualSearchEvents() {
    const input = document.getElementById("manual-search-input");
    const prevBtn = document.getElementById("manual-search-prev");
    const nextBtn = document.getElementById("manual-search-next");
    const closeBtn = document.getElementById("manual-search-close");
    if (!input || input.dataset.searchBound) return;
    input.dataset.searchBound = "true";

    input.addEventListener("input", () => {
        performManualSearch(input.value);
    });

    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            navigateManualSearch(e.shiftKey ? "prev" : "next");
        }
        if (e.key === "Escape") {
            e.preventDefault();
            closeManualSearchBar();
        }
    });

    prevBtn?.addEventListener("click", () => navigateManualSearch("prev"));
    nextBtn?.addEventListener("click", () => navigateManualSearch("next"));
    closeBtn?.addEventListener("click", () => closeManualSearchBar());

    document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "f") {
            e.preventDefault();
            e.stopPropagation();
            if (manualSearchState.active) {
                input.focus();
                input.select();
            } else {
                openManualSearchBar();
            }
        }
    });
}

function hydrateManualSearch() {
    bindManualSearchEvents();
}



function shouldShowManualCompletionAction(runtime = null) {
    if (!runtime) return false;
    const hasInlineChecks = Array.isArray(runtime.inlineChecks) && runtime.inlineChecks.length > 0;
    const hasGlobalCheck = Boolean(runtime.check?.command);
    return !hasInlineChecks && !hasGlobalCheck;
}

async function toggleManualReadingCompleted() {
    const lab = getActiveLab();
    if (!lab) return;
    if (!appData.labs[lab.id]) return;
    const nextCompleted = !Boolean(appData.labs[lab.id].completed);
    appData.labs[lab.id].completed = nextCompleted;
    await sync();
    renderApp();
    if (typeof showToast === "function") {
        showToast(
            nextCompleted ? "已标记完成" : "已撤回完成",
            nextCompleted ? "当前实验已标记为完成阅读。" : "当前实验已恢复为未完成状态。",
            "success"
        );
    }
}

function renderManualCompletionAction(runtime, lab) {
    if (!lab || !shouldShowManualCompletionAction(runtime)) return "";
    const isCompleted = Boolean(lab.completed);
    return `
        <div class="manual-completion-card">
            <div class="manual-completion-title">${isCompleted ? "已完成阅读" : "完成本实验"}</div>
            <div class="manual-completion-text">${isCompleted ? "当前实验已标记为完成。你仍然可以继续阅读手册或操作终端。" : "这个实验没有配置自动校验步骤。阅读完成后，可手动标记为已完成。"}</div>
            <button type="button" class="btn ${isCompleted ? "btn-secondary" : "btn-primary"} manual-completion-btn" onclick="toggleManualReadingCompleted()">${isCompleted ? "标记为未完成" : "我已完成阅读"}</button>
        </div>
    `;
}

function scheduleManualReadingStateSync() {
    if (manualReadingState.saveTimer) clearTimeout(manualReadingState.saveTimer);
    manualReadingState.saveTimer = setTimeout(async () => {
        manualReadingState.saveTimer = null;
        try {
            await sync();
        } catch {}
    }, 400);
}

function captureActiveLabManualReadingState({ immediate = false } = {}) {
    if (isRestoringScroll) return false;
    const lab = getActiveLab();
    const scrollEl = document.querySelector(".manual-scroll");
    if (!lab || !scrollEl) return false;
    const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
    const changed = persistLabManualReadingState(lab, scrollEl.scrollTop, maxScrollTop);
    if (!changed) return false;
    if (immediate) {
        if (manualReadingState.saveTimer) {
            clearTimeout(manualReadingState.saveTimer);
            manualReadingState.saveTimer = null;
        }
        sync().catch(() => {});
    } else {
        scheduleManualReadingStateSync();
    }
    return true;
}

function bindManualReadingPersistence() {
    const scrollEl = document.querySelector(".manual-scroll");
    if (!scrollEl || scrollEl.dataset.readingPersistenceBound) return;
    scrollEl.dataset.readingPersistenceBound = "true";
    scrollEl.addEventListener("scroll", () => {
        if (activeSection !== "workspace" || workspaceView !== "lab" || !activeLabId) return;
        captureActiveLabManualReadingState();
    }, { passive: true });
}

function restoreManualReadingState(lab) {
    const scrollEl = document.querySelector(".manual-scroll");
    if (!lab || !scrollEl) return;
    
    const savedState = getLabManualReadingState(lab);
    if (!savedState) {
        scrollEl.scrollTop = 0;
        return;
    }

    const restoreToken = ++manualReadingState.restoreToken;
    
    const applyRestore = () => {
        if (restoreToken !== manualReadingState.restoreToken) return;
        
        // 检查图片是否加载完成，如果没加载完，延迟恢复
        const imgs = scrollEl.querySelectorAll("img");
        const allLoaded = Array.from(imgs).every(img => img.complete);
        
        const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
        if (maxScrollTop <= 0 && imgs.length > 0 && !allLoaded) {
            // 如果高度还没撑开且有图片没载入，等 100ms 再试
            setTimeout(applyRestore, 100);
            return;
        }

        const ratioTop = savedState.scrollRatio > 0 ? Math.round(maxScrollTop * savedState.scrollRatio) : savedState.scrollTop;
        
        isRestoringScroll = true; // 开启锁定
        scrollEl.scrollTop = Math.max(0, Math.min(maxScrollTop, ratioTop));
        
        // 恢复完成后延迟解锁
        setTimeout(() => { isRestoringScroll = false; }, 100);
    };

    // 预留足够的时间让 marked 渲染的 HTML 进入 DOM
    requestAnimationFrame(() => {
        setTimeout(applyRestore, 50);
    });
}

function applyManualFontScale() {
    const manualEl = document.getElementById("manual");
    if (!manualEl) return;
    const nextFontScale = Math.max(0.85, Math.min(1.8, Number(manualFontScale) || 1));
    const imageMaxWidth = Math.max(72, Math.min(96, 84 + ((nextFontScale - 1) * 54)));
    const imageMaxHeight = Math.max(420, Math.min(760, 520 + ((nextFontScale - 1) * 220)));
    manualEl.style.setProperty("--manual-font-scale", String(nextFontScale));
    manualEl.style.setProperty("--manual-image-max-width", `${imageMaxWidth.toFixed(1)}%`);
    manualEl.style.setProperty("--manual-image-max-height", `${Math.round(imageMaxHeight)}px`);
}

function adjustManualFontScale(delta) {
    const nextScale = Math.max(0.85, Math.min(1.8, Number((manualFontScale + delta).toFixed(2))));
    if (nextScale === manualFontScale) return;
    manualFontScale = nextScale;
    applyManualFontScale();
}

function bindManualFontZoom() {
    const scrollEl = document.querySelector(".manual-scroll");
    if (!scrollEl || scrollEl.dataset.fontZoomBound) return;
    scrollEl.dataset.fontZoomBound = "true";
    scrollEl.addEventListener("wheel", (event) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        adjustManualFontScale(event.deltaY < 0 ? 0.08 : -0.08);
    }, { passive: false });
}


function enhanceManualInteractions(runtime, lab) {
    const manualEl = document.getElementById("manual");
    if (!manualEl) return;

    applyManualFontScale();
    bindManualFontZoom();
    const resourceNames = getResourceTabNames(runtime, getBoundInstancesForLab(lab));
    manualEl.querySelectorAll(".manual-run-actions").forEach((node) => node.remove());
    hydrateInlineCheckpoints(runtime, lab);
    annotateManualResourceMentions(manualEl, resourceNames);
    hydrateManualHiddenBlocks(manualEl);
    hydrateManualImages(manualEl);
    hydrateManualSelectionContextMenu(manualEl);
    hydrateManualExternalLinks(manualEl);
    hydrateManualSearch();

    Array.from(manualEl.querySelectorAll("pre")).forEach((pre) => {
        if (!pre) return;
        const codeEl = pre.querySelector("code") || pre;
        const actions = document.createElement("div");
        actions.className = "manual-run-actions";

        const button = document.createElement("button");
        button.className = "btn btn-secondary manual-run-btn";
        button.type = "button";
        button.textContent = "Copy";
        button.dataset.defaultLabel = "Copy";
        button.onclick = async () => {
            const copied = await copyManualCodeBlock(codeEl.textContent || "", inferCodeBlockTarget(codeEl, resourceNames));
            const originalLabel = button.dataset.defaultLabel || "Copy";
            button.disabled = true;
            button.textContent = copied ? "Copied!" : "Failed";
            setTimeout(() => {
                button.textContent = originalLabel;
                button.disabled = false;
            }, 1000);
        };

        actions.appendChild(button);
        pre.appendChild(actions);
    });
}

async function refreshActiveLabVmRuntimeState() {
    const lab = activeSection === "workspace" && workspaceView === "lab" ? getActiveLab() : null;
    if (!lab) {
        if (activeLabVmPollHandle) clearTimeout(activeLabVmPollHandle);
        activeLabVmPollHandle = null;
        return;
    }

    const token = ++activeLabVmPollToken;
    const vmInstances = Object.values(getBoundInstancesForLab(lab)).filter((instance) => instance?.providerType === "vmware_vm" && instance?.vmxPath);
    let changed = false;
    let shouldPersist = false;

    for (const instance of vmInstances) {
        try {
            if (typeof hasMissingVmBacking === "function" && await hasMissingVmBacking(instance)) {
                if (typeof dropResourceInstanceFromState === "function") {
                    dropResourceInstanceFromState(instance.id);
                    shouldPersist = true;
                    changed = true;
                }
                continue;
            }
            const powerState = await window.api.getVMPowerState(instance.vmxPath);
            const ip = powerState === "running" ? await window.api.getVMIP(instance.vmxPath) : "";
            const nextSnapshot = { powerState, ip: ip || instance.connection?.host || "" };
            const prevSnapshot = resourceVmRuntimeMap[instance.id] || {};
            if (JSON.stringify(prevSnapshot) !== JSON.stringify(nextSnapshot)) {
                resourceVmRuntimeMap[instance.id] = nextSnapshot;
                changed = true;
            }
            if (ip && appData.resourceInstances[instance.id]) {
                if (!appData.resourceInstances[instance.id].connection || typeof appData.resourceInstances[instance.id].connection !== "object") {
                    appData.resourceInstances[instance.id].connection = { host: "", username: "root", password: "" };
                }
                if (!instance.connection || typeof instance.connection !== "object") {
                    instance.connection = { host: "", username: "root", password: "" };
                }
                if (appData.resourceInstances[instance.id].connection.host !== ip) {
                    appData.resourceInstances[instance.id].connection.host = ip;
                    instance.connection.host = ip;
                    shouldPersist = true;
                    changed = true;
                }
            }
        } catch {}
    }

    if (shouldPersist) await sync();
    if (changed && window.renderApp) window.renderApp();
    if (token !== activeLabVmPollToken) return;
    if (activeLabVmPollHandle) clearTimeout(activeLabVmPollHandle);
    activeLabVmPollHandle = setTimeout(refreshActiveLabVmRuntimeState, 15000);
}

function syncLabLifecycle() {
    if (!window.api?.setLabActivity) return;

    const currentLab = activeSection === "workspace" && workspaceView === "lab" ? getActiveLab() : null;
    const currentInstances = currentLab ? Object.values(getBoundInstancesForLab(currentLab)) : [];
    const activeLabId = currentLab?.id || "";
    const currentInstanceIds = currentInstances.map((item) => item.id).sort().join("|");
    const previousLabId = lifecycleState.activeLabId || "";
    const previousInstances = Array.isArray(lifecycleState.activeInstances) ? lifecycleState.activeInstances : [];

    if (activeLabId === previousLabId && currentInstanceIds === previousInstances.map((item) => item.id).sort().join("|")) return;

    window.api.setLabActivity({
        activeLabId,
        activeInstances: currentInstances,
        previousLabId,
        previousInstances,
        settings: appData.settings
    });

    lifecycleState.activeLabId = activeLabId;
    lifecycleState.activeInstances = currentInstances;
}

function renderLabWorkspace() {
    const lab = getActiveLab();
    const runtime = getLabRuntimeDefinition(lab);
    const module = getModule(activeModuleId);
    const isNewLab = lastRenderedLabId !== lab.id;
    lastRenderedLabId = lab.id;
    const course = getCourse(activeCourseId);
    const activeTabKey = getActiveResourceName(runtime, lab);
    const activeResourceName = resolveBaseResourceName(activeTabKey);
    const profile = getProfileForResource(lab, activeResourceName);
    const bound = getBoundInstanceForLab(lab, activeResourceName);
    const runtimeStatus = getRuntimeStatusForResource(lab, activeResourceName);
    const vmRuntime = getVmRuntimeSnapshot(bound);
    const autoProvisionPaused = Boolean(lab?.id && autoProvisionPausedLabs.has(lab.id));
    const manualHtml = marked.parse(runtime.manualMarkdown || lab?.manual || "暂无实验手册。", {
        baseDir: runtime.manualBaseDir || lab?.importMeta?.manualBaseDir || lab?.importMeta?.packageDir || "",
        sourcePath: runtime.manualSourcePath || lab?.importMeta?.manualSourcePath || ""
    });
    const treePane = document.querySelector(".tree-pane");
    if (treePane) treePane.classList.add("has-detail");
    if (typeof window.ensureTerminalShell === "function") {
        window.ensureTerminalShell();
    }
    applyTreePaneState();
    const workspaceColumns = document.querySelector(".workspace-columns");
    if (workspaceColumns) {
        if (!profile) {
            workspaceColumns.classList.add("terminal-hidden");
        } else {
            workspaceColumns.classList.remove("terminal-hidden");
        }
    }

    if (typeof window.syncWorkspaceSplitLayout === "function" && workspaceColumns) {
        const containerWidth = workspaceColumns.getBoundingClientRect().width;
        const preferredWidth = Number(workspaceColumns.dataset.manualWidth || 0) || Math.round(containerWidth * 0.45);
        if (containerWidth > 0) {
            window.syncWorkspaceSplitLayout(preferredWidth);
            requestAnimationFrame(() => {
                if (typeof window.syncWorkspaceSplitLayout === "function") {
                    window.syncWorkspaceSplitLayout(preferredWidth);
                }
            });
            if (typeof window.scheduleWorkspaceLayoutSync === "function") {
                window.scheduleWorkspaceLayoutSync(preferredWidth, 120);
                window.scheduleWorkspaceLayoutSync(preferredWidth, 280);
            }
        }
    }

    const hydratedManualHtml = injectInlineCheckpointMarkerHtml(manualHtml, runtime);
    const scrollEl = document.querySelector(".manual-scroll");
    const savedScrollTop = !isNewLab && scrollEl ? scrollEl.scrollTop : 0;
    document.getElementById("manual").innerHTML = `${hydratedManualHtml}${renderManualCompletionAction(runtime, lab)}`;

    document.getElementById("tree-lab-panel").innerHTML = `
        ${buildWorkspaceStatusCards(lab, runtime, course, module, activeResourceName, profile, bound, runtimeStatus, vmRuntime)}
        <div class="workspace-status-card">
            <div class="workspace-status-title">资源操作</div>
            <div class="resource-action-row">
                ${profile ? (profile.providerType === "manual_ssh"
                    ? `<button class="btn btn-primary" onclick="openBindSshModal()">${bound ? "重新绑定服务器" : "绑定服务器"}</button>`
                    : (bound && profile.providerType === "vmware_vm"
                        ? `<button class="btn btn-primary" onclick="resetEnvironmentForActiveLab()">环境重置</button>`
                        : (!bound && autoProvisionPaused
                            ? `<button class="btn btn-primary" onclick="resumeLabEnvironmentProvision()">重新准备环境</button>`
                            : ""))) : ""}
                <button class="btn btn-secondary" onclick="leaveActiveLab()">离开实验</button>
                ${bound ? `<button class="btn btn-secondary" onclick="releaseLabResource()">解除绑定</button>` : ""}
                ${bound && bound.runnerType === "ssh" ? `<button class="btn btn-secondary" onclick='reconnectResource(${jsString(activeResourceName)})'>连接资源</button>` : ""}
            </div>
            ${autoProvisionPaused ? `<div class="hint" style="margin-top:10px;">${bound ? "当前实验环境已解除，" : "环境初始化未完成，"}本次停留不会自动重新创建。点击"重新准备环境"后才会再次创建。</div>` : ""}
            <div id="ssh-status" class="hint" style="margin-top:10px;">未连接</div>
            <div id="verify-result" class="verify-result" style="margin-top:10px;"></div>
        </div>
    `;
    updateTreePaneDetailDensity();
    renderManualProgress(runtime, lab);
    renderWorkspaceTerminalUi(runtime, lab);
    enhanceManualInteractions(runtime, lab);
    bindManualReadingPersistence();
    if (isNewLab) {
        showManualRestoreBanner(lab);
    } else {
        const currentScrollEl = document.querySelector(".manual-scroll");
        if (currentScrollEl && savedScrollTop > 0) {
            isRestoringScroll = true;
            currentScrollEl.scrollTop = savedScrollTop;
            setTimeout(() => { isRestoringScroll = false; }, 50);
        }
    }

    if (runtime.resources.length > 1 && lab?.id) {
        const batchKey = `${lab.id}:all`;
        const missingResources = runtime.resources.filter((item) => !getBoundInstanceForLab(lab, item.name));
        if (!missingResources.length) autoPrepareRequestedLabs.delete(batchKey);
        if (!autoProvisionPaused && !workspaceBatchState.active && missingResources.length && !autoPrepareRequestedLabs.has(batchKey)) {
            autoPrepareRequestedLabs.add(batchKey);
            setTimeout(() => {
                if (getActiveLab()?.id === lab.id) {
                    prepareAllResourcesForActiveLab();
                }
            }, 80);
        }
    }

    if (bound) autoInitRequestedLabs.delete(`${lab?.id || ""}:${activeResourceName}`);
    if (!autoProvisionPaused && runtime.resources.length <= 1 && !workspaceBatchState.active && !bound && profile?.providerType === "vmware_vm" && runtimeStatus?.state !== "provisioning" && lab?.id) {
        const autoKey = `${lab.id}:${activeResourceName}`;
        if (!autoInitRequestedLabs.has(autoKey)) {
            autoInitRequestedLabs.add(autoKey);
            setTimeout(() => {
                if (getActiveLab()?.id === lab.id && terminalUiState.activeTabKey === activeTabKey) {
                    initializeResourceForActiveLab();
                }
            }, 80);
        }
    }

    const activeSession = ensureTerminalSession(getTerminalSessionKey(lab, activeTabKey));
    const runnerType = profile?.runnerType || bound?.runnerType || "ssh";
    if (runnerType !== "ssh" && bound) {
        window.api.initLocalShell();
    } else if (bound?.runnerType === "ssh") {
        if (bound.providerType === "vmware_vm" && typeof window.ensureVmResourcePowered === "function") {
            window.ensureVmResourcePowered(activeResourceName, true).then(() => {
                const latestSession = ensureTerminalSession(getTerminalSessionKey(lab, activeTabKey));
                if (!latestSession.connected && latestSession.status !== "connecting") {
                    reconnectResource(activeTabKey, true);
                }
            }).catch(() => {});
        } else if (!activeSession.connected && activeSession.status !== "connecting") {
            reconnectResource(activeTabKey, true);
        }
    }

    if (typeof syncSshStatusLabel === "function") syncSshStatusLabel();
    if (window.syncLabLifecycle) window.syncLabLifecycle();
    refreshActiveLabVmRuntimeState();
    setTimeout(() => {
        fitAddon.fit();
        const sessionKey = getTerminalSessionKey(lab, activeTabKey);
        if (window.api?.resizeTerminal) {
            window.api.resizeTerminal({ sessionKey, cols: term.cols, rows: term.rows });
        }
    }, 80);
}

function setActiveTerminalTab(tabKey) {
    terminalUiState.activeTabKey = tabKey;
    if (workspaceView === "lab" && activeLabId) renderLabWorkspace();
}

function fillProfileForm(profile) {
    document.getElementById("resource-provider-type").value = profile?.providerType || "manual_ssh";
    document.getElementById("resource-profile-name").value = profile?.name || "";
    document.getElementById("resource-summary").value = profile?.summary || "";
    document.getElementById("resource-reuse-key").value = profile?.reuseKey || "";
    document.getElementById("resource-note").value = profile?.note || "";
    document.getElementById("resource-vmware-template").value = profile?.vmwareTemplate || "";
    document.getElementById("resource-vmware-snapshot").value = profile?.vmwareSnapshot || "";
}

function toggleLabResourceFields() {
    document.getElementById("lab-resource-fields").classList.toggle("hidden", document.getElementById("lab-resource-mode").value !== "custom");
}

function openModal(id) {
    document.getElementById(id).classList.add("active");
}

function closeModal(id) {
    document.getElementById(id).classList.remove("active");
    if (id === "modal-delete") {
        pendingDeleteAction = null;
        document.getElementById("delete-confirm-input").value = "";
    }
}

window.renderCoursePage = renderCoursePage;
window.renderModulePage = renderModulePage;
window.renderLabWorkspace = renderLabWorkspace;
window.renderWorkspaceTerminalUi = renderWorkspaceTerminalUi;
window.setActiveTerminalTab = setActiveTerminalTab;
window.enhanceManualInteractions = enhanceManualInteractions;
window.syncLabLifecycle = syncLabLifecycle;
window.fillProfileForm = fillProfileForm;
window.toggleLabResourceFields = toggleLabResourceFields;
window.openModal = openModal;
window.closeModal = closeModal;
window.showToast = showToast;
window.toggleTreePane = toggleTreePane;
window.reconnectResource = reconnectResource;
window.toggleManualReadingCompleted = toggleManualReadingCompleted;
window.captureActiveLabManualReadingState = captureActiveLabManualReadingState;
