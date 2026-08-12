/**
 * Virtual Memory Manager
 * Simulates memory allocation and byte-level representation
 */

class VirtualMemory {
    constructor(addressMode = 64) {
        this.addressMode = addressMode;
        this.baseAddress = addressMode === 64 ? 0x7FFF00000000n : 0x7FFF0000;
        this.heapBaseAddress = addressMode === 64 ? 0x600000000000n : 0x60000000;
        
        this.currentAddress = this.baseAddress;
        this.currentHeapAddress = this.heapBaseAddress;
        
        this.allocations = []; 
        this.heapAllocations = []; 
        this.overflowWarnings = [];
        
        this.addressMap = new Map();
        this.heapCount = 0; 
        this.stepTrace = null;
    }

    reset() {
        this.currentAddress = this.baseAddress;
        this.currentHeapAddress = this.heapBaseAddress;
        this.allocations = [];
        this.heapAllocations = [];
        this.overflowWarnings = [];
        this.addressMap.clear();
        this.heapCount = 0;
        this.frames = [];
        this.frameCounter = 0;
        this.stepTrace = null;
    }

    setAddressMode(mode) {
        this.addressMode = mode;
        this.baseAddress = mode === 64 ? 0x7FFF00000000n : 0x7FFF0000;
        this.heapBaseAddress = mode === 64 ? 0x600000000000n : 0x60000000;
        this.reset();
    }

