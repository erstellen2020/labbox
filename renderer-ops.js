function openCourseModal(courseId = "") {
    editingCourseId = courseId;
    const course = courseId ? getCourse(courseId) : null;
    document.getElementById("course-modal-title").innerText = course ? "编辑课程" : "新增课程";
    document.getElementById("course-name").value = course?.name || "";
    document.getElementById("course-icon").value = course?.icon || "📦";
    document.getElementById("course-description").value = course?.description || "";
    openModal("modal-course");
}

async function saveCourse() {
    const name = document.getElementById("course-name").value.trim();
    if (!name) return alert("请输入课程名称。");
    const courseId = editingCourseId || uid("course");
    appData.courses[courseId] = normalizeCourse(courseId, {
        name,
        icon: document.getElementById("course-icon").value.trim() || "📦",
        description: document.getElementById("course-description").value.trim()
    });
    await sync();
    closeModal("modal-course");
    activeCourseId = courseId;
    activeSection = "workspace";
    workspaceView = "course";
    renderApp();
}

function openModuleModal(moduleId = "") {
    if (!activeCourseId) return;
    editingModuleId = moduleId;
    const module = moduleId ? getModule(moduleId) : null;
    document.getElementById("module-modal-title").innerText = module ? "编辑 B 级目录" : "新增 B 级目录";
    document.getElementById("module-name").value = module?.name || "";
    document.getElementById("module-description").value = module?.description || "";
    openModal("modal-module");
}

async function saveModule() {
    const name = document.getElementById("module-name").value.trim();
    if (!name) return alert("请输入 B 级目录名称。");
    const moduleId = editingModuleId || uid("module");
    const old = editingModuleId ? getModule(editingModuleId) : null;
    appData.modules[moduleId] = normalizeModule(moduleId, {
        courseId: activeCourseId,
        name,
        description: document.getElementById("module-description").value.trim(),
        defaultResourceProfileId: old?.defaultResourceProfileId || ""
    });
    await sync();
    closeModal("modal-module");
    activeModuleId = moduleId;
    workspaceView = "module";
    renderApp();
}

function collectCustomProfileInput() {
    const providerType = normalizeProviderType(document.getElementById("resource-provider-type").value);
    const course = getCourse(activeCourseId);
    const module = getModule(activeModuleId);
    return {
        name: document.getElementById("resource-profile-name").value.trim() || defaultProfileName(course?.name, module?.name, providerType),
        providerType,
        runnerType: mapProviderToRunner(providerType),
        summary: document.getElementById("resource-summary").value.trim() || defaultSummaryForProvider(providerType),
        reuseKey: document.getElementById("resource-reuse-key").value.trim() || `${slugify(course?.name)}:${slugify(module?.name)}:${providerType}`,
        note: document.getElementById("resource-note").value.trim(),
        osName: "Linux",
        ovaPath: appData.settings.rockyOvaPath,
        vmCpu: 1,
        vmMemoryMB: 1024,
        vmDiskGB: 40,
        guestUsername: "root",
        guestPassword: "123",
        vmwareTemplate: document.getElementById("resource-vmware-template").value.trim(),
        vmwareSnapshot: document.getElementById("resource-vmware-snapshot").value.trim()
    };
}

function createOrReuseResourceProfile(rawProfile) {
    const normalized = normalizeResourceProfile(uid("profile"), rawProfile);
    const existing = Object.values(appData.resourceProfiles).find(profile =>
        profile.providerType === normalized.providerType &&
        profile.reuseKey === normalized.reuseKey &&
        profile.name === normalized.name
    );
    if (existing) return existing.id;
    appData.resourceProfiles[normalized.id] = normalized;
    return normalized.id;
}

// 内部工具函数：转义 HTML 防止注入
function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function updateLabPreview() {
    try {
        const manualEl = document.getElementById("lab-manual");
        const previewManual = document.getElementById("lab-preview-manual");
        if (!manualEl || !previewManual) return;

        const manualMarkdown = manualEl.value;
        const manifest = parseLabManifest(manualMarkdown);
        
        // 渲染 Markdown 预览
        const html = window.marked ? window.marked.parse(manifest.body || manualMarkdown) : (manifest.body || manualMarkdown);
        previewManual.innerHTML = html;

        // 更新资源列表显示
        const resourceListEl = document.getElementById("lab-resource-list");
        if (resourceListEl) {
            if (!manifest.resources || manifest.resources.length === 0) {
                resourceListEl.innerHTML = `<div class="hint" style="padding:8px;">尚未解析到资源定义，请在手册中定义 resources。</div>`;
            } else {
                resourceListEl.innerHTML = manifest.resources.map(res => `
                    <div class="list-item" style="padding: 8px 12px; border-radius: 8px; margin-bottom: 4px; background: #1a1f28; border: 1px solid #2d3440;">
                        <div style="display:flex; justify-content:space-between; align-items:center; width: 100%;">
                            <div style="flex:1;">
                                <div style="font-weight:600; color:#8fd0ff;">${escapeHtml(res.name)}</div>
                                <div style="font-size:0.8rem; color:#96a4b9;">${res.os} | ${res.cpu}核 | ${res.memory}MB</div>
                            </div>
                            <button class="btn btn-danger" style="padding:2px 8px; font-size:0.75rem; min-width:unset;" onclick="deleteLabResource('${escapeHtml(res.name)}')">删除</button>
                        </div>
                    </div>
                `).join("");
            }
        }
    } catch (e) {
        console.error("updateLabPreview failed:", e);
    }
}

function deleteLabResource(name) {
    if (!confirm(`确定要删除资源 "${name}" 吗？这会直接修改手册中的定义。`)) return;

    try {
        const manualEl = document.getElementById("lab-manual");
        const content = manualEl.value;
        const manifest = parseLabManifest(content);

        let data = manifest.raw || {};
        if (data.resources && Array.isArray(data.resources)) {
            data.resources = data.resources.filter(r => r.name !== name);
        }

        const yamlStr = window.jsyaml.dump(data).trim();
        const bodyText = (manifest.body || "").trim();
        
        // 如果资源全部删空了且没有其他元数据，可以选择保留空的 --- 或者清理掉
        const newContent = `---\n${yamlStr}\n---\n\n${bodyText}`;
        manualEl.value = newContent;

        updateLabPreview();
    } catch (err) {
        console.error("Delete resource failed:", err);
        alert("删除资源失败: " + err.message);
    }
}

async function addLabResourcePrompt() {
    // 获取本机资源信息进行简单校验
    let hostRes = { totalMemMB: 8192, freeMemMB: 4096, cpus: 8 };
    try {
        if (window.api?.getHostResources) {
            hostRes = await window.api.getHostResources();
        }
    } catch(e) {}

    document.getElementById("lab-res-name").value = `server-${(parseLabManifest(document.getElementById("lab-manual").value).resources.length + 1).toString().padStart(2, '0')}`;
    document.getElementById("lab-res-cpu").max = hostRes.cpus || 16;
    document.getElementById("lab-res-memory").placeholder = `可用约 ${hostRes.freeMemMB} MB`;
    document.getElementById("lab-res-validation-msg").innerText = "";
    
    openModal("modal-lab-resource");
}

async function confirmAddLabResource() {
    try {
        const nameEl = document.getElementById("lab-res-name");
        const cpuEl = document.getElementById("lab-res-cpu");
        const memEl = document.getElementById("lab-res-memory");
        const validationMsgEl = document.getElementById("lab-res-validation-msg");

        const name = nameEl.value.trim();
        const os = document.getElementById("lab-res-os").value;
        const cpu = parseInt(cpuEl.value) || 0;
        const memory = parseInt(memEl.value) || 0;
        const reuse = document.getElementById("lab-res-reuse").checked;

        if (!name) {
            validationMsgEl.innerText = "请输入资源名称。";
            return;
        }
        if (cpu <= 0 || memory <= 0) {
            validationMsgEl.innerText = "CPU 和内存必须大于 0。";
            return;
        }

        // 基础合理性检测
        try {
            if (window.api?.getHostResources) {
                const hostRes = await window.api.getHostResources();

                // 1. CPU 校验
                if (cpu > hostRes.cpus) {
                    validationMsgEl.innerText = `禁止保存：CPU 核心数 (${cpu}) 超过了宿主机上限 (${hostRes.cpus})。`;
                    return;
                }

                // 2. 内存校验
                const memLimit = Math.floor(hostRes.totalMemMB * 0.9);
                if (memory > memLimit) {
                    validationMsgEl.innerText = `禁止保存：内存 (${memory}MB) 超过了安全限制 (${memLimit}MB)。`;
                    return;
                }
            }
        } catch(e) {
            console.warn("Host resource check failed:", e);
        }

        const manualEl = document.getElementById("lab-manual");
        if (!manualEl) throw new Error("找不到手册输入框 (lab-manual)");

        const content = manualEl.value;
        const manifest = parseLabManifest(content);

        let data = manifest.raw || {};
        if (!data || typeof data !== "object") data = {};
        if (!data.resources) data.resources = [];

        // 检查重名
        if (data.resources.some(r => r.name === name)) {
            validationMsgEl.innerText = "资源名称已存在，请换一个名称。";
            return;
        }

        data.resources.push({ name, os, cpu, memory, reuse });

        // 写回 Markdown
        if (!window.jsyaml || typeof window.jsyaml.dump !== "function") {
            throw new Error("YAML 解析器未就绪，请尝试刷新页面。");
        }

        const yamlStr = window.jsyaml.dump(data).trim();
        const bodyText = (manifest.body || "").trim();
        const newContent = `---\n${yamlStr}\n---\n\n${bodyText}`;

        manualEl.value = newContent;

        // 成功后才关闭
        updateLabPreview();
        closeModal("modal-lab-resource");

        // 清理提示
        validationMsgEl.innerText = "";
    } catch (err) {
        console.error("Save resource failed:", err);
        document.getElementById("lab-res-validation-msg").innerText = "报错: " + err.message;
    }
}

