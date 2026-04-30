function renderProgressBar(percent) {
    return `<div class="progress-track mini-progress"><div class="progress-fill" style="width:${percent}%"></div></div>`;
}

function renderStatusDot(status) {
    return `<span class="status-dot status-${status}"></span>`;
}

function jsString(value) {
    return JSON.stringify(String(value || ""));
}

function getProfileState(profile) {
    if (!profile) return "idle";
    const status = resourceStatusMap[getStatusKey(profile)];
    if (status?.state === "failed") return "failed";
    if (status?.state === "provisioning") return "provisioning";
    if (findCompatibleInstances(profile).length) return "ready";
    return "idle";
}

function getLabState(lab) {
    const resourceNames = getAllResourceNamesForLab(lab);
    const boundInstances = resourceNames.map((resourceName) => getBoundInstanceForLab(lab, resourceName)).filter(Boolean);
    const runtimeStatuses = resourceNames.map((resourceName) => getRuntimeStatusForResource(lab, resourceName)).filter(Boolean);
    if (runtimeStatuses.some((status) => status.state === "failed")) return "failed";
    if (runtimeStatuses.some((status) => status.state === "provisioning")) return "provisioning";
    if (boundInstances.some((instance) => instance.status === "failed")) return "failed";
    if (boundInstances.some((instance) => ["ready", "scaffolded"].includes(instance.status))) return "ready";
    return getProfileState(getEffectiveProfileForLab(lab));
}

function getModuleState(module) {
    const labs = getLabsByModule(module.id);
    if (!labs.length) return "idle";
    if (labs.some(lab => getLabState(lab) === "provisioning")) return "provisioning";
    if (labs.some(lab => getLabState(lab) === "failed")) return "failed";
    if (labs.some(lab => getLabState(lab) === "ready")) return "ready";
    return "idle";
}

function getCourseState(course) {
    const modules = getModulesByCourse(course.id);
    if (!modules.length) return "idle";
    if (modules.some(module => getModuleState(module) === "provisioning")) return "provisioning";
    if (modules.some(module => getModuleState(module) === "failed")) return "failed";
    if (modules.some(module => getModuleState(module) === "ready")) return "ready";
    return "idle";
}

function switchSection(section) {
    if (activeLabId && typeof window.captureActiveLabManualReadingState === "function") {
        window.captureActiveLabManualReadingState({ immediate: true });
    }
    activeSection = section;
    renderApp();
    if (window.syncLabLifecycle) window.syncLabLifecycle();
    if (section === "resources" && window.loadVmManagerData) {
        window.loadVmManagerData();
    }
}

function navigateTo(level, id) {
    const previousLabId = activeLabId;
    if (previousLabId && typeof window.captureActiveLabManualReadingState === "function") {
        window.captureActiveLabManualReadingState({ immediate: true });
    }
    activeSection = "workspace";
    if (level === "home") {
        workspaceView = "home";
        activeCourseId = "";
        activeModuleId = "";
        activeLabId = "";
    } else if (level === "course") {
        workspaceView = "course";
        activeCourseId = id;
        activeModuleId = "";
        activeLabId = "";
    } else if (level === "module") {
        const module = getModule(id);
        if (!module) return;
        workspaceView = "module";
        activeCourseId = module.courseId;
        activeModuleId = module.id;
        activeLabId = "";
    } else if (level === "lab") {
        const lab = getLab(id);
        if (!lab) return;
        workspaceView = "lab";
        activeCourseId = lab.courseId;
        activeModuleId = lab.moduleId;
        activeLabId = lab.id;
    }
    if (previousLabId && previousLabId !== activeLabId) {
        autoProvisionPausedLabs.delete(previousLabId);
    }
    renderApp();
    if (window.syncLabLifecycle) window.syncLabLifecycle();
    if (level === "lab") setTimeout(() => fitAddon.fit(), 80);
}

function resetWorkspace() {
    navigateTo("home");
}

function selectCourse(courseId) {
    navigateTo("course", courseId);
}

function selectModule(moduleId) {
    navigateTo("module", moduleId);
}

