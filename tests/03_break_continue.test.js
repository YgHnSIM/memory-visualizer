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
function varVal(m, fn, name) {
    const f = m.frames.find(x => x.name === fn);
    const a = f && f.locals.find(l => l.renderName === name);
    if (!a) throw new Error('no ' + fn + '.' + name);
    return a.value;
}

t('break: sum until 5 then break = 10', `
int main() {
    int s;
    int i;
    s = 0;
    for (i = 0; i < 10; i++) {
        if (i == 5) {
            break;
        }
        s = s + i;
    }
    return 0;
}
`, (m) => {
    if (varVal(m, 'main', 's') !== 10) throw new Error('s not 10: ' + varVal(m, 'main', 's'));
    if (varVal(m, 'main', 'i') !== 5) throw new Error('i not 5: ' + varVal(m, 'main', 'i'));
});

t('continue: skip even = 1+3+5 = 9', `
int main() {
    int s;
    int i;
    s = 0;
    for (i = 0; i < 6; i++) {
        if (i % 2 == 0) {
            continue;
        }
        s = s + i;
    }
    return 0;
}
`, (m) => {
    if (varVal(m, 'main', 's') !== 9) throw new Error('s not 9: ' + varVal(m, 'main', 's'));
    if (varVal(m, 'main', 'i') !== 6) throw new Error('i not 6: ' + varVal(m, 'main', 'i'));
});

t('if (cond) break; single-statement form', `
int main() {
    int s;
    int i;
    s = 0;
    i = 0;
    while (i < 100) {
        s = s + i;
        i = i + 1;
        if (s >= 6) break;
    }
    return 0;
}
`, (m) => {
    if (varVal(m, 'main', 's') !== 6) throw new Error('s not 6: ' + varVal(m, 'main', 's'));
    if (varVal(m, 'main', 'i') !== 4) throw new Error('i not 4: ' + varVal(m, 'main', 'i'));
});

t('nested loops: multiplication table 3x4 sum = 60', `
int main() {
    int total;
    int i;
    int j;
    total = 0;
    for (i = 1; i <= 3; i++) {
        for (j = 1; j <= 4; j++) {
            total = total + i * j;
        }
    }
    return 0;
}
`, (m) => {
    if (varVal(m, 'main', 'total') !== 60) throw new Error('total not 60: ' + varVal(m, 'main', 'total'));
    if (varVal(m, 'main', 'i') !== 4) throw new Error('i not 4: ' + varVal(m, 'main', 'i'));
    if (varVal(m, 'main', 'j') !== 5) throw new Error('j not 5: ' + varVal(m, 'main', 'j'));
});

t('nested loop + break: inner break stops at 2, outer continues', `
int main() {
    int total;
    int i;
    int j;
    total = 0;
    for (i = 1; i <= 2; i++) {
        for (j = 1; j <= 5; j++) {
            if (j == 3) {
                break;
            }
            total = total + i * j;
        }
    }
    return 0;
}
`, (m) => {
    if (varVal(m, 'main', 'total') !== 9) throw new Error('total not 9: ' + varVal(m, 'main', 'total'));
    if (varVal(m, 'main', 'i') !== 3) throw new Error('i not 3: ' + varVal(m, 'main', 'i'));
    if (varVal(m, 'main', 'j') !== 3) throw new Error('j not 3: ' + varVal(m, 'main', 'j'));
});

console.log(`\nRESULT: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);