function openLabModal(labId = "") {
    if (!activeModuleId) return;
    editingLabId = labId;
    const lab = labId ? getLab(labId) : null;
    document.getElementById("lab-modal-title").innerText = lab ? "编辑实验" : "新增实验";
    document.getElementById("lab-title").value = lab?.title || "";
    const manualEl = document.getElementById("lab-manual");
    manualEl.value = lab?.manual || "";

    // 清除校验信息
    const validationMsgEl = document.getElementById("lab-modal-validation-msg");
    if (validationMsgEl) validationMsgEl.innerText = "";

    openModal("modal-lab");
    updateLabPreview();

    // 强制聚焦并确保可交互
    setTimeout(() => {
        manualEl.focus();
    }, 100);
}

async function saveLab() {
    try {
        const titleEl = document.getElementById("lab-title");
        const title = titleEl.value.trim();
        const validationMsgEl = document.getElementById("lab-modal-validation-msg");

        if (!title) {
            if (validationMsgEl) {
                validationMsgEl.innerText = "请输入实验标题。";
                titleEl.focus();
            } else {
                alert("请输入实验标题。");
            }
            return;
        }

        const labId = editingLabId || uid("lab");
        const prev = editingLabId ? getLab(editingLabId) : null;
        appData.labs[labId] = normalizeLab(labId, {
            courseId: activeCourseId,
            moduleId: activeModuleId,
            title,
            manual: document.getElementById("lab-manual").value,
            check: prev?.check || "",
            resourceProfileId: prev?.resourceProfileId || "",
            boundInstances: {},
            completed: prev?.completed || false,
            manualReadingState: prev?.manualReadingState || null,
            importMeta: prev?.importMeta || null
        });

        await sync();

        // 如果成功保存，清理并关闭
        if (validationMsgEl) validationMsgEl.innerText = "";
        closeModal("modal-lab");

        activeLabId = labId;
        workspaceView = "lab";
        renderApp();
    } catch (err) {
        console.error("Save lab failed:", err);
        const validationMsgEl = document.getElementById("lab-modal-validation-msg");
        if (validationMsgEl) {
            validationMsgEl.innerText = "保存失败: " + err.message;
        } else {
            alert("保存失败: " + err.message);
        }
    }
}
async function performSilentImport(imported) {
    if (!imported || !imported.data || !imported.data.length) return false;
    
    const specs = Array.isArray(imported.data) ? imported.data : [imported.data];
    const packageDir = imported.directoryPath || "";
    
    // 模拟导入预览上下文
    const context = { packageDir };
    let importedCount = 0;

    for (const spec of specs) {
        const item = validateLabSpec(spec, context, false);
        if (!item.valid) continue;

        const courseId = findOrCreateCourseByName(item.courseName, spec.course_icon || spec.a_icon || "📦", spec.course_description || "");
        const moduleId = findOrCreateModuleByName(courseId, item.moduleName, spec.module_description || spec.b_description || "");
        
        const profileRaw = extractResourceProfileFromSpec(spec, item.courseName, item.moduleName);
        let labProfileId = "";
        if (profileRaw) {
            const profileId = createOrReuseResourceProfile(profileRaw);
            if (!appData.modules[moduleId].defaultResourceProfileId) appData.modules[moduleId].defaultResourceProfileId = profileId;
            else if (appData.modules[moduleId].defaultResourceProfileId !== profileId) labProfileId = profileId;
        }

        const labId = item.duplicateLabId || uid("lab");
        // 自动重写资源路径
        const sourceManual = String(spec.manual || spec.guide || "");
        const manualBaseDir = String(spec.__manualBaseDir || packageDir).trim();
        const manualSourcePath = String(spec.__manualSourcePath || "").trim();
        
        let preparedManual = { manual: sourceManual, manualBaseDir, manualSourcePath };
        if (window.api?.stageImportedManualAssets) {
            try {
                const staged = await window.api.stageImportedManualAssets({
                    labId, manual: sourceManual, baseDir: manualBaseDir, sourcePath: manualSourcePath
                });
                if (staged?.ok) {
                    preparedManual.manual = staged.manual || sourceManual;
                    preparedManual.managedAssetDir = staged.managedAssetDir || "";
                }
            } catch (e) {}
        }

        appData.labs[labId] = normalizeLab(labId, {
            courseId,
            moduleId,
            title: item.title,
            manual: preparedManual.manual,
            check: spec.check || spec.verify || "",
            resourceProfileId: labProfileId,
            boundInstances: {},
            completed: false,
            importMeta: {
                source: "auto_import",
                importedAt: nowIso(),
                aLevel: item.courseName,
                bLevel: item.moduleName,
                sourceId: item.sourceId,
                packageDir,
                manualBaseDir: preparedManual.manualBaseDir,
                manualSourcePath: preparedManual.manualSourcePath,
                managedAssetDir: preparedManual.managedAssetDir || ""
            }
        });
        importedCount++;
    }
    
    if (importedCount > 0) {
        await sync();
        return true;
    }
    return false;
}

function validateLabSpec(spec, context, forceCurrentModule) {
    const title = spec.title || spec.name || "";
    const sourceId = spec.id || spec.uuid || spec.lab_id || `${spec.a_level || ""}::${spec.b_level || ""}::${title}`;
    const courseName = forceCurrentModule
        ? (getCourse(activeCourseId)?.name || "")
        : (spec.a_level || spec.aLevel || spec.course || spec.course_name || (context.courseId ? getCourse(context.courseId)?.name : ""));
    const moduleName = forceCurrentModule
        ? (getModule(activeModuleId)?.name || "")
        : (spec.b_level || spec.bLevel || spec.module || spec.module_name || (context.moduleId ? getModule(context.moduleId)?.name : ""));
    const errors = [];
    if (!title) errors.push("缺少 title");
    if (!courseName) errors.push("缺少 a_level");
    if (!moduleName) errors.push("缺少 b_level");
    const duplicate = Object.values(appData.labs).find(lab => lab.importMeta?.sourceId === sourceId);
    return { spec, valid: !errors.length, errors, title, sourceId, courseName, moduleName, duplicateLabId: duplicate?.id || "" };
}

function extractResourceProfileFromSpec(spec, courseName, moduleName) {
    const raw = spec.resource_profile || spec.resource || {};
    const providerType = normalizeProviderType(raw.providerType || raw.provider_type || raw.provider || raw.type || spec.provider_type || spec.resource_provider || spec.environment || spec.environment_type);
    if (!providerType) return null;
    return {
        name: raw.name || spec.resource_profile_name || defaultProfileName(courseName, moduleName, providerType),
        providerType,
        runnerType: mapProviderToRunner(providerType),
        summary: raw.summary || raw.requirement || raw.requirements || spec.resource_summary || defaultSummaryForProvider(providerType),
        reuseKey: raw.reuse_key || raw.key || spec.resource_reuse_key || `${slugify(courseName)}:${slugify(moduleName)}:${providerType}`,
        note: raw.note || raw.description || spec.resource_note || "",
        osName: raw.os_name || raw.osName || spec.os_name || "",
        ovaPath: raw.ova_path || raw.ovaPath || spec.ova_path || appData.settings.rockyOvaPath,
        vmCpu: raw.cpu || raw.vm_cpu || spec.cpu || 1,
        vmMemoryMB: raw.memory_mb || raw.memory || raw.vm_memory || spec.memory || spec.memory_mb || 1024,
        vmDiskGB: raw.disk_gb || raw.disk || raw.vm_disk || spec.disk || spec.disk_gb || 40,
        guestUsername: raw.username || raw.guest_username || spec.username || "root",
        guestPassword: raw.password || raw.guest_password || spec.password || "123",
        vmwareTemplate: raw.vmware_template || raw.template || spec.vmware_template || "",
        vmwareSnapshot: raw.vmware_snapshot || raw.snapshot || spec.vmware_snapshot || ""
    };
}

function findOrCreateCourseByName(name, icon = "📦", description = "") {
    const existing = Object.values(appData.courses).find(course => course.name === name);
    if (existing) {
        if (!existing.description && description) appData.courses[existing.id].description = description;
        if ((!existing.icon || existing.icon === "📦") && icon) appData.courses[existing.id].icon = icon;
        return existing.id;
    }
    const id = uid("course");
    appData.courses[id] = normalizeCourse(id, { name, icon, description });
    return id;
}