function selectLab(labId) {
    navigateTo("lab", labId);
}

function renderApp() {
    renderNav();
    renderTree();
    renderBreadcrumb();
    renderStatusStrip();
    renderMain();
    renderMermaidDiagrams();
}

window.renderMermaidDiagrams = async function() {
    try {
        const { default: mermaid } = await import('./node_modules/mermaid/dist/mermaid.esm.min.mjs');
        mermaid.initialize({ 
            startOnLoad: true,
            flowchart: {
                useMaxWidth: false
            }
        });
        mermaid.init(document.querySelectorAll('.mermaid'));
    } catch (e) {
        console.error("Failed to render mermaid:", e);
    }
};

function renderNav() {
    document.getElementById("nav-home").classList.toggle("active", activeSection === "workspace");
    document.getElementById("nav-resources").classList.toggle("active", activeSection === "resources");
    document.getElementById("nav-settings").classList.toggle("active", activeSection === "settings");
}

function normalizeTreeSearchQuery(value) {
    return String(value || "").trim().toLowerCase();
}

function labMatchesTreeSearch(lab, query) {
    if (!query) return true;
    return String(lab?.title || "").toLowerCase().includes(query);
}

function moduleMatchesTreeSearch(module, query) {
    if (!query) return true;
    if (String(module?.name || "").toLowerCase().includes(query)) return true;
    return getLabsByModule(module.id).some(lab => labMatchesTreeSearch(lab, query));
}

function courseMatchesTreeSearch(course, query) {
    if (!query) return true;
    if (String(course?.name || "").toLowerCase().includes(query)) return true;
    return getModulesByCourse(course.id).some(module => moduleMatchesTreeSearch(module, query));
}

function applyTreeSearch(rawQuery) {
    treeSearchQuery = String(rawQuery || "").trim();
    renderTree();
}

function submitTreeSearch() {
    const input = document.getElementById("tree-search-input");
    applyTreeSearch(input ? input.value : "");
}

function renderTree() {
    const container = document.getElementById("tree-content");
    const input = document.getElementById("tree-search-input");
    if (input && input.value !== treeSearchQuery) input.value = treeSearchQuery;
    const query = normalizeTreeSearchQuery(treeSearchQuery);
    const courses = Object.values(appData.courses).filter(course => courseMatchesTreeSearch(course, query));
    if (!courses.length) {
        container.innerHTML = query
            ? `<div class="empty-state">没有找到匹配的课程，请换个关键词试试。</div>`
            : `<div class="empty-state">当前还没有任何课程。可以先导入实验文件夹，系统会自动生成课程树，也可以 <a href="#" onclick="openCourseModal()" style="color:#2d7ff9; text-decoration:none; font-weight:600;">手动创建课程</a>。</div>`;
        return;
    }

    container.innerHTML = courses.map(course => {
        const courseProgress = getCourseProgress(course.id);
        const expanded = Boolean(query) || activeCourseId === course.id;
        const visibleModules = getModulesByCourse(course.id).filter(module => moduleMatchesTreeSearch(module, query));
        return `
            <div class="tree-group">
                <button class="tree-course tree-node ${expanded ? "active" : ""}" onclick="selectCourse('${course.id}')">
                    <span class="tree-meta">${renderStatusDot(getCourseState(course))}<span>${course.icon} ${escapeHtml(course.name)} (${courseProgress.completed}/${courseProgress.total})</span></span>
                </button>
                ${expanded ? `<div class="tree-indent">${visibleModules.map(module => {
                    const moduleExpanded = Boolean(query) || activeModuleId === module.id;
                    const visibleLabs = getLabsByModule(module.id).filter(lab => labMatchesTreeSearch(lab, query));
                    return `
                        <button class="tree-module tree-node ${moduleExpanded ? "active" : ""}" onclick="selectModule('${module.id}')">
                            <span class="tree-meta">${renderStatusDot(getModuleState(module))}<span>${escapeHtml(module.name)}</span></span>
                        </button>
                        ${moduleExpanded ? `<div class="tree-indent">${visibleLabs.map(lab => `
                            <button class="tree-lab tree-node ${activeLabId === lab.id ? "active" : ""}" onclick="selectLab('${lab.id}')">
                                <span class="tree-meta">${renderStatusDot(getLabState(lab))}<span>${escapeHtml(lab.title)}${lab.completed ? " ✓" : ""}</span></span>
                            </button>
                        `).join("")}</div>` : ""}
                    `;
                }).join("")}</div>` : ""}
            </div>
        `;
    }).join("");
}

