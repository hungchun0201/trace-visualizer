/**
 * app.js — Trace Visualizer with agent detection, tool extraction, and LIVE mode.
 */
(() => {
    'use strict';

    const uploadScreen = document.getElementById('upload-screen');
    const mainScreen = document.getElementById('main-screen');
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const btnBack = document.getElementById('btn-back');
    const fileInfoEl = document.getElementById('file-info');
    const nodeCountEl = document.getElementById('node-count');
    const dagSvg = document.getElementById('dag-svg');
    const detailTitle = document.getElementById('detail-title');
    const detailMeta = document.getElementById('detail-meta');
    const detailContent = document.getElementById('detail-content');
    const panelLeft = document.getElementById('panel-left');
    const resizeHandle = document.getElementById('resize-handle');
    const apiKeyInput = document.getElementById('api-key-input');
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');
    const zoomResetBtn = document.getElementById('zoom-reset');
    const zoomLevelEl = document.getElementById('zoom-level');
    const liveBadge = document.getElementById('live-badge');

    let allNodes = [], nodeMap = {}, roots = [];
    let selectedIdx = null, fileName = '', firstTimestamp = 0;
    let zoomLevel = 0.7;
    const ZOOM_STEP = 0.15, MIN_ZOOM = 0.2, MAX_ZOOM = 2.5;

    // ---- Live mode state ----
    let liveMode = false;
    let liveFile = null;
    let liveLineCount = 0;
    let liveTimer = null;
    let rawEntries = []; // Keep raw entries for incremental rebuilds

    // ---- Agent type definitions ----
    const AGENT_TYPES = {
        main: { label: 'Main', color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' },
        explore: { label: 'Explore', color: '#F97316', bg: 'rgba(249,115,22,0.12)' },
        plan: { label: 'Plan', color: '#10B981', bg: 'rgba(16,185,129,0.12)' },
        summary: { label: 'Summary', color: '#A855F7', bg: 'rgba(168,85,247,0.12)' },
        topic: { label: 'Topic', color: '#14B8A6', bg: 'rgba(20,184,166,0.12)' },
        extract: { label: 'Extract', color: '#78716C', bg: 'rgba(120,113,108,0.12)' },
        display: { label: 'Display', color: '#EC4899', bg: 'rgba(236,72,153,0.12)' },
        toolbox: { label: 'Toolbox', color: '#4B5563', bg: 'rgba(75,85,99,0.12)' },
        pr: { label: 'PR', color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)' },
        unknown: { label: 'Agent', color: '#6B7280', bg: 'rgba(107,114,128,0.08)' },
    };

    // Known Claude Code tools
    const KNOWN_TOOLS = [
        'Task', 'Bash', 'Read', 'Write', 'Edit', 'MultiEdit',
        'Glob', 'Grep', 'TodoRead', 'TodoWrite',
        'WebFetch', 'WebSearch', 'Notebook',
        'Agent', 'SubOutput',
        'ExitPlanMode', 'EnterPlanMode', 'Plan',
        'AskFollowupQuestion', 'AskUserQuestion', 'Skill', 'SlashCommand',
        'ServerAction',
        'TaskCreate', 'TaskUpdate', 'TaskDone', 'TaskStatus',
        'FileEdit', 'FileRead', 'FileWrite', 'ListDir',
        'Search', 'UrlFetch',
        'BatchTool', 'ParallelTool',
    ];
    const TOOL_SET = new Set(KNOWN_TOOLS);

    // API key persistence
    const SK = 'trace_viz_api_key';
    if (apiKeyInput) {
        apiKeyInput.value = localStorage.getItem(SK) || '';
        apiKeyInput.addEventListener('change', () => {
            const k = apiKeyInput.value.trim();
            k ? localStorage.setItem(SK, k) : localStorage.removeItem(SK);
        });
    }

    // Zoom controls
    function applyZoom() {
        dagSvg.style.transform = `scale(${zoomLevel})`;
        dagSvg.style.transformOrigin = '0 0';
        if (zoomLevelEl) zoomLevelEl.textContent = `${Math.round(zoomLevel * 100)}%`;
    }
    if (zoomInBtn) zoomInBtn.addEventListener('click', () => { zoomLevel = Math.min(MAX_ZOOM, zoomLevel + ZOOM_STEP); applyZoom(); });
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => { zoomLevel = Math.max(MIN_ZOOM, zoomLevel - ZOOM_STEP); applyZoom(); });
    if (zoomResetBtn) zoomResetBtn.addEventListener('click', () => { zoomLevel = 0.7; applyZoom(); });

    // File upload
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
    fileInput.addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); });
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drag-over'); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
    btnBack.addEventListener('click', () => { stopLive(); mainScreen.classList.remove('active'); uploadScreen.classList.add('active'); resetState(); });

    // Paste trace data
    const pasteInput = document.getElementById('paste-input');
    const btnPaste = document.getElementById('btn-paste');
    if (btnPaste && pasteInput) {
        btnPaste.addEventListener('click', () => {
            const text = pasteInput.value.trim();
            if (!text) { alert('Please paste trace data first.'); return; }
            try {
                fileName = 'pasted-trace';
                parseAndBuild(text);
                showMain();
            } catch (err) {
                alert('Parse error: ' + err.message);
            }
        });
    }

    function loadFile(file) {
        fileName = file.name;
        const r = new FileReader();
        r.onload = e => {
            try { parseAndBuild(e.target.result); showMain(); }
            catch (err) { alert('Parse error: ' + err.message); }
        };
        r.readAsText(file);
    }

    // Load default trace
    const btnDefault = document.getElementById('btn-default');
    if (btnDefault) {
        btnDefault.addEventListener('click', () => {
            btnDefault.disabled = true;
            btnDefault.textContent = 'Loading...';
            fetch('default-trace.jsonl')
                .then(r => { if (!r.ok) throw new Error('Default trace not found'); return r.text(); })
                .then(text => {
                    fileName = 'traces.jsonl (default)';
                    parseAndBuild(text);
                    showMain();
                })
                .catch(err => { alert(err.message); })
                .finally(() => { btnDefault.disabled = false; btnDefault.textContent = 'Load Default Trace'; });
        });
    }

    // ---- Agent Type Detection ----
    function detectAgentType(input) {
        const s = input.substring(0, 2000).toLowerCase();
        if (s.includes('file search specialist') || s.includes('read-only exploration') ||
            s.includes('read-only task') || s.includes('your role is exclusively to search')) return 'explore';
        if (s.includes('planning specialist') || s.includes('software architect')) return 'plan';
        if (s.includes('interactive cli tool') || s.includes('software engineering tasks') ||
            s.includes('pair programming') || s.includes('the following skills are available')) return 'main';
        if (s.includes('summarize this coding conversation') || s.includes('summarize this coding')) return 'summary';
        if (s.includes('new conversation topic') || s.includes('analyze if this message')) return 'topic';
        if (s.includes('extract any file paths') || s.includes('process bash commands')) return 'extract';
        if (s.includes('display file') || s.includes('display content') || s.includes('display the contents')) return 'display';
        if (s.includes('pull request') || s.includes('pr comments') || s.includes('get comments from')) return 'pr';
        if (input.startsWith('Tools:')) return 'toolbox';
        return 'unknown';
    }

    // ---- Tool Extraction from Output ----
    function extractTools(output) {
        if (!output || output.length === 0) return [];
        const found = new Set();
        const re1 = /"name":\s*"([^"]+)"/g;
        let m;
        while ((m = re1.exec(output)) !== null) {
            if (TOOL_SET.has(m[1])) found.add(m[1]);
        }
        const re2 = /\[tool_use:\s*([^\]]+)\]/g;
        while ((m = re2.exec(output)) !== null) {
            const name = m[1].trim();
            if (TOOL_SET.has(name)) found.add(name);
        }
        return [...found];
    }

    function extractAllTools(input, output) {
        const found = new Set();
        const re1 = /"name":\s*"([^"]+)"/g;
        const re2 = /\[tool_use:\s*([^\]]+)\]/g;
        const re3 = /tool_call:\s*(\S+)\s*━/g;
        for (const text of [input, output]) {
            if (!text) continue;
            let m;
            while ((m = re1.exec(text)) !== null) {
                if (TOOL_SET.has(m[1])) found.add(m[1]);
            }
            while ((m = re2.exec(text)) !== null) {
                const name = m[1].trim();
                if (TOOL_SET.has(name)) found.add(name);
            }
            while ((m = re3.exec(text)) !== null) {
                const name = m[1].trim();
                if (TOOL_SET.has(name)) found.add(name);
            }
        }
        return [...found];
    }

    function extractToolsWithDetails(normalizedEntry) {
        const e = normalizedEntry;
        const results = [];
        const output = e.output || '';

        const toolCallRe = /━━━ tool_call:\s*(\S+)\s*━━━\s*\nid:\s*\S+\narguments:\n([\s\S]*?)━━━━━/g;
        let m;
        while ((m = toolCallRe.exec(output)) !== null) {
            const name = m[1].trim();
            if (!TOOL_SET.has(name)) continue;
            if (name === 'Bash') {
                const cmd = parseBashFirstCmd(m[2]);
                results.push({ name, cmd });
            } else if (name === 'Agent') {
                try {
                    const args = JSON.parse(m[2].trim());
                    results.push({ name, cmd: args.subagent_type || null });
                } catch (e) {
                    results.push({ name, cmd: null });
                }
            } else {
                results.push({ name, cmd: null });
            }
        }

        if (results.length === 0) {
            const oldTools = extractAllTools('', output);
            for (const t of oldTools) {
                results.push({ name: t, cmd: null });
            }
        }

        return results;
    }

    function parseBashFirstCmd(argsText) {
        try {
            const args = JSON.parse(argsText.trim());
            const cmd = args.command || '';
            if (!cmd) return null;
            const cleaned = cmd.trim().replace(/^(cd\s+\S+\s*[;&|]+\s*)/i, '');
            const firstWord = cleaned.split(/[\s|;&]+/)[0];
            const basename = firstWord.split('/').pop();
            return basename || null;
        } catch (e) {
            return null;
        }
    }

    // ---- Spawning Detection ----
    function detectSpawningRelationships(nodes) {
        const sessions = {};
        for (const n of nodes) {
            const sid = String(n.sessionId || '');
            if (!sessions[sid]) sessions[sid] = [];
            sessions[sid].push(n);
        }
        for (const sid in sessions) {
            const group = sessions[sid].sort((a, b) => a.timestamp - b.timestamp);
            let currentOrch = null;
            for (const n of group) {
                if (n.agentType === 'main' || n.agentType === 'plan') {
                    currentOrch = n;
                } else if (['explore', 'extract', 'summary', 'topic', 'display', 'pr'].includes(n.agentType)) {
                    if (currentOrch && n.spawnedBy === null) {
                        n.spawnedBy = currentOrch.globalIndex;
                        currentOrch.spawns.push(n.globalIndex);
                    }
                }
            }
        }
    }

    // ---- Parsing & Tree Building ----
    function parseAndBuild(text) {
        const entries = [];
        for (const line of text.trim().split('\n')) {
            if (!line.trim()) continue;
            try { entries.push(JSON.parse(line)); } catch (e) { /* skip */ }
        }
        if (entries.length === 0) return;
        rawEntries = entries;
        buildFromEntries(entries);
    }

    function parseAndBuildFromArray(entries) {
        if (entries.length === 0) return;
        rawEntries = entries;
        buildFromEntries(entries);
    }

    function buildFromEntries(entries) {
        const sample = entries[0];
        const isNewFormat = 'messages' in sample || 'response' in sample || 'model' in sample;

        const normalized = entries.map(e => {
            if (isNewFormat) return normalizeNewFormat(e);
            return normalizeOldFormat(e);
        });

        normalized.sort((a, b) => a.timestamp - b.timestamp);
        firstTimestamp = normalized[0].timestamp;

        allNodes = normalized.map((e, i) => ({
            globalIndex: i + 1,
            timestamp: e.timestamp,
            input: e.input,
            output: e.output,
            inputChars: e.input.length,
            outputChars: e.output.length,
            inputTokens: e.inputTokens || null,
            outputTokens: e.outputTokens || null,
            sessionId: e.sessionId,
            model: e.model || '',
            parentIndex: null,
            children: [],
            prefixCacheRatio: null,
            commonPrefixLen: 0,
            originRanges: [],
            agentType: isNewFormat ? 'unknown' : detectAgentType(e.input),
            tools: extractToolsWithDetails(e),
            usage: e.usage || {},
            spawnedBy: null,
            spawns: [],
        }));

        nodeMap = {};
        for (const n of allNodes) nodeMap[n.globalIndex] = n;

        if (isNewFormat) {
            assignAgentTypesWithStack(allNodes, normalized);
        } else {
            detectSpawningRelationships(allNodes);
        }

        for (let i = 1; i < allNodes.length; i++) {
            findBestParent(allNodes[i], allNodes.slice(0, i));
        }

        for (const n of allNodes) {
            const u = n.usage || {};
            const cacheRead = u.cache_read_input_tokens || 0;
            const apiInput = u.input_tokens || 0;
            if (cacheRead > 0 && apiInput > 0) {
                n.prefixCacheRatio = cacheRead / apiInput;
                n.commonPrefixLen = n.commonPrefixLen || 0;
            }
        }

        for (const n of allNodes) n.children = [];
        for (const n of allNodes) {
            if (n.parentIndex !== null) nodeMap[n.parentIndex].children.push(n.globalIndex);
        }

        for (const n of allNodes) { n.originRanges = computeOriginRanges(n); }

        roots = allNodes.filter(n => n.parentIndex === null).map(n => n.globalIndex);
    }

    const SUBAGENT_TYPE_MAP = {
        'explore': 'explore', 'Explore': 'explore',
        'plan': 'plan', 'Plan': 'plan',
        'summary': 'summary', 'Summary': 'summary',
        'topic': 'topic', 'Topic': 'topic',
        'extract': 'extract', 'Extract': 'extract',
        'display': 'display', 'Display': 'display',
        'pr': 'pr', 'PR': 'pr',
        'toolbox': 'toolbox', 'Toolbox': 'toolbox',
    };

    function assignAgentTypesWithStack(nodes, normalized) {
        const stack = ['main'];
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            const ne = normalized[i];
            node.agentType = stack[stack.length - 1];
            if (ne.spawnedAgentTypes && ne.spawnedAgentTypes.length > 0) {
                for (const sat of ne.spawnedAgentTypes) {
                    const mapped = SUBAGENT_TYPE_MAP[sat];
                    if (mapped) {
                        stack.push(mapped);
                        if (i + 1 < nodes.length) {
                            node.spawns.push(nodes[i + 1].globalIndex);
                            nodes[i + 1].spawnedBy = node.globalIndex;
                        }
                    }
                }
            }
            if (ne.toolCallsNull && stack.length > 1) {
                stack.pop();
            }
        }
    }

    function normalizeOldFormat(e) {
        return {
            timestamp: e.timestamp,
            input: e.input || '',
            output: e.output || '',
            inputTokens: null,
            outputTokens: null,
            sessionId: e.session_id || '',
            model: '',
        };
    }

    function normalizeNewFormat(e) {
        let ts = 0;
        if (typeof e.timestamp === 'string') {
            ts = new Date(e.timestamp).getTime();
        } else if (typeof e.timestamp === 'number') {
            ts = e.timestamp;
        }

        let input = '';
        if (Array.isArray(e.messages)) {
            const parts = [];
            for (const msg of e.messages) {
                const role = msg.role || '?';
                const content = extractContent(msg.content);
                parts.push(`${role}:\n${content}`);
            }
            input = parts.join('\n\n');
        }

        let output = '';
        if (e.response) {
            output = formatResponse(e.response);
        }

        const inputTokens = e.input_tokens || (e.response?.usage?.input_tokens) || null;
        const outputTokens = e.output_tokens || (e.response?.usage?.output_tokens) || null;

        const rawUsage = e.response?.usage || {};
        const usage = {
            input_tokens: rawUsage.input_tokens || rawUsage.prompt_tokens || e.input_tokens || 0,
            output_tokens: rawUsage.output_tokens || rawUsage.completion_tokens || e.output_tokens || 0,
            cache_creation_input_tokens: rawUsage.cache_creation_input_tokens || 0,
            cache_read_input_tokens: rawUsage.cache_read_input_tokens || 0,
        };

        const spawnedAgentTypes = [];
        let toolCallsNull = false;

        if (e.response && Array.isArray(e.response.choices)) {
            for (const ch of e.response.choices) {
                const msg = ch.message || {};
                const tc = msg.tool_calls;
                if (tc === null || tc === undefined) {
                    toolCallsNull = true;
                } else if (Array.isArray(tc)) {
                    for (const t of tc) {
                        if (!t || !t.function) continue;
                        if (t.function.name === 'Agent') {
                            try {
                                const args = JSON.parse(t.function.arguments || '{}');
                                if (args.subagent_type) spawnedAgentTypes.push(args.subagent_type);
                            } catch (ignored) { }
                        }
                    }
                }
            }
        } else if (e.response && Array.isArray(e.response.content)) {
            const hasToolUse = e.response.content.some(c => c && c.type === 'tool_use');
            if (!hasToolUse && e.response.stop_reason === 'end_turn') {
                toolCallsNull = true;
            }
            for (const c of e.response.content) {
                if (c && c.type === 'tool_use' && c.name === 'Agent') {
                    const inp = c.input || {};
                    if (inp.subagent_type) spawnedAgentTypes.push(inp.subagent_type);
                }
            }
        }

        return {
            timestamp: ts,
            input,
            output,
            inputTokens,
            outputTokens,
            sessionId: e.session_id || e.response?.id || '',
            model: e.model || e.response?.model || '',
            usage,
            spawnedAgentTypes,
            toolCallsNull,
        };
    }

    function formatResponse(resp) {
        const parts = [];
        if (Array.isArray(resp.choices)) {
            for (const ch of resp.choices) {
                const msg = ch.message || ch.delta || {};
                if (msg.content) {
                    parts.push(formatContentBlocks(msg.content));
                }
                if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
                    for (const tc of msg.tool_calls) {
                        const fn = tc.function || {};
                        let argsStr = fn.arguments || '{}';
                        try { argsStr = JSON.stringify(JSON.parse(argsStr), null, 2); } catch (e) { }
                        parts.push(`\n━━━ tool_call: ${fn.name || '?'} ━━━\nid: ${tc.id || '?'}\narguments:\n${argsStr}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
                    }
                }
                if (ch.finish_reason) parts.push(`\n[finish_reason: ${ch.finish_reason}]`);
                if (ch.stop_reason) parts.push(`\n[stop_reason: ${ch.stop_reason}]`);
            }
        }
        if (Array.isArray(resp.content)) {
            parts.push(formatContentBlocks(resp.content));
        }
        if (resp.usage) {
            const u = resp.usage;
            const uParts = [];
            if (u.input_tokens) uParts.push(`input: ${u.input_tokens}`);
            if (u.output_tokens) uParts.push(`output: ${u.output_tokens}`);
            if (u.cache_creation_input_tokens) uParts.push(`cache_creation: ${u.cache_creation_input_tokens}`);
            if (u.cache_read_input_tokens) uParts.push(`cache_read: ${u.cache_read_input_tokens}`);
            if (uParts.length > 0) parts.push(`\n[usage: ${uParts.join(', ')}]`);
        }
        return parts.join('\n');
    }

    function formatContentBlocks(content) {
        if (typeof content === 'string') return content;
        if (!Array.isArray(content)) return String(content || '');
        return content.map(block => {
            if (!block || !block.type) return String(block || '');
            switch (block.type) {
                case 'text':
                    return block.text || '';
                case 'tool_use':
                    return `\n━━━ tool_use: ${block.name || '?'} ━━━\nid: ${block.id || '?'}\ninput: ${JSON.stringify(block.input || {}, null, 2)}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
                case 'tool_result':
                    const resultContent = typeof block.content === 'string'
                        ? block.content
                        : Array.isArray(block.content)
                            ? block.content.map(c => c.text || JSON.stringify(c)).join('\n')
                            : JSON.stringify(block.content || '');
                    return `\n━━━ tool_result (${block.tool_use_id || '?'}) ━━━\n${resultContent}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
                case 'image':
                    return `[image: ${block.source?.type || 'unknown'}]`;
                default:
                    return `[${block.type}]: ${JSON.stringify(block).substring(0, 500)}`;
            }
        }).join('\n');
    }

    function extractContent(content) {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) return formatContentBlocks(content);
        return String(content || '');
    }

    function findBestParent(node, prev) {
        if (prev.length === 0 || node.input.length === 0) return;
        const BLOCK_SIZE = 64;
        let bestP = null, bestRawL = 0, bestQ = 0;
        for (const p of prev) {
            if (p.input.length === 0) continue;
            const min = Math.min(p.input.length, node.input.length);
            let len = 0;
            for (let c = 0; c < min; c++) { if (p.input[c] === node.input[c]) len++; else break; }
            const quantized = Math.floor(len / BLOCK_SIZE) * BLOCK_SIZE;
            if (quantized > bestQ) { bestQ = quantized; bestRawL = len; bestP = p; }
        }
        if (bestP && bestQ >= BLOCK_SIZE) {
            node.parentIndex = bestP.globalIndex;
            node.commonPrefixLen = bestRawL;
            node.prefixCacheRatio = bestRawL / node.input.length;
        }
    }

    function computeOriginRanges(node) {
        if (node.parentIndex === null || node.commonPrefixLen === 0) return [];
        const ranges = [];
        let remainingLen = node.commonPrefixLen;
        let current = nodeMap[node.parentIndex];
        while (current) {
            const parentPrefixLen = (current.parentIndex !== null) ? current.commonPrefixLen : 0;
            if (parentPrefixLen < remainingLen) {
                ranges.push({ from: parentPrefixLen, to: remainingLen, originIdx: current.globalIndex });
                remainingLen = parentPrefixLen;
            }
            if (current.parentIndex === null || remainingLen <= 0) break;
            current = nodeMap[current.parentIndex];
        }
        return ranges.reverse();
    }

    // ---- UI ----
    function showMain() {
        uploadScreen.classList.remove('active');
        mainScreen.classList.add('active');
        updateUI();
    }

    function updateUI() {
        const agentCounts = {};
        for (const n of allNodes) { agentCounts[n.agentType] = (agentCounts[n.agentType] || 0) + 1; }
        const summary = Object.entries(agentCounts).map(([t, c]) => `${c} ${AGENT_TYPES[t]?.label || t}`).join(', ');
        const liveTag = liveMode ? ' [LIVE]' : '';
        fileInfoEl.textContent = `${fileName}${liveTag} · ${allNodes.length} requests (${summary})`;
        nodeCountEl.textContent = `${allNodes.length} requests`;
        renderDAG();
        updateCostBanner();
    }

    function updateCostBanner() {
        const banner = document.getElementById('cost-banner');
        if (!banner) return;

        if (typeof PRICING === 'undefined') { banner.style.display = 'none'; return; }

        const cost = PRICING.calcTotal(allNodes);
        if (!cost) { banner.style.display = 'none'; return; }

        const modelList = Object.entries(cost.models).map(([m, c]) => `${m}×${c}`).join(', ');

        banner.innerHTML = `
            <div class="cost-item">
                <span class="cost-label">💰 With Cache:</span>
                <span class="cost-value cost-with-cache">${PRICING.fmt(cost.withCache)}</span>
            </div>
            <div class="cost-item">
                <span class="cost-label">Without Cache:</span>
                <span class="cost-value cost-without-cache">${PRICING.fmt(cost.withoutCache)}</span>
            </div>
            <div class="cost-item">
                <span class="cost-saved">Saved ${PRICING.fmt(cost.saved)} (${cost.savedPct.toFixed(0)}%)</span>
            </div>
            <div class="cost-item">
                <span class="cost-label">${modelList}</span>
            </div>
        `;
        banner.style.display = 'flex';
    }

    function renderDAG() {
        DAG.render(dagSvg, roots, nodeMap, firstTimestamp, handleNodeClick, selectedIdx, AGENT_TYPES);
    }

    function handleNodeClick(idx) {
        selectedIdx = idx;
        renderDAG();
        const node = nodeMap[idx];
        if (node) showNodeDetail(node);
    }

    function showPlaceholder() {
        detailMeta.innerHTML = '';
        detailTitle.textContent = 'Select a request node';
        detailContent.innerHTML = `
      <div class="detail-placeholder">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
          <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/>
          <line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="12" y2="17"/>
        </svg>
        <p>Click a node in the DAG to view its input and output</p>
      </div>`;
    }

    function showNodeDetail(node) {
        const at = AGENT_TYPES[node.agentType] || AGENT_TYPES.unknown;
        const inputTok = node.inputTokens || est(node.inputChars);
        const outputTok = node.outputTokens || est(node.outputChars);
        const cachePct = node.prefixCacheRatio !== null ? `${Math.round(node.prefixCacheRatio * 100)}%` : '—';
        const apiCacheRead = (node.usage || {}).cache_read_input_tokens || 0;
        const cachedTok = apiCacheRead > 0
            ? `~${fmtN(apiCacheRead)} cached`
            : (node.prefixCacheRatio !== null ? `~${fmtN(est(node.commonPrefixLen))} cached` : '');
        const parentInfo = node.parentIndex !== null ? `#${node.parentIndex}` : 'none';
        const ts = new Date(node.timestamp);
        const delta = (node.timestamp - firstTimestamp) / 1000;

        const spawnerHtml = node.spawnedBy ? `<div class="meta-chip"><span class="label">Spawned By</span><span class="value">#${node.spawnedBy}</span></div>` : '';
        const spawnsHtml = node.spawns.length > 0 ? `<div class="meta-chip"><span class="label">Spawns</span><span class="value">${node.spawns.map(s => `#${s}`).join(', ')}</span></div>` : '';
        const toolsHtml = node.tools.length > 0 ? `<div class="meta-chip"><span class="label">Tools</span><span class="value">${node.tools.map(t => typeof t === 'string' ? t : (t.cmd ? `${t.name}: ${t.cmd}` : t.name)).join(', ')}</span></div>` : '';
        const modelHtml = node.model ? `<div class="meta-chip"><span class="label">Model</span><span class="value">${esc(node.model)}</span></div>` : '';

        detailTitle.textContent = `Request #${node.globalIndex}`;

        detailMeta.innerHTML = `
      <div class="detail-meta fade-in">
        <div class="meta-chip agent-badge" style="border-left: 3px solid ${at.color}; background: ${at.bg}">
          <span class="value" style="color: ${at.color}; font-weight: 600">${at.label}</span>
        </div>
        ${modelHtml}
        <div class="meta-chip"><span class="label">Time</span><span class="value">${esc(ts.toLocaleString())}</span></div>
        <div class="meta-chip"><span class="label">Δ</span><span class="value">${fmtDelta(delta)}</span></div>
        <div class="meta-chip"><span class="label">Session</span><span class="value">${esc(trunc(String(node.sessionId || ''), 18))}</span></div>
        <div class="meta-chip"><span class="label">Parent</span><span class="value">${parentInfo}</span></div>
      </div>
      <div class="detail-meta fade-in" style="animation-delay:.03s">
        <div class="meta-chip"><span class="label">Input</span><span class="value">${fmtN(node.inputChars)} chars · ${node.inputTokens ? '' : '~'}${fmtN(inputTok)} tokens</span></div>
        <div class="meta-chip"><span class="label">Output</span><span class="value">${fmtN(node.outputChars)} chars · ${node.outputTokens ? '' : '~'}${fmtN(outputTok)} tokens</span></div>
        <div class="meta-chip"><span class="label">Prefix Cache</span><span class="value">${cachePct} ${cachedTok}</span></div>
        ${toolsHtml}${spawnerHtml}${spawnsHtml}
      </div>`;

        const ranges = node.originRanges;
        let inputHtml = '';
        if (ranges.length > 0) {
            for (const r of ranges) { inputHtml += `<span class="reused-text" data-origin="${r.originIdx}">${esc(node.input.substring(r.from, r.to))}</span>`; }
            const newPart = node.input.substring(node.commonPrefixLen);
            if (newPart) inputHtml += `<span class="new-text">${esc(newPart)}</span>`;
        } else {
            inputHtml = `<span class="new-text">${esc(node.input)}</span>`;
        }

        const hasReused = ranges.length > 0;
        const firstOrigin = hasReused ? ranges[0].originIdx : null;

        detailContent.innerHTML = `
      <div class="detail-section fade-in" style="animation-delay:.05s">
        <div class="detail-section-header" data-section="input">
          <h4 class="input-label">Input (${fmtN(node.inputChars)} chars)</h4>
          <span class="toggle-arrow open">▶</span>
        </div>
        <div class="detail-section-body open" data-section="input">
          ${hasReused ? `<div class="reused-origin-tag" id="origin-tag">Reused from request #${firstOrigin}</div>` : ''}
          <pre>${inputHtml}</pre>
        </div>
      </div>
      <div class="detail-section fade-in" style="animation-delay:.1s">
        <div class="detail-section-header" data-section="output">
          <h4 class="output-label">Output (${fmtN(node.outputChars)} chars)</h4>
          <span class="toggle-arrow open">▶</span>
        </div>
        <div class="detail-section-body open" data-section="output">
          <pre class="new-text">${esc(node.output)}</pre>
        </div>
      </div>`;

        requestAnimationFrame(() => {
            const newTextEl = detailContent.querySelector('.detail-section-body[data-section="input"] .new-text');
            if (newTextEl && ranges.length > 0) {
                const containerRect = detailContent.getBoundingClientRect();
                const elRect = newTextEl.getBoundingClientRect();
                const scrollOffset = elRect.top - containerRect.top + detailContent.scrollTop;
                detailContent.scrollTop = Math.max(0, scrollOffset - 60);
            } else {
                detailContent.scrollTop = 0;
            }
        });
        detailContent.querySelectorAll('.detail-section-header').forEach(h => {
            h.addEventListener('click', () => {
                const s = h.dataset.section;
                const body = detailContent.querySelector(`.detail-section-body[data-section="${s}"]`);
                const arrow = h.querySelector('.toggle-arrow');
                body.classList.toggle('open');
                arrow.classList.toggle('open');
            });
        });
        if (hasReused) { detailContent.addEventListener('scroll', updateOriginTag); }
    }

    function updateOriginTag() {
        const tag = document.getElementById('origin-tag');
        if (!tag) return;
        const spans = detailContent.querySelectorAll('.reused-text[data-origin]');
        if (spans.length === 0) return;
        const containerRect = detailContent.getBoundingClientRect();
        const targetY = containerRect.top + 80;
        const newSpan = detailContent.querySelector('.new-text');
        if (newSpan) {
            const newRect = newSpan.getBoundingClientRect();
            if (newRect.top <= targetY) { tag.style.opacity = '0.3'; tag.textContent = 'New tokens ↓'; return; }
        }
        let currentOrigin = null;
        for (const span of spans) {
            const rect = span.getBoundingClientRect();
            if (rect.bottom > targetY) { currentOrigin = span.dataset.origin; break; }
        }
        if (currentOrigin) { tag.style.opacity = '1'; tag.textContent = `Reused from request #${currentOrigin}`; }
    }

    // ---- Resize ----
    let resizing = false;
    resizeHandle.addEventListener('mousedown', e => { resizing = true; resizeHandle.classList.add('active'); document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; e.preventDefault(); });
    document.addEventListener('mousemove', e => { if (!resizing) return; const r = document.querySelector('.content').getBoundingClientRect(); panelLeft.style.width = Math.max(280, Math.min(r.width - 300, e.clientX - r.left)) + 'px'; });
    document.addEventListener('mouseup', () => { if (resizing) { resizing = false; resizeHandle.classList.remove('active'); document.body.style.cursor = ''; document.body.style.userSelect = ''; } });

    // ---- Helpers ----
    function resetState() { allNodes = []; nodeMap = {}; roots = []; selectedIdx = null; fileName = ''; firstTimestamp = 0; fileInput.value = ''; detailMeta.innerHTML = ''; rawEntries = []; liveLineCount = 0; zoomLevel = 0.7; applyZoom(); }
    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function trunc(s, m) { return s.length <= m ? s : s.substring(0, m - 1) + '…'; }
    function est(c) { return Math.ceil(c / 4); }
    function fmtN(n) { if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return String(n); }
    function fmtDelta(s) { if (s === 0) return '+0s'; if (s < 60) return `+${Math.round(s)}s`; const m = Math.floor(s / 60); const r = Math.round(s % 60); if (m < 60) return `+${m}m${r}s`; const h = Math.floor(m / 60); return `+${h}h${m % 60}m`; }

    // ============================================================
    // LIVE MODE — Poll server for new trace entries
    // ============================================================
    function startLive(traceFile) {
        liveMode = true;
        liveFile = traceFile;
        liveLineCount = 0;
        rawEntries = [];

        if (liveBadge) {
            liveBadge.style.display = 'inline-block';
        }

        // Initial load
        pollOnce().then(() => {
            // Start polling every 2 seconds
            liveTimer = setInterval(pollOnce, 2000);
        });
    }

    function stopLive() {
        liveMode = false;
        if (liveTimer) {
            clearInterval(liveTimer);
            liveTimer = null;
        }
        if (liveBadge) {
            liveBadge.style.display = 'none';
        }
    }

    async function pollOnce() {
        if (!liveFile) return;

        try {
            const url = `/traces/${liveFile}/poll?after=${liveLineCount}`;
            const resp = await fetch(url);
            if (!resp.ok) return;

            const data = await resp.json();

            if (data.lines && data.lines.length > 0) {
                // Append new entries
                rawEntries = rawEntries.concat(data.lines);
                liveLineCount = data.total;

                // Rebuild visualization from all entries
                const prevSelected = selectedIdx;
                buildFromEntries(rawEntries);
                selectedIdx = prevSelected;
                updateUI();

                // If no node was selected, show placeholder
                if (!selectedIdx) {
                    showPlaceholder();
                }
            } else if (data.total !== undefined) {
                liveLineCount = data.total;
            }
        } catch (e) {
            // Network error — keep polling silently
        }
    }

    // ---- Auto-start from URL params ----
    function checkUrlParams() {
        const params = new URLSearchParams(window.location.search);
        const file = params.get('file');
        const live = params.get('live');

        if (file) {
            // Extract filename from path like /traces/traces_20260316.jsonl
            const traceFile = file.replace(/^\/traces\//, '');
            fileName = traceFile;

            if (live === 'true') {
                // Live mode: skip upload screen, start polling
                showMain();
                showPlaceholder();
                startLive(traceFile);
            } else {
                // Static mode: fetch the full file once
                fetch(file)
                    .then(r => { if (!r.ok) throw new Error('Trace file not found'); return r.text(); })
                    .then(text => {
                        parseAndBuild(text);
                        showMain();
                    })
                    .catch(err => {
                        console.error('Failed to load trace:', err);
                    });
            }
        }
    }

    // Auto-start on page load
    checkUrlParams();
})();