function findOrCreateModuleByName(courseId, name, description = "") {
    const existing = getModulesByCourse(courseId).find(module => module.name === name);
    if (existing) {
        if (!existing.description && description) appData.modules[existing.id].description = description;
        return existing.id;
    }
    const id = uid("module");
    appData.modules[id] = normalizeModule(id, { courseId, name, description, defaultResourceProfileId: "" });
    return id;
}

async function beginImportLabSpecs(context = {}) {
    const imported = await window.api.importLocal();
    if (!imported) return;
    const raw = imported && typeof imported === "object" && imported.data !== undefined ? imported.data : imported;
    const packageDir = imported && typeof imported === "object" ? (imported.directoryPath || imported.baseDir || "") : "";
    pendingImportPreview = {
        context: { ...context, packageDir },
        specs: Array.isArray(raw) ? raw : [raw],
        packageDir,
        fileCount: Number(imported?.fileCount || 0) || 0,
        warnings: Array.isArray(imported?.warnings) ? imported.warnings : []
    };
    document.getElementById("import-force-current-module").checked = false;
    document.getElementById("import-force-current-module").disabled = !activeModuleId;
    document.getElementById("import-duplicate-mode").value = "skip";
    renderImportPreview();
    openModal("modal-import-preview");
}

function renderImportPreview() {
    if (!pendingImportPreview) return;
    const forceCurrentModule = document.getElementById("import-force-current-module").checked && !!activeModuleId;
    const items = pendingImportPreview.specs.map(spec => validateLabSpec(spec, pendingImportPreview.context, forceCurrentModule));
    pendingImportPreview.items = items;
    const warningCount = Array.isArray(pendingImportPreview.warnings) ? pendingImportPreview.warnings.length : 0;
    const filePrefix = pendingImportPreview.fileCount ? `已扫描 ${pendingImportPreview.fileCount} 个 JSON 文件，` : "";
    const warningSuffix = warningCount ? ` 其中 ${warningCount} 个文件或条目读取失败。` : "";
    document.getElementById("import-preview-summary").innerText = `${filePrefix}共读取 ${items.length} 条实验，合法 ${items.filter(i => i.valid).length} 条，重复 ${items.filter(i => i.duplicateLabId).length} 条。${warningSuffix}`;
    document.getElementById("import-preview-list").innerHTML = items.map(item => `
        <div class="list-item">
            <div>
                <div class="list-title">${escapeHtml(item.title || "未命名实验")}</div>
                <div class="list-meta">${escapeHtml(item.courseName || "-")} / ${escapeHtml(item.moduleName || "-")}</div>
                <div class="list-meta">${item.valid ? "格式有效" : item.errors.join("，")}${item.duplicateLabId ? " · 已存在同源实验" : ""}</div>
                <div class="list-meta">${escapeHtml(item.spec?.__importSourceFile || "")}</div>
            </div>
            <div class="actions"><span class="badge ${item.valid ? "badge-green" : "badge-yellow"}">${item.valid ? "可导入" : "需修正"}</span></div>
        </div>
    `).join("");
}

async function prepareImportedManual(spec, labId) {
    const sourceManual = String(spec.manual || spec.guide || "");
    const manualBaseDir = String(spec.__manualBaseDir || pendingImportPreview?.packageDir || "").trim();
    const manualSourcePath = String(spec.__manualSourcePath || "").trim();
    if (!window.api?.stageImportedManualAssets) {
        return {
            manual: sourceManual,
            manualBaseDir,
            manualSourcePath,
            managedAssetDir: "",
            managedAssetCount: 0,
            assetWarnings: []
        };
    }

    try {
        const staged = await window.api.stageImportedManualAssets({
            labId,
            manual: sourceManual,
            baseDir: manualBaseDir,
            sourcePath: manualSourcePath
        });
        if (!staged?.ok) {
            return {
                manual: sourceManual,
                manualBaseDir,
                manualSourcePath,
                managedAssetDir: "",
                managedAssetCount: 0,
                assetWarnings: [staged?.error || "导入图片资源失败，已保留原始手册路径。"]
            };
        }
        return {
            manual: String(staged.manual || sourceManual),
            manualBaseDir,
            manualSourcePath,
            managedAssetDir: String(staged.managedAssetDir || "").trim(),
            managedAssetCount: Array.isArray(staged.copiedAssets) ? staged.copiedAssets.length : 0,
            assetWarnings: Array.isArray(staged.warnings) ? staged.warnings : []
        };
    } catch (error) {
        return {
            manual: sourceManual,
            manualBaseDir,
            manualSourcePath,
            managedAssetDir: "",
            managedAssetCount: 0,
            assetWarnings: [String(error?.message || error || "导入图片资源失败，已保留原始手册路径。")]
        };
    }
}

async function confirmImportPreview() {
    if (!pendingImportPreview) return;
    const duplicateMode = document.getElementById("import-duplicate-mode").value;
    const forceCurrentModule = document.getElementById("import-force-current-module").checked && !!activeModuleId;
    let importedCount = 0;
    let skippedCount = 0;
    const assetWarnings = [];

    for (const item of pendingImportPreview.items) {
        if (!item.valid) {
            skippedCount += 1;
            continue;
        }
        const spec = item.spec;
        const courseId = forceCurrentModule ? activeCourseId : findOrCreateCourseByName(item.courseName, spec.course_icon || spec.a_icon || "📦", spec.course_description || "");
        const moduleId = forceCurrentModule ? activeModuleId : findOrCreateModuleByName(courseId, item.moduleName, spec.module_description || spec.b_description || "");
        const profileRaw = extractResourceProfileFromSpec(spec, item.courseName, item.moduleName);
        let labProfileId = "";
        if (profileRaw) {
            const profileId = createOrReuseResourceProfile(profileRaw);
            if (!appData.modules[moduleId].defaultResourceProfileId) appData.modules[moduleId].defaultResourceProfileId = profileId;
            else if (appData.modules[moduleId].defaultResourceProfileId !== profileId) labProfileId = profileId;
        }

        let labId = item.duplicateLabId || uid("lab");
        if (item.duplicateLabId && duplicateMode === "skip") {
            skippedCount += 1;
            continue;
        }
        const preparedManual = await prepareImportedManual(spec, labId);
        if (preparedManual.assetWarnings.length) {
            assetWarnings.push(`${item.title}: ${preparedManual.assetWarnings.join("；")}`);
        }

        appData.labs[labId] = normalizeLab(labId, {
            courseId,
            moduleId,
            title: item.title,
            manual: preparedManual.manual,
            check: spec.check || spec.verify || "",
            resourceProfileId: labProfileId,
            boundInstances: {},
            completed: false,
            manualReadingState: null,
            importMeta: {
                source: "json",
                importedAt: nowIso(),
                aLevel: item.courseName,
                bLevel: item.moduleName,
                sourceId: item.sourceId,
                packageDir: pendingImportPreview?.packageDir || "",
                manualFile: String(spec.manual_file || spec.manualPath || spec.manual_path || "").trim(),
                manualBaseDir: preparedManual.manualBaseDir,
                manualSourcePath: preparedManual.manualSourcePath,
                managedAssetDir: preparedManual.managedAssetDir,
                managedAssetCount: preparedManual.managedAssetCount
            }
        });
        importedCount += 1;
    }

    await sync();
    closeModal("modal-import-preview");
    const importWarnings = Array.isArray(pendingImportPreview?.warnings) ? pendingImportPreview.warnings : [];
    pendingImportPreview = null;
    renderApp();
    const warningText = assetWarnings.length
        ? `\n其中 ${assetWarnings.length} 个实验的图片未能全部托管，已保留原路径：\n${assetWarnings.slice(0, 5).join("\n")}${assetWarnings.length > 5 ? "\n..." : ""}`
        : "";
    const importWarningText = importWarnings.length
        ? `\n另外有 ${importWarnings.length} 个文件或条目读取失败：\n${importWarnings.slice(0, 5).join("\n")}${importWarnings.length > 5 ? "\n..." : ""}`
        : "";
    alert(`导入完成：成功 ${importedCount} 个，跳过 ${skippedCount} 个。${warningText}${importWarningText}`);
}

function openBindSshModal() {
    const profile = getEffectiveProfileForLab(getActiveLab());
    if (!profile || profile.providerType !== "manual_ssh") return alert("当前实验的资源画像不是手动 SSH 服务器。");
    document.getElementById("bind-ssh-label").value = "";
    document.getElementById("bind-ssh-host").value = "";
    document.getElementById("bind-ssh-username").value = "root";
    document.getElementById("bind-ssh-password").value = "";
    document.getElementById("bind-ssh-reusable").checked = true;
    openModal("modal-bind-ssh");
}

