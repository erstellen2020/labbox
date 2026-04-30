(function () {
    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function decodeHtmlEntities(value) {
        return String(value || "")
            .replace(/&quot;/g, "\"")
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&");
    }

    function isWindowsAbsolutePath(value) {
        return /^[a-zA-Z]:[\\/]/.test(String(value || ""));
    }

    function isUncPath(value) {
        return /^(?:\\\\|\/\/)[^\\/]+[\\/]/.test(String(value || ""));
    }

    function isAbsoluteFilePath(value) {
        const text = String(value || "");
        return isWindowsAbsolutePath(text) || isUncPath(text) || text.startsWith("/");
    }

    function pathToFileUrl(value) {
        const original = String(value || "").trim();
        if (!original) return "";
        const normalized = original.replace(/\\/g, "/");
        if (isUncPath(original)) {
            return encodeURI(`file:${normalized.startsWith("//") ? normalized : `//${normalized.replace(/^\/+/, "")}`}`);
        }
        if (normalized.startsWith("/")) {
            return encodeURI(`file://${normalized}`);
        }
        return encodeURI(`file:///${normalized.replace(/^\/+/, "")}`);
    }

    function baseDirToFileUrl(baseDir) {
        const resolved = pathToFileUrl(baseDir);
        if (!resolved) return "";
        return resolved.endsWith("/") ? resolved : `${resolved}/`;
    }

    function trimMarkdownDestination(rawTarget) {
        const decoded = decodeHtmlEntities(rawTarget).trim();
        if (!decoded) return "";
        if (decoded.startsWith("<") && decoded.endsWith(">")) {
            return decoded.slice(1, -1).trim();
        }
        const titleMatch = decoded.match(/^(.+?)\s+(['"])(.*)\2$/);
        return (titleMatch ? titleMatch[1] : decoded).trim();
    }

    function hasUnsafeScheme(value) {
        return /^(?:javascript|vbscript):/i.test(String(value || "").trim());
    }

    function resolveInlineTarget(rawTarget, options = {}, mode = "link") {
        const target = trimMarkdownDestination(rawTarget);
        if (!target || hasUnsafeScheme(target)) return "";
        const normalized = target.replace(/\\/g, "/");

        if (mode === "image" && /^data:/i.test(target)) {
            return /^data:image\//i.test(target) ? target : "";
        }
        if (/^(?:https?|file|blob):/i.test(target)) return encodeURI(target);
        if (mode === "link" && /^(?:mailto|tel):/i.test(target)) return encodeURI(target);
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !isWindowsAbsolutePath(target)) return "";
        if (isAbsoluteFilePath(target)) return pathToFileUrl(target);

        const baseDir = String(options.baseDir || "").trim();
        if (baseDir) {
            try {
                return new URL(normalized, baseDirToFileUrl(baseDir)).href;
            } catch {}
        }

        return encodeURI(normalized);
    }

    function replaceInlineTokens(text, options) {
        const tokens = [];
        const stash = (html) => {
            const token = `@@INLINE_TOKEN_${tokens.length}@@`;
            tokens.push(html);
            return token;
        };

        function buildManualImageHtml(rawAttrs) {
            const attrs = decodeHtmlEntities(rawAttrs);
            const srcMatch = attrs.match(/src\s*=\s*(['"])?([^"' >]+)\1?/i);
            if (!srcMatch) return null;
            const src = resolveInlineTarget(srcMatch[2], options, "image");
            if (!src) return null;

            const altMatch = attrs.match(/alt\s*=\s*(['"])?([^"' >]+)\1?/i);
            const alt = altMatch ? altMatch[2] : "";

            const styleMatch = attrs.match(/style\s*=\s*(['"])?([^"']+)\1?/i);
            const style = styleMatch ? ` style="${escapeHtml(styleMatch[2])}"` : "";

            return stash(`<img class="manual-image" src="${escapeHtml(src)}" alt="${alt}" loading="lazy"${style} />`);
        }

        let value = String(text || "");
        value = value.replace(/&lt;img\s+((?:[^&]|&(?:quot|amp|lt|gt);)+?)\s*\/?&gt;/gi, (matched, attrs) => {
            const result = buildManualImageHtml(attrs);
            return result !== null ? result : matched;
        });
        value = value.replace(/<img\s+([^>]+)>/gi, (matched, attrs) => {
            const result = buildManualImageHtml(attrs);
            return result !== null ? result : matched;
        });
        value = value.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (matched, alt, target) => {
            const src = resolveInlineTarget(target, options, "image");
            if (!src) return matched;
            return stash(`<img class="manual-image" src="${escapeHtml(src)}" alt="${alt}" loading="lazy" />`);
        });
        value = value.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (matched, label, target) => {
            const href = resolveInlineTarget(target, options, "link");
            if (!href) return matched;
            const attrs = /^(?:https?|file):/i.test(href) ? ' target="_blank" rel="noreferrer"' : "";
            return stash(`<a href="${escapeHtml(href)}"${attrs}>${label}</a>`);
        });
        return { text: value, tokens };
    }

    function parseInline(text, options = {}) {
        const replaced = replaceInlineTokens(String(text || ""), options);
        const formatted = replaced.text
            .replace(/`([^`]+)`/g, "<code>$1</code>")
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
            .replace(/\*([^*]+)\*/g, "<em>$1</em>");
        return formatted.replace(/@@INLINE_TOKEN_(\d+)@@/g, (matched, index) => replaced.tokens[Number(index)] || matched);
    }

    function parseFenceInfo(info) {
        const raw = String(info || "").trim();
        if (!raw) return { language: "", target: "" };
        const targetMatch = raw.match(/target\s*=\s*"([^"]+)"/i);
        const language = raw.replace(/\{[\s\S]*\}$/, "").trim().split(/\s+/)[0] || "";
        return {
            language: language.toLowerCase(),
            target: targetMatch ? targetMatch[1].trim() : ""
        };
    }

    function splitTableRow(line) {
        const trimmed = String(line || "").trim();
        if (!trimmed || !trimmed.includes("|")) return [];
        let content = trimmed;
        if (content.startsWith("|")) content = content.slice(1);
        if (content.endsWith("|")) content = content.slice(0, -1);
        return content.split("|").map((cell) => cell.trim());
    }

    function isTableSeparatorCell(cell) {
        return /^:?-{3,}:?$/.test(String(cell || "").trim());
    }

    function isTableSeparatorRow(line) {
        const cells = splitTableRow(line);
        return cells.length > 0 && cells.every(isTableSeparatorCell);
    }

    function getTableColumnCount(headerCells = [], bodyLines = []) {
        let count = Array.isArray(headerCells) ? headerCells.length : 0;
        bodyLines.forEach((line) => {
            count = Math.max(count, splitTableRow(line).length);
        });
        return Math.max(1, count);
    }

    function getTableAlignments(separatorLine, columnCount) {
        const cells = splitTableRow(separatorLine);
        const alignments = [];
        for (let index = 0; index < columnCount; index += 1) {
            const cell = String(cells[index] || "").trim();
            let align = "";
            if (/^:-+:$/.test(cell)) align = "center";
            else if (/^-+:$/.test(cell)) align = "right";
            else if (/^:-+$/.test(cell)) align = "left";
            alignments.push(align);
        }
        return alignments;
    }

    function renderTableBlock(headerLine, separatorLine, bodyLines, options = {}) {
        const headerCells = splitTableRow(headerLine);
        const columnCount = getTableColumnCount(headerCells, bodyLines);
        const alignments = getTableAlignments(separatorLine, columnCount);
        const normalizedHeaders = headerCells.slice();
        while (normalizedHeaders.length < columnCount) normalizedHeaders.push("");

        const headerHtml = normalizedHeaders
            .map((cell, index) => {
                const alignAttr = alignments[index] ? ` style="text-align:${alignments[index]};"` : "";
                return `<th${alignAttr}>${parseInline(cell, options)}</th>`;
            })
            .join("");

        const bodyHtml = bodyLines
            .map((line) => {
                const cells = splitTableRow(line);
                while (cells.length < columnCount) cells.push("");
                return `<tr>${cells.slice(0, columnCount).map((cell, index) => {
                    const alignAttr = alignments[index] ? ` style="text-align:${alignments[index]};"` : "";
                    return `<td${alignAttr}>${parseInline(cell, options)}</td>`;
                }).join("")}</tr>`;
            })
            .join("");

        return `
<div class="manual-table-wrap">
<table class="manual-table">
<thead><tr>${headerHtml}</tr></thead>
${bodyHtml ? `<tbody>${bodyHtml}</tbody>` : ""}
</table>
</div>`.trim();
    }

    function renderHttpBlock(source = "") {
        const urls = String(source || "")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => /^https?:\/\//i.test(line));
        if (!urls.length) return "";
        return `
<div class="manual-http-block">
${urls.map((url) => `
<a class="manual-http-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>
`).join("")}
</div>`.trim();
    }

    function markdownToHtml(source, options = {}) {
        const lines = String(source || "").replace(/\r\n/g, "\n").split("\n");
        const html = [];
        let inList = false;
        let inCodeBlock = false;
        let codeFenceLang = "";
        let codeLines = [];
        let paragraph = [];

        function flushParagraph() {
            if (!paragraph.length) return;
            html.push(`<p>${parseInline(paragraph.join("<br>"), options)}</p>`);
            paragraph = [];
        }

        function closeList() {
            if (!inList) return;
            html.push("</ul>");
            inList = false;
        }

        function flushCodeBlock() {
            const blockSource = codeLines.join("\n");
            if (codeFenceLang === "mermaid") {
                const rawSource = String(blockSource || "")
                    .replace(/\u00a0/g, " ")
                    .trim();
                html.push(`<div class="mermaid">${escapeHtml(rawSource)}</div>`);
                return;
            }

            if (codeFenceLang === "http") {
                const httpBlock = renderHttpBlock(blockSource);
                if (httpBlock) {
                    html.push(httpBlock);
                    return;
                }
                html.push(`<pre><code class="language-http">${escapeHtml(blockSource)}</code></pre>`);
                return;
            }

            if (codeFenceLang === "hide") {
                const hiddenBody = markdownToHtml(blockSource, options);
                html.push(`
<div class="manual-hidden-block">
<button type="button" class="btn btn-secondary manual-hidden-toggle" aria-expanded="false">查看隐藏内容</button>
<div class="manual-hidden-content hidden">${hiddenBody}</div>
</div>`.trim());
                return;
            }

            const langClass = codeFenceLang ? ` class="language-${codeFenceLang}"` : "";
            const targetAttr = html._lastFenceTarget ? ` data-target="${escapeHtml(html._lastFenceTarget)}"` : "";
            html.push(`<pre${targetAttr}><code${langClass}${targetAttr}>${escapeHtml(blockSource)}</code></pre>`);
        }

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            const rawLine = lines[lineIndex];
            const line = escapeHtml(rawLine);
            const trimmed = line.trim();

            if (trimmed.startsWith("```")) {
                flushParagraph();
                closeList();
                if (!inCodeBlock) {
                    inCodeBlock = true;
                    const fenceInfo = parseFenceInfo(trimmed.slice(3));
                    codeFenceLang = fenceInfo.language;
                    codeLines = [];
                    paragraph = [];
                    html._lastFenceTarget = fenceInfo.target;
                } else {
                    flushCodeBlock();
                    inCodeBlock = false;
                    codeFenceLang = "";
                    codeLines = [];
                    html._lastFenceTarget = "";
                }
                continue;
            }

            if (inCodeBlock) {
                codeLines.push(rawLine);
                continue;
            }

            if (!trimmed) {
                flushParagraph();
                closeList();
                continue;
            }

            const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
            if (headingMatch) {
                flushParagraph();
                closeList();
                const level = headingMatch[1].length;
                html.push(`<h${level}>${parseInline(headingMatch[2], options)}</h${level}>`);
                continue;
            }

            const listMatch = trimmed.match(/^[-*]\s+(.*)$/);
            if (listMatch) {
                flushParagraph();
                if (!inList) {
                    html.push("<ul>");
                    inList = true;
                }
                html.push(`<li>${parseInline(listMatch[1], options)}</li>`);
                continue;
            }

            const nextLine = lineIndex + 1 < lines.length ? escapeHtml(lines[lineIndex + 1]).trim() : "";
            if (trimmed.includes("|") && isTableSeparatorRow(nextLine)) {
                flushParagraph();
                closeList();

                const tableHeaderLine = line;
                const tableSeparatorLine = escapeHtml(lines[lineIndex + 1]);
                const tableBodyLines = [];
                lineIndex += 2;

                while (lineIndex < lines.length) {
                    const candidateLine = escapeHtml(lines[lineIndex]);
                    const candidateTrimmed = candidateLine.trim();
                    if (!candidateTrimmed || !candidateTrimmed.includes("|")) {
                        lineIndex -= 1;
                        break;
                    }
                    tableBodyLines.push(candidateLine);
                    lineIndex += 1;
                }

                if (lineIndex >= lines.length) lineIndex -= 1;
                html.push(renderTableBlock(tableHeaderLine, tableSeparatorLine, tableBodyLines, options));
                continue;
            }

            closeList();
            paragraph.push(line);
        }

        flushParagraph();
        closeList();
        if (inCodeBlock) {
            flushCodeBlock();
        }
        return html.join("\n");
    }

    function parseScalar(value) {
        const text = String(value || "").trim();
        if (!text) return "";
        if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
            return text.slice(1, -1);
        }
        if (/^(true|false)$/i.test(text)) return text.toLowerCase() === "true";
        if (/^(null|~)$/i.test(text)) return null;
        if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
        return text;
    }

    function parseYamlSubset(input) {
        const lines = String(input || "").replace(/\r\n/g, "\n").split("\n");
        const root = {};
        const stack = [{ indent: -1, value: root, type: "object" }];

        function readBlockScalar(startIndex, parentIndent, fold = false) {
            const collected = [];
            let lastIndex = startIndex;
            let baseIndent = -1;

            for (let cursor = startIndex; cursor < lines.length; cursor += 1) {
                const original = lines[cursor];
                const trimmed = original.trim();
                const indent = original.match(/^ */)[0].length;

                if (trimmed && indent <= parentIndent) break;

                lastIndex = cursor;
                if (!trimmed) {
                    collected.push("");
                    continue;
                }

                if (baseIndent < 0) baseIndent = indent;
                collected.push(original.slice(Math.min(indent, baseIndent)));
            }

            const value = fold
                ? collected.map((line) => line.trim() ? line.trim() : "").join("\n").replace(/\n{3,}/g, "\n\n")
                : collected.join("\n");

            return { value: value.replace(/\n+$/g, ""), nextIndex: lastIndex };
        }

        for (let index = 0; index < lines.length; index += 1) {
            const originalLine = lines[index];
            const trimmedLine = originalLine.trim();
            if (!trimmedLine || trimmedLine.startsWith("#")) continue;

            const indent = originalLine.match(/^ */)[0].length;
            while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
                stack.pop();
            }

            const current = stack[stack.length - 1];

            if (trimmedLine.startsWith("- ")) {
                if (current.type !== "array") {
                    throw new Error("Unsupported YAML structure near list item.");
                }

                const itemText = trimmedLine.slice(2).trim();
                const pairMatch = itemText.match(/^([^:]+):(.*)$/);

                if (!itemText) {
                    const item = {};
                    current.value.push(item);
                    stack.push({ indent, value: item, type: "object" });
                    continue;
                }

                if (!pairMatch) {
                    current.value.push(parseScalar(itemText));
                    continue;
                }

                const key = pairMatch[1].trim();
                const rest = pairMatch[2].trim();
                const item = {};
                current.value.push(item);
                if (rest === "|" || rest === "|-" || rest === ">" || rest === ">-") {
                    const block = readBlockScalar(index + 1, indent, rest.startsWith(">"));
                    item[key] = block.value;
                    index = block.nextIndex;
                    stack.push({ indent, value: item, type: "object" });
                } else if (rest) {
                    item[key] = parseScalar(rest);
                    stack.push({ indent, value: item, type: "object" });
                } else {
                    item[key] = {};
                    stack.push({ indent, value: item, type: "object" });
                    stack.push({ indent: indent + 1, value: item[key], type: "object" });
                }
                continue;
            }

            const pairMatch = trimmedLine.match(/^([^:]+):(.*)$/);
            if (!pairMatch) {
                throw new Error(`Unsupported YAML line: ${trimmedLine}`);
            }

            const key = pairMatch[1].trim();
            const rest = pairMatch[2].trim();
            if (rest === "|" || rest === "|-" || rest === ">" || rest === ">-") {
                const block = readBlockScalar(index + 1, indent, rest.startsWith(">"));
                current.value[key] = block.value;
                index = block.nextIndex;
                continue;
            }
            if (rest) {
                current.value[key] = parseScalar(rest);
                continue;
            }

            let nextType = "object";
            for (let lookAhead = index + 1; lookAhead < lines.length; lookAhead += 1) {
                const candidate = lines[lookAhead].trim();
                if (!candidate || candidate.startsWith("#")) continue;
                nextType = candidate.startsWith("- ") ? "array" : "object";
                break;
            }

            current.value[key] = nextType === "array" ? [] : {};
            stack.push({ indent, value: current.value[key], type: nextType });
        }

        return root;
    }

    function dumpYamlSubset(obj, indent = 0) {
        const space = "  ".repeat(indent);
        if (obj === null || obj === undefined) return "~";
        if (typeof obj !== "object") {
            const str = String(obj);
            if (str.includes("\n")) return `|-\n${str.split("\n").map(l => `${space}  ${l}`).join("\n")}`;
            if (/[#:-]/.test(str) || !str.trim()) return `"${str.replace(/"/g, '\\"')}"`;
            return str;
        }

        if (Array.isArray(obj)) {
            if (obj.length === 0) return "[]";
            return obj.map(item => {
                const dumped = dumpYamlSubset(item, indent + 1);
                if (typeof item === "object" && item !== null && !Array.isArray(item)) {
                    // Object in array: "- name: value"
                    // We need to carefully align the first line and sub-lines
                    const lines = dumped.split("\n");
                    const firstLine = lines[0].trimStart();
                    const otherLines = lines.slice(1).map(l => l).join("\n");
                    return `${space}- ${firstLine}${otherLines ? "\n" + otherLines : ""}`;
                }
                return `${space}- ${dumped}`;
            }).join("\n");
        }

        const keys = Object.keys(obj);
        if (keys.length === 0) return "{}";
        return keys.map(key => {
            const value = obj[key];
            const dumped = dumpYamlSubset(value, indent + 1);
            if (typeof value === "object" && value !== null && !Array.isArray(value)) {
                return `${space}${key}:\n${dumped}`;
            }
            if (Array.isArray(value)) {
                return `${space}${key}:\n${dumped}`;
            }
            return `${space}${key}: ${dumped}`;
        }).join("\n");
    }

    window.marked = {
        parse: markdownToHtml
    };

    window.jsyaml = {
        load: parseYamlSubset,
        dump: dumpYamlSubset
    };
})();
