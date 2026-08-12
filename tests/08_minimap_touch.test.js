'use strict';

// Touch pan + auto-minimize for the minimap (todo 6, option B).
// Stub pattern copied from 07_minimap_frames.test.js, extended with
// listener-capturing addEventListener/dispatch so we can drive the
// pointer-event handlers directly.

function makeEl(tag) {
    const el = {
        tagName: tag,
        children: [],
        attrs: {},
        style: { setProperty(k, v) { this[k] = v; } },
        dataset: {},
        textContent: '',
        _listeners: {},
        _dispatched: [],
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return this.attrs[k]; },
        appendChild(c) { this.children.push(c); c.parent = this; return c; },
        addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
        removeEventListener() {},
        dispatch(type, ev) { (this._listeners[type] || []).forEach(fn => fn(ev)); },
        dispatchEvent(ev) { this._dispatched.push(ev); return true; },
        setPointerCapture() {},
        getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; },
        querySelectorAll() { return []; },
        querySelector() { return null; },
        classList: {
            _set: new Set(),
            add(c) { this._set.add(c); },
            remove(c) { this._set.delete(c); },
            toggle(c) { if (this._set.has(c)) { this._set.delete(c); return false; } this._set.add(c); return true; },
            contains(c) { return this._set.has(c); }
        }
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

const win = {
    _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener() {},
    dispatch(type, ev) { (this._listeners[type] || []).forEach(fn => fn(ev)); }
};
global.window = win;

const mod = require('./lib').loadMinimap();

const MINIMAP = 'minimapSvg';

function mkEv(type, x, y, pointerId, pointerType, target) {
    return {
        type, clientX: x, clientY: y, pointerId, pointerType,
        deltaY: 0, button: 0,
        target: target || null,
        _pd: false, _sp: false,
        preventDefault() { this._pd = true; },
        stopPropagation() { this._sp = true; }
    };
}

function make() {
    return new mod.MinimapVisualizer(MINIMAP);
}

// --- T0: wiring — touch-action inline guard + pointer listeners registered ---
const mm0 = make();
if (mm0.container.style['touch-action'] !== 'none') {
    throw new Error('container must have inline touch-action: none (JS insurance)');
}
if (!mm0.container._listeners['pointerdown'] || !mm0.container._listeners['pointermove']) {
    throw new Error('container must capture pointerdown/pointermove listeners');
}
if (!win._listeners['pointerup'] || !win._listeners['pointercancel']) {
    throw new Error('window must capture pointerup/pointercancel listeners');
}
// Existing mouse path must stay wired (desktop unchanged)
if (!mm0.container._listeners['mousedown']) throw new Error('existing mousedown path removed');
console.log('T0 wiring OK: touch-action none inline, pointer listeners, mouse path intact');

// --- T1: touch drag pans + preventDefault/stopPropagation + toggle revert ---
const mm1 = make();
const c1 = mm1.container;
const down1 = mkEv('pointerdown', 100, 100, 1, 'touch', c1);
c1.dispatch('pointerdown', down1);
if (down1._pd !== true) throw new Error('touch pointerdown must preventDefault');
if (!mm1.svg.classList.contains('touch-minimize')) {
    throw new Error('pointerdown must toggle touch-minimize immediately');
}
const move1 = mkEv('pointermove', 110, 108, 1, 'touch', c1);
c1.dispatch('pointermove', move1);
if (move1._pd !== true || move1._sp !== true) {
    throw new Error('touch pointermove during drag must preventDefault + stopPropagation');
}
if (mm1.pan.x !== 10 || mm1.pan.y !== 8) {
    throw new Error('touch drag must pan (10,8), got (' + mm1.pan.x + ',' + mm1.pan.y + ')');
}
if (mm1.svg.classList.contains('touch-minimize')) {
    throw new Error('drag > 6px must revert the pointerdown minimize toggle');
}
const move2 = mkEv('pointermove', 120, 130, 1, 'touch', c1);
c1.dispatch('pointermove', move2);
if (mm1.pan.x !== 20 || mm1.pan.y !== 30) {
    throw new Error('touch drag must continue panning (20,30), got (' + mm1.pan.x + ',' + mm1.pan.y + ')');
}
if (mm1.contentGroup.attrs['transform'] !== 'translate(80, 70) scale(1)') {
    throw new Error('transform must follow existing translate/scale mechanism, got ' + mm1.contentGroup.attrs['transform']);
}
win.dispatch('pointerup', mkEv('pointerup', 120, 130, 1, 'touch', c1));
if (mm1.pan.x !== 20) throw new Error('pan must stay after pointerup');
console.log('T1 touch drag OK: pan (' + mm1.pan.x + ',' + mm1.pan.y + '), preventDefault/stopPropagation verified');

