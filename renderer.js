async function init() {
    const saved = await window.api.readData();
    if (saved) appData = normalizeAppData(saved);
    if (!appData.settings?.instructionsImported && window.api?.importInstructions && typeof performSilentImport === "function") {
        try {
            const imported = await window.api.importInstructions();
            const importedOk = await performSilentImport(imported);
            if (importedOk) {
                appData.settings.instructionsImported = true;
                await sync();
            }
        } catch (error) {
            console.warn("Failed to auto import bundled instructions:", error?.message || error);
        }
    }
    manualFontScale = appData.settings?.manualFontScale || 1;
    if (window.applyTerminalFontSize) {
        window.applyTerminalFontSize(appData.settings?.sshTerminalFontSize || 14, { fit: false });
    }
    if (cleanupStaleResourceInstances()) {
        await sync();
    }
    if (typeof cleanupMissingVmResourceInstances === "function" && await cleanupMissingVmResourceInstances()) {
        await sync();
    }
    if (await cleanupOrphanResourceInstances()) {
        await sync();
    }

    document.getElementById("import-force-current-module").addEventListener("change", () => window.renderImportPreview && window.renderImportPreview());
    document.getElementById("import-duplicate-mode").addEventListener("change", () => window.renderImportPreview && window.renderImportPreview());
    const treeSearchInput = document.getElementById("tree-search-input");
    const treeSearchButton = document.getElementById("tree-search-button");
    if (treeSearchButton) {
        treeSearchButton.addEventListener("click", () => window.submitTreeSearch && window.submitTreeSearch());
    }
    if (treeSearchInput) {
        treeSearchInput.addEventListener("input", () => {
            if (treeSearchInput.value.trim() !== "") return;
            if (window.applyTreeSearch) window.applyTreeSearch("");
        });
        treeSearchInput.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (window.submitTreeSearch) window.submitTreeSearch();
        });
    }

    window.renderApp();
    window.initWorkspaceResizer();
}

init();
