// ui.js
// Handles all user interactions, UI synchronization, and the step-by-step playback engine.

document.addEventListener('DOMContentLoaded', () => {
    // -------------------------------------------------------
    // Mode Toggles
    // -------------------------------------------------------
    const modeNodeBtn = document.getElementById('mode-node');
    const modeEdgeBtn = document.getElementById('mode-edge');
    const modeDeleteBtn = document.getElementById('mode-delete');

    function setMode(newMode) {
        state.mode = newMode;
        modeNodeBtn.classList.remove('active');
        modeEdgeBtn.classList.remove('active');
        modeDeleteBtn.classList.remove('active');
        cy.nodes().removeClass('selected-source');
        state.sourceNodeId = null;

        if (newMode === 'node') modeNodeBtn.classList.add('active');
        else if (newMode === 'edge') modeEdgeBtn.classList.add('active');
        else if (newMode === 'delete') modeDeleteBtn.classList.add('active');
    }

    modeNodeBtn.addEventListener('click', () => setMode('node'));
    modeEdgeBtn.addEventListener('click', () => setMode('edge'));
    modeDeleteBtn.addEventListener('click', () => setMode('delete'));

    // -------------------------------------------------------
    // Generator Buttons
    // -------------------------------------------------------
    document.getElementById('gen-cycle').addEventListener('click', () => generateCycleGraph());
    document.getElementById('gen-complete').addEventListener('click', () => generateCompleteGraph());
    document.getElementById('gen-grid').addEventListener('click', () => generateGridGraph());
    document.getElementById('gen-random').addEventListener('click', () => generateRandomGraph());

    // -------------------------------------------------------
    // Graph Tools
    // -------------------------------------------------------
    document.getElementById('btn-clear').addEventListener('click', () => {
        clearGraph();
        updateLegend(0);
        logPanel.innerHTML = '';
        logMessage('Canvas cleared.', 'info');
    });

    document.getElementById('btn-export').addEventListener('click', () => {
        const json = cy.json();
        const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(json));
        const a = document.createElement('a');
        a.href = dataStr;
        a.download = 'graph.json';
        a.click();
    });

    document.getElementById('import-json').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const json = JSON.parse(evt.target.result);
                cy.json(json);
                updateStats();
                let maxN = 0, maxE = 0;
                cy.nodes().forEach(n => {
                    const num = parseInt(n.id().replace('n', ''));
                    if (!isNaN(num) && num > maxN) maxN = num;
                });
                cy.edges().forEach(ed => {
                    const num = parseInt(ed.id().replace('e', ''));
                    if (!isNaN(num) && num > maxE) maxE = num;
                });
                state.nodeIdCounter = maxN + 1;
                state.edgeIdCounter = maxE + 1;
                logMessage('Graph imported successfully.', 'success');
            } catch (err) {
                alert('Failed to parse JSON.');
            }
        };
        reader.readAsText(file);
    });

    // -------------------------------------------------------
    // Theme Toggle
    // -------------------------------------------------------
    const themeToggleBtn = document.getElementById('theme-toggle');
    const rootDoc = document.documentElement;

    if (localStorage.getItem('theme') === 'dark') {
        rootDoc.setAttribute('data-theme', 'dark');
        themeToggleBtn.innerHTML = '<i class="ph ph-sun"></i>';
    }

    themeToggleBtn.addEventListener('click', () => {
        if (rootDoc.getAttribute('data-theme') === 'dark') {
            rootDoc.removeAttribute('data-theme');
            localStorage.setItem('theme', 'light');
            themeToggleBtn.innerHTML = '<i class="ph ph-moon"></i>';
        } else {
            rootDoc.setAttribute('data-theme', 'dark');
            localStorage.setItem('theme', 'dark');
            themeToggleBtn.innerHTML = '<i class="ph ph-sun"></i>';
        }
    });

    // -------------------------------------------------------
    // Step-by-Step Toggle
    // -------------------------------------------------------
    document.getElementById('step-by-step-toggle').addEventListener('change', (e) => {
        state.isStepByStep = e.target.checked;
    });

    // -------------------------------------------------------
    // Run & Chromatic Number buttons
    // -------------------------------------------------------
    document.getElementById('btn-run').addEventListener('click', executeRunToggle);

    document.getElementById('btn-chromatic').addEventListener('click', () => {
        if (state.isColoring) return;
        logMessage('Calculating Chromatic Number…', 'info');
        const cn = calculateChromaticNumber();
        logMessage(`Chromatic Number χ(G) = ${cn}`, 'success');
        document.getElementById('colors-input').value = cn;
    });
});

// -------------------------------------------------------
// Logger
// -------------------------------------------------------
const logPanel = document.getElementById('log-panel');

function logMessage(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `log-entry ${type}`;
    el.innerText = `> ${msg}`;
    logPanel.appendChild(el);
    logPanel.scrollTop = logPanel.scrollHeight;
}

// -------------------------------------------------------
// Color Legend
// -------------------------------------------------------
function updateLegend(maxColors) {
    const legendSection = document.getElementById('legend-section');
    const colorLegend = document.getElementById('color-legend');

    if (!maxColors || maxColors <= 0) {
        legendSection.style.display = 'none';
        return;
    }

    legendSection.style.display = 'block';
    colorLegend.innerHTML = '';

    for (let i = 0; i < maxColors; i++) {
        const swatch = document.createElement('div');
        swatch.className = 'color-swatch';
        swatch.style.backgroundColor = PALETTE[i % PALETTE.length];
        swatch.innerText = i;
        swatch.title = `Color ${i}`;
        colorLegend.appendChild(swatch);
    }
}

