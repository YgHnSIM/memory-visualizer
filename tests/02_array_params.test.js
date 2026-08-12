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
        for (const d of decls) if (d) m.allocate(d);
        m.resolvePointers();
        check(m, p);
        pass++;
        console.log('PASS | ' + name);
    } catch (e) {
        fail++;
        console.log('FAIL | ' + name + ' | ' + e.message);
    }
}

t('array param: sum_array(values, 5) = 15', `
int sum_array(int arr[], int n) {
    int s;
    int i;
    s = 0;
    for (i = 0; i < n; i++) {
        s = s + arr[i];
    }
    return s;
}
int main() {
    int values[5];
    int total;
    values[0] = 1;
    values[1] = 2;
    values[2] = 3;
    values[3] = 4;
    values[4] = 5;
    total = sum_array(values, 5);
    return 0;
}
`, (m, p) => {
    const mainF = m.frames.find(f => f.name === 'main');
    const total = mainF && mainF.locals.find(l => l.renderName === 'total');
    if (!total || total.value !== 15) throw new Error('total not 15: ' + (total && total.value));
    const saF = m.frames.find(f => f.name === 'sum_array');
    if (!saF) throw new Error('no sum_array frame');
    const arrP = saF.params.find(a => a.renderName === 'arr');
    if (!arrP || arrP.kind !== 'pointer') throw new Error('arr param not pointer: ' + JSON.stringify(arrP && { kind: arrP.kind }));
    if (!arrP.pointsTo) throw new Error('arr param missing pointsTo');
    const valAlloc = m.getAllocations().find(a => a.name === 'main.values');
    if (!valAlloc || (valAlloc.values || [])[4] !== 5) throw new Error('caller values mutated by index writes');
});

t('array param: max with dynamic index reads', `
int max_of(int a[], int n) {
    int best;
    int i;
    best = a[0];
    i = 1;
    while (i < n) {
        if (a[i] > best) {
            best = a[i];
        }
        i = i + 1;
    }
    return best;
}
int main() {
    int nums[4];
    int r;
    nums[0] = 9;
    nums[1] = 3;
    nums[2] = 12;
    nums[3] = 7;
    r = max_of(nums, 4);
    return 0;
}
`, (m) => {
    const mainF = m.frames.find(f => f.name === 'main');
    const r = mainF && mainF.locals.find(l => l.renderName === 'r');
    if (!r || r.value !== 12) throw new Error('r not 12: ' + (r && r.value));
});

t('array param: write through pointer arr[0] = 99 mutates caller', `
int set_first(int a[]) {
    a[0] = 99;
    a[1] = a[1] + 1;
    return 0;
}
int main() {
    int data[2];
    int r;
    data[0] = 1;
    data[1] = 41;
    r = set_first(data);
    return 0;
}
`, (m) => {
    const data = m.getAllocations().find(a => a.name === 'main.data');
    if (!data) throw new Error('no data alloc');
    if ((data.values || [])[0] !== 99) throw new Error('data[0] not 99: ' + data.values[0]);
    if ((data.values || [])[1] !== 42) throw new Error('data[1] not 42: ' + data.values[1]);
});

t('int arr[10] form param also works', `
int len10(int arr[10]) {
    return arr[0] + arr[9];
}
int main() {
    int v[10];
    int r;
    v[0] = 7;
    v[9] = 5;
    r = len10(v);
    return 0;
}
`, (m) => {
    const mainF = m.frames.find(f => f.name === 'main');
    const r = mainF && mainF.locals.find(l => l.renderName === 'r');
    if (!r || r.value !== 12) throw new Error('r not 12: ' + (r && r.value));
});

console.log(`\nRESULT: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);