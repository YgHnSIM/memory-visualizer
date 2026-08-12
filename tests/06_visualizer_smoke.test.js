'use strict';
// Visualizer smoke test: render frames + freed heap + dangling pointers with DOM stubs.

class FakeClassList {
    constructor() { this.set = new Set(); }
    add(...c) { c.forEach(x => this.set.add(x)); }
    remove(...c) { c.forEach(x => this.set.delete(x)); }
    contains(c) { return this.set.has(c); }
    toggle(c) { this.contains(c) ? this.remove(c) : this.add(c); }
}

class FakeEl {
    constructor(tag) {
        this.tagName = tag;
        this.children = [];
        this.attributes = {};
        this.style = {};
        this.dataset = {};
        this.classList = new FakeClassList();
        this._textContent = '';
        this.title = '';
        this.rowSpan = 0;
        this.hidden = false;
        this.tdCount = 0;
    }
    get className() { return Array.from(this.classList.set).join(' '); }
    set className(v) {
        this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean));
    }
    get textContent() { return this._textContent; }
    set textContent(v) { this._textContent = String(v); }
    appendChild(child) { this.children.push(child); return child; }
    setAttribute(k, v) { this.attributes[k] = v; }
    getAttribute(k) { return this.attributes[k]; }
    querySelectorAll() { return []; }
    querySelector() { return null; }
    getElementsByClassName() { return []; }
    innerHTML = '';
}

const documentStub = {
    createElement: (tag) => new FakeEl(tag),
    createTextNode: (t) => new FakeEl('#text'),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    body: new FakeEl('body'),
};

global.document = documentStub;
global.window = { getComputedStyle: () => ({}) };

const mod = require('./lib').loadVisualizer();

// --- scenario: WP5 function frames + freed heap + dangling + chips ---
const code = `
int add(int a, int b) {
    int sum;
    sum = 7;
    return sum;
}
int main() {
    int result;
    result = add(3, 4);
    return 0;
}
int *p = (int*)malloc(4 * sizeof(int));
free(p);
`;
const p = new mod.CParser();
const m = new mod.VirtualMemory(64);
const decls = p.parse(code);
console.log('--- parser errors:', JSON.stringify(p.errors));
m.setFnDefs(p.functionDefs);
m.reset();
for (const d of decls) if (d) m.allocate(d);
m.resolvePointers();

console.log('--- frames:', m.frames.map(f => f.name + '@' + f.depth + '(' + f.displayName + ')' + ' ret=' + f.returnAddress.toString(16)).join(' | '));

const tbody = new FakeEl('tbody');
const v = new mod.MemoryVisualizer(tbody, m);
v.render();
const rows = tbody.children;
let badgeFound = 0, danglingFound = 0, frameHeaders = 0;
function scan(el) {
    if (el.className && String(el.className).includes('overflow-badge')) badgeFound++;
    if (el.className && String(el.className).includes('dangling-badge')) danglingFound++;
    if (el.className && String(el.className).includes('frame-header-row')) frameHeaders++;
    for (const c of el.children || []) scan(c);
}
for (const r of rows) scan(r);
console.log('  rows total:', rows.length, '| frame headers:', frameHeaders, '| FREE badge:', badgeFound, '| dangling badge:', danglingFound);

const addF = m.frames.find(f => f.name === 'add');
console.log('  add params renderName:', addF.params.map(a => a.renderName).join(','), '| displayName:', addF.displayName);

const checks = {
  frames: m.frames.length >= 2,
  main: m.frames.some(f => f.name === 'main' && f.locals.length > 0),
  addFrame: !!addF && addF.params.length === 2,
  frameHeaders,
  displayName: addF && addF.displayName === 'add(3, 4)',
};
console.log(checks);
if (checks.frames && checks.main && checks.addFrame && checks.frameHeaders >= 2 && checks.displayName) {
    console.log('SMOKE OK');
} else {
    console.log('SMOKE FAILED');
    process.exit(1);
}