// --- T2: two pointers -> no pan ---
const mm2 = make();
const c2 = mm2.container;
c2.dispatch('pointerdown', mkEv('pointerdown', 100, 100, 11, 'touch', c2));
c2.dispatch('pointerdown', mkEv('pointerdown', 300, 100, 12, 'touch', c2));
if (mm2.svg.classList.contains('touch-minimize')) {
    throw new Error('second pointer must stop the pending toggle');
}
c2.dispatch('pointermove', mkEv('pointermove', 400, 200, 11, 'touch', c2));
c2.dispatch('pointermove', mkEv('pointermove', 500, 260, 12, 'touch', c2));
if (mm2.pan.x !== 0 || mm2.pan.y !== 0) {
    throw new Error('two-pointer gesture must not pan, got (' + mm2.pan.x + ',' + mm2.pan.y + ')');
}
if (mm2.contentGroup.attrs['transform'] !== 'translate(60, 40) scale(1)') {
    throw new Error('transform must stay untouched during two-pointer gesture');
}
win.dispatch('pointerup', mkEv('pointerup', 400, 200, 11, 'touch', c2));
win.dispatch('pointerup', mkEv('pointerup', 500, 260, 12, 'touch', c2));
console.log('T2 two-pointer OK: pan suppressed');

// --- T3: tap (< 6px) toggles minimize, tap again expands ---
const mm3 = make();
const c3 = mm3.container;
const tap1Down = mkEv('pointerdown', 100, 100, 21, 'touch', c3);
c3.dispatch('pointerdown', tap1Down);
c3.dispatch('pointermove', mkEv('pointermove', 102, 101, 21, 'touch', c3));
win.dispatch('pointerup', mkEv('pointerup', 102, 101, 21, 'touch', c3));
if (!mm3.svg.classList.contains('touch-minimize')) {
    throw new Error('tap (< 6px) must keep minimize toggle');
}
if (mm3.pan.x !== 0 || mm3.pan.y !== 0) {
    throw new Error('tap must not pan');
}
c3.dispatch('pointerdown', mkEv('pointerdown', 110, 110, 22, 'touch', c3));
win.dispatch('pointerup', mkEv('pointerup', 110, 110, 22, 'touch', c3));
if (mm3.svg.classList.contains('touch-minimize')) {
    throw new Error('tap on minimized minimap must expand (toggle off)');
}
console.log('T3 tap toggle OK: minimized -> tap -> expanded');

// --- T4: pointerType mouse -> no touch behavior; existing mouse pan preserved ---
const mm4 = make();
const c4 = mm4.container;
const mouseDown = mkEv('pointerdown', 100, 100, 99, 'mouse', c4);
c4.dispatch('pointerdown', mouseDown);
if (mouseDown._pd === true) throw new Error('mouse pointerdown must not preventDefault (mouse path unchanged)');
if (mm4.svg.classList.contains('touch-minimize')) {
    throw new Error('mouse pointerdown must not toggle touch-minimize');
}
if (mm4.pan.x !== 0) throw new Error('mouse pointerdown must not pan');
c4.dispatch('mousedown', { button: 0, clientX: 100, clientY: 100 });
win.dispatch('mousemove', { clientX: 104, clientY: 105 });
if (mm4.pan.x !== 4 || mm4.pan.y !== 5) {
    throw new Error('existing desktop mousedown/mousemove pan must keep working, got (' + mm4.pan.x + ',' + mm4.pan.y + ')');
}
win.dispatch('mouseup', {});
console.log('T4 mouse OK: pointerType mouse ignored, legacy mousedown pan intact');

// --- T5: wheel zoom + clamp + zoom event preserved ---
const mm5 = make();
const c5 = mm5.container;
const wheel = mkEv('wheel', 60, 40, 0, 'touch');
wheel.deltaY = -100;
c5.dispatch('wheel', wheel);
if (wheel._pd !== true) throw new Error('wheel handler must preventDefault');
if (mm5.currentScale !== 1.1) throw new Error('wheel zoom must still work, scale=' + mm5.currentScale);
for (let i = 0; i < 15; i++) {
    const w = mkEv('wheel', 60, 40, 0, 'touch');
    w.deltaY = -100;
    c5.dispatch('wheel', w);
}
if (mm5.currentScale !== 2.0) {
    throw new Error('zoom clamp upper bound must stay 2.0, got ' + mm5.currentScale);
}
if (!mm5.svg._dispatched.some(ev => ev.type === 'minimap-zoom')) {
    throw new Error('wheel zoom must still dispatch minimap-zoom event');
}
console.log('T5 wheel zoom OK: scale 1.1, clamped at 2.0, zoom event dispatched');

console.log('MINIMAP TOUCH OK');