function renderBreadcrumb() {
    const crumbs = [];
    if (activeSection === "resources") {
        crumbs.push({ label: "VMware 管理", click: "switchSection('resources')" });
    } else if (activeSection === "settings") {
        crumbs.push({ label: "设置", click: "switchSection('settings')" });
    } else {
        crumbs.push({ label: "首页", click: "navigateTo('home')" });
        if (activeCourseId) crumbs.push({ label: getCourse(activeCourseId)?.name || "课程", click: `navigateTo('course','${activeCourseId}')` });
        if (activeModuleId) crumbs.push({ label: getModule(activeModuleId)?.name || "目录", click: `navigateTo('module','${activeModuleId}')` });
        if (activeLabId) crumbs.push({ label: getLab(activeLabId)?.title || "实验", click: `navigateTo('lab','${activeLabId}')` });
    }

    const breadcrumb = document.getElementById("breadcrumb");
    if (!breadcrumb) return;
    breadcrumb.innerHTML = crumbs.map((crumb, index) => `
        <button class="breadcrumb-btn ${index === crumbs.length - 1 ? "active" : ""}" onclick="${crumb.click}">${escapeHtml(crumb.label)}</button>
        ${index < crumbs.length - 1 ? '<span class="breadcrumb-sep">/</span>' : ""}
    `).join("");
}

function renderStatusStrip() {
    const container = document.getElementById("resource-status-strip");
    if (!container) return;
    if (workspaceView === "lab" && activeLabId) {
        container.innerHTML = "";
        return;
    }
    let status = null;
    if (activeLabId) {
        status = resourceStatusMap[getStatusKey(getEffectiveProfileForLab(getActiveLab()))] || null;
    }
    if (!status) {
        status = Object.values(resourceStatusMap).find(item => item.state === "provisioning") || null;
    }
    if (status && status.state === "ready") status = null;
    if (!status) {
        container.innerHTML = "";
        return;
    }

    container.innerHTML = `
        <div class="status-banner">
            <div class="status-banner-title">${escapeHtml(status.title || "资源状态")}</div>
            <div class="status-banner-text">${escapeHtml(status.message || "")}</div>
            ${typeof status.progressPercent === "number" ? renderProgressBar(status.progressPercent) : ""}
        </div>
    `;
}

function renderMain() {
    const content = document.getElementById("content-body");
    const workspace = document.getElementById("workspace-view");
    const treeLabPanel = document.getElementById("tree-lab-panel");
    const treePane = document.querySelector(".tree-pane");

    if (activeSection === "resources") {
        if (treeLabPanel) treeLabPanel.innerHTML = "";
        if (treePane) treePane.classList.remove("has-detail");
        workspace.classList.add("hidden");
        content.classList.remove("hidden");
        renderVmwareManagerPage(content);
        decorateVmwareManagerResourceList(content);
        return;
    }
    if (activeSection === "settings") {
        if (treeLabPanel) treeLabPanel.innerHTML = "";
        if (treePane) treePane.classList.remove("has-detail");
        workspace.classList.add("hidden");
        content.classList.remove("hidden");
        renderSettingsPage(content);
        return;
    }
    if (workspaceView === "lab" && activeLabId) {
        content.classList.add("hidden");
        workspace.classList.remove("hidden");
        renderLabWorkspace();
        return;
    }

    if (treeLabPanel) treeLabPanel.innerHTML = "";
    if (treePane) treePane.classList.remove("has-detail");
    workspace.classList.add("hidden");
    content.classList.remove("hidden");
    if (workspaceView === "module" && activeModuleId) return renderModulePage(content);
    if (workspaceView === "course" && activeCourseId) return renderCoursePage(content);
    renderDashboard(content);
}