    allocate(declaration) {
        if (declaration.kind === 'assignment') {
            this.handleAssignment(declaration);
            return null; 
        }

        if (declaration.kind === 'free') {
            this.handleFree(declaration.target);
            return null; 
        }

        if (declaration.kind === 'function_call') {
            this.handleFunctionCall(declaration);
            return null;
        }

        if (declaration.kind === 'function_def') {
            return null;
        }

        // Resolve deferred expression nodes (binop/varref/deref) to concrete values
        if (declaration.value && typeof declaration.value === 'object') {
            declaration.value = this.resolveValue(declaration.value);
        }
        if (Array.isArray(declaration.values)) {
            declaration.values = declaration.values.map(v => (v && typeof v === 'object') ? this.resolveValue(v) : v);
        }
        if (declaration.kind === 'struct' && Array.isArray(declaration.members)) {
            for (const m of declaration.members) {
                if (m.value && typeof m.value === 'object') m.value = this.resolveValue(m.value);
            }
        }

        // Arithmetic/range overflow detection for scalar values (C-style wrap)
        if (declaration.kind === 'variable') {
            const range = this.checkTypeRange(declaration);
            if (range) {
                this.overflowWarnings.push({
                    kind: 'range',
                    name: declaration.name,
                    type: declaration.type,
                    value: declaration.value,
                    min: range.min,
                    max: range.max
                });
                declaration.value = range.wrapped;
            }
        }

        const alignment = declaration.alignment || 1;
        let address = this.currentAddress;
        let padding = 0;

        if (this.addressMode === 64) {
            const addrBig = BigInt(address);
            const alignBig = BigInt(alignment);
            padding = Number((alignBig - (addrBig % alignBig)) % alignBig);
        } else {
            padding = (alignment - (address % alignment)) % alignment;
        }

        if (padding > 0) {
            const paddingAlloc = {
                kind: 'padding',
                name: `PAD_${address}`, 
                address: address,
                size: padding,
                bytes: new Array(padding).fill(0),
                isPadding: true,
                section: 'stack'
            };
            this.allocations.push(paddingAlloc);

            if (this.addressMode === 64) {
                this.currentAddress = BigInt(this.currentAddress) + BigInt(padding);
            } else {
                this.currentAddress += padding;
            }
            address = this.currentAddress;
        }

        this.addressMap.set(declaration.name, address);
        
        let pointerValue = declaration.value;
        if (declaration.heapAlloc) {
            const heapBlock = this.allocateHeap(
                declaration.heapAlloc.size, 
                declaration.heapAlloc.type,
                declaration.heapAlloc.structDef
            );
            pointerValue = heapBlock.address; 
            declaration.value = pointerValue;
        } else if (declaration.kind === 'pointer' && declaration.pointsTo) {
            // Normalize "name[i]" and "name.member" style targets so the
            // pointer resolves against the base allocation.
            let targetName = declaration.pointsTo;
            let targetIndex = declaration.pointsToIndex || 0;

            const bracketMatch = targetName.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$/);
            if (bracketMatch) {
                targetName = bracketMatch[1];
                targetIndex = parseInt(bracketMatch[2]);
            }
            const memberMatch = targetName.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)$/);
            if (memberMatch) {
                targetName = memberMatch[1];
                declaration.pointsToMember = memberMatch[2];
                targetIndex = 0;
            }
            declaration.pointsTo = targetName;
            declaration.pointsToIndex = targetIndex;

            const targetAddr = this.addressMap.get(targetName);
            
            if (targetAddr !== undefined) {
                let resolvedAddr = targetAddr;
                if (targetIndex) {
                    const targetAlloc = this.getAllocations().find(a => a.name === targetName);
                    let elemSize = 1;
                    if (targetAlloc) {
                        if (targetAlloc.kind === 'array') elemSize = targetAlloc.elementSize;
                        else elemSize = this.getTypeSize(targetAlloc.type);
                    }
                    
                    const offset = targetIndex * elemSize;
                    if (this.addressMode === 64) resolvedAddr = BigInt(targetAddr) + BigInt(offset);
                    else resolvedAddr = Number(targetAddr) + offset;
                }
                
                pointerValue = resolvedAddr;
                declaration.value = pointerValue;
            }
        }

        const bytes = this.getBytes(declaration);

        const allocation = { ...declaration, address, bytes, section: 'stack' };
        this.allocations.push(allocation);

        if (this.addressMode === 64) {
            this.currentAddress = BigInt(this.currentAddress) + BigInt(declaration.size);
        } else {
            this.currentAddress += declaration.size;
        }
        return allocation;
    }

    allocateHeap(size, type, structDef) {
        const address = this.currentHeapAddress;
        
        const bytes = new Array(size).fill(0);
        
        this.heapCount++;
        const name = `heap_block_${this.heapCount}`;
        
        const allocation = {
            kind: 'heap_block',
            type: type || 'void*', 
            name: name,
            address: address,
            size: size,
            bytes: bytes,
            section: 'heap',
            displayType: type ? `${type}[${Math.floor(size/this.getTypeSize(type))}]` : `byte[${size}]`, 
            structDef: structDef 
        };
        
        if (structDef) {
            allocation.members = structDef.members.map(m => ({
                ...m,
                value: 0 
            }));
            allocation.displayType = structDef.displayType || type;
        }
        
        this.heapAllocations.push(allocation);
        
        if (this.addressMode === 64) {
            this.currentHeapAddress = BigInt(this.currentHeapAddress) + BigInt(size);
        } else {
            this.currentHeapAddress += size;
        }
        
        return allocation;
    }
    
    resolveValue(node) {
        if (node === null || node === undefined) return 0;
        if (typeof node !== 'object') return node;
        switch (node.type) {
            case 'binop': {
                const a = this.resolveValue(node.left);
                const b = this.resolveValue(node.right);
                if ((node.op === '+' || node.op === '-') && typeof a === 'number' && typeof b === 'number') {
                    const pElem = this.pointeeSize(node.left);
                    if (pElem > 1) {
                        return node.op === '+' ? a + b * pElem : a - b * pElem;
                    }
                }
                if (typeof a === 'bigint' || typeof b === 'bigint') {
                    const ab = typeof a === 'bigint' ? a : BigInt(Math.trunc(a));
                    const bb = typeof b === 'bigint' ? b : BigInt(Math.trunc(b));
                    let r;
                    switch (node.op) {
                        case '+': r = ab + bb; break;
                        case '-': r = ab - bb; break;
                        case '*': r = ab * bb; break;
                        case '/': r = bb === 0n ? 0n : ab / bb; break;
                        case '%': r = bb === 0n ? 0n : ab % bb; break;
                        default: return 0;
                    }
                    return Number(r);
                }
                if (typeof a !== 'number' || typeof b !== 'number') return 0;
                switch (node.op) {
                    case '+': return a + b;
                    case '-': return a - b;
                    case '*': return a * b;
                    case '/': return b === 0 ? 0 : Math.trunc(a / b);
                    case '%': return b === 0 ? 0 : a % b;
                }
                return 0;
            }
            case 'identifier': {
                return this.resolveValue({ type: 'varref', name: node.value, offset: node.offset || 0 });
            }
            case 'varref': {
                let target = this.allocations.find(x => x.name === node.name);
                if (!target) {
                    const aliasAddr = this.addressMap.get(node.name);
                    if (aliasAddr !== undefined) target = this.findAllocationContaining(aliasAddr);
                }
                if (!target) return 0;
                if (target.kind === 'array') {
                    if (node.offset > 0) {
                        const vals = target.values || [];
                        return typeof vals[node.offset] === 'number' ? vals[node.offset] : 0;
                    }
                    return typeof target.address === 'bigint' ? Number(target.address) : target.address;
                }
                if (target.kind === 'pointer') {
                    const v = target.resolvedAddress !== undefined ? target.resolvedAddress : target.value;
                    return typeof v === 'bigint' ? Number(v) : (typeof v === 'number' ? v : 0);
                }
                if (target.kind === 'variable' || target.kind === 'union' || target.kind === 'struct') {
                    return typeof target.value === 'number' ? target.value : 0;
                }
                return 0;
            }
            case 'deref': {
                const inner = this.resolveValue(node.target);
                if (typeof inner !== 'number') return 0;
                if (inner === 0) return 0;
                const v = this.readPointerValue(BigInt(inner));
                return typeof v === 'bigint' ? Number(v) : v;
            }
            case 'literal': return node.value;
            case 'string': return node.value;
            case 'address_of': return '&' + node.target;
        }
        return 0;
    }

    pointeeSize(node) {
        while (node && node.type === 'deref') node = node.target;
        if (!node || (node.type !== 'varref' && node.type !== 'identifier')) return 0;
        const t = this.allocations.find(x => x.name === (node.name !== undefined ? node.name : node.value));
        if (!t || t.kind !== 'pointer') return 0;
        const targetAlloc = t.resolvedAddress !== undefined ? this.findAllocationContaining(t.resolvedAddress) : null;
        if (targetAlloc) {
            return targetAlloc.elementSize || this.getTypeSize(targetAlloc.type || 'int') || 1;
        }
        const typeStr = t.displayType || t.type || '';
        const m = typeStr.match(/^([a-zA-Z_\s]+)\*/);
        return m ? (this.getTypeSize(m[1].trim()) || 1) : 1;
    }

    handleFunctionCall(decl, callerFrame) {
        if (!decl.fnDef) return null;

        this.frameCounter++;
        if (this.frameCounter > 30) { this.frameCounter--; return null; }
        const depth = this.frameCounter;

        const frame = {
            kind: 'frame',
            name: decl.name,
            displayName: decl.name + '()',
            params: [],
            locals: [],
            calls: [],
            returnAddress: this.addressMode === 64 ? BigInt(this.currentAddress) : this.currentAddress,
            depth,
            returnValue: 0
        };
        this.frames.push(frame);

        const allocParams = [];
        decl.fnDef.params.forEach((p, idx) => {
            const raw = decl.args[idx];
            const val = raw && typeof raw === 'object' ? this.evalFrameExpr(callerFrame || frame, raw) : (typeof raw === 'number' ? raw : 0);
            const isPtrLike = !!p.pointer || !!p.isArray;
            const ap = {
                kind: isPtrLike ? 'pointer' : 'variable',
                type: p.typeLabel || p.type,
                name: decl.name + '.' + p.name,
                displayName: p.name,
                size: isPtrLike ? (this.addressMode === 64 ? 8 : 4) : this.getTypeSize((p.type || 'int').replace(/^unsigned /, '')),
                alignment: 4,
                value: val,
                frameId: depth,
                isParam: true
            };
            if (isPtrLike && typeof val === 'number' && val !== 0) {
                const alias = this.nameForAddress(val);
                if (alias) ap.pointsTo = alias;
            }
            allocParams.push(ap);
        });

        for (const ap of allocParams) {
            const allocObj = this.allocate(ap);
            if (allocObj) {
                frame.params.push(allocObj);
                this.assignFrameLabel(allocObj, ap.displayName);
                this.addressMap.set(ap.displayName, allocObj.address);
                this.addressMap.set(allocObj.name, allocObj.address);
            }
        }

        decl.fnDef.locals.forEach(l => {
            let initVal = 0;
            if (l.init !== null && l.init !== undefined) {
                initVal = (typeof l.init === 'object') ? this.evalFrameExpr(frame, l.init) : Number(l.init);
            }
            const declObj = {
                kind: 'variable',
                type: l.type,
                name: decl.name + '.' + l.name,
                displayName: l.name,
                size: l.size || 4,
                alignment: 4,
                value: initVal,
                frameId: depth,
                isLocal: true
            };
            if (l.isArray) {
                declObj.kind = 'array';
                declObj.length = l.arrayLength || 1;
                declObj.elementSize = this.getTypeSize((l.type || 'int').replace(/^unsigned /, ''));
                declObj.values = new Array(declObj.length).fill(0);
                declObj.values[0] = initVal;
            }
            const allocObj = this.allocate(declObj);
            if (allocObj) {
                frame.locals.push(allocObj);
                this.assignFrameLabel(allocObj, l.name);
                this.addressMap.set(l.name, allocObj.address);
                this.addressMap.set(allocObj.name, allocObj.address);
            }
        });

        frame.displayName = decl.name + '(' + allocParams.map(a => a.value).join(', ') + ')';

        // if (cond) return X; guards evaluated in order
        for (const ir of (decl.fnDef.ifReturns || [])) {
            const hit = this.evalFrameExpr(frame, ir.cond);
            if (hit) {
                this._traceEvent(`[${frame.displayName}] 조기 반환: return ${this._exprToString(ir.value)};`);
                frame.returnValue = this.evalFrameExpr(frame, ir.value);
                return frame;
            }
        }

        // sequential body execution: assignments mutate frame locals, calls stack child frames
        for (const st of (decl.fnDef.bodyStatements || [])) {
            this._traceEvent(`[${frame.displayName}] ${this._stmtToString(st)}`);
            this.execFrameStatement(frame, st);
        }

        // return value
        if (decl.fnDef.returnStmt) {
            this._traceEvent(`[${frame.displayName}] return ${this._exprToString(decl.fnDef.returnStmt.value)};`);
            frame.returnValue = this.evalFrameExpr(frame, decl.fnDef.returnStmt.value);
        }

        return frame;
    }

    execFrameStatement(frame, st) {
        if (!st) return;
        if (st.kind === 'assign') {
            const v = this.evalFrameExpr(frame, st.expr);
            if (st.target && typeof st.target === 'object' && st.target.type === 'index') {
                const alloc = this.findFrameVar(frame, st.target.name);
                if (!alloc) return;
                const idx = this.evalFrameExpr(frame, st.target.index);
                if (alloc.kind === 'array') {
                    if (!alloc.values) alloc.values = [];
                    alloc.values[idx] = v;
                    if (alloc.address !== undefined) {
                        const elemSize = alloc.elementSize || 4;
                        const addr = this.addressMode === 64 ? BigInt(alloc.address) + BigInt(idx * elemSize) : alloc.address + idx * elemSize;
                        this.writeMemory(addr, v, alloc.elementType || alloc.type || 'int', elemSize);
                    }
                } else if (alloc.kind === 'pointer') {
                    const base = alloc.resolvedAddress !== undefined ? alloc.resolvedAddress : alloc.value;
                    if (!base) return;
                    const targetAlloc = this.findAllocationContaining(BigInt(base));
                    const elemSize = (targetAlloc && targetAlloc.elementSize) || 4;
                    const addr = BigInt(base) + BigInt(idx * elemSize);
                    this.writeMemory(addr, v, (targetAlloc && targetAlloc.elementType) || (targetAlloc && targetAlloc.type) || 'int', elemSize);
                    if (targetAlloc && targetAlloc.kind === 'array' && targetAlloc.values) {
                        targetAlloc.values[idx] = v;
                    }
                }
                return;
            }
            if (st.target && typeof st.target === 'object' && st.target.type === 'deref') {
                // write through pointer: *x = v — mutate caller's allocation
                const addr = this.evalFrameExpr(frame, st.target.target);
                if (typeof addr === 'number' && addr !== 0) {
                    const targetAlloc = this.findAllocationContaining(addr);
                    if (targetAlloc) {
                        const elemSize = (targetAlloc.kind === 'array' && targetAlloc.elementSize) || targetAlloc.size || 4;
                        this.writeMemory(addr, v, (targetAlloc.kind === 'array' ? (targetAlloc.elementType || 'int') : targetAlloc.type) || 'int', elemSize);
                        if (targetAlloc.kind === 'variable') targetAlloc.value = v;
                        if (targetAlloc.kind === 'pointer') targetAlloc.value = v;
                    }
                }
            } else {
                const alloc = this.findFrameVar(frame, st.target);
                if (alloc && (alloc.kind === 'variable' || alloc.kind === 'array')) {
                    if (alloc.kind === 'array') { if (!alloc.values) alloc.values = []; alloc.values[0] = v; }
                    alloc.value = v;
                    if (alloc.kind === 'variable' && alloc.address !== undefined) {
                        this.writeMemory(alloc.address, v, alloc.type || 'int', alloc.size || 4);
                    }
                }
            }
            return;
        }
        if (st.kind === 'call') {
            const def = this.fnDefs && this.fnDefs[st.name] ? this.fnDefs[st.name] : null;
            if (!def) return;
            if (this.frameCounter >= 7) return;
            this._traceEvent(`[${frame.displayName}] 호출: ${st.name}(${(st.args || []).map(a => this._exprToString(a)).join(', ')})`);
            const sub = { kind: 'function_call', name: st.name, args: st.args, fnDef: def };
            const childFrame = this.handleFunctionCall(sub, frame);
            this._traceEvent(`복귀: ${st.name}() = ${childFrame ? childFrame.returnValue : 0}`);
            if (childFrame) frame.calls.push(childFrame);
            return;
        }
        if (st.kind === 'if') {
            const hit = this.evalFrameExpr(frame, st.cond);
            if (hit) {
                for (const s of st.body || []) {
                    const ctl = this.execFrameStatement(frame, s);
                    if (ctl === 'break' || ctl === 'continue') return ctl;
                }
            }
            return null;
        }
        if (st.kind === 'break') return 'break';
        if (st.kind === 'continue') return 'continue';
        if (st.kind === 'loop') {
            const MAX_ITER = 200;
            if (st.ctype === 'for') {
                if (st.init) {
                    this._traceEvent(`[${frame.displayName}] for 초기화: ${this._stmtToString(st.init)}`);
                    this.execFrameStatement(frame, st.init);
                }
                let guard = 0;
                while (this.evalFrameExpr(frame, st.cond)) {
                    let ctl = null;
                    for (const s of st.body || []) {
                        ctl = this.execFrameStatement(frame, s);
                        if (ctl === 'break' || ctl === 'continue') break;
                    }
                    if (ctl === 'break') break;
                    if (st.step) {
                        this._traceEvent(`[${frame.displayName}] for 증감: ${this._stmtToString(st.step)}`);
                        this.execFrameStatement(frame, st.step);
                    }
                    if (++guard > MAX_ITER) break;
                }
            } else {
                // while
                let guard = 0;
                while (this.evalFrameExpr(frame, st.cond)) {
                    let ctl = null;
                    for (const s of st.body || []) {
                        ctl = this.execFrameStatement(frame, s);
                        if (ctl === 'break' || ctl === 'continue') break;
                    }
                    if (ctl === 'break') break;
                    if (++guard > MAX_ITER) break;
                }
            }
            return null;
        }
    }

    nameForAddress(addr) {
        const big = BigInt(addr);
        const frameNames = new Set(this.frames.map(f => f.name));
        for (const a of this.getAllocations()) {
            if (a.address !== undefined && BigInt(a.address) === big && !frameNames.has(a.name)) return a.name;
        }
        return null;
    }

    findFrameVar(frame, name) {
        if (!frame) return null;
        const p = frame.params.find(a => a.renderName === name);
        if (p) return p;
        const l = frame.locals.find(a => a.renderName === name);
        if (l) return l;
        return this.allocations.find(a => a.name === name) || null;
    }

    evalFrameExpr(frame, node) {
        if (node === null || node === undefined) return 0;
        if (typeof node === 'number') return node;
        if (typeof node === 'string') return node;
        switch (node.type) {
            case 'literal': return node.value;
            case 'varref': {
                const alloc = this.findFrameVar(frame, node.name);
                if (!alloc) return 0;
                if (alloc.kind === 'array') {
                    if (node.offset > 0) return (alloc.values || [])[node.offset] || 0;
                    return typeof alloc.address === 'bigint' ? Number(alloc.address) : alloc.address;
                }
                if (alloc.kind === 'pointer') {
                    const v = alloc.resolvedAddress !== undefined ? alloc.resolvedAddress : alloc.value;
                    return typeof v === 'bigint' ? Number(v) : (typeof v === 'number' ? v : 0);
                }
                return typeof alloc.value === 'number' ? alloc.value : 0;
            }
            case 'index': {
                const alloc = this.findFrameVar(frame, node.name);
                if (!alloc) return 0;
                const idx = this.evalFrameExpr(frame, node.index);
                if (alloc.kind === 'array') {
                    return (alloc.values || [])[idx] || 0;
                }
                if (alloc.kind === 'pointer') {
                    const base = alloc.resolvedAddress !== undefined ? alloc.resolvedAddress : alloc.value;
                    if (!base) return 0;
                    const targetAlloc = this.findAllocationContaining(BigInt(base));
                    const elemSize = (targetAlloc && targetAlloc.elementSize) || 4;
                    return this.readElementValue(BigInt(base) + BigInt(idx * elemSize), elemSize);
                }
                return 0;
            }
            case 'binop': {
                const a = this.evalFrameExpr(frame, node.left);
                const b = this.evalFrameExpr(frame, node.right);
                switch (node.op) {
                    case '+': return a + b;
                    case '-': return a - b;
                    case '*': return a * b;
                    case '/': return b === 0 ? 0 : Math.floor(a / b);
                    case '%': return b === 0 ? 0 : a % b;
                    case '<=': return a <= b ? 1 : 0;
                    case '>=': return a >= b ? 1 : 0;
                    case '<': return a < b ? 1 : 0;
                    case '>': return a > b ? 1 : 0;
                    case '==': return a === b ? 1 : 0;
                    case '!=': return a !== b ? 1 : 0;
                    default: return 0;
                }
            }
            case 'deref': {
                const inner = this.evalFrameExpr(frame, node.target);
                if (typeof inner !== 'number' || inner === 0) return 0;
                const v = this.readPointerValue(BigInt(inner));
                return typeof v === 'bigint' ? Number(v) : v;
            }
            case 'address_of': {
                const tgt = node.target && node.target.type === 'varref' ? this.findFrameVar(frame, node.target.name) : null;
                if (!tgt) return 0;
                const v = tgt.address !== undefined ? tgt.address : tgt.value;
                return typeof v === 'bigint' ? Number(v) : (typeof v === 'number' ? v : 0);
            }
            case 'func_call': {
                const def = this.fnDefs && this.fnDefs[node.name] ? this.fnDefs[node.name] : null;
                if (!def) return 0;
                if (this.frameCounter >= 7) return 0;
                this._traceEvent(`[${frame.displayName}] 호출: ${node.name}(${(node.args || []).map(a => this._exprToString(a)).join(', ')})`);
                const sub = { kind: 'function_call', name: node.name, args: node.args, fnDef: def };
                const childFrame = this.handleFunctionCall(sub, frame);
                this._traceEvent(`복귀: ${node.name}() = ${childFrame ? childFrame.returnValue : 0}`);
                if (childFrame) frame.calls.push(childFrame);
                return childFrame ? childFrame.returnValue : 0;
            }
        }
        return 0;
    }

    setFnDefs(fnDefs) {
        this.fnDefs = fnDefs || {};
    }

    // ---- Step mode (trace & replay) ----
    beginStepTrace() {
        this.stepTrace = [];
    }

    traceTopLevel(decl) {
        if (!this.stepTrace) return;
        this._traceEvent(this._describeDecl(decl));
    }

    getStepEventCount() {
        return this.stepTrace ? this.stepTrace.length : 0;
    }

    getStepLabel(index) {
        const e = this.stepTrace && this.stepTrace[index];
        return e ? e.label : null;
    }

    applyStepEvent(index) {
        const e = this.stepTrace && this.stepTrace[index];
        if (!e) return false;
        const s = e.state;
        this.allocations = this._clone(s.allocations);
        this.heapAllocations = this._clone(s.heapAllocations);
        this.overflowWarnings = this._clone(s.overflowWarnings);
        this.addressMap = this._clone(s.addressMap);
        this.heapCount = s.heapCount;
        this.frames = this._clone(s.frames);
        this.frameCounter = s.frameCounter;
        this.currentAddress = s.currentAddress;
        this.currentHeapAddress = s.currentHeapAddress;
        return true;
    }

    _traceEvent(label) {
        if (!this.stepTrace) return;
        this.stepTrace.push({ label, state: this._snapshot() });
    }

    _snapshot() {
        return {
            allocations: this._clone(this.allocations),
            heapAllocations: this._clone(this.heapAllocations),
            overflowWarnings: this._clone(this.overflowWarnings),
            addressMap: this._clone(this.addressMap),
            heapCount: this.heapCount,
            frames: this._clone(this.frames),
            frameCounter: this.frameCounter,
            currentAddress: this.currentAddress,
            currentHeapAddress: this.currentHeapAddress
        };
    }

    _clone(v) {
        if (v === null || typeof v !== 'object') return v;
        if (Array.isArray(v)) return v.map(x => this._clone(x));
        if (v instanceof Map) {
            const m = new Map();
            for (const [k, val] of v) m.set(k, this._clone(val));
            return m;
        }
        const o = {};
        for (const k of Object.keys(v)) o[k] = this._clone(v[k]);
        return o;
    }

    _describeDecl(decl) {
        if (!decl) return '선언 처리';
        switch (decl.kind) {
            case 'variable':
            case 'pointer':
            case 'struct':
                return `${decl.type || 'int'} ${decl.name} 선언`;
            case 'array':
                return `${decl.type || 'int'} ${decl.name}[${decl.length || ''}] 선언`;
            case 'union':
                return `union ${decl.name} 선언`;
            case 'assignment':
                return `${decl.target} = ${this._exprToString(decl.value)}`;
            case 'function_call':
                return `함수 호출: ${decl.name}(${(decl.args || []).map(a => this._exprToString(a)).join(', ')})`;
            case 'function_def':
                return `함수 정의: ${decl.name}()`;
            case 'free':
                return `free(${decl.target})`;
            default:
                return `${decl.kind || '선언'} 처리`;
        }
    }

    _stmtToString(st) {
        if (!st) return '';
        switch (st.kind) {
            case 'assign': {
                const t = typeof st.target === 'object' ? this._targetToString(st.target) : st.target;
                return `${t} = ${this._exprToString(st.expr)};`;
            }
            case 'call':
                return `${st.name}(${(st.args || []).map(a => this._exprToString(a)).join(', ')});`;
            case 'if':
                return `if (${this._exprToString(st.cond)}) { ... }`;
            case 'loop':
                return st.ctype === 'for'
                    ? `for (${this._stmtToString(st.init)} ${this._exprToString(st.cond)}; ${this._stmtToString(st.step)}) { ... }`
                    : `while (${this._exprToString(st.cond)}) { ... }`;
            case 'break':
                return 'break;';
            case 'continue':
                return 'continue;';
            default:
                return st.kind;
        }
    }

    _targetToString(t) {
        if (t.type === 'index') return `${t.name}[${this._exprToString(t.index)}]`;
        if (t.type === 'deref') return `*${this._exprToString(t.target)}`;
        return t.name || String(t);
    }

    _exprToString(node) {
        if (node === null || node === undefined) return '0';
        if (typeof node !== 'object') return String(node);
        switch (node.type) {
            case 'literal': return String(node.value);
            case 'string': return '"' + node.value + '"';
            case 'varref': return node.offset > 0 ? `${node.name}[${node.offset}]` : node.name;
            case 'index': return `${node.name}[${this._exprToString(node.index)}]`;
            case 'deref': return `*${this._exprToString(node.target)}`;
            case 'address_of': {
                const t = node.target;
                const inner = t && typeof t === 'object' ? this._targetToString(t) : String(t);
                return '&' + inner;
            }
            case 'binop':
                return `(${this._exprToString(node.left)} ${node.op} ${this._exprToString(node.right)})`;
            case 'func_call':
                return `${node.name}(${(node.args || []).map(a => this._exprToString(a)).join(', ')})`;
            default: return node.type;
        }
    }

    assignFrameLabel(alloc, displayLabel) {
        alloc.renderName = displayLabel;
    }

    checkTypeRange(declaration) {
        const value = declaration.value;
        if (typeof value !== 'number' || !Number.isFinite(value)) return null;

        const type = declaration.type || '';
        const unsigned = type.includes('unsigned');
        const base = type.replace('unsigned ', '').replace(/\*/g, '').trim();
        const bits = { 'char': 8, 'short': 16, 'int': 32, 'long': 64 }[base] || 32;

        if (unsigned) {
            const max = Math.pow(2, bits) - 1;
            if (value < 0 || value > max) {
                const wrapped = value % (max + 1);
                return { min: 0, max, wrapped: Math.abs(wrapped) };
            }
        } else {
            const min = -Math.pow(2, bits - 1);
            const max = Math.pow(2, bits - 1) - 1;
            if (value < min || value > max) {
                let v = value % Math.pow(2, bits);
                if (v > max) v -= Math.pow(2, bits);
                return { min, max, wrapped: v };
            }
        }
        return null;
    }

    handleFree(pointerName) {
        const pointer = this.allocations.find(a => a.name === pointerName);
        if (!pointer || pointer.kind !== 'pointer') {
            this.overflowWarnings.push({
                kind: 'free',
                name: pointerName,
                message: `free(${pointerName}) 대상이 힙 포인터가 아닙니다`
            });
            return;
        }

        if (pointer.danglingBlock) {
            this.overflowWarnings.push({
                kind: 'free',
                name: pointerName,
                message: `${pointer.danglingBlock} 더블 프리(double free) 감지`
            });
            return;
        }

        const addrRaw = pointer.resolvedAddress !== undefined ? pointer.resolvedAddress : pointer.value;
        if (!addrRaw || addrRaw === 0 || addrRaw === 0n) {
            this.overflowWarnings.push({
                kind: 'free',
                name: pointerName,
                message: `free(${pointerName}): NULL 또는 초기화되지 않은 포인터입니다`
            });
            return;
        }

        const addr = BigInt(addrRaw);
        const heapBlock = this.heapAllocations.find(h => {
            const hAddr = BigInt(h.address);
            return addr >= hAddr && addr < hAddr + BigInt(h.size);
        });

        if (!heapBlock) {
            this.overflowWarnings.push({
                kind: 'free',
                name: pointerName,
                message: `free(${pointerName}): 힙이 아닌 주소(${addr.toString(16)})입니다 (스택 변수 주소?)`
            });
            return;
        }

        if (heapBlock.freed) {
            this.overflowWarnings.push({
                kind: 'free',
                name: pointerName,
                message: `${heapBlock.name} 더블 프리(double free) 감지`
            });
            return;
        }

        // 실제 C와 동일: free 후에도 포인터는 주소 값을 유지한다 (댕글링 포인터)
        heapBlock.freed = true;
        for (let i = 0; i < heapBlock.bytes.length; i++) heapBlock.bytes[i] = 0xCD;
        pointer.isDangling = true;
        pointer.danglingBlock = heapBlock.name;
        pointer.pointsTo = null;
        pointer.pointsToIndex = null;
        pointer.pointsToMember = null;
    }

    getFreedBlock(address) {
        if (address === undefined || address === null) return null;
        const addr = BigInt(address);
        return this.heapAllocations.find(h => h.freed && addr >= BigInt(h.address) && addr < BigInt(h.address) + BigInt(h.size)) || null;
    }

    handleAssignment(action) {
        const targetExpr = action.target; 
        const valueExpr = action.value;   

        const targetInfo = this.resolveTargetAddress(targetExpr);
        if (!targetInfo) {
            console.warn(`Failed to resolve assignment target: ${targetExpr}`);
            return;
        }

        let value = 0;
        let newPointsTo = null; 
        
        if (valueExpr && typeof valueExpr === 'object' && valueExpr.type === 'func_call') {
            // Function call on assignment RHS: result = add(3, 4);
            const callDecl = { kind: 'function_call', name: valueExpr.name, args: valueExpr.args, fnDef: valueExpr.fnDef };
            const fr = this.handleFunctionCall(callDecl, null);
            const rv = fr ? fr.returnValue : 0;
            value = typeof rv === 'number' ? rv : 0;
        } else if (valueExpr && typeof valueExpr === 'object') {
            value = this.resolveValue(valueExpr);
        } else if (typeof valueExpr === 'string' && valueExpr.startsWith('&')) {
             const varName = valueExpr.substring(1).trim();
             
             if (varName.includes('[')) {
                 const resolved = this.resolveTargetAddress(varName);
                 if (resolved) value = resolved.address;
             } else {
                 const addr = this.addressMap.get(varName);
                 value = addr !== undefined ? addr : 0;
             }
        } else {
             const resolved = this.resolveTargetAddress(valueExpr.toString()); 
             if (resolved) {
                 value = this.readPointerValue(resolved.address);
             } else {
                 value = parseInt(valueExpr);
                 if (isNaN(value)) value = 0;
             }
        }

        this.writeMemory(targetInfo.address, value, targetInfo.type, targetInfo.size);

        const targetAlloc = this.findAllocationContaining(targetInfo.address);
        if (targetAlloc) {
            if (targetAlloc.kind === 'variable') {
                targetAlloc.value = value;
            } else if (targetAlloc.kind === 'array') {
                const offsetBytes = Number(BigInt(targetInfo.address) - BigInt(targetAlloc.address));
                const elemSize = targetAlloc.elementSize || this.getTypeSize(targetAlloc.type);
                const index = Math.floor(offsetBytes / elemSize);
                
                if (index >= 0 && index < targetAlloc.length) {
                    if (!targetAlloc.values) targetAlloc.values = [];
                    targetAlloc.values[index] = value;
                }
            } else if (targetAlloc.kind === 'struct' || (targetAlloc.kind === 'heap_block' && targetAlloc.structDef)) {
                const offsetBytes = Number(BigInt(targetInfo.address) - BigInt(targetAlloc.address));
                let currentOffset = 0;
                
                for (const member of targetAlloc.members) {
                    const padding = member.padding || 0;
                    const memberStart = currentOffset + padding;
                    const memberEnd = memberStart + member.size;
                    
                    if (offsetBytes >= memberStart && offsetBytes < memberEnd) {
                        if (member.kind === 'variable' || member.kind === 'pointer') {
                             member.value = value;
                        } else if (member.kind === 'array') {
                             const subOffset = offsetBytes - memberStart;
                             const elemSize = member.elementSize || 1;
                             const idx = Math.floor(subOffset / elemSize);
                             if (member.values && idx >= 0 && idx < member.length) {
                                 member.values[idx] = value;
                             }
                        }
                        break;
                    }
                    currentOffset += padding + member.size;
                }
            }
        }

        const alloc = this.findAllocationContaining(targetInfo.address);
        if (alloc && alloc.kind === 'pointer') {
            if (value === 0) {
                alloc.pointsTo = null;
                alloc.resolvedAddress = 0;
                alloc.pointsToIndex = null;
                alloc.pointsToMember = null;
            } else {
                const targetAlloc = this.findAllocationContaining(value);
                if (targetAlloc) {
                    alloc.pointsTo = targetAlloc.name;
                    const offset = Number(BigInt(value) - BigInt(targetAlloc.address));
                    
                    if (targetAlloc.kind === 'array') {
                         const elemSize = targetAlloc.elementSize || this.getTypeSize(targetAlloc.type);
                         alloc.pointsToIndex = Math.floor(offset / elemSize);
                         alloc.pointsToMember = null;
                    } else if (targetAlloc.kind === 'struct') {
                         alloc.pointsToIndex = null;
                         let currentOffset = 0;
                         let foundMember = null;
                         for(const m of targetAlloc.members) {
                             const totalSize = (m.padding || 0) + m.size;
                             if (offset >= currentOffset && offset < currentOffset + totalSize) {
                                 foundMember = m.name;
                                 break;
                             }
                             currentOffset += totalSize;
                         }
                         alloc.pointsToMember = foundMember;
                    } else {
                         alloc.pointsToIndex = null;
                         alloc.pointsToMember = null;
                    }
                    alloc.resolvedAddress = value;
                }
            }
        }
    }

    resolveTargetAddress(expr) {
        if (expr.includes('.') && !expr.includes('->') && !expr.startsWith('*')) {
            const parts = expr.split('.');
            const varName = parts[0];
            const addr = this.addressMap.get(varName);
            
            if (addr !== undefined) {
                let currentAlloc = this.getAllocations().find(a => a.name === varName);
                let currentAddr = addr;
                
                for (let i = 1; i < parts.length; i++) {
                    const memberName = parts[i];
                    
                    if (!currentAlloc || !currentAlloc.members) return null;
                    
                    const member = currentAlloc.members.find(m => m.name === memberName);
                    if (!member) return null;
                    
                    const offset = member.offset || 0;
                    currentAddr = this.addressMode === 64 ? BigInt(currentAddr) + BigInt(offset) : currentAddr + offset;
                    
                    currentAlloc = member; 
                }
                
                return { 
                    address: currentAddr, 
                    type: currentAlloc.type, 
                    size: currentAlloc.size 
                };
            }
        }

        if (expr.includes('->')) {
            const parts = expr.split('->');
            const ptrName = parts[0].trim();
            const memberName = parts[1].trim();

            const ptrAddr = this.addressMap.get(ptrName);
            if (ptrAddr === undefined) return null;

            const ptrValue = this.readPointerValue(ptrAddr);
            if (ptrValue === 0n || ptrValue === 0) return null; 

            if (memberName === 'data' || memberName === 'x' || memberName === 'id') return { address: ptrValue, type: 'int', size: 4 };
            if (memberName === 'next' || memberName === 'y' || memberName === 'p1' || memberName === 'p2') {
                const offset = this.addressMode === 64 ? 8n : 4;
                const addr = this.addressMode === 64 ? BigInt(ptrValue) + BigInt(offset) : ptrValue + offset;
                return { address: addr, type: 'pointer', size: this.addressMode === 64 ? 8 : 4 };
            }
            return { address: ptrValue, type: 'int', size: 4 };
        }
        
        if (expr.includes('[') && expr.endsWith(']')) {
            const match = expr.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$/);
            if (match) {
                const arrName = match[1];
                const index = parseInt(match[2]);
                const arrAddr = this.addressMap.get(arrName);
                
                if (arrAddr !== undefined) {
                     const alloc = this.getAllocations().find(a => a.name === arrName);
                     const elemSize = alloc ? (alloc.elementSize || 1) : 4; 
                     const type = alloc ? alloc.type : 'int';
                     
                     const offset = index * elemSize;
                     const addr = this.addressMode === 64 ? BigInt(arrAddr) + BigInt(offset) : arrAddr + offset;
                     return { address: addr, type: type, size: elemSize };
                }
            }
        }

        if (expr.startsWith('*')) {
            const inner = expr.substring(1).trim();
            const parenMatch = inner.match(/^\(([a-zA-Z_][a-zA-Z0-9_]*)\s*\+\s*(\d+)\)$/);
            
            if (parenMatch) {
                const ptrName = parenMatch[1];
                const offsetIdx = parseInt(parenMatch[2]);
                const ptrAddr = this.addressMap.get(ptrName);
                
                if (ptrAddr !== undefined) {
                    const ptrValue = this.readPointerValue(ptrAddr);
                    const ptrAlloc = this.getAllocations().find(a => a.name === ptrName);
                    const fullType = ptrAlloc ? ptrAlloc.type : 'int*'; 
                    const baseType = fullType.replace('*', '').trim();
                    const size = this.getTypeSize(baseType);
                    
                    const offset = offsetIdx * size;
                    const addr = this.addressMode === 64 ? BigInt(ptrValue) + BigInt(offset) : ptrValue + offset;
                    
                    return { address: addr, type: baseType, size: size };
                }
            }

            const ptrName = inner; 
            const ptrAddr = this.addressMap.get(ptrName);
            if (ptrAddr !== undefined) {
                const ptrValue = this.readPointerValue(ptrAddr);
                const ptrAlloc = this.getAllocations().find(a => a.name === ptrName);
                const type = ptrAlloc ? ptrAlloc.type.replace('*', '').trim() : 'int';
                const size = this.getTypeSize(type);
                
                return { address: ptrValue, type: type, size: size }; 
            }
        }

        const addr = this.addressMap.get(expr);
        if (addr !== undefined) {
            const alloc = this.getAllocations().find(a => a.name === expr);
            return { address: addr, type: alloc ? alloc.type : 'int', size: alloc ? alloc.size : 4 };
        }

        return null;
    }

    readElementValue(address, elemSize) {
        const alloc = this.findAllocationContaining(address);
        if (!alloc) return 0;
        const offset = Number(BigInt(address) - BigInt(alloc.address));
        let value = 0n;
        for (let i = 0; i < elemSize; i++) {
            const byte = alloc.bytes[offset + i] || 0;
            value += BigInt(byte) << BigInt(i * 8);
        }
        if (elemSize > 1) {
            const bits = elemSize * 8;
            const max = 1n << BigInt(bits - 1);
            if (value >= max) value -= 1n << BigInt(bits);
        }
        return typeof value === 'bigint' ? Number(value) : value;
    }

    readPointerValue(address) {
        const alloc = this.findAllocationContaining(address);
        if (!alloc) return 0;

        const offset = Number(BigInt(address) - BigInt(alloc.address));
        const size = this.addressMode === 64 ? 8 : 4;
        
        let value = 0n;
        for (let i = 0; i < size; i++) {
            const byte = alloc.bytes[offset + i] || 0;
            value += BigInt(byte) << BigInt(i * 8);
        }
        return value; 
    }

    findAllocationContaining(address) {
        const addrBig = BigInt(address);
        return this.getAllocations().find(a => {
            const start = BigInt(a.address);
            const end = start + BigInt(a.size);
            return addrBig >= start && addrBig < end;
        });
    }

    writeMemory(address, value, type, size) {
        const alloc = this.findAllocationContaining(address);
        if (!alloc) {
            // Attribute the overflow to the allocation whose end the write crossed
            let prev = null;
            for (const a of this.getAllocations()) {
                const end = BigInt(a.address) + BigInt(a.size);
                if (end <= BigInt(address) && (!prev || end > BigInt(prev.address) + BigInt(prev.size))) {
                    prev = a;
                }
            }
            this.overflowWarnings.push({
                name: prev ? prev.name : '(out of bounds)',
                address: address,
                type: type,
                overflowBytes: size
            });
            return;
        }

        const offset = Number(BigInt(address) - BigInt(alloc.address));
        const bytes = this.valueToBytes(value, type, size);
        const end = offset + bytes.length;

        if (end > alloc.bytes.length) {
            this.overflowWarnings.push({
                name: alloc.name,
                address: address,
                type: type,
                overflowBytes: end - alloc.bytes.length
            });
        }

        for (let i = 0; i < bytes.length; i++) {
            if (offset + i < alloc.bytes.length) {
                alloc.bytes[offset + i] = bytes[i];
            }
        }
    }

    getTypeSize(type) {
        if (!type) return 1;
        if (type.includes('*')) return this.addressMode === 64 ? 8 : 4;
        switch (type.replace('unsigned ', '')) {
            case 'char': return 1;
            case 'short': return 2;
            case 'int': return 4;
            case 'long': return this.addressMode === 64 ? 8 : 4;
            case 'float': return 4;
            case 'double': return 8;
            default: return 1;
        }
    }

    getBytes(decl) {
        if (decl.kind === 'pointer') {
             if (decl.value) {
                 return this.valueToBytes(decl.value, 'long', decl.size); 
             }
             return this.pointerToBytes(decl);
        }
        
        switch (decl.kind) {
            case 'variable': return this.valueToBytes(decl.value, decl.type, decl.size);
            case 'pointer': return this.pointerToBytes(decl);
            case 'array': return this.arrayToBytes(decl);
            case 'struct': return this.structToBytes(decl);
            case 'union': return this.unionToBytes(decl);
            default: return new Array(decl.size).fill(0);
        }
    }

    valueToBytes(value, type, size) {
        if (type === 'float') return this.floatToBytes(value);
        if (type === 'double') return this.doubleToBytes(value);
        if (type === 'char' || type === 'unsigned char') {
            return [Number(value) & 0xFF];
        }

        const bytes = [];
        if (typeof value === 'bigint') {
            let val = value;
            if (val < 0n) {
                const mask = (1n << BigInt(size * 8)) - 1n;
                val = val & mask; 
            }
            
            for (let i = 0; i < size; i++) {
                bytes.push(Number(val & 0xFFn));
                val = val >> 8n;
            }
        } else {
            let val = value < 0 ? Number((1n << BigInt(size * 8)) + BigInt(value)) : value;
            for (let i = 0; i < size; i++) { 
                bytes.push(val & 0xFF); 
                val = Math.floor(val / 256); 
            }
        }
        return bytes;
    }

    floatToBytes(value) {
        const buf = new ArrayBuffer(4), view = new DataView(buf);
        view.setFloat32(0, value, true);
        return [0, 1, 2, 3].map(i => view.getUint8(i));
    }

    doubleToBytes(value) {
        const buf = new ArrayBuffer(8), view = new DataView(buf);
        view.setFloat64(0, value, true);
        return [0, 1, 2, 3, 4, 5, 6, 7].map(i => view.getUint8(i));
    }

    pointerToBytes(decl) {
        const bytes = [], size = decl.size;
        for (let i = 0; i < size; i++) bytes.push(0);
        return bytes;
    }

    arrayToBytes(decl) {
        const bytes = [];
        
        if (decl.structDef) {
            const structDef = decl.structDef;
            const values = decl.values; 
            
            for (let i = 0; i < decl.length; i++) {
                const valStr = values[i];
                const elemValues = (typeof valStr === 'string') ? valStr.split(',').map(v => v.trim()) : [];
                
                const elemDecl = {
                    kind: 'struct',
                    type: decl.type.replace(/\[\d*\]/, '').trim(), 
                    size: structDef.size,
                    members: structDef.members.map((m, mIdx) => {
                        let val = 0;
                        const vStr = elemValues[mIdx];
                        if (vStr) {
                            if (vStr.startsWith('0x')) val = parseInt(vStr, 16);
                            else if (vStr.includes('.')) val = parseFloat(vStr);
                            else val = parseInt(vStr, 10) || 0;
                        }
                        return { ...m, value: val };
                    })
                };
                bytes.push(...this.structToBytes(elemDecl));
            }
            return bytes;
        }

        for (let i = 0; i < decl.length; i++) {
            bytes.push(...this.valueToBytes(decl.values[i] || 0, decl.type, decl.elementSize));
        }
        return bytes;
    }

    structToBytes(decl) {
        const bytes = [];
        
        const addPadding = (count) => {
            for(let i=0; i<count; i++) bytes.push(0);
        };

        for (const m of decl.members) {
            if (m.padding && m.padding > 0) {
                addPadding(m.padding);
            }

            if (m.kind === 'array') {
                bytes.push(...this.arrayToBytes(m));
            } else if (m.kind === 'struct') {
                bytes.push(...this.structToBytes(m));
            } else {
                bytes.push(...this.valueToBytes(m.value, m.type, m.size));
            }
        }
        
        while (bytes.length < decl.size) {
            bytes.push(0);
        }
        
        return bytes;
    }

    unionToBytes(decl) {
        const bytes = new Array(decl.size).fill(0);
        if (decl.members.length > 0) {
            const m = decl.members[0];
            const mb = this.valueToBytes(m.value, m.type, m.size);
            for (let i = 0; i < mb.length; i++) bytes[i] = mb[i];
        }
        return bytes;
    }

    resolvePointers() {
        let changes = true;
        let iterations = 0;
        
        while (changes && iterations < 10) {
            changes = false;
            iterations++;
            
            for (const alloc of this.getAllocations()) {
                if (alloc.kind === 'pointer' && alloc.pointsTo) {
                    
                    const targetAlloc = this.getAllocations().find(a => a.name === alloc.pointsTo);
                    const targetBaseAddr = this.addressMap.get(alloc.pointsTo);

                    if (targetBaseAddr !== undefined) {
                        let target = targetBaseAddr;
                        let offset = 0;
                        let baseIsPointerValue = false;
                        
                        if (targetAlloc && targetAlloc.kind === 'pointer' && alloc.pointsToIndex !== null && alloc.pointsToIndex !== 0) {
                            if (targetAlloc.resolvedAddress !== undefined) {
                                target = targetAlloc.resolvedAddress; 
                                baseIsPointerValue = true;
                            } else {
                                continue; 
                            }
                        }

                        if (alloc.pointsToIndex !== null && alloc.pointsToIndex !== 0) {
                            let elementSize = 1;
                            
                            if (baseIsPointerValue) {
                                if (targetAlloc.baseType) {
                                    elementSize = this.getTypeSize(targetAlloc.baseType);
                                } else {
                                    const typeStr = targetAlloc.displayType || targetAlloc.type;
                                    if (typeStr.includes('*')) {
                                        const typeName = typeStr.substring(0, typeStr.lastIndexOf('*')).trim();
                                        elementSize = this.getTypeSize(typeName);
                                    }
                                }
                            } else if (targetAlloc) {
                                elementSize = targetAlloc.elementSize || this.getTypeSize(targetAlloc.type) || 1;
                            }
                            
                            offset = alloc.pointsToIndex * elementSize;
                        }
                        else if (alloc.pointsToMember && targetAlloc && targetAlloc.members) {
                            for (const member of targetAlloc.members) {
                                offset += (member.padding || 0);
                                if (member.name === alloc.pointsToMember) {
                                    break;
                                }
                                offset += member.size;
                            }
                        }

                        let resolvedAddr;
                        if (this.addressMode === 64) {
                            resolvedAddr = BigInt(target) + BigInt(offset);
                        } else {
                            resolvedAddr = Number(target) + offset;
                        }
                        
                        if (alloc.resolvedAddress !== resolvedAddr) {
                            alloc.resolvedAddress = resolvedAddr;
                            
                            alloc.bytes = [];
                            for (let i = 0; i < alloc.size; i++) {
                                alloc.bytes.push(this.addressMode === 64
                                    ? Number((BigInt(resolvedAddr) >> BigInt(i * 8)) & 0xFFn)
                                    : (Number(resolvedAddr) >> (i * 8)) & 0xFF);
                            }
                            changes = true;
                        }
                    }
                }
            }
        }
    }

    formatAddress(address, mode = 'hex') {
        if (this.addressMode === 64) {
            const addr = BigInt(address);
            return mode === 'hex' ? '0x' + addr.toString(16).toUpperCase().padStart(12, '0')
                : addr.toString(2).padStart(48, '0');
        } else {
            return mode === 'hex' ? '0x' + address.toString(16).toUpperCase().padStart(8, '0')
                : address.toString(2).padStart(32, '0');
        }
    }

    getAllocations() { 
        return [...this.allocations, ...this.heapAllocations]; 
    }

    getStats() {
        const all = this.getAllocations();
        let stackBytes = 0;
        let heapBytes = 0;
        let paddingBytes = 0;
        let freedBytes = 0;
        let blocks = 0;

        for (const a of all) {
            const size = a.size || 0;
            blocks++;
            if (a.kind === 'padding') {
                paddingBytes += size;
            } else if (a.section === 'heap') {
                if (a.freed) freedBytes += size;
                else heapBytes += size;
            } else {
                stackBytes += size;
            }
        }

        return {
            stackBytes,
            heapBytes,
            paddingBytes,
            freedBytes,
            totalBytes: stackBytes + heapBytes + paddingBytes,
            blockCount: blocks
        };
    }
}

window.VirtualMemory = VirtualMemory;
