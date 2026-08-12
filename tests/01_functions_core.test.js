'use strict';
const { loadCore } = require('./lib');
const mod = loadCore();

const CParser = mod.CParser, VirtualMemory = mod.VirtualMemory;

function test(name, code, check) {
  const parser = new CParser();
  const memory = new VirtualMemory();
  memory.setAddressMode(64);
  const decls = parser.parse(code);
  memory.setFnDefs(parser.functionDefs);
  const errs = parser.errors || [];
  for (const d of decls) { if (d) { try { memory.allocate(d); } catch (e) { console.log('ALLOC FAIL on decl:', JSON.stringify(d).slice(0, 300)); throw e; } } }
  memory.resolvePointers();
  let ok = true, log = [];
  try { ok = check(decls, memory, parser); } catch (e) { ok = false; log.push('threw: ' + e.message); }
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (errs.length ? ' | PARSER ERRORS: ' + JSON.stringify(errs) : '') + (log.length ? ' | ' + log.join(' | ') : ''));
  if (!ok) process.exitCode = 1;
}

test('function def + top-level call', `
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
`, (decls, memory) => {
  const frames = memory.frames;
  if (!frames.length) throw new Error('no frames created');
  const mainF = frames.find(f => f.name === 'main');
  if (!mainF) throw new Error('no main frame');
  if (!mainF.locals.length) throw new Error('no locals in main');
  const resultAlloc = mainF.locals.find(l => l.renderName === 'result' || l.displayName === 'result');
  if (!resultAlloc) throw new Error('result alloc missing');
  return true;
});

test('add() frame has params + locals', `
int add(int a, int b) {
    int sum;
    return sum;
}
int main() {
    int result;
    result = add(3, 4);
    return 0;
}
`, (decls, memory) => {
  const addF = memory.frames.find(f => f.name === 'add');
  if (!addF) throw new Error('no add frame');
  const paramNames = addF.params.map(p => p.renderName).join(',');
  if (paramNames !== 'a,b') throw new Error('params wrong: ' + paramNames);
  if (addF.displayName !== 'add(3, 4)') throw new Error('displayName wrong: ' + addF.displayName);
  return true;
});

test('recursion factorial(5) hits depth cap gracefully', `
int factorial(int n) {
    int res;
    res = n * factorial(n - 1);
    return res;
}
int main() {
    int f;
    f = factorial(5);
    return 0;
}
`, (decls, memory) => {
  const factFrames = memory.frames.filter(f => f.name === 'factorial');
  if (!factFrames.length) throw new Error('no factorial frames');
  const depths = factFrames.map(f => f.depth);
  const maxDepth = Math.max(...depths);
  if (maxDepth > 7) throw new Error('depth too deep: ' + maxDepth);
  if (factFrames.length < 3) throw new Error('recursion not captured: ' + factFrames.length);
  const d1 = factFrames[0].displayName;
  if (!/factorial\(5\)/.test(d1)) throw new Error('top displayName wrong: ' + d1);
  return true;
});

test('nested calls: swap wrapper', `
void swap(int* x, int* y) {
    int temp;
    temp = *x;
}
int caller() {
    int a;
    int b;
    a = 10;
    b = 20;
    swap(&a, &b);
    return 0;
}
int main() {
    int r;
    r = caller();
    return 0;
}
`, (decls, memory) => {
  const callF = memory.frames.find(f => f.name === 'caller');
  const swapF = memory.frames.find(f => f.name === 'swap');
  if (!callF || !swapF) throw new Error('frames missing: ' + memory.frames.map(f => f.name).join(','));
  if (!callF.calls.length) throw new Error('caller.calls empty');
  if (callF.calls[0].name !== 'swap') throw new Error('nested call wrong: ' + callF.calls[0].name);
  return true;
});

test('swap via pointer params mutates caller vars', `
void swap(int* x, int* y) {
    int temp;
    temp = *x;
    *x = *y;
    *y = temp;
}
int main() {
    int a;
    int b;
    a = 10;
    b = 20;
    swap(&a, &b);
    return 0;
}
`, (decls, memory) => {
  const swapF = memory.frames.find(f => f.name === 'swap');
  if (!swapF) throw new Error('no swap frame');
  if (swapF.params.length !== 2) throw new Error('swap params wrong: ' + swapF.params.length);
  const xAlloc = swapF.params[0];
  if (xAlloc.kind !== 'pointer') throw new Error('x not pointer kind: ' + xAlloc.kind);
  if (xAlloc.value === 0) throw new Error('x address not passed');
  const mainF = memory.frames.find(f => f.name === 'main');
  const aAlloc = mainF.locals.find(l => l.renderName === 'a');
  const bAlloc = mainF.locals.find(l => l.renderName === 'b');
  if (aAlloc.value !== 20) throw new Error('a not 20: ' + aAlloc.value);
  if (bAlloc.value !== 10) throw new Error('b not 10: ' + bAlloc.value);
  return true;
});