function decorateVmwareManagerResourceList(container) {
    return;
}

function renderResourceInstanceRecords(instances) {
    const groups = new Map();

    instances.forEach((instance) => {
        const key = instance.labId ? `lab:${instance.labId}` : `instance:${instance.id}`;
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                labId: instance.labId || "",
                instances: []
            });
        }
        groups.get(key).instances.push(instance);
    });

    const orderedGroups = Array.from(groups.values()).sort((left, right) => {
        const leftTime = Math.max(...left.instances.map((item) => Date.parse(item.lastUsedAt || "") || 0));
        const rightTime = Math.max(...right.instances.map((item) => Date.parse(item.lastUsedAt || "") || 0));
        return rightTime - leftTime;
    });

    if (!orderedGroups.length) {
        return '<div class="empty-state">当前还没有任何资源实例。进入实验后会按实验自动创建对应环境。</div>';
    }

    return orderedGroups.map((group) => {
        const lab = group.labId ? getLab(group.labId) : null;
        const vmNames = group.instances
            .map((instance) => instance.vmDisplayName || instance.label || instance.resourceName || instance.id)
            .filter(Boolean)
            .sort((left, right) => left.localeCompare(right, "zh-CN", { numeric: true, sensitivity: "base" }));
        const title = lab
            ? `${lab.title} 使用了 ${vmNames.join("-")}`
            : vmNames.join("-");
        const routeMeta = lab
            ? `${getCourse(lab.courseId)?.name || "未命名课程"} / ${getModule(lab.moduleId)?.name || "未命名目录"}`
            : "未关联实验";
        const ipMeta = group.instances
            .map((instance) => `${instance.vmDisplayName || instance.label || instance.resourceName || "资源"} ${instance.connection.host || "IP 未就绪"}`)
            .join(" · ");
        const actionHtml = lab
            ? `<button class="btn btn-danger" onclick="requestDeleteLab('${lab.id}')">删除实验与环境</button>`
            : `<button class="btn btn-danger" onclick="requestDeleteOrphanResourceGroup('${group.instances.map((item) => item.id).join(",")}')">删除残留环境</button>`;

        return `
            <div class="list-item">
                <div>
                    <div class="list-title">${escapeHtml(title)}</div>
                    <div class="list-meta">${escapeHtml(routeMeta)} · ${group.instances.length} 台资源</div>
                    <div class="list-meta">${escapeHtml(ipMeta)}</div>
                </div>
                <div class="actions">${actionHtml}</div>
            </div>
        `;
    }).join("");
}

function renderDashboard(container) {
    const courses = Object.values(appData.courses);
    container.innerHTML = `
        <div class="simple-page">
            <div class="page-toolbar">
                <div>
                    <h1 class="page-title">实验工作台</h1>
                    <p class="page-subtitle">以实验手册为入口，自动组织 A / B / 实验 层级，并在进入实验时绑定或初始化环境。</p>
                </div>
                <div class="actions">
                    <button class="btn btn-secondary" onclick="beginImportLabSpecs()">导入实验文件夹</button>
                    <button class="btn btn-primary" onclick="openCourseModal()">新建课程</button>
                </div>
            </div>
            <div class="resource-card-grid">
                <div class="stat-card"><div class="stat-label">课程数</div><div class="stat-value">${courses.length}</div></div>
                <div class="stat-card"><div class="stat-label">实验数</div><div class="stat-value">${Object.keys(appData.labs).length}</div></div>
                <div class="stat-card"><div class="stat-label">资源实例数</div><div class="stat-value">${Object.keys(appData.resourceInstances).length}</div></div>
            </div>
            <div class="grid">
                ${courses.length ? courses.map(course => {
                    const progress = getCourseProgress(course.id);
                    return `<div class="card clickable" onclick="navigateTo('course','${course.id}')">
                        <div class="card-icon">${course.icon}</div>
                        <div class="card-title">${escapeHtml(course.name)}</div>
                        <div class="card-desc">${escapeHtml(course.description || "暂无课程介绍。")}</div>
                        <div class="card-footer"><div class="progress-text">进度：${progress.completed} / ${progress.total}</div>${renderProgressBar(progress.percent)}</div>
                    </div>`;
                }).join("") : '<div class="empty-state">当前还没有课程。建议直接导入实验文件夹让系统自动建树，或者 <a href="#" onclick="openCourseModal()" style="color:#2d7ff9; text-decoration:none; font-weight:600;">手动创建一个课程</a>。</div>'}
            </div>
        </div>
    `;
}

