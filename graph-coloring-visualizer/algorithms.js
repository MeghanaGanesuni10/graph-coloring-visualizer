// algorithms.js
// Holds all graph coloring algorithms, which yield step-by-step states for animation.
// Each algorithm is a generator function that yields "step" objects consumed by ui.js.

// -------------------------------------------------------
// Utility: Build adjacency list from the current Cytoscape graph
// -------------------------------------------------------
function buildAdjacencyList() {
    const adjList = new Map();
    const nodes = cy.nodes();

    nodes.forEach(node => {
        adjList.set(node.id(), []);
    });

    cy.edges().forEach(edge => {
        const source = edge.source().id();
        const target = edge.target().id();
        adjList.get(source).push(target);
        adjList.get(target).push(source);
    });

    return adjList;
}

// -------------------------------------------------------
// Algorithm 1: Greedy Graph Coloring
// -------------------------------------------------------
function* runGreedyColoring() {
    const nodes = cy.nodes().toArray();
    const adjList = buildAdjacencyList();
    const resultColors = new Map(); // nodeId -> colorIndex

    let maxColorUsed = 0;

    for (const node of nodes) {
        const nodeId = node.id();

        // Step: highlight current node being investigated
        yield { type: 'investigate', nodeId: nodeId, msg: `Investigating node ${node.data('label')}` };

        // Find colors used by neighbors
        const neighborColors = new Set();
        const conflictEdges = [];
        for (const neighborId of adjList.get(nodeId)) {
            if (resultColors.has(neighborId)) {
                neighborColors.add(resultColors.get(neighborId));
                // Collect edges to neighbors for conflict checking visualization
                const edge = cy.edges(`[source="${nodeId}"][target="${neighborId}"], [source="${neighborId}"][target="${nodeId}"]`);
                if (edge.length > 0) conflictEdges.push(edge[0].id());
            }
        }

        // Yield conflict highlight if there are colored neighbors
        if (conflictEdges.length > 0) {
            yield { type: 'conflict', nodeId: nodeId, edgeIds: conflictEdges, msg: `Checking ${conflictEdges.length} neighbor constraint(s)` };
        }

        // Find the lowest available color
        let colorIndex = 0;
        while (neighborColors.has(colorIndex)) {
            colorIndex++;
        }

        resultColors.set(nodeId, colorIndex);
        maxColorUsed = Math.max(maxColorUsed, colorIndex + 1);

        // Step: color the node
        yield { type: 'color', nodeId: nodeId, colorIndex: colorIndex, msg: `Assigned color ${colorIndex} to node ${node.data('label')}` };
    }

    // Done – include the full finalColors map so the UI can persist them
    yield { type: 'done', maxColors: maxColorUsed, finalColors: resultColors, msg: `Greedy coloring finished using ${maxColorUsed} color(s).` };
    return maxColorUsed;
}

// -------------------------------------------------------
// Algorithm 2: DSATUR (Degree of Saturation)
// -------------------------------------------------------
function* runDSATURColoring() {
    const nodes = cy.nodes().toArray();
    const adjList = buildAdjacencyList();
    const resultColors = new Map();
    const uncoloredNodes = new Set(nodes.map(n => n.id()));

    let maxColorUsed = 0;

    // Saturation = number of distinct colors among colored neighbors
    function getSaturation(nodeId) {
        const coloredNeighbors = new Set();
        for (const neighborId of adjList.get(nodeId)) {
            if (resultColors.has(neighborId)) {
                coloredNeighbors.add(resultColors.get(neighborId));
            }
        }
        return coloredNeighbors.size;
    }

    // Degree among uncolored neighbors
    function getUncoloredDegree(nodeId) {
        let deg = 0;
        for (const neighborId of adjList.get(nodeId)) {
            if (!resultColors.has(neighborId)) deg++;
        }
        return deg;
    }

    while (uncoloredNodes.size > 0) {
        let chosenNodeId = null;
        let maxSat = -1;
        let maxDeg = -1;

        // Pick the uncolored node with highest saturation (tie-break by degree)
        for (const nodeId of uncoloredNodes) {
            const sat = getSaturation(nodeId);
            const deg = getUncoloredDegree(nodeId);

            if (sat > maxSat || (sat === maxSat && deg > maxDeg)) {
                maxSat = sat;
                maxDeg = deg;
                chosenNodeId = nodeId;
            }
        }

        const nodeLabel = cy.getElementById(chosenNodeId).data('label');
        yield { type: 'investigate', nodeId: chosenNodeId, msg: `Selected node ${nodeLabel} (Saturation: ${maxSat}, Degree: ${maxDeg})` };

        // Find conflict edges for visualization
        const neighborColors = new Set();
        const conflictEdges = [];
        for (const neighborId of adjList.get(chosenNodeId)) {
            if (resultColors.has(neighborId)) {
                neighborColors.add(resultColors.get(neighborId));
                const edge = cy.edges(`[source="${chosenNodeId}"][target="${neighborId}"], [source="${neighborId}"][target="${chosenNodeId}"]`);
                if (edge.length > 0) conflictEdges.push(edge[0].id());
            }
        }

        if (conflictEdges.length > 0) {
            yield { type: 'conflict', nodeId: chosenNodeId, edgeIds: conflictEdges, msg: `Checking ${conflictEdges.length} neighbor constraint(s)` };
        }

        // Find the lowest available color
        let colorIndex = 0;
        while (neighborColors.has(colorIndex)) {
            colorIndex++;
        }

        resultColors.set(chosenNodeId, colorIndex);
        uncoloredNodes.delete(chosenNodeId);
        maxColorUsed = Math.max(maxColorUsed, colorIndex + 1);

        yield { type: 'color', nodeId: chosenNodeId, colorIndex: colorIndex, msg: `Assigned color ${colorIndex} to node ${nodeLabel}` };
    }

    yield { type: 'done', maxColors: maxColorUsed, finalColors: resultColors, msg: `DSATUR coloring finished using ${maxColorUsed} color(s).` };
    return maxColorUsed;
}

