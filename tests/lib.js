'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function readRel(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// Load a browser JS module for Node: rewrite `window.X = X;` exports to globalThis.
function loadJs(rel) {
    return readRel(rel).replace(/window\.([A-Za-z0-9_]+)\s*=\s*\1;/g, 'globalThis.$1 = $1;');
}

function loadCore() {
    const src = loadJs('js/parser.js') + loadJs('js/memory.js');
    const mod = new Function('globalThis', src + '; return { CParser, VirtualMemory };')(globalThis);
    return mod;
}

function loadVisualizer() {
    const src = loadJs('js/parser.js') + loadJs('js/memory.js') + loadJs('js/visualizer.js');
    const mod = new Function('globalThis', src + '; return { CParser, VirtualMemory, MemoryVisualizer };')(globalThis);
    return mod;
}

function loadMinimap() {
    const src = loadJs('js/minimap.js');
    const mod = new Function('globalThis', src + '; return { MinimapVisualizer };')(globalThis);
    return mod;
}

// Extract the EXAMPLES map from main.js (no DOM deps) so examples can be regression-tested.
function loadExamples() {
    const mainSrc = readRel('js/main.js');
    const m = mainSrc.match(/const EXAMPLES = \{([\s\S]*?)\n    \};\n\n    \/\/ Learning points/);
    if (!m) throw new Error('EXAMPLES block not found in js/main.js');
    return new Function('return {' + m[1] + '};')();
}

// Run parser+memory over a code string; returns { parser, memory, decls }.
function analyze(mod, code) {
    const p = new mod.CParser();
    const m = new mod.VirtualMemory(64);
    const decls = p.parse(code);
    m.setFnDefs(p.functionDefs);
    m.reset();
    for (const d of decls) if (d) m.allocate(d);
    m.resolvePointers();
    return { parser: p, memory: m, decls };
}

module.exports = { ROOT, readRel, loadJs, loadCore, loadVisualizer, loadMinimap, loadExamples, analyze };