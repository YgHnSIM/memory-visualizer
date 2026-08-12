'use strict';

function makeEl(tag) {
    const el = {
        tagName: tag,
        children: [],
        attrs: {},
        style: {},
        dataset: {},
        textContent: '',
        setAttribute: function (k, v) { this.attrs[k] = String(v); },
        getAttribute: function (k) { return this.attrs[k]; },
        appendChild: function (c) { this.children.push(c); c.parent = this; return c; },
        addEventListener: function () {},
        querySelectorAll: function () { return []; },
        querySelector: function () { return null; },
        classList: { add() {}, remove() {} }
    };
    return el;
}
global.document = {
    getElementById: () => {
        const svg = makeEl('svg');
        svg.parentElement = makeEl('div');
        return svg;
    },
    createElementNS: (ns, tag) => makeEl(tag)
};
global.window = { addEventListener: () => {}, removeEventListener: () => {} };

const mod = require('./lib').loadMinimap();

const mm = new mod.MinimapVisualizer('minimapSvg');
const frames = [
    { depth: 1, name: 'main', displayName: 'main()' },
    { depth: 2, name: 'add', displayName: 'add(3, 4)' },
    { depth: 3, name: 'factorial', displayName: 'factorial(5)' }
];
const allocs = [
    { name: 'global_x', kind: 'variable', size: 4, address: BigInt('0x7FFF00000000'), value: 10 },
    { name: 'main.sum', kind: 'variable', size: 4, address: BigInt('0x7FFF00000100'), value: 7, frameId: 1, displayName: 'sum' },
    { name: 'add.a', kind: 'variable', size: 4, address: BigInt('0x7FFF00000110'), value: 3, frameId: 2, displayName: 'a' },
    { name: 'add.b', kind: 'variable', size: 4, address: BigInt('0x7FFF00000114'), value: 4, frameId: 2, displayName: 'b' },
    { name: 'factorial.n', kind: 'variable', size: 4, address: BigInt('0x7FFF00000120'), value: 5, frameId: 3, displayName: 'n' }
];
mm.render(allocs, frames);

const panels = mm.contentGroup.children.filter(g => g.attrs['class'] === 'frame-panel');
const labels = panels.map(p => {
    const t = p.children.find(c => c.tagName === 'text');
    return t && t.textContent;
});
console.log('frame panels:', labels.length, '| labels:', JSON.stringify(labels));
const blocks = mm.contentGroup.children.filter(g => g.attrs['class'] === undefined && g.attrs['data-name']);
const xs = blocks.map(b => Number(b.children[0].attrs['x']));
console.log('block x offsets (nesting):', JSON.stringify(xs));
if (labels.length !== 4) throw new Error('expected 4 panels (global + 3 frames), got ' + labels.length);
if (!labels.includes('main()  · depth 1')) throw new Error('missing main panel');
if (!labels.includes('add()  · depth 2')) throw new Error('missing add panel');
if (!labels.includes('factorial()  · depth 3')) throw new Error('missing factorial panel');
if (xs[0] !== 0) throw new Error('global block should be at x=0');
if (xs[1] !== 14 || xs[2] !== 28 || xs[4] !== 42) throw new Error('frames should nest right by group index: ' + xs);
console.log('MINIMAP FRAMES OK');