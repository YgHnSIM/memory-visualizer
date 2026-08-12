'use strict';
const mod = require('./lib').loadCore();

let pass = 0, fail = 0;
function t(name, code, check) {
    try {
        const p = new mod.CParser();
        const m = new mod.VirtualMemory(64);
        const decls = p.parse(code);
        m.setFnDefs(p.functionDefs);
        m.reset();
        m.beginStepTrace();
        for (const d of decls) { if (d) { m.allocate(d); m.traceTopLevel(d); } }
        m.resolvePointers();
        check(m);
        pass++;
        console.log('PASS | ' + name);
    } catch (e) {
        fail++;
        console.log('FAIL | ' + name + ' | ' + e.message);
    }
}

t('step trace: swap_func produces events with call/return labels', `
int swap(int *a, int *b) {
    int tmp;
    tmp = *a;
    *a = *b;
    *b = tmp;
    return 0;
}
int main() {
    int x;
    int y;
    x = 10;
    y = 20;
    swap(&x, &y);
    return 0;
}
`, (m) => {
    const n = m.getStepEventCount();
    if (n < 10) throw new Error('too few events: ' + n);
    const labels = [];
    for (let i = 0; i < n; i++) labels.push(m.getStepLabel(i));
    const all = labels.join('\n');
    if (!/호출: swap\(/.test(all)) throw new Error('no call event:\n' + all);
    if (!/복귀: swap\(\) = 0/.test(all)) throw new Error('no return event:\n' + all);
    if (!/\[main\(\)\] x = 10;/.test(all)) throw new Error('no main assign event:\n' + all);
    if (!/\[swap\(.*\)\] tmp = \*a;/.test(all)) throw new Error('no swap assign event:\n' + all);
});

t('step trace: recursion has nested call events + if-return', `
int fact(int n) {
    if (n <= 1) return 1;
    return n * fact(n - 1);
}
int main() {
    int r;
    r = fact(3);
    return 0;
}
`, (m) => {
    const n = m.getStepEventCount();
    if (n < 8) throw new Error('too few events: ' + n);
    const labels = [];
    for (let i = 0; i < n; i++) labels.push(m.getStepLabel(i));
    const all = labels.join('\n');
    if (!/조기 반환: return 1;/.test(all)) throw new Error('no if-return event:\n' + all);
    const calls = (all.match(/호출: fact\(/g) || []).length;
    if (calls < 2) throw new Error('expected nested fact calls, got ' + calls + ':\n' + all);
});

t('step trace: break/continue/nested loops produce for events', `
int main() {
    int s;
    int i;
    int j;
    s = 0;
    for (i = 1; i <= 3; i++) {
        s = s + i;
    }
    return 0;
}
`, (m) => {
    const labels = [];
    for (let i = 0; i < m.getStepEventCount(); i++) labels.push(m.getStepLabel(i));
    const all = labels.join('\n');
    const inits = (all.match(/for 초기화: i = 1;/g) || []).length;
    const steps = (all.match(/for 증감: i = \(i \+ 1\);/g) || []).length;
    if (inits !== 1) throw new Error('for init events wrong: ' + inits);
    if (steps !== 3) throw new Error('for step events wrong: ' + steps + '\n' + all);
});

t('step replay: applying each event restores deterministic states', `
int main() {
    int a;
    int b;
    a = 5;
    b = a + 3;
    b = b * 2;
    return 0;
}
`, (m) => {
    const n = m.getStepEventCount();
    const lastAllocs = m.allocations.length;
    for (let i = 0; i < n; i++) {
        if (!m.applyStepEvent(i)) throw new Error('apply failed at ' + i);
        for (const a of m.allocations) {
            if (a.address === undefined) throw new Error('alloc lost address at ' + i);
            if (!Array.isArray(a.bytes)) throw new Error('alloc lost bytes at ' + i);
        }
        m.applyStepEvent(n - 1);
        if (m.allocations.length !== lastAllocs) throw new Error('end state mismatch after ' + i);
    }
    const idx2 = m.getStepLabel(0);
    if (!idx2) throw new Error('no label for event 0');
});

t('step events are independent snapshots (mutation isolation)', `
int main() {
    int a;
    a = 7;
    return 0;
}
`, (m) => {
    m.applyStepEvent(0);
    const before = m.allocations.length;
    m.allocations.push({ hacked: true });
    m.applyStepEvent(0);
    if (m.allocations.length !== before) throw new Error('snapshot mutated after re-apply');
});

t('top-level decl events labeled', `
int a = 10;
int *p = &a;
p = &a;
`, (m) => {
    if (m.getStepEventCount() < 3) throw new Error('too few top-level events: ' + m.getStepEventCount());
    const labels = [];
    for (let i = 0; i < m.getStepEventCount(); i++) labels.push(m.getStepLabel(i));
    const all = labels.join('\n');
    if (!/int a 선언/.test(all)) throw new Error('no var decl event:\n' + all);
    if (!/int\* p 선언/.test(all)) throw new Error('no ptr decl event:\n' + all);
    if (!/p = .*&a/.test(all)) throw new Error('no assignment event:\n' + all);
});

console.log(`\nRESULT: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
