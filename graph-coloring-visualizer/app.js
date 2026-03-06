// app.js
// Core application state, Cytoscape initialization, graph manipulation, and generators.

const PALETTE = [
  '#ef4444', // Red 500
  '#3b82f6', // Blue 500
  '#10b981', // Emerald 500
  '#f59e0b', // Amber 500
  '#8b5cf6', // Violet 500
  '#ec4899', // Pink 500
  '#06b6d4', // Cyan 500
  '#f97316', // Orange 500
  '#84cc16', // Lime 500
  '#14b8a6', // Teal 500
  '#6366f1', // Indigo 500
  '#d946ef', // Fuchsia 500
];

const COLORS = {
  defaultNode: '#94a3b8',
  defaultEdge: '#cbd5e1',
  activeBorder: '#3b82f6',
  conflictEdge: '#ef4444',
  highlightEdge: '#94a3b8'
};

// -------------------------------------------------------
// Main application state
// -------------------------------------------------------
const state = {
  mode: 'node',           // 'node' | 'edge' | 'delete'
  sourceNodeId: null,     // For edge creation (first click)
  nodeIdCounter: 1,
  edgeIdCounter: 1,
  isColoring: false,      // True while an algorithm is running
  isStepByStep: false,    // Toggle for slow / fast playback
  finalColors: new Map(), // nodeId -> colorIndex  (persisted after algorithm)
};

// Cytoscape Instance
let cy;

document.addEventListener('DOMContentLoaded', () => {
  initCytoscape();
  setupCanvasEventHandlers();
});

// -------------------------------------------------------
// Initialize Cytoscape
// -------------------------------------------------------
function initCytoscape() {
  cy = cytoscape({
    container: document.getElementById('cy'),
    style: [
      {
        selector: 'node',
        style: {
          'background-color': COLORS.defaultNode,
          'label': 'data(label)',
          'color': '#fff',
          'text-valign': 'center',
          'text-halign': 'center',
          'font-size': '12px',
          'font-family': 'Inter',
          'font-weight': '600',
          'width': '40px',
          'height': '40px',
          'border-width': 0,
          'border-color': COLORS.activeBorder,
          'transition-property': 'border-width, border-color, width, height',
          'transition-duration': '0.3s'
        }
      },
      {
        selector: 'node.selected-source',
        style: {
          'border-width': 4,
          'border-color': COLORS.activeBorder,
        }
      },
      {
        selector: 'node.active-algo',
        style: {
          'border-width': 4,
          'border-color': COLORS.activeBorder,
          'border-style': 'dashed',
          'width': '48px',
          'height': '48px',
        }
      },
      {
        selector: 'node.backtracking',
        style: {
          'border-width': 4,
          'border-color': '#ef4444',
          'border-style': 'double',
          'width': '48px',
          'height': '48px',
        }
      },
      {
        selector: 'edge',
        style: {
          'width': 3,
          'line-color': COLORS.defaultEdge,
          'curve-style': 'bezier',
          'transition-property': 'line-color, width',
          'transition-duration': '0.3s'
        }
      },
      {
        selector: 'edge.conflict-edge',
        style: {
          'line-color': COLORS.conflictEdge,
          'width': 4,
        }
      }
    ],
    elements: [],
    layout: { name: 'preset' },
    userZoomingEnabled: true,
    userPanningEnabled: true,
    boxSelectionEnabled: false
  });

  updateStats();
}

// -------------------------------------------------------
// Canvas event handlers (add node, edge, delete)
// -------------------------------------------------------
function setupCanvasEventHandlers() {
  // Tap on background → add node
  cy.on('tap', (evt) => {
    if (state.isColoring) return;
    if (evt.target === cy && state.mode === 'node') {
      addNode(evt.position);
    }
  });

  // Tap on node → edge creation or delete
  cy.on('tap', 'node', (evt) => {
    if (state.isColoring) return;
    const node = evt.target;

    if (state.mode === 'delete') {
      node.remove();
      updateStats();
    } else if (state.mode === 'edge') {
      if (!state.sourceNodeId) {
        state.sourceNodeId = node.id();
        node.addClass('selected-source');
      } else {
        const sourceId = state.sourceNodeId;
        const targetId = node.id();
        if (sourceId !== targetId) {
          const existing = cy.edges(`[source="${sourceId}"][target="${targetId}"], [source="${targetId}"][target="${sourceId}"]`);
          if (existing.length === 0) addEdge(sourceId, targetId);
        }
        cy.nodes().removeClass('selected-source');
        state.sourceNodeId = null;
      }
    }
  });

  // Tap on edge → delete
  cy.on('tap', 'edge', (evt) => {
    if (state.isColoring) return;
    if (state.mode === 'delete') {
      evt.target.remove();
      updateStats();
    }
  });
}