function renderVmwareManagerPage(container) {
    const vms = vmManagerState.vms || [];
    const instances = Object.values(appData.resourceInstances).sort((a, b) => String(b.lastUsedAt).localeCompare(String(a.lastUsedAt)));
    const rockyTemplateVm = vms.find(vm => vm.isTemplate);
    const rockyTemplateExists = Boolean(rockyTemplateVm);

    container.innerHTML = `
        <div class="simple-page">
            <div class="page-toolbar">
                <div>
                    <h1 class="page-title">VMware 管理</h1>
                    <p class="page-subtitle">这里显示 VMware 当前管理的虚拟机，包括 RockyBase 模板与所有克隆实例。</p>
                </div>
                <div class="actions">
                    <button class="btn btn-primary" onclick="createVmFromOvaPrompt()">手动导入 RockyBase 模板</button>
                </div>
            </div>

            <div class="resource-card-grid">
                <div class="panel">
                    <div class="hint">${rockyTemplateExists ? "当前已检测到 RockyBase 模板机。" : "当前还没有 RockyBase 模板机。首次 Linux 实验初始化或点击上方按钮时会导入它。"}</div>
                    ${rockyTemplateExists ? `<div class="hint">快照 clean：${rockyTemplateVm.hasCleanSnapshot ? "已存在" : "缺失"}</div>` : ""}
                </div>
                <div class="panel">
                    <div class="stat-label">VMware 虚拟机数</div>
                    <div class="stat-value" style="font-size:1.2rem;">${vmManagerState.loading ? "..." : vms.length}</div>
                    <div class="hint">${vmManagerState.error ? escapeHtml(vmManagerState.error) : "这里统计 inventory 与手工登记的 VMX。"}</div>
                </div>
            </div>

            <div class="list">
                ${vmManagerState.loading ? '<div class="empty-state">正在读取 VMware 虚拟机列表...</div>' : ''}
                ${!vmManagerState.loading && vmManagerState.error ? `<div class="empty-state">${escapeHtml(vmManagerState.error)}</div>` : ''}
                ${!vmManagerState.loading && !vmManagerState.error && vms.length ? vms.map((vm, index) => `
                    <div class="list-item">
                        <div>
                            <div class="list-title">${escapeHtml(vm.name)}${vm.isTemplate ? ' · 模板机' : ''}</div>
                            <div class="list-meta">${escapeHtml(vm.path)}</div>
                            <div class="list-meta">${vm.running ? "运行中" : "已关机"}${vm.ip ? ` · IP ${escapeHtml(vm.ip)}` : ""}${vm.isTemplate ? ` · clean 快照 ${vm.hasCleanSnapshot ? "已存在" : "缺失"}` : ""}</div>
                        </div>
                        <div class="actions">
                            <button class="btn btn-secondary" onclick="runVmActionByIndex('start', ${index})">启动</button>
                            <button class="btn btn-secondary" onclick="runVmActionByIndex('stop', ${index})">关机</button>
                            <button class="btn btn-secondary" onclick="runVmActionByIndex('reset', ${index})">重启</button>
                            <button class="btn btn-secondary" onclick="snapshotVmPromptByIndex(${index})">快照</button>
                            <button class="btn btn-secondary" onclick="openVmFolderByIndex(${index})">打开目录</button>
                            <button class="btn btn-danger" onclick="deleteVmPromptByIndex(${index})">删除</button>
                        </div>
                    </div>
                `).join("") : ''}
            </div>

            <div class="page-toolbar" style="margin-top:12px;">
                <div>
                    <h2 class="page-title" style="font-size:1.3rem;">资源实例</h2>
                    <p class="page-subtitle">这里按实验聚合显示当前环境占用的资源实例。</p>
                </div>
            </div>
            <div class="list">
                ${renderResourceInstanceRecords(instances)}
            </div>
        </div>
    `;
}

