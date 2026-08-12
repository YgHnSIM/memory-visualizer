'use strict';
const { loadCore, loadExamples } = require('./lib');
const mod = loadCore();
const EXAMPLES = loadExamples();

let pass = 0, fail = 0;
for (const [name, code] of Object.entries(EXAMPLES)) {
    try {
        const p = new mod.CParser();
        const m = new mod.VirtualMemory(64);
        const decls = p.parse(code);
        m.setFnDefs(p.functionDefs);
        m.reset();
        for (const d of decls) if (d) m.allocate(d);
        m.resolvePointers();
        const allocs = m.getAllocations();
        const warns = m.overflowWarnings;
        if (allocs.length === 0) {
            console.log(`  [${name}] FAIL: 0 allocations (errors=${p.errors.length})`);
            fail++;
        } else {
            pass++;
            console.log(`  [${name}] OK: allocs=${allocs.length} errors=${p.errors.length} warns=${warns.length}`);
        }
        if (p.errors.length > 3) {
            console.log('    errors:', p.errors.slice(0, 3).map(e => e.message).join(' | '));
        }
    } catch (e) {
        console.log(`  [${name}] THROW: ${e.message}`);
        fail++;
    }
}
console.log(`\nRESULT: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);