async function preheatModuleResource() {
    const profile = getModuleDefaultProfile(activeModuleId);
    if (!profile) return alert("当前目录还没有默认资源画像。");
    if (profile.providerType === "manual_ssh") return alert("手动 SSH 资源不支持预热，请在具体实验中绑定服务器。");
    const existing = findCompatibleInstances(profile).filter(instance => instance.reusable);
    if (existing.length) return alert("当前目录已有可复用资源实例，无需再次预热。");

    const statusKey = getStatusKey(profile);
    resourceStatusMap[statusKey] = { statusKey, state: "provisioning", progressPercent: 1, title: profile.name, message: "正在预热目录资源..." };
    renderApp();

    const instanceId = uid("resource");
    const result = await window.api.initializeResource({
        instanceId,
        profileId: profile.id,
        profile,
        settings: appData.settings,
        statusKey,
        context: {
            courseName: getCourse(activeCourseId)?.name || "",
            moduleName: getModule(activeModuleId)?.name || "",
            labTitle: getModule(activeModuleId)?.name || "目录预热"
        }
    });

    if (!result?.ok) {
        resourceStatusMap[statusKey] = { statusKey, state: "failed", progressPercent: 0, title: profile.name, message: result?.error || "目录资源预热失败" };
        renderApp();
        return;
    }

    appData.resourceInstances[instanceId] = normalizeResourceInstance(instanceId, {
        ...result.instance,
        reusable: profile.reuseEnabled !== false
    });
    await sync();
    renderApp();
}

function requestDeleteResourceInstance(instanceId) {
    const instance = getResourceInstance(instanceId);
    if (!instance) return;
    const usageCount = getLabsUsingResourceInstance(instanceId).length;
    const usageNote = usageCount ? `\n当前有 ${usageCount} 个实验正在引用这个资源，删除后会自动解绑。` : "";
    requestDelete("删除资源实例", `请输入 delete 确认删除资源实例“${instance.label}”。${usageNote}`, async () => {
        const res = await window.api.deleteResourceInstance({
            instanceId,
            instance,
            profile: instance.profileId ? getResourceProfile(instance.profileId) : null,
            settings: appData.settings
        });
        if (!res?.ok) {
            alert(res?.error || "删除资源实例失败。");
            return;
        }
        Object.values(appData.labs).forEach((lab) => {
            Object.keys(lab.boundInstances || {}).forEach((resourceName) => {
                if (lab.boundInstances[resourceName] === instanceId) {
                    delete lab.boundInstances[resourceName];
                }
            });
        });
        delete appData.resourceInstances[instanceId];
        await sync();
        renderApp();
        if (res?.msg) alert(res.msg);
    });
}

function requestDeleteOrphanResourceGroup(instanceIdsRaw = "") {
    const instanceIds = String(instanceIdsRaw || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item, index, list) => list.indexOf(item) === index);
    if (!instanceIds.length) return;

    requestDelete("删除残留环境", `请输入 delete 确认删除这 ${instanceIds.length} 个未关联实验的残留资源实例。`, async () => {
        for (const instanceId of instanceIds) {
            const instance = getResourceInstance(instanceId);
            if (!instance) continue;
            const res = await window.api.deleteResourceInstance({
                instanceId,
                instance,
                profile: instance.profileId ? getResourceProfile(instance.profileId) : null,
                settings: appData.settings,
                destroyVmFiles: true
            });
            if (!res?.ok) {
                alert(res?.error || `删除资源实例 ${instance.label} 失败。`);
                return;
            }
            delete appData.resourceInstances[instanceId];
            delete resourceVmRuntimeMap[instanceId];
        }
        await sync();
        renderApp();
    });
}

function requestDelete(title, message, onConfirm) {
    pendingDeleteAction = onConfirm;
    document.getElementById("delete-modal-title").innerText = title;
    document.getElementById("delete-modal-message").innerText = message;
    document.getElementById("delete-confirm-input").value = "";
    openModal("modal-delete");
}

async function confirmDeleteAction() {
    if (document.getElementById("delete-confirm-input").value.trim() !== "delete") {
        alert("请输入 delete 后再确认删除。");
        return;
    }

    const action = pendingDeleteAction;
    closeModal("modal-delete");
    if (action) await action();
}

function requestDeleteCourse(courseId) {
    if (getModulesByCourse(courseId).length) {
        alert("课程下还有目录，不能直接删除。请先清空目录。");
        return;
    }

    const course = getCourse(courseId);
    if (!course) return;

    requestDelete("删除课程", `请输入 delete 确认删除课程“${course.name}”。`, async () => {
        delete appData.courses[courseId];
        if (activeCourseId === courseId) {
            activeCourseId = "";
            activeModuleId = "";
            activeLabId = "";
            workspaceView = "home";
        }
        await sync();
        renderApp();
    });
}

function requestDeleteModule(moduleId) {
    if (getLabsByModule(moduleId).length) {
        alert("目录下还有实验，不能直接删除。请先清空实验。");
        return;
    }

    const module = getModule(moduleId);
    if (!module) return;

    requestDelete("删除目录", `请输入 delete 确认删除目录“${module.name}”。`, async () => {
        delete appData.modules[moduleId];
        if (activeModuleId === moduleId) {
            activeModuleId = "";
            activeLabId = "";
            workspaceView = "course";
        }
        await sync();
        renderApp();
    });
}

function requestDeleteLab(labId) {
    const lab = getLab(labId);
    if (!lab) return;

    const boundInstances = Object.values(getBoundInstancesForLab(lab)).filter((instance, index, list) => instance && list.findIndex((item) => item.id === instance.id) === index);
    const boundResourceCount = boundInstances.length;
    const sharedResourceCount = boundInstances.filter((instance) => getLabsUsingResourceInstance(instance.id).length > 1).length;
    const usageNote = boundResourceCount
        ? `\n该实验当前绑定了 ${boundResourceCount} 个资源实例，删除实验时会${sharedResourceCount ? "保留共享实例并解除当前绑定，其余独占环境会一并删除" : "一并删除对应环境"}。`
        : "";

    requestDelete("删除实验", `请输入 delete 确认删除实验“${lab.title}”。${usageNote}`, async () => {
        let deletedCount = 0;
        let keptSharedCount = 0;
        for (const instance of boundInstances) {
            if (getLabsUsingResourceInstance(instance.id).length > 1) {
                keptSharedCount += 1;
                continue;
            }
            const res = await window.api.deleteResourceInstance({
                instanceId: instance.id,
                instance,
                profile: instance.profileId ? getResourceProfile(instance.profileId) : null,
                settings: appData.settings,
                destroyVmFiles: true
            });
            if (!res?.ok) {
                alert(res?.error || `删除资源实例 ${instance.label} 失败。`);
                return;
            }
            dropResourceInstanceFromState(instance.id);
            deletedCount += 1;
        }

        clearBoundInstancesForLab(appData.labs[labId]);
        delete appData.labs[labId];
        if (activeLabId === labId) {
            activeLabId = "";
            workspaceView = "module";
        }
        await sync();
        renderApp();
        if (window.syncLabLifecycle) window.syncLabLifecycle();
        if (typeof showToast === "function" && (deletedCount || keptSharedCount)) {
            const detail = [
                deletedCount ? `${deletedCount} 个独占环境已删除` : "",
                keptSharedCount ? `${keptSharedCount} 个共享环境已保留，仅解除当前实验绑定` : ""
            ].filter(Boolean).join("，");
            showToast("实验已删除", detail, "success");
        }
    });
}

async function pickVmwareInstallDir() {
    if (!window.api?.chooseDirectory) return;
    const input = document.getElementById("settings-vmware-install-dir");
    if (!input) return;
    const selected = await window.api.chooseDirectory({
        title: "选择 VMware 安装目录",
        defaultPath: input.value.trim()
    });
    if (selected) input.value = selected;
}

async function pickRockyOvaFile() {
    if (!window.api?.chooseFile) return;
    const input = document.getElementById("settings-rocky-ova");
    if (!input) return;
    const selected = await window.api.chooseFile({
        title: "选择 RockyBase OVA 文件",
        defaultPath: input.value.trim(),
        filters: [{ name: "OVA Files", extensions: ["ova"] }]
    });
    if (selected) input.value = selected;
}