function renderSettingsPage(container) {
    const s = appData.settings || {};
    container.innerHTML = `
        <div class="simple-page">
            <div class="page-toolbar">
                <div>
                    <h1 class="page-title">设置</h1>
                    <p class="page-subtitle">这里只保留 VMware 安装目录和 RockyBase 模板 OVA。程序会自动推导 VMware 相关可执行文件路径。</p>
                </div>
                <div class="actions">
                    <button class="btn btn-primary" onclick="saveSettings()">保存设置</button>
                </div>
            </div>
            <div class="panel">
                <div class="field-grid">
                    <div class="field-full">
                        <label for="settings-vmware-install-dir">VMware 安装目录</label>
                        <div class="actions">
                            <input id="settings-vmware-install-dir" value="${escapeHtml(s.vmwareInstallDir || "")}" placeholder="例如 D:\\Program Files (x86)\\VMware\\VMware Workstation">
                            <button class="btn btn-secondary" type="button" onclick="pickVmwareInstallDir()">更改</button>
                        </div>
                    </div>
                    <div class="field-full">
                        <label for="settings-rocky-ova">RockyBase.ova</label>
                        <div class="actions">
                            <input id="settings-rocky-ova" value="${escapeHtml(s.rockyOvaPath || "")}" placeholder="例如 D:\\labox\\RockyBase.ova">
                            <button class="btn btn-secondary" type="button" onclick="pickRockyOvaFile()">选择 OVA</button>
                        </div>
                    </div>
                    <div class="field-full"><label for="settings-lab-root">Lab 根目录</label><input id="settings-lab-root" value="${escapeHtml(s.labRootDir || "")}" placeholder="例如 D:\\labox"></div>
                    <div class="field"><label for="settings-vm-suspend-seconds">离开实验后自动挂起秒数</label><input id="settings-vm-suspend-seconds" type="number" min="0" step="1" value="${escapeHtml(String(s.vmSuspendSeconds || 300))}"></div>
                    <div class="field"><label for="settings-manual-font-scale">实验手册字体缩放</label><input id="settings-manual-font-scale" type="number" min="0.85" max="1.8" step="0.05" value="${escapeHtml(String(s.manualFontScale || 1))}"></div>
                    <div class="field"><label for="settings-ssh-font-size">SSH 窗口字体大小</label><input id="settings-ssh-font-size" type="number" min="10" max="24" step="1" value="${escapeHtml(String(s.sshTerminalFontSize || 14))}"></div>
                    <div class="field-full">
                        <label><input id="settings-manage-external-vms" type="checkbox" style="width:auto; margin-right:8px;" ${s.manageExternalVms ? "checked" : ""} />纳管用户原有 VMware inventory 虚拟机</label>
                    </div>
                </div>
            </div>
        </div>
    `;
}