// -------------------------------------------------------
// Execution Engine (step-by-step playback)
// -------------------------------------------------------
let executionIterator = null;
let playbackTimer = null;

function executeRunToggle() {
    const btn = document.getElementById('btn-run');

    if (state.isColoring) {
        // ---- STOP ----
        state.isColoring = false;
        clearTimeout(playbackTimer);
        btn.innerHTML = '<i class="ph ph-play"></i> Run Coloring';
        btn.classList.remove('danger');
        btn.classList.add('primary');
        logMessage('Execution halted by user.', 'warning');
        // Clean up visual markers but keep any colors assigned so far
        cy.nodes().removeClass('active-algo backtracking');
        cy.edges().removeClass('conflict-edge');
        return;
    }

    // ---- START ----
    if (cy.nodes().length === 0) {
        logMessage('Graph is empty. Add some nodes first.', 'warning');
        return;
    }

    resetColors();
    updateLegend(0);
    logPanel.innerHTML = '';
    state.isColoring = true;
    btn.innerHTML = '<i class="ph ph-stop"></i> Stop';
    btn.classList.remove('primary');
    btn.classList.add('danger');

    const algo = document.getElementById('algo-select').value;
    const mColors = parseInt(document.getElementById('colors-input').value, 10);

    if (algo === 'greedy') executionIterator = runGreedyColoring();
    else if (algo === 'dsatur') executionIterator = runDSATURColoring();
    else if (algo === 'backtracking') executionIterator = runBacktrackingColoring(mColors);

    logMessage(`Starting ${algo.toUpperCase()} algorithm…`);

    // Determine step delay
    const delay = state.isStepByStep ? 700 : 150;
    scheduleNextStep(delay);
}

/** Schedules the next algorithm step after `delay` ms */
function scheduleNextStep(delay) {
    playbackTimer = setTimeout(() => processNextStep(delay), delay);
}

function processNextStep(delay) {
    if (!executionIterator || !state.isColoring) return;

    const result = executionIterator.next();

    if (result.done) {
        finalizeExecution();
        return;
    }

    const step = result.value;

    // Clear transient visual markers from previous step
    cy.nodes().removeClass('active-algo backtracking');
    cy.edges().removeClass('conflict-edge');

    // Highlight current node
    if (step.nodeId) {
        cy.getElementById(step.nodeId).addClass('active-algo');
    }

    // ---- Handle each step type ----

    if (step.type === 'investigate') {
        logMessage(step.msg, 'info');
    }
    else if (step.type === 'conflict') {
        // Highlight conflicting edges in red
        logMessage(step.msg, 'warning');
        if (step.edgeIds) {
            step.edgeIds.forEach(edgeId => {
                cy.getElementById(edgeId).addClass('conflict-edge');
            });
        }
    }
    else if (step.type === 'color') {
        logMessage(step.msg, 'success');
        const node = cy.getElementById(step.nodeId);
        const color = PALETTE[step.colorIndex % PALETTE.length];
        node.style('background-color', color);
        node.data('colorIndex', step.colorIndex);
        // ★ Track color incrementally so applyFinalColors always has full data
        state.finalColors.set(step.nodeId, step.colorIndex);
    }
    else if (step.type === 'backtrack') {
        logMessage(step.msg, 'warning');
        const node = cy.getElementById(step.nodeId);
        // Visual: flash a red "backtracking" border, then reset to grey
        node.addClass('backtracking');
        node.style('background-color', COLORS.defaultNode);
        node.data('colorIndex', -1);
        // ★ Remove from tracked colors on backtrack
        state.finalColors.delete(step.nodeId);
    }
    else if (step.type === 'fail_node') {
        logMessage(step.msg, 'error');
    }
    else if (step.type === 'done') {
        logMessage(step.msg, 'success');
        document.getElementById('stat-colors').innerText = step.maxColors;

        // ★ Persist final colors so they survive after animation ends
        if (step.finalColors) {
            state.finalColors = step.finalColors;
        }

        updateLegend(step.maxColors);
        finalizeExecution();
        return; // don't schedule another step
    }
    else if (step.type === 'fail') {
        logMessage(step.msg, 'error');
        document.getElementById('stat-colors').innerText = '-';
        updateLegend(0);
        finalizeExecution();
        return;
    }

    // Schedule the next step
    scheduleNextStep(delay);
}

// -------------------------------------------------------
// Finalize: persist colors and clean up UI
// -------------------------------------------------------
function finalizeExecution() {
    state.isColoring = false;
    clearTimeout(playbackTimer);

    // Remove all transient visual markers
    cy.nodes().removeClass('active-algo backtracking');
    cy.edges().removeClass('conflict-edge');

    // ★ Defer applyFinalColors slightly so all pending Cytoscape renders flush first
    setTimeout(() => {
        applyFinalColors();
    }, 100);

    const btn = document.getElementById('btn-run');
    btn.innerHTML = '<i class="ph ph-arrow-counter-clockwise"></i> Run Again';
    btn.classList.remove('danger');
    btn.classList.add('primary');

    logMessage('Algorithm finished — final coloring applied.', 'info');
}
