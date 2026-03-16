/**
 * dag.js — Tree-based DAG renderer.
 * Agent-colored nodes, tool badges on left, cache+delta badges on right.
 * No spawn edges (removed per user preference).
 */
const DAG = (() => {
    const NODE_W = 200;
    const NODE_H = 88;
    const TOOL_BADGE_W = 48;
    const TOOL_BADGE_H = 16;
    const TOOL_GAP = 2;
    const LEFT_MARGIN = 80;
    const RIGHT_MARGIN = 58;
    const COL_W = NODE_W + LEFT_MARGIN + RIGHT_MARGIN;
    const ROW_H = NODE_H + 20;
    const PAD_X = 12;
    const PAD_Y = 16;
    const BADGE_W = 52;
    const BADGE_H = 20;
    const SVG_NS = 'http://www.w3.org/2000/svg';

    // ---- Model Tier Definitions ----
    const MODEL_TIERS = {
        haiku:   { color: '#F59E0B', bg: 'rgba(245,158,11,0.08)', border: '#F59E0B', borderWidth: 1.5, dash: '4,3', icon: '⚡', label: 'Haiku' },
        sonnet:  { color: '#3B82F6', bg: 'rgba(59,130,246,0.08)', border: '#3B82F6', borderWidth: 1.5, dash: '',    icon: '🎵', label: 'Sonnet' },
        opus:    { color: '#A855F7', bg: 'rgba(168,85,247,0.10)', border: '#A855F7', borderWidth: 2.5, dash: '',    icon: '💎', label: 'Opus' },
        gemini:  { color: '#10B981', bg: 'rgba(16,185,129,0.08)', border: '#10B981', borderWidth: 1.5, dash: '',    icon: '✦',  label: 'Gemini' },
        unknown: { color: '#6B7280', bg: 'rgba(107,114,128,0.04)', border: '', borderWidth: 1, dash: '', icon: '', label: '' },
    };

    function resolveModelTier(modelName) {
        if (!modelName) return MODEL_TIERS.unknown;
        const m = modelName.toLowerCase();
        if (m.includes('haiku')) return MODEL_TIERS.haiku;
        if (m.includes('opus')) return MODEL_TIERS.opus;
        if (m.includes('sonnet')) return MODEL_TIERS.sonnet;
        if (m.includes('gemini')) return MODEL_TIERS.gemini;
        return MODEL_TIERS.unknown;
    }

    // Short labels for tools
    const TOOL_LABELS = {
        Task: '🔀 Task', Bash: '$ Bash', Read: '📖 Read', Write: '✏️ Write',
        Edit: '✏️ Edit', MultiEdit: '✏️ Multi', Glob: '🔍 Glob', Grep: '🔎 Grep',
        TodoRead: '📋 Todo', TodoWrite: '📝 Todo', WebFetch: '🌐 Web',
        WebSearch: '🔎 Web', Notebook: '📓 Note', SubOutput: '📤 Sub',
        ExitPlanMode: '🚪 Exit', EnterPlanMode: '📐 Plan', Plan: '📐 Plan',
        AskFollowupQuestion: '❓ Ask', AskUserQuestion: '❓ Ask', Skill: '⚡ Skill',
        SlashCommand: '/ Cmd', ServerAction: '🖥 Srv',
        Agent: '🤖 Agent',
        TaskCreate: '📋 Create', TaskUpdate: '📋 Update',
        TaskDone: '✅ Done', TaskStatus: '📊 Status',
        FileEdit: '✏️ Edit', FileRead: '📖 Read', FileWrite: '✏️ Write',
        ListDir: '📂 List',
        Search: '🔎 Search', UrlFetch: '🌐 Fetch',
        BatchTool: '⚡ Batch', ParallelTool: '⚡ Para',
    };

    // Color map for tool categories
    const TOOL_COLORS = {
        Task: '#A855F7', Bash: '#F59E0B', Read: '#3B82F6', Write: '#10B981',
        Edit: '#10B981', MultiEdit: '#10B981', Glob: '#6366F1', Grep: '#6366F1',
        TodoRead: '#EC4899', TodoWrite: '#EC4899', WebFetch: '#14B8A6',
        WebSearch: '#14B8A6', Notebook: '#8B5CF6', SubOutput: '#64748B',
        ExitPlanMode: '#78716C', EnterPlanMode: '#78716C', Plan: '#78716C',
        AskFollowupQuestion: '#F97316', AskUserQuestion: '#F97316', Skill: '#EAB308',
        SlashCommand: '#78716C', ServerAction: '#64748B',
        Agent: '#A855F7',
        TaskCreate: '#EC4899', TaskUpdate: '#EC4899',
        TaskDone: '#10B981', TaskStatus: '#EC4899',
        FileEdit: '#10B981', FileRead: '#3B82F6', FileWrite: '#10B981',
        ListDir: '#6366F1',
        Search: '#6366F1', UrlFetch: '#14B8A6',
        BatchTool: '#F97316', ParallelTool: '#F97316',
    };

    function el(tag, attrs) {
        const e = document.createElementNS(SVG_NS, tag);
        for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
        return e;
    }

    function render(svg, roots, nodeMap, firstTs, onNodeClick, selIdx, agentTypes) {
        svg.innerHTML = '';
        if (roots.length === 0) return;

        const pos = {};
        let nextCol = 0;
        for (const r of roots) {
            layoutTree(r, nodeMap, pos, nextCol, 0);
            nextCol += stWidth(r, nodeMap) + 1;
        }

        let maxC = 0, maxR = 0;
        for (const p of Object.values(pos)) {
            if (p.col > maxC) maxC = p.col;
            if (p.row > maxR) maxR = p.row;
        }
        svg.setAttribute('width', PAD_X * 2 + (maxC + 1) * COL_W + BADGE_W + 8);
        svg.setAttribute('height', PAD_Y * 2 + (maxR + 1) * ROW_H);
        svg.style.overflow = 'visible';

        // Tree edges (solid)
        for (const idx in pos) {
            const n = nodeMap[idx];
            if (n && n.parentIndex !== null && pos[n.parentIndex]) {
                drawEdge(svg, pos[n.parentIndex], pos[idx]);
            }
        }

        // Nodes
        for (const idx in pos) {
            const n = nodeMap[idx];
            if (n) drawNode(svg, n, pos[idx], firstTs, onNodeClick, selIdx, agentTypes);
        }
    }

    function stWidth(idx, nm) {
        const n = nm[idx];
        if (!n || n.children.length === 0) return 1;
        let w = 0;
        for (const c of n.children) w += stWidth(c, nm);
        if (n.children.length > 1) w += n.children.length - 1; // account for GAP between siblings
        return w;
    }

    function layoutTree(idx, nm, pos, colStart, depth) {
        const n = nm[idx];
        if (!n) return;
        if (n.children.length === 0) { pos[idx] = { col: colStart, row: depth }; return; }
        const kids = [...n.children].sort((a, b) => a - b);
        let cur = colStart;
        const GAP = kids.length > 1 ? 1 : 0; // add 1 column gap between branches
        for (let i = 0; i < kids.length; i++) {
            layoutTree(kids[i], nm, pos, cur, depth + 1);
            cur += stWidth(kids[i], nm);
            if (i < kids.length - 1) cur += GAP;
        }
        const fc = pos[kids[0]], lc = pos[kids[kids.length - 1]];
        pos[idx] = { col: (fc.col + lc.col) / 2, row: depth };
    }

    function drawEdge(svg, pp, cp) {
        const px = PAD_X + pp.col * COL_W + LEFT_MARGIN + NODE_W / 2;
        const py = PAD_Y + pp.row * ROW_H + NODE_H;
        const cx = PAD_X + cp.col * COL_W + LEFT_MARGIN + NODE_W / 2;
        const cy = PAD_Y + cp.row * ROW_H;
        const my = py + (cy - py) / 2;
        svg.appendChild(el('path', {
            d: `M${px},${py} L${px},${my} L${cx},${my} L${cx},${cy}`,
            class: 'dag-edge', fill: 'none',
        }));
        const a = 5;
        svg.appendChild(el('polygon', {
            points: `${cx},${cy} ${cx - a},${cy - a * 1.5} ${cx + a},${cy - a * 1.5}`,
            fill: 'rgba(139,92,246,0.3)',
        }));
    }

    function drawNode(svg, node, p, firstTs, onNodeClick, selIdx, agentTypes) {
        const x = PAD_X + p.col * COL_W + LEFT_MARGIN;
        const y = PAD_Y + p.row * ROW_H;
        const sel = node.globalIndex === selIdx;
        const at = (agentTypes && agentTypes[node.agentType]) || { color: '#6B7280', bg: 'rgba(107,114,128,0.08)' };
        const mt = resolveModelTier(node.model);

        const g = el('g', { class: `dag-node ${sel ? 'selected' : ''}`, 'data-global-index': node.globalIndex });

        // Node background — blend agent bg with model tier tint
        const rectAttrs = {
            x, y, width: NODE_W, height: NODE_H,
            class: 'dag-node-rect', fill: mt.bg || at.bg,
            stroke: sel ? at.color : (mt.border || 'var(--border-color)'),
            'stroke-width': sel ? 2.5 : mt.borderWidth,
        };
        if (mt.dash) rectAttrs['stroke-dasharray'] = mt.dash;
        g.appendChild(el('rect', rectAttrs));

        // Left color bar — use model tier color if available, else agent color
        const barColor = mt.color !== '#6B7280' ? mt.color : at.color;
        g.appendChild(el('rect', { x, y, width: 3, height: NODE_H, rx: 1.5, fill: barColor, opacity: 0.8 }));

        // Agent type mini-badge (top-left, inside node)
        const agentLabel = (AGENT_TYPES_SHORT[node.agentType] || node.agentType || '?').toUpperCase();
        const alW = agentLabel.length * 5.5 + 8;
        g.appendChild(el('rect', { x: x + 5, y: y + 3, width: alW, height: 13, rx: 3, fill: at.color, opacity: 0.2 }));
        const al = el('text', { x: x + 9, y: y + 12, class: 'dag-label-agent', fill: at.color });
        al.textContent = agentLabel;
        g.appendChild(al);

        // Model tier badge (top-right, inside node, on same line as agent badge)
        if (mt.label) {
            const mtLabel = `${mt.icon} ${mt.label}`;
            const mtW = mt.label.length * 5.5 + (mt.icon ? 14 : 0) + 8;
            const mtX = x + NODE_W - mtW - 5;
            g.appendChild(el('rect', { x: mtX, y: y + 3, width: mtW, height: 13, rx: 3, fill: mt.color, opacity: 0.15 }));
            const mtText = el('text', { x: mtX + mtW / 2, y: y + 12, class: 'dag-label-model', fill: mt.color, 'text-anchor': 'middle' });
            mtText.textContent = mtLabel;
            g.appendChild(mtText);
        }

        // Time (below agent/model badges)
        const ts = new Date(node.timestamp);
        const timeStr = ts.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const tt = el('text', { x: x + NODE_W - 6, y: y + 76, class: 'dag-label-time', 'text-anchor': 'end' });
        tt.textContent = timeStr;
        g.appendChild(tt);

        // Row 2: #N ← #P
        const id = el('text', { x: x + 8, y: y + 30, class: 'dag-label-id' });
        id.textContent = `#${node.globalIndex}`;
        g.appendChild(id);
        if (node.parentIndex !== null) {
            const pt = el('text', { x: x + 44, y: y + 30, class: 'dag-label-parent' });
            pt.textContent = `← #${node.parentIndex}`;
            g.appendChild(pt);
        }
        if (node.spawns.length > 0) {
            const sp = el('text', { x: x + NODE_W - 6, y: y + 30, class: 'dag-label-spawns', 'text-anchor': 'end' });
            sp.textContent = `↗${node.spawns.length}`;
            g.appendChild(sp);
        }
        if (node.spawnedBy !== null) {
            const sb = el('text', { x: x + NODE_W - 6, y: y + 76, class: 'dag-label-spawned-by', 'text-anchor': 'end' });
            sb.textContent = `↙#${node.spawnedBy}`;
            g.appendChild(sb);
        }

        // Row 3: in: X tok  out: Y tok
        const inTok = node.inputTokens || Math.ceil(node.inputChars / 4);
        const outTok = node.outputTokens || Math.ceil(node.outputChars / 4);
        const tokPrefix = (node.inputTokens && node.outputTokens) ? '' : '~';
        const s3 = el('text', { x: x + 8, y: y + 46, class: 'dag-label-stats' });
        s3.textContent = `in: ${tokPrefix}${fN(inTok)} tok  out: ${tokPrefix}${fN(outTok)} tok`;
        g.appendChild(s3);

        // Row 4: new + cached (from usage data if available)
        const usage = node.usage || {};
        const cacheRead = usage.cache_read_input_tokens || 0;
        const cacheWrite = usage.cache_creation_input_tokens || 0;
        if (cacheRead > 0 || cacheWrite > 0) {
            const s4 = el('text', { x: x + 8, y: y + 60, class: 'dag-label-new-tokens' });
            const newTok = Math.max(0, (usage.input_tokens || inTok) - cacheRead);
            s4.textContent = `new: ${fN(newTok)} · cached: ${fN(cacheRead)}`;
            g.appendChild(s4);
        } else if (node.prefixCacheRatio !== null) {
            const nc = node.inputChars - node.commonPrefixLen;
            const s4 = el('text', { x: x + 8, y: y + 60, class: 'dag-label-new-tokens' });
            s4.textContent = `new: ~${fN(Math.ceil(nc / 4))} · cached: ~${fN(Math.ceil(node.commonPrefixLen / 4))}`;
            g.appendChild(s4);
        }

        // Row 5: total tokens
        const s5 = el('text', { x: x + 8, y: y + 76, class: 'dag-label-stats' });
        s5.textContent = `${tokPrefix}${fN(inTok + outTok)} total tok`;
        g.appendChild(s5);

        // ---- Left side: Tool badges ----
        const tools = node.tools || [];
        if (tools.length > 0) {
            const maxShow = Math.min(tools.length, 4);
            const totalH = maxShow * (TOOL_BADGE_H + TOOL_GAP) - TOOL_GAP;
            const startY = y + (NODE_H - totalH) / 2;
            for (let i = 0; i < maxShow; i++) {
                const t = tools[i];
                // Support both string format (old) and {name, cmd} object format
                const toolName = typeof t === 'string' ? t : t.name;
                const toolCmd = typeof t === 'object' ? t.cmd : null;
                const ty = startY + i * (TOOL_BADGE_H + TOOL_GAP);
                // Widen badge if cmd detail exists
                const badgeW = toolCmd ? TOOL_BADGE_W + 20 : TOOL_BADGE_W;
                const tx = x - badgeW - 6;
                const tc2 = TOOL_COLORS[toolName] || '#6B7280';
                g.appendChild(el('rect', {
                    x: tx, y: ty, width: badgeW, height: TOOL_BADGE_H,
                    rx: 3, fill: `${tc2}15`, stroke: `${tc2}40`,
                    'stroke-width': 1,
                }));
                // Build label: "$ Bash: ls" or "📖 Read"
                let labelText = TOOL_LABELS[toolName] || toolName;
                if (toolCmd) labelText += `: ${toolCmd}`;
                const tl = el('text', {
                    x: tx + badgeW / 2, y: ty + 11.5,
                    class: 'dag-label-tool', fill: tc2, 'text-anchor': 'middle',
                });
                tl.textContent = labelText;
                g.appendChild(tl);
            }
            if (tools.length > maxShow) {
                const moreY = startY + maxShow * (TOOL_BADGE_H + TOOL_GAP);
                const moreTx = x - TOOL_BADGE_W / 2 - 6;
                const mt = el('text', {
                    x: moreTx, y: moreY + 8,
                    class: 'dag-label-tool-more', 'text-anchor': 'middle',
                });
                mt.textContent = `+${tools.length - maxShow} more`;
                g.appendChild(mt);
            }
        }

        // ---- Right side: Cache + Delta badges (positioned just outside, may overlap with next col) ----
        const bx = x + NODE_W + 4;

        if (node.prefixCacheRatio !== null) {
            const pct = Math.round(node.prefixCacheRatio * 100);
            const bc = cacheColor(pct);
            const by = y + NODE_H / 2 - BADGE_H - 6;
            g.appendChild(el('rect', {
                x: bx, y: by, width: BADGE_W, height: BADGE_H,
                class: 'dag-shared-badge', fill: bc.bg, stroke: bc.border, 'stroke-width': 1,
            }));
            const bt = el('text', {
                x: bx + BADGE_W / 2, y: by + 14,
                class: 'dag-label-shared', fill: bc.text, 'text-anchor': 'middle',
            });
            bt.textContent = `${pct}%`;
            g.appendChild(bt);
        }

        const delta = (node.timestamp - firstTs) / 1000;
        const deltaStr = fmtDelta(delta);
        const tdY = y + NODE_H / 2 + 4;
        g.appendChild(el('rect', { x: bx, y: tdY, width: BADGE_W, height: BADGE_H, class: 'dag-delta-badge' }));
        const dt = el('text', { x: bx + BADGE_W / 2, y: tdY + 14, class: 'dag-label-delta', 'text-anchor': 'middle' });
        dt.textContent = deltaStr;
        g.appendChild(dt);

        g.addEventListener('click', () => onNodeClick(node.globalIndex));
        svg.appendChild(g);
    }

    // Short agent type labels for node badges
    const AGENT_TYPES_SHORT = {
        main: 'Main', explore: 'Explore', plan: 'Plan', summary: 'Summary',
        topic: 'Topic', extract: 'Extract', display: 'Display', toolbox: 'Toolbox',
        pr: 'PR', unknown: 'Agent',
    };

    function fmtDelta(s) {
        if (s === 0) return '+0s';
        if (s < 60) return `+${Math.round(s)}s`;
        const m = Math.floor(s / 60);
        const r = Math.round(s % 60);
        if (m < 60) return `+${m}m${r}s`;
        const h = Math.floor(m / 60);
        return `+${h}h${m % 60}m`;
    }

    function cacheColor(p) {
        if (p >= 80) return { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)', text: '#10B981' };
        if (p >= 50) return { bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.3)', text: '#3B82F6' };
        if (p >= 20) return { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)', text: '#F59E0B' };
        return { bg: 'rgba(244,63,94,0.12)', border: 'rgba(244,63,94,0.3)', text: '#F43F5E' };
    }

    function fN(n) { if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return String(n); }
    function fC(n) { if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K'; return String(n); }

    return { render };
})();