test('while loop: sum 1..5 = 15', `
int sum_range() {
    int sum;
    int i;
    sum = 0;
    i = 1;
    while (i <= 5) {
        sum = sum + i;
        i = i + 1;
    }
    return sum;
}
int main() {
    int result;
    result = sum_range();
    return 0;
}
`, (decls, memory) => {
  const sumF = memory.frames.find(f => f.name === 'sum_range');
  if (!sumF) throw new Error('no sum_range frame');
  const sumAlloc = sumF.locals.find(l => l.renderName === 'sum');
  if (!sumAlloc || sumAlloc.value !== 15) throw new Error('sum not 15: ' + (sumAlloc && sumAlloc.value));
  const mainF = memory.frames.find(f => f.name === 'main');
  const resultAlloc = mainF && mainF.locals.find(l => l.renderName === 'result');
  if (!resultAlloc || resultAlloc.value !== 15) throw new Error('result not 15: ' + (resultAlloc && resultAlloc.value));
  return true;
});

test('for loop: i++ step, sum 0..9 = 45', `
int sum_for() {
    int sum;
    int i;
    sum = 0;
    for (i = 0; i < 10; i++) {
        sum = sum + i;
    }
    return sum;
}
int main() {
    int result;
    result = sum_for();
    return 0;
}
`, (decls, memory) => {
  const sumF = memory.frames.find(f => f.name === 'sum_for');
  if (!sumF) throw new Error('no sum_for frame');
  const sumAlloc = sumF.locals.find(l => l.renderName === 'sum');
  if (!sumAlloc || sumAlloc.value !== 45) throw new Error('sum not 45: ' + (sumAlloc && sumAlloc.value));
  const iAlloc = sumF.locals.find(l => l.renderName === 'i');
  if (!iAlloc || iAlloc.value !== 10) throw new Error('i not 10 after loop: ' + (iAlloc && iAlloc.value));
  return true;
});

test('infinite loop guard: no hang', `
int runaway() {
    int x;
    x = 0;
    while (x < 5) {
        x = x;
    }
    return 0;
}
int main() {
    int r;
    r = runaway();
    return 0;
}
`, (decls, memory) => {
  const f = memory.frames.find(f => f.name === 'runaway');
  if (!f) throw new Error('no runaway frame');
  return true;
});

test('unknown function -> parser error', `
int main() {
    int r;
    r = missing(1, 2);
    return 0;
}
`, (decls, memory, parser) => {
  if (!(parser.errors || []).length) throw new Error('expected parser error');
  return true;
});

test('add(3,4) returns 7, sum = a + b executed', `
int add(int a, int b) {
    int sum;
    sum = a + b;
    return sum;
}
int main() {
    int result;
    result = add(3, 4);
    return 0;
}
`, (decls, memory) => {
  const addF = memory.frames.find(f => f.name === 'add');
  if (!addF) throw new Error('no add frame');
  if (addF.returnValue !== 7) throw new Error('add returnValue wrong: ' + addF.returnValue);
  const sumAlloc = addF.locals.find(l => l.renderName === 'sum');
  if (!sumAlloc || sumAlloc.value !== 7) throw new Error('sum not 7: ' + (sumAlloc && sumAlloc.value));
  const mainF = memory.frames.find(f => f.name === 'main');
  const resultAlloc = mainF && mainF.locals.find(l => l.renderName === 'result');
  if (!resultAlloc || resultAlloc.value !== 7) throw new Error('result not 7: ' + (resultAlloc && resultAlloc.value));
  return true;
});

test('factorial(5) = 120 with base case', `
int factorial(int n) {
    int res;
    if (n <= 1) return 1;
    res = n * factorial(n - 1);
    return res;
}
int main() {
    int f;
    f = factorial(5);
    return 0;
}
`, (decls, memory) => {
  const factFrames = memory.frames.filter(f => f.name === 'factorial');
  if (factFrames.length < 4) throw new Error('recursion not captured: ' + factFrames.length);
  const mainF = memory.frames.find(f => f.name === 'main');
  const fAlloc = mainF && mainF.locals.find(l => l.renderName === 'f');
  if (!fAlloc) throw new Error('f alloc missing');
  if (fAlloc.value !== 120) throw new Error('f not 120: ' + fAlloc.value);
  const topFact = memory.frames.find(f => f.name === 'factorial' && f.displayName === 'factorial(5)');
  if (!topFact || topFact.returnValue !== 120) throw new Error('factorial(5) returnValue wrong: ' + (topFact && topFact.returnValue));
  return true;
});