// -------------------------------------------------------
// Graph helpers
// -------------------------------------------------------
function updateStats() {
  document.getElementById('stat-nodes').innerText = cy.nodes().length;
  document.getElementById('stat-edges').innerText = cy.edges().length;
}

function addNode(position) {
  const id = `n${state.nodeIdCounter++}`;
  cy.add({
    group: 'nodes',
    data: { id, label: `${state.nodeIdCounter - 1}`, colorIndex: -1 },
    position
  });
  updateStats();
}

function addEdge(source, target) {
  cy.add({
    group: 'edges',
    data: { id: `e${state.edgeIdCounter++}`, source, target }
  });
  updateStats();
}

function clearGraph() {
  if (state.isColoring) return;
  cy.elements().remove();
  state.nodeIdCounter = 1;
  state.edgeIdCounter = 1;
  state.sourceNodeId = null;
  state.finalColors = new Map();
  resetColors();
  updateStats();
}

// -------------------------------------------------------
// Color management
// -------------------------------------------------------

/** Remove all coloring from the graph (reset to default grey) */
function resetColors() {
  cy.nodes().forEach(node => {
    node.data('colorIndex', -1);
    node.style('background-color', COLORS.defaultNode);
    node.removeClass('active-algo backtracking');
  });
  cy.edges().removeClass('conflict-edge');
  state.finalColors = new Map();
  document.getElementById('stat-colors').innerText = '-';
}

/**
 * Apply the stored finalColors map permanently to every node.
 * Uses cy.batch() to apply all changes atomically.
 * Called after the algorithm finishes so colors persist on screen.
 */
function applyFinalColors() {
  if (!state.finalColors || state.finalColors.size === 0) return;

  cy.batch(() => {
    cy.nodes().forEach(node => {
      const colorIndex = state.finalColors.get(node.id());
      if (colorIndex !== undefined && colorIndex >= 0) {
        node.style('background-color', PALETTE[colorIndex % PALETTE.length]);
        node.data('colorIndex', colorIndex);
      }
    });
  });
}

// -------------------------------------------------------
// Graph template generators
// -------------------------------------------------------
function generateCycleGraph(n = 6) {
  clearGraph();
  const radius = 100;
  const center = { x: cy.width() / 2, y: cy.height() / 2 };
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    addNode({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
  }
  for (let i = 1; i <= n; i++) {
    addEdge(`n${i}`, `n${(i % n) + 1}`);
  }
}

function generateCompleteGraph(n = 5) {
  clearGraph();
  const radius = 100;
  const center = { x: cy.width() / 2, y: cy.height() / 2 };
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    addNode({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
  }
  for (let i = 1; i <= n; i++) {
    for (let j = i + 1; j <= n; j++) {
      addEdge(`n${i}`, `n${j}`);
    }
  }
}

function generateGridGraph(rows = 3, cols = 4) {
  clearGraph();
  const cellW = 80, cellH = 80;
  const startX = cy.width() / 2 - (cols * cellW) / 2 + cellW / 2;
  const startY = cy.height() / 2 - (rows * cellH) / 2 + cellH / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      addNode({ x: startX + c * cellW, y: startY + r * cellH });
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c + 1;
      if (c < cols - 1) addEdge(`n${idx}`, `n${idx + 1}`);
      if (r < rows - 1) addEdge(`n${idx}`, `n${idx + cols}`);
    }
  }
}

function generateRandomGraph(n = 8, prob = 0.3) {
  clearGraph();
  const w = cy.width(), h = cy.height(), pad = 50;
  for (let i = 0; i < n; i++) {
    addNode({ x: pad + Math.random() * (w - 2 * pad), y: pad + Math.random() * (h - 2 * pad) });
  }
  for (let i = 1; i <= n; i++) {
    for (let j = i + 1; j <= n; j++) {
      if (Math.random() < prob) addEdge(`n${i}`, `n${j}`);
    }
  }
}