async function saveSettings() {
    const vmwareInstallDir = document.getElementById("settings-vmware-install-dir").value.trim();
    const rockyOvaPath = document.getElementById("settings-rocky-ova").value.trim();

    if (!vmwareInstallDir) {
        alert("请先选择 VMware 安装目录。");
        return;
    }
    if (!rockyOvaPath) {
        alert("请先选择 RockyBase.ova 文件。");
        return;
    }

    const resourceAliases = { RockyBase: rockyOvaPath };
    appData.settings = normalizeSettings({
        ...appData.settings,
        vmwareInstallDir,
        vmwareExePath: `${vmwareInstallDir}\\vmware.exe`,
        vmrunPath: `${vmwareInstallDir}\\vmrun.exe`,
        vdiskPath: `${vmwareInstallDir}\\vmware-vdiskmanager.exe`,
        ovftoolPath: `${vmwareInstallDir}\\OVFTool\\ovftool.exe`,
        rockyOvaPath,
        labRootDir: document.getElementById("settings-lab-root").value.trim(),
        vmSuspendSeconds: Number(document.getElementById("settings-vm-suspend-seconds").value || 300) || 300,
        manualFontScale: Number(document.getElementById("settings-manual-font-scale").value || 1) || 1,
        sshTerminalFontSize: Number(document.getElementById("settings-ssh-font-size").value || 14) || 14,
        manageExternalVms: document.getElementById("settings-manage-external-vms").checked,
        resourceAliases
    });

    manualFontScale = appData.settings.manualFontScale || 1;
    if (typeof applyManualFontScale === "function") applyManualFontScale();
    if (typeof applyTerminalFontSize === "function") applyTerminalFontSize(appData.settings.sshTerminalFontSize || 14);
    labRuntimeDefinitionCache.clear();
    autoProvisionPausedLabs.clear();
    autoInitRequestedLabs.clear();
    autoPrepareRequestedLabs.clear();
    Object.keys(resourceStatusMap).forEach((key) => {
        if (resourceStatusMap[key]?.state === "failed") {
            delete resourceStatusMap[key];
        }
    });
    await sync();
    renderApp();

    if (typeof showToast === "function") {
        showToast("设置已保存", "VMware 与 RockyBase 路径已更新。", "success");
    } else {
        alert("设置已保存。");
    }
}


async function loadVmManagerData() {
    vmManagerState.loading = true;
    vmManagerState.error = "";
    renderApp();
    try {
        if (typeof cleanupMissingVmResourceInstances === "function" && await cleanupMissingVmResourceInstances()) {
            await sync();
        }
        const vms = await window.api.getVMs();
        const enriched = await Promise.all((vms || []).map(async (vm) => {
            let running = false;
            let ip = "";
            try { running = await window.api.getVMStatus(vm.path); } catch {}
            if (running) {
                try { ip = await window.api.getVMIP(vm.path); } catch {}
            }
            return { ...vm, running, ip };
        }));
        vmManagerState.vms = enriched;
        vmManagerState.loaded = true;
    } catch (error) {
        vmManagerState.error = error.message || "读取 VMware 列表失败。";
    } finally {
        vmManagerState.loading = false;
        renderApp();
    }
}

var pendingVmPromptResolver = null;

function openVmTextPrompt(title, description, defaultValue, inputType = "text") {
    document.getElementById("vm-input-title").innerText = title;
    document.getElementById("vm-input-desc").innerText = description;
    const input = document.getElementById("vm-input-value");
    input.type = inputType || "text";
    input.value = defaultValue || "";
    openModal("modal-vm-input");
    setTimeout(() => {
        input.focus();
        input.select();
    }, 0);
    return new Promise((resolve) => {
        pendingVmPromptResolver = resolve;
    });
}

function confirmVmTextPrompt() {
    const resolver = pendingVmPromptResolver;
    pendingVmPromptResolver = null;
    const input = document.getElementById("vm-input-value");
    const value = input.value;
    input.type = "text";
    closeModal("modal-vm-input");
    if (resolver) resolver(value);
}

function cancelVmTextPrompt() {
    const resolver = pendingVmPromptResolver;
    pendingVmPromptResolver = null;
    document.getElementById("vm-input-value").type = "text";
    closeModal("modal-vm-input");
    if (resolver) resolver(null);
}

async function createVmFromOvaPrompt() {
    const exists = (vmManagerState.vms || []).some(vm => String(vm.name || "").toLowerCase() === "rockybase");
    let replaceExisting = false;
    if (exists) {
        replaceExisting = confirm("RockyBase 模板机已存在，是否重建它？这会删除旧模板目录并重新从 OVA 导入。");
        if (!replaceExisting) return;
    }

    const res = await window.api.createVmFromOva({ name: "RockyBase", replaceExisting });
    if (!res?.success) {
        alert(res?.msg || "从 OVA 创建虚拟机失败。");
        return;
    }
    alert(replaceExisting ? "RockyBase 模板机已重建。" : "RockyBase 模板机已导入。");
    if (res?.msg) alert(res.msg);
    await loadVmManagerData();
}

async function runVmAction(action, vmxPath) {
    const res = await window.api.vmCommand({ action, vmxPath });
    if (!res?.success) {
        alert(res?.msg || "VM 操作失败。");
        return;
    }
    if (action === "start") alert("虚拟机已启动。");
    if (action === "stop") alert("虚拟机已关机。");
    if (action === "reset") alert("虚拟机已重启。");
    await loadVmManagerData();
}

async function runVmActionByIndex(action, index) {
    const vm = (vmManagerState.vms || [])[index];
    if (!vm) return;
    return runVmAction(action, vm.path);
}

async function cloneVmPrompt(vmxPath) {
    const name = await openVmTextPrompt("链接克隆", "请输入克隆后的虚拟机名称。", "RockyBase_LinkedClone");
    if (!name) return;
    const res = await window.api.vmCommand({ action: "clone", vmxPath, extra: name.trim() });
    if (!res?.success) {
        alert(res?.msg || "链接克隆失败。");
        return;
    }
    alert("链接克隆已创建。");
    await loadVmManagerData();
}

async function cloneVmPromptByIndex(index) {
    const vm = (vmManagerState.vms || [])[index];
    if (!vm) return;
    return cloneVmPrompt(vm.path);
}

async function snapshotVmPrompt(vmxPath) {
    const name = await openVmTextPrompt("创建快照", "请输入快照名称。", "Snapshot_" + Date.now());
    if (!name) return;
    const res = await window.api.vmCommand({ action: "snapshot", vmxPath, extra: name.trim() });
    if (!res?.success) {
        alert(res?.msg || "创建快照失败。");
        return;
    }
    alert("快照创建成功。");
    await loadVmManagerData();
}

async function snapshotVmPromptByIndex(index) {
    const vm = (vmManagerState.vms || [])[index];
    if (!vm) return;
    return snapshotVmPrompt(vm.path);
}

async function openVmFolder(vmxPath) {
    const pathParts = String(vmxPath || "").split(/[\\/]/);
    pathParts.pop();
    const dir = pathParts.join("\\");
    const res = await window.api.openPath(dir);
    if (res) alert("打开目录失败：" + res);
}

async function openVmFolderByIndex(index) {
    const vm = (vmManagerState.vms || [])[index];
    if (!vm) return;
    return openVmFolder(vm.path);
}

async function deleteVmPrompt(vmxPath) {
    const ok = confirm("确认删除这台虚拟机及其磁盘文件吗？");
    if (!ok) return;
    const res = await window.api.vmCommand({ action: "deleteVM", vmxPath });
    if (!res?.success) {
        alert(res?.msg || "删除虚拟机失败。");
        return;
    }
    await loadVmManagerData();
}

async function deleteVmPromptByIndex(index) {
    const vm = (vmManagerState.vms || [])[index];
    if (!vm) return;
    return deleteVmPrompt(vm.path);
}

var vmWakePromises = new Map();