// -------------------------------------------------------
// Algorithm 3: Backtracking (m-coloring decision problem)
// -------------------------------------------------------
function* runBacktrackingColoring(m) {
    const nodes = cy.nodes().toArray();
    const adjList = buildAdjacencyList();
    const resultColors = new Map();

    // Returns true if assigning color c to nodeId won't conflict with any neighbor
    function isSafe(nodeId, c) {
        for (const neighborId of adjList.get(nodeId)) {
            if (resultColors.get(neighborId) === c) return false;
        }
        return true;
    }

    // Collect conflict edges for a node (used during visualization)
    function getConflictEdges(nodeId) {
        const edges = [];
        for (const neighborId of adjList.get(nodeId)) {
            if (resultColors.has(neighborId)) {
                const edge = cy.edges(`[source="${nodeId}"][target="${neighborId}"], [source="${neighborId}"][target="${nodeId}"]`);
                if (edge.length > 0) edges.push(edge[0].id());
            }
        }
        return edges;
    }

    // Recursive generator
    function* solveColoring(nodeIndex) {
        if (nodeIndex === nodes.length) {
            return true;
        }

        const nodeId = nodes[nodeIndex].id();
        const nodeLabel = nodes[nodeIndex].data('label');

        yield { type: 'investigate', nodeId: nodeId, msg: `Investigating node ${nodeLabel}` };

        for (let c = 0; c < m; c++) {
            if (isSafe(nodeId, c)) {
                resultColors.set(nodeId, c);

                // Show conflict edges for context
                const conflictEdges = getConflictEdges(nodeId);
                if (conflictEdges.length > 0) {
                    yield { type: 'conflict', nodeId: nodeId, edgeIds: conflictEdges, msg: `Color ${c} is safe — no neighbor conflicts` };
                }

                yield { type: 'color', nodeId: nodeId, colorIndex: c, msg: `Trying color ${c} on node ${nodeLabel}` };

                // Recurse
                const isPossible = yield* solveColoring(nodeIndex + 1);
                if (isPossible) return true;

                // Backtrack – uncolor via a dedicated backtrack step
                resultColors.delete(nodeId);
                yield { type: 'backtrack', nodeId: nodeId, msg: `Backtracking from node ${nodeLabel} — color ${c} caused failure downstream` };
            } else {
                // Color is not safe – yield a conflict visualization
                const conflictNeighbors = [];
                for (const neighborId of adjList.get(nodeId)) {
                    if (resultColors.get(neighborId) === c) {
                        const edge = cy.edges(`[source="${nodeId}"][target="${neighborId}"], [source="${neighborId}"][target="${nodeId}"]`);
                        if (edge.length > 0) conflictNeighbors.push(edge[0].id());
                    }
                }
                yield { type: 'conflict', nodeId: nodeId, edgeIds: conflictNeighbors, msg: `Color ${c} conflicts with neighbor(s) of node ${nodeLabel}` };
            }
        }

        // No color worked for this node
        yield { type: 'fail_node', nodeId: nodeId, msg: `No valid color for node ${nodeLabel} with ${m} colors` };
        return false;
    }

    const possible = yield* solveColoring(0);

    if (possible) {
        let maxColorUsed = 0;
        for (const color of resultColors.values()) {
            maxColorUsed = Math.max(maxColorUsed, color + 1);
        }
        yield { type: 'done', maxColors: maxColorUsed, finalColors: resultColors, msg: `Backtracking found a valid ${maxColorUsed}-coloring (max allowed: ${m}).` };
        return maxColorUsed;
    } else {
        yield { type: 'fail', msg: `Graph cannot be colored with only ${m} colors.` };
        return false;
    }
}

// -------------------------------------------------------
// Exact Chromatic Number (non-animated, instant computation)
// -------------------------------------------------------
function calculateChromaticNumber() {
    const nodes = cy.nodes().toArray();
    const adjList = buildAdjacencyList();

    if (nodes.length === 0) return 0;

    // Upper bound: max degree + 1
    let maxDeg = 0;
    for (const edges of adjList.values()) {
        maxDeg = Math.max(maxDeg, edges.length);
    }
    const upperBound = maxDeg + 1;

    // Linear search for the smallest m that allows a valid coloring
    for (let m = 1; m <= upperBound; m++) {
        const resultColors = new Map();

        function isSafe(nodeId, c) {
            for (const neighborId of adjList.get(nodeId)) {
                if (resultColors.get(neighborId) === c) return false;
            }
            return true;
        }

        function solve(nodeIndex) {
            if (nodeIndex === nodes.length) return true;

            const nodeId = nodes[nodeIndex].id();
            for (let c = 0; c < m; c++) {
                if (isSafe(nodeId, c)) {
                    resultColors.set(nodeId, c);
                    if (solve(nodeIndex + 1)) return true;
                    resultColors.delete(nodeId);
                }
            }
            return false;
        }

        if (solve(0)) {
            return m;
        }
    }
    return upperBound;
}