function initWorkspaceResizer() {
    const resizer = document.getElementById("workspace-resizer");
    const manualColumn = document.querySelector(".manual-column");
    const terminalColumn = document.querySelector(".terminal-column");
    const columns = document.querySelector(".workspace-columns");

    if (!resizer || !manualColumn || !terminalColumn || !columns) return;

    let isResizing = false;
    const MIN_MANUAL_WIDTH = 320;
    const MIN_TERMINAL_WIDTH = 460;
    let layoutSyncTimers = [];

    function applyManualWidth(nextWidth) {
        const containerWidth = columns.getBoundingClientRect().width;
        if (containerWidth <= 0) return;
        const maxManualWidth = Math.max(MIN_MANUAL_WIDTH, containerWidth - MIN_TERMINAL_WIDTH);
        const clampedWidth = Math.max(MIN_MANUAL_WIDTH, Math.min(nextWidth, maxManualWidth));
        const terminalWidth = Math.max(MIN_TERMINAL_WIDTH, containerWidth - clampedWidth);
        manualColumn.style.flex = `0 0 ${clampedWidth}px`;
        manualColumn.style.width = `${clampedWidth}px`;
        terminalColumn.style.flex = `0 0 ${terminalWidth}px`;
        terminalColumn.style.width = `${terminalWidth}px`;
        columns.dataset.manualWidth = String(Math.round(clampedWidth));
        if (window.fitAddon) {
            window.fitAddon.fit();
        }
    }

    function scheduleWorkspaceLayoutSync(preferredWidth = 0, delayMs = 0) {
        const timer = setTimeout(() => {
            layoutSyncTimers = layoutSyncTimers.filter((item) => item !== timer);
            syncWorkspaceSplitLayout(preferredWidth);
            if (window.fitAddon) {
                window.fitAddon.fit();
            }
        }, delayMs);
        layoutSyncTimers.push(timer);
    }

    function syncWorkspaceSplitLayout(preferredWidth = 0) {
        if (columns.classList.contains("terminal-hidden")) {
            manualColumn.style.flex = "";
            manualColumn.style.width = "";
            terminalColumn.style.flex = "";
            terminalColumn.style.width = "";
            return;
        }

        if (window.matchMedia("(max-width: 1380px)").matches) {
            manualColumn.style.flex = "";
            manualColumn.style.width = "";
            terminalColumn.style.flex = "";
            terminalColumn.style.width = "";
            delete columns.dataset.manualWidth;
            if (window.fitAddon) window.fitAddon.fit();
            return;
        }

        const widthCandidate = Number(preferredWidth || columns.dataset.manualWidth || manualColumn.getBoundingClientRect().width || 0);
        const containerWidth = columns.getBoundingClientRect().width;
        if (containerWidth <= 0) return;

        const fallbackWidth = Math.round(containerWidth * 0.45);
        applyManualWidth(widthCandidate > 0 ? widthCandidate : fallbackWidth);
    }

    window.syncWorkspaceSplitLayout = syncWorkspaceSplitLayout;
    window.scheduleWorkspaceLayoutSync = scheduleWorkspaceLayoutSync;

    const storedWidth = Number(columns.dataset.manualWidth || 0);
    if (storedWidth > 0) {
        syncWorkspaceSplitLayout(storedWidth);
    }

    resizer.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        isResizing = true;
        document.body.style.cursor = "col-resize";
        resizer.classList.add("active");
        e.preventDefault();
        e.stopPropagation();
    });

    document.addEventListener("mousemove", (e) => {
        if (!isResizing) return;

        const containerRect = columns.getBoundingClientRect();
        const offsetX = e.clientX - containerRect.left;

        applyManualWidth(offsetX);
    });

    document.addEventListener("mouseup", () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = "";
            resizer.classList.remove("active");
        }
    });

    resizer.addEventListener("dblclick", () => {
        manualColumn.style.flex = "";
        manualColumn.style.width = "";
        terminalColumn.style.flex = "";
        terminalColumn.style.width = "";
        delete columns.dataset.manualWidth;
        if (window.fitAddon) {
            window.fitAddon.fit();
        }
    });
}

window.renderApp = renderApp;
window.navigateTo = navigateTo;
window.switchSection = switchSection;
window.resetWorkspace = resetWorkspace;
window.selectCourse = selectCourse;
window.selectModule = selectModule;
window.selectLab = selectLab;
window.submitTreeSearch = submitTreeSearch;
window.applyTreeSearch = applyTreeSearch;
window.initWorkspaceResizer = initWorkspaceResizer;

// Add a resize listener to ensure the terminal always fits its container
window.addEventListener('resize', () => {
    // Debounce the resize event to prevent performance issues from rapid resizing
    clearTimeout(window._terminalResizeTimer);
    window._terminalResizeTimer = setTimeout(() => {
        if (typeof window.syncWorkspaceSplitLayout === "function") {
            window.syncWorkspaceSplitLayout();
        }
        if (window.fitAddon) {
            window.fitAddon.fit();
        }
    }, 50); // Adjust debounce delay as needed
});