async function ensureVmResourcePowered(resourceName = "", silent = false) {
    const lab = getActiveLab();
    const targetResource = resolveBaseResourceName(resourceName || terminalUiState.activeTabKey || getPrimaryResourceNameForLab(lab));
    const instance = getBoundInstanceForLab(lab, targetResource);
    if (!lab || !instance || instance.providerType !== "vmware_vm" || !instance.vmxPath) return instance;

    const wakeKey = `${lab.id}:${targetResource}`;
    if (vmWakePromises.has(wakeKey)) return vmWakePromises.get(wakeKey);

    vmWakingResources.add(wakeKey);

    const task = (async () => {
        let powerState = await window.api.getVMPowerState(instance.vmxPath);
        if (powerState === "stopped" || powerState === "suspended") {
            if (!silent && typeof showToast === "function") {
                showToast("唤醒环境", `正在恢复 ${targetResource} 虚拟机...`);
            }

            const startRes = await window.api.vmCommand({ action: "start", vmxPath: instance.vmxPath });
            if (!startRes?.success && !/already running/i.test(String(startRes?.msg || ""))) {
                throw new Error(startRes?.msg || `无法启动 ${targetResource}`);
            }
        }

        const deadline = Date.now() + 1000 * 60 * 2;
        let ip = instance.connection?.host || "";
        while (Date.now() < deadline) {
            powerState = await window.api.getVMPowerState(instance.vmxPath);
            if (powerState === "running") {
                ip = await window.api.getVMIP(instance.vmxPath) || ip;
                if (ip) break;
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        resourceVmRuntimeMap[instance.id] = {
            powerState,
            ip: ip || instance.connection?.host || ""
        };

        if (ip && appData.resourceInstances[instance.id]) {
            appData.resourceInstances[instance.id].connection.host = ip;
            await sync();
        }

        vmWakingResources.delete(wakeKey);
        renderApp();

        if (typeof window.reconnectResource === "function") {
            const session = ensureTerminalSession(getTerminalSessionKey(lab, targetResource));
            if (!session.connected && session.status !== "connecting") {
                window.reconnectResource(targetResource, true);
            }
        }

        return getBoundInstanceForLab(lab, targetResource) || instance;
    })();

    vmWakePromises.set(wakeKey, task);
    try {
        return await task;
    } finally {
        vmWakePromises.delete(wakeKey);
    }
}

async function connectBoundResource(resourceName = "", silent = false) {
    const lab = getActiveLab();
    const targetResource = resolveBaseResourceName(resourceName || terminalUiState.activeTabKey || getPrimaryResourceNameForLab(lab));
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

    const session = ensureTerminalSession(getTerminalSessionKey(lab, targetResource));
    if (silent && (session.status === "connecting" || session.status === "connected" || !!session.buffer)) return true;
    session.status = "connecting";
    session.connected = false;
    if (resolveBaseResourceName(terminalUiState.activeTabKey) === targetResource) syncSshStatusLabel();

    window.api.sendConnect({
        sessionKey: getTerminalSessionKey(lab, targetResource),
        host: latestHost,
        username: instance.connection?.username || "root",
        password: instance.connection?.password || "",
        cols: window.term?.cols || 120,
        rows: window.term?.rows || 32
    });
    return true;
}

async function initializeResourceForActiveLab() {
    const lab = getActiveLab();
    const runtime = getLabRuntimeDefinition(lab);
    const resourceName = resolveBaseResourceName(terminalUiState.activeTabKey || getPrimaryResourceNameForLab(lab));
    const profile = getProfileForResource(lab, resourceName);
    if (!lab || !profile) return alert("当前实验还没有可初始化的资源画像。");
    if (profile.providerType === "manual_ssh") return openBindSshModal();

    const compatibleInstance = typeof pickCompatibleInstance === "function"
        ? pickCompatibleInstance(profile)
        : (findCompatibleInstances(profile)[0] || null);
    if (compatibleInstance) {
        setBoundInstanceForLab(appData.labs[lab.id], resourceName, compatibleInstance.id);
        if (appData.resourceInstances[compatibleInstance.id]) {
            appData.resourceInstances[compatibleInstance.id].lastUsedAt = nowIso();
        }
        if (compatibleInstance.providerType === "vmware_vm" && typeof refreshVmResourceConnection === "function") {
            try {
                await refreshVmResourceConnection(compatibleInstance, { persist: false });
            } catch {}
        }
        await sync();
        renderApp();
        if (window.syncLabLifecycle) window.syncLabLifecycle();
        delete manualMaterialUiState[getManualMaterialStateKey(lab, resourceName)];
        renderApp();
        if (compatibleInstance.runnerType === "ssh") {
            await connectBoundResource(resourceName, true);
        } else if (compatibleInstance.runnerType !== "ssh") {
            window.api.initLocalShell();
        }
        if (typeof showToast === "function") {
            showToast("复用环境", `已复用当前目录的 ${resourceName} 资源。`, "success");
        }
        return;
    }

    const instanceId = uid("resource");
    const statusKey = getStatusKey(profile);
    resourceStatusMap[statusKey] = { statusKey, state: "provisioning", progressPercent: 1, title: profile.name, message: "正在开始初始化环境..." };
    renderApp();

    const result = await window.api.initializeResource({
        instanceId,
        profileId: profile.id,
        profile,
        setupScript: getSetupScriptForResource(lab, resourceName),
        settings: appData.settings,
        statusKey,
        context: {
            courseName: getCourse(lab.courseId)?.name || "",
            moduleName: getModule(lab.moduleId)?.name || "",
            labTitle: lab.title,
            labId: lab.id,
            resourceName,
            packageDir: lab?.importMeta?.packageDir || ""
        }
    });

    if (!result?.ok) {
        resourceStatusMap[statusKey] = { statusKey, state: "failed", progressPercent: 0, title: profile.name, message: result?.error || "初始化环境失败" };
        autoProvisionPausedLabs.add(lab.id);
        renderApp();
        if ((result?.error || "").includes("not found")) {
            alert("未找到 VMware 程序或 RockyBase OVA，请到设置页检查路径。");
        }
        return;
    }

    appData.resourceInstances[instanceId] = normalizeResourceInstance(instanceId, {
        ...result.instance,
        reusable: profile.reuseEnabled !== false
    });
    setBoundInstanceForLab(appData.labs[lab.id], resourceName, instanceId);
    resourceVmRuntimeMap[instanceId] = {
        powerState: "running",
        ip: result.instance.connection?.host || ""
    };
    delete manualMaterialUiState[getManualMaterialStateKey(lab, resourceName)];
    await sync();
    renderApp();
    if (window.syncLabLifecycle) window.syncLabLifecycle();
    if (result.instance.runnerType === "ssh" && result.instance.connection?.host) {
        connectBoundResource(resourceName, true);
    }
}

async function resetEnvironmentForActiveLab() {
    const lab = getActiveLab();
    if (!lab) return;

    const resourceNames = getAllResourceNamesForLab(lab);
    const resettableResources = resourceNames.filter((resourceName) => {
        const profile = getProfileForResource(lab, resourceName);
        return profile?.providerType === "vmware_vm";
    });

    if (!resettableResources.length) {
        alert("当前实验没有可重置的 VMware 环境。");
        return;
    }

    const confirmed = confirm("环境重置会恢复所有实验资源到预置步骤执行完成后的快照，并清空当前实验的检查进度。确认继续吗？");
    if (!confirmed) return;

    const previousTabKey = resolveBaseResourceName(terminalUiState.activeTabKey || resettableResources[0]);
    setWorkspaceBatchProgress({ active: true, total: resettableResources.length, current: 0, message: "正在重置实验环境...", resourceName: "" });
    renderApp();

    try {
        for (let index = 0; index < resettableResources.length; index += 1) {
            const resourceName = resettableResources[index];
            terminalUiState.activeTabKey = resourceName;
            const profile = getProfileForResource(lab, resourceName);
            let instance = getBoundInstanceForLab(lab, resourceName);

            setWorkspaceBatchProgress({
                active: true,
                total: resettableResources.length,
                current: index,
                message: `正在重置实验环境 (${index + 1}/${resettableResources.length})：${resourceName}`,
                resourceName
            });
            renderApp();

            if (!instance) {
                await initializeResourceForActiveLab();
                instance = getBoundInstanceForLab(lab, resourceName);
                if (!instance) throw new Error(`无法初始化 ${resourceName}`);
            } else {
                const statusKey = getStatusKey(profile);
                resourceStatusMap[statusKey] = { statusKey, state: "provisioning", progressPercent: 1, title: profile.name, message: "正在重置实验环境..." };
                renderApp();

                const result = await window.api.resetResourceEnvironment({
                    instanceId: instance.id,
                    instance,
                    profile,
                    setupScript: getSetupScriptForResource(lab, resourceName),
                    settings: appData.settings,
                    statusKey,
                    context: {
                        courseName: getCourse(lab.courseId)?.name || "",
                        moduleName: getModule(lab.moduleId)?.name || "",
                        labTitle: lab.title,
                        labId: lab.id,
                        resourceName,
                        packageDir: lab?.importMeta?.packageDir || ""
                    }
                });

                if (!result?.ok) {
                    resourceStatusMap[statusKey] = { statusKey, state: "failed", progressPercent: 0, title: profile.name, message: result?.error || "环境重置失败" };
                    renderApp();
                    throw new Error(result?.error || `${resourceName} 环境重置失败。`);
                }

                appData.resourceInstances[instance.id] = normalizeResourceInstance(instance.id, {
                    ...result.instance,
                    reusable: profile.reuseEnabled !== false
                });
                appData.resourceInstances[instance.id].status = "ready";
                resourceVmRuntimeMap[instance.id] = {
                    powerState: "running",
                    ip: result.instance.connection?.host || ""
                };
            }
            delete manualMaterialUiState[getManualMaterialStateKey(lab, resourceName)];

            setWorkspaceBatchProgress({
                active: true,
                total: resettableResources.length,
                current: index + 1,
                message: `正在重置实验环境 (${index + 1}/${resettableResources.length})：${resourceName} 已恢复`,
                resourceName
            });
            renderApp();
        }

        resetLabExecutionState(appData.labs[lab.id]);
        resetLabTerminalState(appData.labs[lab.id]);
        clearManualMaterialStateForLab(appData.labs[lab.id]);
        clearLabManualReadingState(appData.labs[lab.id]);
        await sync();
        renderApp();
        if (window.syncLabLifecycle) window.syncLabLifecycle();

        resettableResources.forEach((resourceName) => {
            const bound = getBoundInstanceForLab(lab, resourceName);
            if (bound?.runnerType === "ssh" && bound.connection?.host) {
                connectBoundResource(resourceName, true);
            }
        });
    } catch (error) {
        const rawMessage = String(error?.message || "");
        const displayMessage = /All configured authentication methods failed|Permission denied|authentication failed|User authentication failure/i.test(rawMessage)
            ? "环境已恢复，但当前保存的 SSH 密码与快照中的密码不一致。请点击“连接资源”并输入快照恢复后的正确密码。"
            : (rawMessage || "环境重置失败。");
        alert(displayMessage);
    }  finally {
        terminalUiState.activeTabKey = previousTabKey;
        setWorkspaceBatchProgress({ active: false, total: 0, current: 0, message: "", resourceName: "" });
        renderApp();
        
        // 核心修复：在 UI 渲染完成后，执行“唤醒”逻辑
        setTimeout(() => {
            // 1. 尝试静默重连（静默模式下如果已连接则不会报错）
            if (typeof window.reconnectResource === "function") {
                window.reconnectResource(terminalUiState.activeTabKey, true);
            }
            // 2. 强行索要焦点
            if (typeof window.requestTerminalFocus === "function") {
                window.requestTerminalFocus(200, 3);
            }
        }, 600); // 延迟 600ms 等待遮罩层动画彻底结束
    }
}

async function leaveActiveLab() {
    const lab = getActiveLab();
    if (!lab) return;

    if (typeof hideManualRestoreBanner === "function") hideManualRestoreBanner();

    const activeInstances = Object.values(getBoundInstancesForLab(lab));
    if (activeInstances.length && window.api?.leaveLabNow) {
        const result = await window.api.leaveLabNow({
            activeLabId: lab.id,
            activeInstances,
            settings: appData.settings
        });
        if (!result?.ok) {
            alert(result?.error || "离开实验时挂起环境失败。");
            return;
        }
    }

    if (typeof showToast === "function" && activeInstances.some((instance) => instance?.providerType === "vmware_vm")) {
        showToast("已离开实验", "实验环境已立即挂起。", "success");
    }

    navigateTo("module", lab.moduleId);
}

async function prepareAllResourcesForActiveLab() {
    const lab = getActiveLab();
    const resourceNames = getAllResourceNamesForLab(lab);
    if (!lab || !resourceNames.length) return;

    const batchKey = `${lab.id}:all`;
    const previousTabKey = resolveBaseResourceName(terminalUiState.activeTabKey || resourceNames[0]);
    setWorkspaceBatchProgress({ active: true, total: resourceNames.length, current: 0, message: "正在准备实验环境...", resourceName: "" });
    renderApp();

    try {
        for (let index = 0; index < resourceNames.length; index += 1) {
            const resourceName = resourceNames[index];
            terminalUiState.activeTabKey = resourceName;
            setWorkspaceBatchProgress({
                active: true,
                total: resourceNames.length,
                current: index,
                message: `正在准备实验环境 (${index + 1}/${resourceNames.length})：${resourceName} 启动中...`,
                resourceName
            });
            renderApp();

            const instance = getBoundInstanceForLab(lab, resourceName);
            if (!instance) {
                await initializeResourceForActiveLab();
            } else {
                if (instance.providerType === "vmware_vm" && instance.vmxPath) {
                    const powerState = await window.api.getVMPowerState(instance.vmxPath);
                    if (powerState === "stopped" || powerState === "suspended") {
                        const startRes = await window.api.vmCommand({ action: "start", vmxPath: instance.vmxPath });
                        if (!startRes?.success) throw new Error(startRes?.msg || `无法启动 ${resourceName}`);
                    }
                }
                if (instance.runnerType === "ssh" && instance.connection?.host) {
                    connectBoundResource(resourceName, true);
                }
            }

            setWorkspaceBatchProgress({
                active: true,
                total: resourceNames.length,
                current: index + 1,
                message: `正在准备实验环境 (${index + 1}/${resourceNames.length})：${resourceName} 已就绪。`,
                resourceName
            });
            renderApp();
        }
    } finally {
        autoPrepareRequestedLabs.delete(batchKey);
        terminalUiState.activeTabKey = previousTabKey;
        setWorkspaceBatchProgress({ active: false, total: 0, current: 0, message: "", resourceName: "" });
        renderApp();
    }
}

async function releaseLabResource() {
    const lab = getActiveLab();
    if (!lab) return;

    const boundEntries = Object.entries(getBoundInstancesForLab(lab)).filter(([, instance]) => Boolean(instance));
    const uniqueInstances = boundEntries
        .map(([, instance]) => instance)
        .filter((instance, index, list) => instance && list.findIndex((item) => item.id === instance.id) === index);
    if (uniqueInstances.length) {
        const sharedCount = uniqueInstances.filter((instance) => getLabsUsingResourceInstance(instance.id).length > 1).length;
        const disposableCount = boundEntries.filter(([resourceName, instance]) => {
            const profile = getProfileForResource(lab, resourceName);
            return getLabsUsingResourceInstance(instance.id).length <= 1 && profile?.reuseEnabled === false;
        }).length;
        const reusableCount = uniqueInstances.length - sharedCount - disposableCount;
        const actionSummary = [
            disposableCount ? `${disposableCount} 个独占实例会被删除` : "",
            reusableCount ? `${reusableCount} 个可复用实例只会解除绑定` : "",
            sharedCount ? `${sharedCount} 个共享实例只会解除当前实验绑定` : ""
        ].filter(Boolean).join("，");
        const confirmed = confirm(`将释放当前实验的 ${uniqueInstances.length} 个资源实例。${actionSummary || "本次停留不会自动重新创建。"}确认继续吗？`);
        if (!confirmed) return;
    }

    let deletedCount = 0;
    let unboundReusableCount = 0;
    let unboundSharedCount = 0;
    for (const [resourceName, instance] of boundEntries) {
        const usageCount = getLabsUsingResourceInstance(instance.id).length;
        if (usageCount > 1) {
            unboundSharedCount += 1;
            continue;
        }
        const profile = getProfileForResource(lab, resourceName);
        if (profile?.reuseEnabled !== false) {
            if (appData.resourceInstances[instance.id]) {
                appData.resourceInstances[instance.id].lastUsedAt = nowIso();
            }
            unboundReusableCount += 1;
            continue;
        }
        const res = await window.api.deleteResourceInstance({
            instanceId: instance.id,
            instance,
            profile: instance.profileId ? getResourceProfile(instance.profileId) : null,
            settings: appData.settings,
            destroyVmFiles: true
        });
        if (!res?.ok) {
            alert(res?.error || `删除资源实例 ${instance.label} 失败。`);
            return;
        }
        delete appData.resourceInstances[instance.id];
        delete resourceVmRuntimeMap[instance.id];
        deletedCount += 1;
    }

    clearBoundInstancesForLab(appData.labs[lab.id]);
    clearManualMaterialStateForLab(appData.labs[lab.id]);
    autoProvisionPausedLabs.add(lab.id);
    autoPrepareRequestedLabs.delete(`${lab.id}:all`);
    getAllResourceNamesForLab(lab).forEach((resourceName) => {
        autoInitRequestedLabs.delete(`${lab.id}:${resourceName}`);
    });
    resetLabTerminalState(appData.labs[lab.id]);
    await sync();
    renderApp();
    if (window.syncLabLifecycle) window.syncLabLifecycle();
    if (typeof showToast === "function") {
        const detail = [
            deletedCount ? `${deletedCount} 个独占实例已删除` : "",
            unboundReusableCount ? `${unboundReusableCount} 个可复用实例已保留` : "",
            unboundSharedCount ? `${unboundSharedCount} 个共享实例已保留` : "",
            "当前停留不会自动重新创建环境。"
        ].filter(Boolean).join("，");
        showToast("资源已解除", detail, "success");
    }
}

async function resumeLabEnvironmentProvision() {
    const lab = getActiveLab();
    if (!lab) return;
    autoProvisionPausedLabs.delete(lab.id);
    autoPrepareRequestedLabs.delete(`${lab.id}:all`);
    getAllResourceNamesForLab(lab).forEach((resourceName) => {
        autoInitRequestedLabs.delete(`${lab.id}:${resourceName}`);
    });
    renderApp();

    const runtime = getLabRuntimeDefinition(lab);
    if ((runtime.resources || []).length > 1) {
        await prepareAllResourcesForActiveLab();
    } else {
        await initializeResourceForActiveLab();
    }
}

async function bindManualSshResource() {
    const lab = getActiveLab();
    const resourceName = resolveBaseResourceName(terminalUiState.activeTabKey || getPrimaryResourceNameForLab(lab));
    const profile = getProfileForResource(lab, resourceName) || getEffectiveProfileForLab(lab);
    const host = document.getElementById("bind-ssh-host").value.trim();
    if (!host) return alert("请输入 SSH 主机地址。");

    const instanceId = uid("resource");
    appData.resourceInstances[instanceId] = normalizeResourceInstance(instanceId, {
        profileId: profile.id,
        providerType: "manual_ssh",
        runnerType: "ssh",
        label: document.getElementById("bind-ssh-label").value.trim() || `手动绑定 ${host}`,
        status: "ready",
        reusable: document.getElementById("bind-ssh-reusable").checked,
        createdByApp: false,
        lastUsedAt: nowIso(),
        reuseKey: profile.reuseKey,
        notes: "用户手动绑定的 SSH 服务器",
        connection: {
            host,
            username: document.getElementById("bind-ssh-username").value.trim() || "root",
            password: document.getElementById("bind-ssh-password").value
        }
    });
    setBoundInstanceForLab(appData.labs[lab.id], resourceName, instanceId);
    await sync();
    closeModal("modal-bind-ssh");
    renderApp();
    if (window.syncLabLifecycle) window.syncLabLifecycle();
    connectBoundResource(resourceName, true);
}

async function applyManualFilesForResource(resourceName = "") {
    const lab = getActiveLab();
    const targetResource = resolveBaseResourceName(String(resourceName || "").trim() || terminalUiState.activeTabKey || getPrimaryResourceNameForLab(lab));
    const files = getPreseedFilesForResource(lab, targetResource);
    if (!lab || !files.length) {
        if (typeof showToast === "function") {
            showToast("无需导入", "当前资源没有需要手动导入的前置素材。");
        }
        return;
    }

    const stateKey = typeof getManualMaterialStateKey === "function"
        ? getManualMaterialStateKey(lab, targetResource)
        : `${lab.id}:${targetResource}`;
    manualMaterialUiState[stateKey] = { status: "loading", message: "正在导入前置素材..." };
    renderLabWorkspace();

    try {
        const { instance } = await ensureResourceReadyForCheckpoint(lab, targetResource);
        if (!instance?.connection?.host) {
            throw new Error("当前资源还没有可用的 SSH 地址。");
        }

        const result = await window.api.applyResourceFiles({
            connection: instance.connection,
            files,
            packageDir: lab?.importMeta?.packageDir || "",
            sessionKey: getTerminalSessionKey(lab, targetResource)
        });
        if (!result?.ok) {
            throw new Error(result?.error || "导入前置素材失败。");
        }

        manualMaterialUiState[stateKey] = {
            status: "success",
            message: `已导入 ${result.count || files.length} 个素材文件。`
        };
        if (typeof showToast === "function") {
            showToast("素材已导入", `已将 ${result.count || files.length} 个文件导入到 ${targetResource}。`, "success");
        }
    } catch (error) {
        manualMaterialUiState[stateKey] = {
            status: "fail",
            message: String(error?.message || error || "导入前置素材失败。")
        };
        if (typeof showToast === "function") {
            showToast("素材导入失败", manualMaterialUiState[stateKey].message, "fail");
        }
    }

    renderLabWorkspace();
}

async function doVerify() {
    const lab = getActiveLab();
    const runtime = getLabRuntimeDefinition(lab);
    const resourceName = resolveBaseResourceName(terminalUiState.activeTabKey || getPrimaryResourceNameForLab(lab));
    const profile = getProfileForResource(lab, resourceName) || runtime.profile;
    const instance = getBoundInstanceForLab(lab, resourceName);
    const check = runtime.check;
    if (!lab || !profile) return;
    if (!check?.command) return alert("当前实验还没有配置校验命令。");
    if (!instance) return alert("请先绑定或初始化资源实例，再执行校验。");

    if (instance.runnerType === "ssh" && instance.connection?.host) {
        connectBoundResource(resourceName, true);
        const sessionKey = getTerminalSessionKey(lab, resourceName);
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
            const session = ensureTerminalSession(sessionKey);
            if (session.connected) break;
            await new Promise((resolve) => setTimeout(resolve, 300));
        }
        const session = ensureTerminalSession(sessionKey);
        if (!session.connected) {
            alert("SSH 连接尚未建立，请稍后重试。");
            return;
        }
    }

    const res = await window.api.verify({
        type: profile.runnerType,
        cmd: check.command,
        sessionKey: getTerminalSessionKey(lab, resourceName),
        connection: instance?.connection || null,
        background: true
    });
    const el = document.getElementById("verify-result");
    if (!el) return;
    el.innerHTML = res
        ? `
            <div class="verify-result-card success">
                <div class="verify-result-icon">✓</div>
                <div class="verify-result-title">${escapeHtml(check.successMsg || "验证通过")}</div>
                <div class="verify-result-text">实验结果已通过校验，当前实验会立即显示为完成。</div>
            </div>
        `
        : `
            <div class="verify-result-card fail">
                <div class="verify-result-icon">!</div>
                <div class="verify-result-title">${escapeHtml(check.failMsg || "验证未通过")}</div>
                <div class="verify-result-text">系统没有检测到预期结果，请回到手册逐步检查操作。</div>
                ${check.hint ? `<div class="verify-result-hint">建议：${escapeHtml(check.hint)}</div>` : ""}
            </div>
        `;

    if (typeof showToast === "function") {
        showToast(
            res ? "验证通过" : "验证失败",
            res ? (check.successMsg || "实验已通过校验。") : (check.hint || check.failMsg || "请根据提示检查操作步骤。"),
            res ? "success" : "fail"
        );
    }

    if (res && !lab.completed) {
        appData.labs[lab.id].completed = true;
        await sync();
        renderApp();
    }
}

window.openCourseModal = openCourseModal;
window.openModuleModal = openModuleModal;
window.openLabModal = openLabModal;
window.saveCourse = saveCourse;
window.saveModule = saveModule;
window.saveLab = saveLab;
window.beginImportLabSpecs = beginImportLabSpecs;
window.confirmImportPreview = confirmImportPreview;
window.toggleLabResourceFields = toggleLabResourceFields;
window.renderImportPreview = renderImportPreview;
window.openBindSshModal = openBindSshModal;
window.bindManualSshResource = bindManualSshResource;
window.initializeResourceForActiveLab = initializeResourceForActiveLab;
window.resetEnvironmentForActiveLab = resetEnvironmentForActiveLab;
window.resumeLabEnvironmentProvision = resumeLabEnvironmentProvision;
window.leaveActiveLab = leaveActiveLab;
window.prepareAllResourcesForActiveLab = prepareAllResourcesForActiveLab;
window.preheatModuleResource = preheatModuleResource;
window.applyManualFilesForResource = applyManualFilesForResource;
window.releaseLabResource = releaseLabResource;
window.requestDeleteResourceInstance = requestDeleteResourceInstance;
window.requestDeleteOrphanResourceGroup = requestDeleteOrphanResourceGroup;
window.connectBoundResource = connectBoundResource;
window.loadVmManagerData = loadVmManagerData;
window.createVmFromOvaPrompt = createVmFromOvaPrompt;
window.runVmAction = runVmAction;
window.runVmActionByIndex = runVmActionByIndex;
window.confirmVmTextPrompt = confirmVmTextPrompt;
window.cancelVmTextPrompt = cancelVmTextPrompt;
window.snapshotVmPrompt = snapshotVmPrompt;
window.snapshotVmPromptByIndex = snapshotVmPromptByIndex;
window.cloneVmPrompt = cloneVmPrompt;
window.cloneVmPromptByIndex = cloneVmPromptByIndex;
window.openVmFolder = openVmFolder;
window.openVmFolderByIndex = openVmFolderByIndex;
window.deleteVmPrompt = deleteVmPrompt;
window.deleteVmPromptByIndex = deleteVmPromptByIndex;
window.confirmDeleteAction = confirmDeleteAction;
window.requestDeleteCourse = requestDeleteCourse;
window.requestDeleteModule = requestDeleteModule;
window.requestDeleteLab = requestDeleteLab;
window.pickVmwareInstallDir = pickVmwareInstallDir;
window.pickRockyOvaFile = pickRockyOvaFile;
window.saveSettings = saveSettings;
window.doVerify = doVerify;
window.closeModal = closeModal;
window.ensureVmResourcePowered = ensureVmResourcePowered;
window.openVmTextPrompt = openVmTextPrompt;
window.addLabResourcePrompt = addLabResourcePrompt;
window.confirmAddLabResource = confirmAddLabResource;
window.updateLabPreview = updateLabPreview;
window.deleteLabResource = deleteLabResource;

async function uploadFileToActiveResource() {
    const lab = getActiveLab();
    if (!lab) return;

    const resourceName = resolveBaseResourceName(terminalUiState.activeTabKey || getPrimaryResourceNameForLab(lab));
    const sessionKey = getTerminalSessionKey(lab, resourceName);
    const session = ensureTerminalSession(sessionKey);

    if (!session || !session.connected) {
        if (typeof showToast === "function") {
            showToast("上传失败", "请先等待 SSH 连接成功后再上传文件。", "fail");
        }
        return;
    }

    const localPath = await window.api.chooseFile({
        title: `选择文件上传到 ${resourceName}`,
        filters: [{ name: "所有文件", extensions: ["*"] }]
    });

    if (!localPath) return;

    if (typeof showToast === "function") {
        showToast("正在上传", "文件正在传输中，请稍后...");
    }

    try {
        const result = await window.api.uploadFileToResource({
            sessionKey,
            localPath,
            remotePath: "/root/" // 默认上传到 root 家目录
        });

        if (result.ok) {
            if (typeof showToast === "function") {
                showToast("上传成功", `文件已成功上传至 ${result.path}`, "success");
            }
        } else {
            throw new Error(result.error);
        }
    } catch (err) {
        console.error("Upload failed:", err);
        if (typeof showToast === "function") {
            showToast("上传失败", err.message || "文件上传过程中发生错误。", "fail");
        }
    }
}

window.uploadFileToActiveResource = uploadFileToActiveResource;
