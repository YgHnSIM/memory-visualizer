'use strict';
// Run all test files in order, aggregate results.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const files = fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.test.js'))
    .sort();

let totalFail = 0;
for (const f of files) {
    console.log(`\n=== ${f} ===`);
    const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
    if (r.stdout) console.log(r.stdout.replace(/\n+$/, ''));
    if (r.stderr) console.error(r.stderr);
    if (r.status !== 0) {
        totalFail++;
        console.log(`  >> ${f} FAILED (exit ${r.status})`);
    } else {
        console.log(`  >> ${f} OK`);
    }
}

console.log(`\n==========\nSUITE: ${files.length - totalFail}/${files.length} files passed`);
process.exit(totalFail ? 1 : 0);