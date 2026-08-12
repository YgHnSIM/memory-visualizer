/**
 * C Code Parser (Recursive Descent Implementation)
 * Parses C code to extract variable, pointer, array, struct, and union declarations
 */

class CParser {
    constructor() {
        this.typeSizes = {
            'char': 1,
            'short': 2,
            'int': 4,
            'long': 8,
            'float': 4,
            'double': 8,
            'void': 0,
            'unsigned char': 1,
            'unsigned short': 2,
            'unsigned int': 4,
            'unsigned long': 8
        };

        this.pointerSize = 8;
        this.structDefs = {};
        this.unionDefs = {};
        this.enumDefs = {};
        this.typedefs = {};
        
        this.tokens = [];
        this.pos = 0;
        this.errors = [];
    }

    setArchitecture(bits) {
        if (bits === 32) {
            this.typeSizes['long'] = 4;
            this.pointerSize = 4;
        } else {
            this.typeSizes['long'] = 8;
            this.pointerSize = 8;
        }
    }

    getAlignment(type) {
        if (type.includes('*') || type === 'pointer') return this.pointerSize;
        
        if (type.includes('[')) {
            const baseType = type.substring(0, type.indexOf('[')).trim();
            return this.getAlignment(baseType);
        }

        let cleanType = type.replace('unsigned ', '').trim();
        
        if (cleanType.startsWith('struct ')) {
            const structName = cleanType.split(/\s+/)[1];
            if (this.structDefs[structName]) return this.structDefs[structName].alignment;
            return this.pointerSize;
        }
        
        if (cleanType.startsWith('union ')) {
             return this.pointerSize; 
        }

        return this.typeSizes[cleanType] || 1;
    }
    
    getTypeSize(type) {
        if (type.endsWith('*')) return this.pointerSize;
        if (type.startsWith('struct ')) {
            const name = type.split(/\s+/)[1];
            return this.structDefs[name] ? this.structDefs[name].size : 0;
        }
        if (type.startsWith('union ')) {
            const name = type.split(/\s+/)[1];
            return this.unionDefs[name] ? this.unionDefs[name].size : 0;
        }
        return this.typeSizes[type.replace('unsigned ', '')] || 4;
    }

    tokenize(code) {
        const tokens = [];
        let cursor = 0;
        
        const patterns = [
            { type: 'COMMENT_SINGLE', regex: /^\/\/.*/ },
            { type: 'COMMENT_MULTI', regex: /^\/\*[\s\S]*?\*\// },
            { type: 'STRING', regex: /^"([^"\\]|\\.)*"/ },
            { type: 'CHAR', regex: /^'([^'\\]|\\.)*'/ },
            { type: 'HEX', regex: /^0x[0-9a-fA-F]+[uUlL]*/ },
            { type: 'NUMBER', regex: /^\d+(\.\d+)?[uUlLfF]*/ },
            { type: 'KEYWORD', regex: /^(typedef|enum|free|struct|union|unsigned|char|short|int|long|float|double|void|sizeof|malloc|NULL|if|return|while|for|break|continue)\b/ },
            { type: 'IDENTIFIER', regex: /^[a-zA-Z_][a-zA-Z0-9_]*/ },
            { type: 'OPERATOR', regex: /^(\+\+|--|->|==|!=|<=|>=|<<|>>|\+=|-=|\*=|\/=|%|<|>|!)/ },
            { type: 'SYMBOL', regex: /^([{}[\],;=()*&.+-])/ },
            { type: 'WHITESPACE', regex: /^\s+/ }
        ];

        while (cursor < code.length) {
            let matched = false;
            const sub = code.slice(cursor);

            for (const { type, regex } of patterns) {
                const match = sub.match(regex);
                if (match) {
                    if (type !== 'WHITESPACE' && type !== 'COMMENT_SINGLE' && type !== 'COMMENT_MULTI') {
                        let value = match[0];
                        if (type === 'NUMBER' || type === 'HEX') {
                            value = value.replace(/[uUlLfF]+$/, '');
                        }
                        tokens.push({ type, value });
                    }
                    cursor += match[0].length;
                    matched = true;
                    break;
                }
            }

            if (!matched) {
                cursor++;
            }
        }
        return tokens;
    }

    peek() {
        return this.tokens[this.pos];
    }

    consume(type = null, value = null) {
        const token = this.tokens[this.pos];
        if (!token) return null;
        if (type && token.type !== type) return null;
        if (value && token.value !== value) return null;
        this.pos++;
        return token;
    }

    match(type, value = null) {
        const token = this.tokens[this.pos];
        if (!token) return false;
        if (token.type !== type) return false;
        if (value && token.value !== value) return false;
        return true;
    }

    expect(type, value = null, errorMsg = "Unexpected token") {
        const token = this.consume(type, value);
        if (!token) {
            throw new Error(`${errorMsg} at token ${this.tokens[this.pos]?.value}`);
        }
        return token;
    }

    parse(code) {
        this.tokens = this.tokenize(code);
        this.pos = 0;
        this.structDefs = {};
        this.unionDefs = {};
        this.enumDefs = {};
        this.typedefs = {};
        this.functionDefs = {};
        this.errors = [];
        
        const output = [];

        while (this.pos < this.tokens.length) {
            try {
                const decls = this.parseStatement();
                if (decls) {
                    if (Array.isArray(decls)) {
                        output.push(...decls.filter(Boolean));
                    } else if (decls.kind === 'struct_assignment') {
                        const target = output.find(d => d.name === decls.name);
                        if (target && target.kind === 'struct') {
                             this.applyStructInitializer(target.members, decls.values);
                        }
                    } else {
                        output.push(decls);
                    }
                }
            } catch (e) {
                const token = this.tokens[this.pos];
                this.errors.push({
                    message: e.message,
                    token: token ? token.value : 'EOF',
                    position: this.pos,
                    hint: this.buildErrorHint(token, e.message)
                });
                console.error("Parse error:", e);
                while (this.pos < this.tokens.length && this.tokens[this.pos].value !== ';') {
                    this.pos++;
                }
                this.pos++;
            }
        }
        return output;
    }

    tryParseFunctionDefinition() {
        const savedPos = this.pos;
        const specifier = this.parseTypeSpecifier();
        const nameTok = this.peek();
        if (!nameTok || nameTok.type !== 'IDENTIFIER' || this.peekAfter(1)?.value !== '(') {
            this.pos = savedPos;
            return null;
        }
        this.consume('IDENTIFIER');
        this.consume('SYMBOL', '(');

        const params = [];
        while (!this.match('SYMBOL', ')')) {
            if (this.match('SYMBOL', ',')) { this.consume(); continue; }
            const pSpec = this.parseTypeSpecifier();
            let ptrs = 0;
            while (this.match('SYMBOL', '*')) { this.consume(); ptrs++; }
            const pName = this.consume('IDENTIFIER');
            let isArrParam = false;
            if (this.match('SYMBOL', '[')) {
                this.consume();
                if (this.match('NUMBER')) this.consume();
                this.consume('SYMBOL', ']');
                isArrParam = true;
            }
            if (pName) {
                params.push({
                    name: pName.value,
                    type: pSpec.typeName,
                    pointer: ptrs,
                    isArray: isArrParam,
                    typeLabel: pSpec.typeName + '*'.repeat(ptrs) + (isArrParam ? '[]' : '')
                });
            }
        }
        this.consume('SYMBOL', ')');

        // Prototype only: int add(int a, int b);
        if (this.match('SYMBOL', ';')) {
            this.consume();
            this.functionDefs[nameTok.value] = { name: nameTok.value, returnType: specifier.typeName, params, locals: [], calls: [], returnStmt: null };
            return { kind: 'function_def', name: nameTok.value, prototypeOnly: true };
        }

        // Definition: { body }
        if (this.match('SYMBOL', '{')) {
            // Register placeholder first so recursive self-calls don't look unknown
            this.functionDefs[nameTok.value] = {
                name: nameTok.value,
                returnType: specifier.typeName,
                params,
                locals: [],
                calls: [],
                returnStmt: null
            };
            const bodyStart = this.pos + 1;
            this.skipBalanced('{', '}');
            const bodyTokens = this.tokens.slice(bodyStart, this.pos - 1);
            const info = this.extractFunctionBody(bodyTokens);
            this.functionDefs[nameTok.value] = {
                name: nameTok.value,
                returnType: specifier.typeName,
                params,
                locals: info.locals,
                calls: info.calls,
                returnStmt: info.returnStmt,
                bodyStatements: info.bodyStatements,
                ifReturns: info.ifReturns
            };
            if (nameTok.value === 'main') {
                return [
                    { kind: 'function_def', name: nameTok.value },
                    { kind: 'function_call', name: nameTok.value, args: [], fnDef: this.functionDefs[nameTok.value] }
                ];
            }
            return { kind: 'function_def', name: nameTok.value };
        }

        this.pos = savedPos;
        return null;
    }

    parseFunctionCall() {
        const nameTok = this.consume('IDENTIFIER');
        this.consume('SYMBOL', '(');
        const args = [];
        while (!this.match('SYMBOL', ')')) {
            if (this.match('SYMBOL', ',')) { this.consume(); continue; }
            args.push(this.evaluateExpression(this.parseExpression()));
            if (!this.match('SYMBOL', ')')) { this.consume(); }
        }
        this.consume('SYMBOL', ')');
        if (this.match('SYMBOL', ';')) this.consume();

        const fnDef = this.functionDefs[nameTok.value] || null;
        if (!fnDef) {
            this.errors.push({
                message: '알 수 없는 함수 호출: ' + nameTok.value + '()',
                token: nameTok.value,
                position: 0,
                hint: '함수를 호출하기 전에 함수 정의(또는 프로토타입)를 먼저 작성하세요.'
            });
        }
        return { kind: 'function_call', name: nameTok.value, args, fnDef };
    }

    parseBodyTerm(tokens, i) {
        const t = tokens[i];
        if (!t) return { node: { type: 'literal', value: 0 }, i };
        if (t.type === 'NUMBER') return { node: { type: 'literal', value: Number(t.value) }, i: i + 1 };
        if (t.type === 'HEX') return { node: { type: 'literal', value: parseInt(t.value, 16) }, i: i + 1 };
        if (t.type === 'CHAR') {
            const raw = t.value.slice(1, -1);
            const esc = { '\n': 10, '\t': 9, '\r': 13, '\0': 0, '\\': 92, "\'": 39, '\"': 34 };
            const code = esc.hasOwnProperty(raw) ? esc[raw] : raw.charCodeAt(0);
            return { node: { type: 'literal', value: code }, i: i + 1 };
        }
        if (t.type === 'IDENTIFIER') {
            // function call: name(args)
            if (tokens[i + 1]?.value === '(') {
                let j = i + 2;
                const args = [];
                while (tokens[j] && tokens[j].value !== ')') {
                    const r = this.parseBodyExpr(tokens, j);
                    args.push(r.node);
                    j = r.i;
                    if (tokens[j]?.value === ',') j++;
                }
                j++;
                if (!this.functionDefs[t.value]) {
                    this.errors.push({
                        message: '알 수 없는 함수 호출: ' + t.value + '()',
                        token: t.value,
                        position: this.pos,
                        hint: '함수를 호출하기 전에 먼저 정의해야 해요. 예: int ' + t.value + '(int x) { ... }'
                    });
                }
                return { node: { type: 'func_call', name: t.value, args }, i: j };
            }
            // array index: name[2] or name[i] (uniform index node)
            if (tokens[i + 1]?.value === '[') {
                let j = i + 2;
                if (tokens[j]?.type === 'NUMBER') {
                    const offset = parseInt(tokens[j].value);
                    j++;
                    if (tokens[j]?.value === ']') j++;
                    return { node: { type: 'index', name: t.value, index: { type: 'literal', value: offset } }, i: j };
                }
                const r = this.parseBodyExpr(tokens, j);
                if (tokens[r.i]?.value === ']') r.i++;
                return { node: { type: 'index', name: t.value, index: r.node }, i: r.i };
            }
            return { node: { type: 'varref', name: t.value, offset: 0 }, i: i + 1 };
        }
        if (t.value === '(') {
            const r = this.parseBodyExpr(tokens, i + 1);
            if (tokens[r.i]?.value === ')') return { node: r.node, i: r.i + 1 };
            return r;
        }
        if (t.value === '&') {
            const r = this.parseBodyTerm(tokens, i + 1);
            return { node: { type: 'address_of', target: r.node }, i: r.i };
        }
        if (t.value === '*') {
            const r = this.parseBodyTerm(tokens, i + 1);
            return { node: { type: 'deref', target: r.node }, i: r.i };
        }
        if (t.value === '-') {
            const r = this.parseBodyTerm(tokens, i + 1);
            if (r.node.type === 'literal') return { node: { type: 'literal', value: -r.node.value }, i: r.i };
            return { node: { type: 'binop', op: '-', left: { type: 'literal', value: 0 }, right: r.node }, i: r.i };
        }
        return { node: { type: 'literal', value: 0 }, i: i + 1 };
    }

    parseBodyExpr(tokens, i) {
        // precedence: comparisons < additive < multiplicative
        let left = this.parseAdditiveExpr(tokens, i);
        const CMP = ['<=', '>=', '<', '>', '==', '!='];
        while (tokens[left.i] && CMP.includes(tokens[left.i].value)) {
            const op = tokens[left.i].value;
            const right = this.parseAdditiveExpr(tokens, left.i + 1);
            left = { node: { type: 'binop', op, left: left.node, right: right.node }, i: right.i };
        }
        return left;
    }

    parseAdditiveExpr(tokens, i) {
        let left = this.parseMultExpr(tokens, i);
        const ADD = ['+', '-'];
        while (tokens[left.i] && ADD.includes(tokens[left.i].value)) {
            const op = tokens[left.i].value;
            const right = this.parseMultExpr(tokens, left.i + 1);
            left = { node: { type: 'binop', op, left: left.node, right: right.node }, i: right.i };
        }
        return left;
    }

    parseMultExpr(tokens, i) {
        let left = this.parseBodyTerm(tokens, i);
        const MUL = ['*', '/', '%'];
        while (tokens[left.i] && MUL.includes(tokens[left.i].value)) {
            const op = tokens[left.i].value;
            const right = this.parseBodyTerm(tokens, left.i + 1);
            left = { node: { type: 'binop', op, left: left.node, right: right.node }, i: right.i };
        }
        return left;
    }

    extractFunctionBody(tokens, sharedLocals) {
        const locals = sharedLocals || [];
        const calls = [];
        const bodyStatements = [];
        const ifReturns = [];
        let returnStmt = null;
        const TYPES = ['char', 'short', 'int', 'long', 'float', 'double', 'unsigned'];
        let i = 0;

        while (i < tokens.length) {
            const t = tokens[i];

            if (t.type === 'KEYWORD' && TYPES.includes(t.value)) {
                // local declaration: type [*] name [= expr] [, ...] ;
                let j = i + 1;
                let typeName = t.value;
                if (t.value === 'unsigned' && tokens[j]?.type === 'KEYWORD' && ['char', 'short', 'int', 'long'].includes(tokens[j].value)) {
                    typeName += ' ' + tokens[j].value;
                    j++;
                }
                let ptrs = 0;
                while (tokens[j]?.value === '*') { j++; ptrs++; }
                let name = null;
                if (tokens[j]?.type === 'IDENTIFIER') { name = tokens[j].value; j++; }
                let isArray = false;
                let arrLen = 0;
                if (tokens[j]?.value === '[') { isArray = true; j++; arrLen = parseInt(tokens[j]?.value) || 0; j++; if (tokens[j]?.value === ']') j++; }
                let init = null;
                if (tokens[j]?.value === '=') {
                    const r = this.parseBodyExpr(tokens, j + 1);
                    init = r.node;
                    j = r.i;
                }
                while (j < tokens.length && tokens[j].value !== ';') j++;
                if (name && !ptrs) {
                    const baseType = typeName.replace(/^unsigned /, '');
                    locals.push({
                        name,
                        type: typeName + '*'.repeat(ptrs),
                        isArray,
                        arrayLength: arrLen,
                        init,
                        size: isArray ? this.getTypeSize(baseType) * (arrLen || 1) : this.getTypeSize(baseType)
                    });
                }
                i = j + 1;
            } else if ((t.type === 'IDENTIFIER' && (tokens[i + 1]?.value === '=' || tokens[i + 1]?.value === '['))
                || (t.value === '*' && tokens[i + 1]?.type === 'IDENTIFIER' && tokens[i + 2]?.value === '=')) {
                // assignment statement: target = expr ;  (target may be deref: *x = ... or index: arr[i] = ...)
                let target;
                let j;
                if (t.value === '*') {
                    target = { type: 'deref', target: { type: 'varref', name: tokens[i + 1].value, offset: 0 } };
                    j = i + 3;
                } else if (tokens[i + 1]?.value === '[') {
                    const tr = this.parseBodyTerm(tokens, i);
                    if (tokens[tr.i]?.value === '=') { target = tr.node; j = tr.i + 1; }
                    else { i = tr.i; continue; }
                } else {
                    target = t.value;
                    j = i + 2;
                }
                const r = this.parseBodyExpr(tokens, j);
                bodyStatements.push({ kind: 'assign', target, expr: r.node });
                let end = r.i;
                while (end < tokens.length && tokens[end].value !== ';') end++;
                i = end < tokens.length && tokens[end].value === ';' ? end + 1 : r.i;
            } else if (t.type === 'IDENTIFIER' && tokens[i + 1]?.value === '(') {
                // nested call: name(args) ;
                const fName = t.value;
                let j = i + 2;
                const args = [];
                while (j < tokens.length && tokens[j].value !== ')') {
                    if (tokens[j].value === ',') { j++; continue; }
                    const r = this.parseBodyExpr(tokens, j);
                    args.push(r.node);
                    j = r.i;
                }
                while (j < tokens.length && tokens[j].value !== ';') j++;
                calls.push({ name: fName, args });
                bodyStatements.push({ kind: 'call', name: fName, args });
                if (!this.functionDefs[fName]) {
                    this.errors.push({
                        message: '알 수 없는 함수 호출: ' + fName + '()',
                        token: fName,
                        position: this.pos,
                        hint: '함수를 호출하기 전에 먼저 정의해야 해요. 예: int ' + fName + '(int x) { ... }'
                    });
                }
                i = j + 1;
            } else if ((t.type === 'KEYWORD' && (t.value === 'while' || t.value === 'for'))) {
                // while (cond) { ... }  /  for (init; cond; step) { ... }
                const ctype = t.value;
                let j = i + 1;
                if (tokens[j]?.value === '(') j++;

                let init = null;
                let cond = null;
                let step = null;

                if (ctype === 'for') {
                    // init: declaration "int i = 0;" or assignment "i = 0;"
                    if (tokens[j]?.type === 'KEYWORD' && TYPES.includes(tokens[j].value)) {
                        let k = j + 1;
                        let initType = tokens[j].value;
                        let initName = null;
                        if (tokens[k]?.type === 'IDENTIFIER') { initName = tokens[k].value; k++; }
                        if (tokens[k]?.value === '=') {
                            const r = this.parseBodyExpr(tokens, k + 1);
                            init = { kind: 'assign', target: initName, expr: r.node };
                            k = r.i;
                        }
                        while (k < tokens.length && tokens[k].value !== ';') k++;
                        if (initName) {
                            const baseType = initType.replace(/^unsigned /, '');
                            locals.push({
                                name: initName,
                                type: initType,
                                isArray: false,
                                arrayLength: 0,
                                init: null,
                                size: this.getTypeSize(baseType)
                            });
                        }
                        j = k + 1;
                    } else if (tokens[j]?.type === 'IDENTIFIER' && tokens[j + 1]?.value === '=') {
                        const r = this.parseBodyExpr(tokens, j + 2);
                        init = { kind: 'assign', target: tokens[j].value, expr: r.node };
                        while (r.i < tokens.length && tokens[r.i].value !== ';') j++;
                        j = r.i + 1;
                    }
                    // cond
                    if (tokens[j]?.value !== ';') {
                        const c = this.parseBodyExpr(tokens, j);
                        cond = c.node;
                        j = c.i;
                    }
                    if (tokens[j]?.value === ';') j++;
                    // step: i++, i--, i += 2, i = i + 1
                    if (tokens[j] && tokens[j].value !== ')') {
                        if (tokens[j]?.type === 'IDENTIFIER' && (tokens[j + 1]?.value === '++' || tokens[j + 1]?.value === '--')) {
                            const dir = tokens[j + 1].value === '++' ? 1 : -1;
                            step = { kind: 'assign', target: tokens[j].value, expr: { type: 'binop', op: '+', left: { type: 'varref', name: tokens[j].value, offset: 0 }, right: { type: 'literal', value: dir } } };
                            j += 2;
                        } else if (tokens[j]?.type === 'IDENTIFIER' && (tokens[j + 1]?.value === '+=' || tokens[j + 1]?.value === '-=')) {
                            const op = tokens[j + 1].value === '+=' ? '+' : '-';
                            const r = this.parseBodyExpr(tokens, j + 2);
                            step = { kind: 'assign', target: tokens[j].value, expr: { type: 'binop', op, left: { type: 'varref', name: tokens[j].value, offset: 0 }, right: r.node } };
                            j = r.i;
                        }
                    }
                    if (tokens[j]?.value === ')') j++;
                } else {
                    // while cond
                    const c = this.parseBodyExpr(tokens, j);
                    cond = c.node;
                    j = c.i;
                    if (tokens[j]?.value === ')') j++;
                }

                // body: { ... } or single statement
                let bodyTokens = [];
                if (tokens[j]?.value === '{') {
                    let depth = 0;
                    let k = j;
                    while (k < tokens.length) {
                        if (tokens[k].value === '{') depth++;
                        else if (tokens[k].value === '}') { depth--; if (depth === 0) break; }
                        k++;
                    }
                    bodyTokens = tokens.slice(j + 1, k);
                    j = k + 1;
                } else {
                    // single-statement body: consume until ';'
                    let k = j;
                    while (k < tokens.length && tokens[k].value !== ';') k++;
                    bodyTokens = tokens.slice(j, k + 1);
                    j = k + 1;
                }
                const sub = this.extractFunctionBody(bodyTokens, locals);
                bodyStatements.push({ kind: 'loop', ctype, init, cond, step, body: sub.bodyStatements });
                i = j;
            } else if (t.type === 'KEYWORD' && t.value === 'if') {
            // if (cond) return X; — capture as a guard / if (cond) { ... } — block
            let j = i + 1;
            if (tokens[j]?.value === '(') j++;
            const cond = this.parseBodyExpr(tokens, j);
            j = cond.i;
            if (tokens[j]?.value === ')') j++;
            if (tokens[j]?.value === 'return') {
                j++;
                const r = this.parseBodyExpr(tokens, j);
                j = r.i;
                if (!returnStmt) {
                    ifReturns.push({ cond: cond.node, value: r.node });
                }
                while (j < tokens.length && tokens[j].value !== ';') j++;
                i = j + 1;
            } else if (tokens[j]?.value === 'break' || tokens[j]?.value === 'continue') {
                // if (cond) break; / if (cond) continue; — conditional control
                const ctl = tokens[j].value;
                j++;
                while (j < tokens.length && tokens[j].value !== ';') j++;
                bodyStatements.push({ kind: 'if', cond: cond.node, body: [{ kind: ctl }] });
                i = j + 1;
            } else if (tokens[j]?.value === '{') {
                // if (cond) { ... } — conditional block (nested statements)
                let depth = 1;
                let k = j + 1;
                while (k < tokens.length && depth > 0) {
                    if (tokens[k].value === '{') depth++;
                    else if (tokens[k].value === '}') depth--;
                    if (depth === 0) break;
                    k++;
                }
                const sub = this.extractFunctionBody(tokens.slice(j + 1, k), locals);
                bodyStatements.push({ kind: 'if', cond: cond.node, body: sub.bodyStatements });
                i = k + 1;
            } else {
                while (j < tokens.length && tokens[j].value !== ';') j++;
                i = j + 1;
            }
            } else if (t.type === 'KEYWORD' && (t.value === 'break' || t.value === 'continue')) {
                bodyStatements.push({ kind: t.value });
                let j = i;
                while (j < tokens.length && tokens[j].value !== ';') j++;
                i = j + 1;
            } else if (t.type === 'KEYWORD' && t.value === 'return') {
                let j = i + 1;
                if (tokens[j]?.value === ';') {
                    returnStmt = { value: { type: 'literal', value: 0 } };
                } else {
                    const r = this.parseBodyExpr(tokens, j);
                    returnStmt = { value: r.node };
                    j = r.i;
                }
                while (j < tokens.length && tokens[j].value !== ';') j++;
                i = j + 1;
            } else {
                i++;
            }
        }
        return { locals, calls, returnStmt, bodyStatements, ifReturns };
    }

    buildErrorHint(token, message) {
        if (!token) return "코드가 여기서 끝났어요. ';'(세미콜론)이 빠졌을 수 있어요.";
        if (token.type === 'SYMBOL' && token.value === '}') return "중괄호 {} 짝이 맞지 않아요. 여는 '{'와 닫는 '}' 개수를 확인하세요.";
        if (token.type === 'SYMBOL' && token.value === ')') return "괄호 () 짝이 맞지 않아요. 함수 호출이나 sizeof()의 괄호를 확인하세요.";
        if (token.type === 'SYMBOL' && token.value === ';') return "';' 앞에 무엇인가 빠졌어요. 변수 이름이나 초기화 값('= ...')이 있어야 합니다.";
        if (token.type === 'KEYWORD' && token.value === 'struct') return "struct 다음에는 구조체 이름이 와야 해요. 예: struct Point { ... };";
        return "구문이 어긋났어요. ';'나 ',' 같은 구분 기호 위치를 확인해 보세요.";
    }

    parseStatement() {
        if (this.match('KEYWORD', 'typedef')) {
            return this.parseTypedef();
        }

        if (this.match('KEYWORD', 'enum')) {
            const hasBody = this.peekAfter(1)?.type === 'IDENTIFIER'
                && this.peekAfter(2)?.type === 'SYMBOL' && this.peekAfter(2)?.value === '{';
            if (hasBody) return this.parseEnumDefinition();
            return this.parseDeclaration();
        }

        if (this.match('KEYWORD', 'free')) {
            return this.parseFreeStatement();
        }

        if (this.isTypeStart()) {
            const fnDef = this.tryParseFunctionDefinition();
            if (fnDef) return fnDef;
            return this.parseDeclaration();
        }

        if (this.match('IDENTIFIER') && this.peekAfter(1)?.type === 'SYMBOL' && this.peekAfter(1)?.value === '(') {
            return this.parseFunctionCall();
        }
        
        if (this.match('SYMBOL', '*') || this.match('IDENTIFIER')) {
            return this.parseAssignmentStatement();
        }

        if (this.match('SYMBOL', ';')) {
            this.consume();
            return null;
        }

        this.pos++;
        return null;
    }

    parseTypedef() {
        this.consume('KEYWORD', 'typedef');
        const spec = this.parseTypeSpecifier();
        if (!spec) return null;

        if (this.match('SYMBOL', '{')) {
            if (spec.isStruct) {
                if (!spec.structName) {
                    spec.structName = `anon_struct_${Object.keys(this.structDefs).length}`;
                    spec.typeName = `struct ${spec.structName}`;
                }
                this.parseStructDefinitionBody(spec.structName);
            }
        }

        const alias = this.consume('IDENTIFIER');
        if (alias) {
            this.typedefs[alias.value] = { ...spec };
        }
        this.consume('SYMBOL', ';');
        return null;
    }

    parseEnumDefinition() {
        this.consume('KEYWORD', 'enum');
        let name = 'anon_enum';
        const nameToken = this.consume('IDENTIFIER');
        if (nameToken) name = nameToken.value;

        if (!this.match('SYMBOL', '{')) return null;

        this.consume('SYMBOL', '{');
        const members = [];
        let nextValue = 0;
        while (!this.match('SYMBOL', '}')) {
            const member = this.consume('IDENTIFIER');
            if (!member) break;
            let value = nextValue;
            if (this.match('SYMBOL', '=')) {
                this.consume();
                if (this.match('NUMBER') || this.match('HEX')) {
                    value = parseInt(this.consume().value, this.match('HEX') ? 16 : 10);
                } else if (this.match('IDENTIFIER')) {
                    const ref = this.consume().value;
                    for (const def of Object.values(this.enumDefs)) {
                        const found = def.members.find(m => m.name === ref);
                        if (found) { value = found.value; break; }
                    }
                }
            }
            members.push({ name: member.value, value });
            nextValue = value + 1;
            if (this.match('SYMBOL', ',')) this.consume();
        }
        this.consume('SYMBOL', '}');
        this.consume('SYMBOL', ';');
        this.enumDefs[name] = { name, members, size: 4, alignment: 4 };
        return null;
    }

    parseFreeStatement() {
        this.consume('KEYWORD', 'free');
        this.consume('SYMBOL', '(');
        const target = this.consume('IDENTIFIER');
        this.consume('SYMBOL', ')');
        this.consume('SYMBOL', ';');
        if (!target) return null;
        return { kind: 'free', target: target.value };
    }

    isTypeStart() {
        const t = this.peek();
        if (!t) return false;
        if (t.type === 'KEYWORD') {
            return ['struct', 'union', 'unsigned', 'enum', 'char', 'short', 'int', 'long', 'float', 'double', 'void'].includes(t.value);
        }
        if (t.type === 'IDENTIFIER' && this.typedefs[t.value]) {
            return true;
        }
        return false;
    }

    parseDeclaration() {
        const specifier = this.parseTypeSpecifier();
        
        if (this.match('SYMBOL', '{')) {
            if (specifier.isStruct) {
                this.parseStructDefinitionBody(specifier.structName);
            } else if (specifier.isUnion) {
                this.parseUnionDefinitionBody(specifier.unionName);
            }
            
            if (this.match('SYMBOL', ';')) {
                this.consume();
                return null;
            }
        }

        const declarations = [];
        
        while (true) {
            const decl = this.parseDeclarator();
            
            let initializer = null;
            if (this.match('SYMBOL', '=')) {
                this.consume();
                initializer = this.parseInitializer(specifier, decl);
            }

            const declObj = this.createDeclarationObject(specifier, decl, initializer);
            declarations.push(declObj);

            if (this.match('SYMBOL', ',')) {
                this.consume();
                continue;
            } else if (this.match('SYMBOL', ';')) {
                this.consume();
                break;
            } else {
                break;
            }
        }
        
        return declarations;
    }

    parseTypeSpecifier() {
        // typedef alias resolution (e.g. "u32 x;" after "typedef unsigned int u32;")
        if (this.match('IDENTIFIER') && this.typedefs[this.peek().value]) {
            const alias = this.typedefs[this.consume().value];
            return { ...alias };
        }

        let isUnsigned = false;
        if (this.match('KEYWORD', 'unsigned')) {
            this.consume();
            isUnsigned = true;
        }

        const token = this.consume('KEYWORD');
        let typeName = token ? token.value : 'int';
        let isStruct = false;
        let isUnion = false;
        let isEnum = false;
        let structName = null;
        let unionName = null;
        let enumName = null;

        if (typeName === 'struct' || typeName === 'union') {
            const nameToken = this.consume('IDENTIFIER');
            if (nameToken) {
                if (typeName === 'struct') {
                    isStruct = true;
                    structName = nameToken.value;
                    typeName = `struct ${structName}`;
                } else {
                    isUnion = true;
                    unionName = nameToken.value;
                    typeName = `union ${unionName}`;
                }
            }
        } else if (typeName === 'enum') {
            const nameToken = this.consume('IDENTIFIER');
            if (nameToken) {
                isEnum = true;
                enumName = nameToken.value;
                typeName = `enum ${enumName}`;
            }
        } else {
            if (isUnsigned) typeName = 'unsigned ' + typeName;
        }

        return { typeName, isStruct, structName, isUnion, unionName, isEnum, enumName };
    }

    parseDeclarator() {
        let pointerCount = 0;
        while (this.match('SYMBOL', '*')) {
            this.consume();
            pointerCount++;
        }

        let name = "";
        if (this.match('SYMBOL', '(')) {
             this.consume(); 
             if (this.match('SYMBOL', '*')) {
                 this.consume(); 
                 pointerCount++; 
                 const nameToken = this.consume('IDENTIFIER');
                 name = nameToken ? nameToken.value : "anon";
                 this.consume('SYMBOL', ')'); 
                 
                 if (this.match('SYMBOL', '(')) {
                     this.skipBalanced('(', ')');
                 }
                 return { name, pointerCount, isFunctionPointer: true };
             }
        }

        const nameToken = this.consume('IDENTIFIER');
        name = nameToken ? nameToken.value : "";

        let arrayLength = null;
        let isArray = false;
        let dims = null;
        if (this.match('SYMBOL', '[')) {
            isArray = true;
            dims = [];
            while (this.match('SYMBOL', '[')) {
                this.consume();
                if (this.match('NUMBER')) {
                    dims.push(parseInt(this.consume().value));
                } else if (this.match('SYMBOL', ']')) {
                    dims.push(0);
                }
                this.consume('SYMBOL', ']');
            }
            arrayLength = dims[0] || 0;
        }

        if (this.match('SYMBOL', '(')) {
             this.skipBalanced('(', ')');
             if (this.match('SYMBOL', '{')) {
                  this.skipBalanced('{', '}');
                  return null; 
             }
        }

        return { name, pointerCount, isArray, arrayLength, dims };
    }

    skipBalanced(open, close) {
        this.consume('SYMBOL', open);
        let depth = 1;
        while (this.pos < this.tokens.length && depth > 0) {
            if (this.match('SYMBOL', open)) depth++;
            else if (this.match('SYMBOL', close)) depth--;
            this.pos++;
        }
    }

    parseInitializer(specifier, decl) {
        if (this.match('SYMBOL', '{')) {
            return this.parseBraceInitializer();
        } else if (this.match('STRING')) {
             const token = this.consume();
             return { type: 'string', value: token.value.slice(1, -1) };
        } else {
             return this.parseExpression();
        }
    }

    parseBraceInitializer() {
        this.consume('SYMBOL', '{');
        const values = [];
        while (!this.match('SYMBOL', '}')) {
            if (this.match('SYMBOL', '{')) {
                values.push(this.parseBraceInitializer());
            } else {
                if (this.match('STRING')) {
                    const t = this.consume();
                    values.push({ type: 'string', value: t.value.slice(1, -1) });
                } else {
                    values.push(this.parseExpression());
                }
            }
            
            if (this.match('SYMBOL', ',')) this.consume();
        }
        this.consume('SYMBOL', '}');
        return { type: 'brace', values };
    }

    parseStructDefinitionBody(name) {
        this.consume('SYMBOL', '{');
        const members = [];
        let totalSize = 0;
        let maxAlignment = 1;

        while (!this.match('SYMBOL', '}')) {
            const spec = this.parseTypeSpecifier();
            while (true) {
                const decl = this.parseDeclarator();
                if (decl) { 
                    const memberInfo = this.createMemberObject(spec, decl);
                    
                    const align = memberInfo.alignment;
                    maxAlignment = Math.max(maxAlignment, align);
                    
                    const padding = (align - (totalSize % align)) % align;
                    memberInfo.offset = totalSize + padding;
                    memberInfo.padding = padding;
                    
                    totalSize += padding + memberInfo.size;
                    members.push(memberInfo);
                }
                
                if (this.match('SYMBOL', ',')) {
                    this.consume(); 
                    continue;
                }
                break;
            }
            this.consume('SYMBOL', ';');
        }
        this.consume('SYMBOL', '}');
        
        const trailingPadding = (maxAlignment - (totalSize % maxAlignment)) % maxAlignment;
        totalSize += trailingPadding;

        this.structDefs[name] = { name, members, size: totalSize, alignment: maxAlignment };
    }

    parseUnionDefinitionBody(name) {
        this.consume('SYMBOL', '{');
        const members = [];
        let maxSize = 0;

        while (!this.match('SYMBOL', '}')) {
            const spec = this.parseTypeSpecifier();
            while (true) {
                const decl = this.parseDeclarator();
                if (decl) {
                    const memberInfo = this.createMemberObject(spec, decl);
                    maxSize = Math.max(maxSize, memberInfo.size);
                    members.push(memberInfo);
                }
                if (this.match('SYMBOL', ',')) { this.consume(); continue; }
                break;
            }
            this.consume('SYMBOL', ';');
        }
        this.consume('SYMBOL', '}');

        this.unionDefs[name] = { name, members, size: maxSize };
    }

    createMemberObject(spec, decl) {
        let type = spec.typeName;
        let size = 0;
        let alignment = 1;
        let displayType = type;

        if (decl.pointerCount > 0) {
            type += '*'.repeat(decl.pointerCount);
            size = this.pointerSize;
            alignment = this.pointerSize;
            displayType = type;
        } else if (decl.isArray) {
            const baseSize = this.getTypeSize(type);
            const totalLen = (decl.dims || [decl.arrayLength]).reduce((a, b) => a * (b || 0), 1);
            size = baseSize * totalLen; 
            alignment = this.getAlignment(type);
            displayType = `${type}[${(decl.dims || [decl.arrayLength || 0]).join('][')}]`;
        } else if (spec.isEnum) {
            size = 4;
            alignment = 4;
            displayType = type;
        } else {
            size = this.getTypeSize(type);
            alignment = this.getAlignment(type);
        }

        return {
            name: decl.name,
            type: type, 
            kind: decl.isArray ? 'array' : (spec.isStruct ? 'struct' : (spec.isEnum ? 'variable' : 'variable')),
            size,
            alignment,
            length: decl.dims ? decl.dims.reduce((a, b) => a * (b || 0), 1) : decl.arrayLength,
            dims: decl.dims,
            flexible: decl.isArray && !(decl.dims || [decl.arrayLength]).reduce((a, b) => a * (b || 0), 1),
            displayType,
            members: spec.isStruct && !decl.pointerCount ? (this.structDefs[spec.structName]?.members || []) : []
        };
    }

    createDeclarationObject(spec, decl, initializer) {
        if(!decl) return null;

        let kind = 'variable';
        let fullType = spec.typeName;
        let size = 0;
        let alignment = 1;
        let value = 0;
        let pointsTo = null;
        let pointsToIndex = null;
        let heapAlloc = null;
        let members = [];
        let arrayValues = [];
        
        if (decl.pointerCount > 0) {
            kind = 'pointer';
            fullType += '*'.repeat(decl.pointerCount);
            size = this.pointerSize;
            alignment = this.pointerSize;
            
            if (initializer) {
                if (initializer.type === 'address_of') {
                    pointsTo = initializer.target;
                    pointsToIndex = initializer.offset || 0;
                } else if (initializer.type === 'malloc') {
                    heapAlloc = {
                        size: initializer.size,
                        type: fullType.substring(0, fullType.length - 1).trim() 
                    };
                    if (heapAlloc.type.startsWith('struct ')) {
                         const sName = heapAlloc.type.split(' ')[1];
                         heapAlloc.structDef = this.structDefs[sName];
                    }
                } else if (initializer.type === 'identifier') {
                    pointsTo = initializer.value; 
                    pointsToIndex = initializer.offset || 0;
                } else if (initializer.type === 'binop' && (initializer.op === '+' || initializer.op === '-')) {
                    const l = initializer.left;
                    const r = initializer.right;
                    if (l && l.type === 'identifier' && r && r.type === 'literal' && typeof r.value === 'number') {
                        pointsTo = l.value;
                        pointsToIndex = initializer.op === '+' ? r.value : -r.value;
                    }
                } else if (initializer.type === 'array_decay') {
                    pointsTo = initializer.target;
                    pointsToIndex = 0;
                }
            }
        } 
        else if (decl.isArray) {
            kind = 'array';
            const baseType = spec.typeName;
            const elementSize = this.getTypeSize(baseType);
            let length = (decl.dims || [decl.arrayLength]).reduce((a, b) => a * (b || 0), 1) || 0;
            let isString = false;
            
            if (length === 0 && initializer) {
                if (initializer.type === 'string') length = initializer.value.length + 1;
                else if (initializer.type === 'brace') length = this.flattenInitializer(initializer.values).length;
            }
            if (length === 0) length = 1; 

            size = elementSize * length;
            alignment = this.getAlignment(baseType);
            
            if (initializer) {
                if (initializer.type === 'string' && baseType === 'char') {
                    isString = true;
                    const str = initializer.value;
                    for (let i = 0; i < length; i++) {
                        arrayValues.push(i < str.length ? str.charCodeAt(i) : 0);
                    }
                } else if (initializer.type === 'brace') {
                    arrayValues = this.flattenInitializer(initializer.values).map(v => this.evaluateExpression(v));
                }
            } else {
                for(let i=0; i<length; i++) arrayValues.push(0);
            }

            while (arrayValues.length < length) arrayValues.push(0);

            return {
                kind,
                type: baseType,
                name: decl.name,
                length,
                dims: decl.dims,
                elementSize,
                size,
                alignment,
                values: arrayValues,
                isString,
                displayType: `${baseType}[${(decl.dims || [length]).join('][')}]`,
                structTypeName: spec.isStruct ? spec.structName : null,
                structDef: spec.isStruct ? this.structDefs[spec.structName] : null
            };
        } 
        else if (spec.isEnum) {
            kind = 'variable';
            fullType = spec.typeName;
            size = 4;
            alignment = 4;
            if (initializer) {
                value = this.evaluateExpression(initializer);
            }
        }
        else if (spec.isStruct) {
            kind = 'struct';
            const def = this.structDefs[spec.structName];
            if (def) {
                size = def.size;
                alignment = def.alignment;
                members = JSON.parse(JSON.stringify(def.members));
                
                if (initializer && initializer.type === 'brace') {
                    this.applyStructInitializer(members, initializer.values);
                    size = this.recomputeStructLayout(members, alignment);
                }
            }
        }
        else if (spec.isUnion) {
            kind = 'union';
             const def = this.unionDefs[spec.unionName];
             if (def) {
                 size = def.size;
                 alignment = 4;
                 members = JSON.parse(JSON.stringify(def.members));
                 if (initializer && initializer.type === 'brace' && initializer.values.length > 0) {
                     members[0].value = this.evaluateExpression(initializer.values[0]);
                 }
             }
        }
        else {
            size = this.getTypeSize(fullType);
            alignment = this.getAlignment(fullType);
            if (initializer) {
                value = this.evaluateExpression(initializer);
            }
        }

        return {
            kind,
            type: fullType,
            name: decl.name,
            size,
            alignment,
            value,
            pointsTo,
            pointsToIndex,
            heapAlloc,
            members,
            displayType: fullType
        };
    }

    recomputeStructLayout(members, structAlignment) {
        const align = structAlignment || 1;
        let cursor = 0;
        for (const m of members) {
            if (m.flexible) {
                m.size = (m.length || 0) * this.getTypeSize(m.type);
                m.offset = cursor;
                m.displayType = `${m.type}[${m.length || ''}]`;
                m.padding = 0;
                cursor += m.size;
            } else {
                if (cursor > (m.offset || 0)) m.offset = cursor;
                cursor = Math.max(cursor, m.offset + m.size);
            }
        }
        return cursor + ((align - (cursor % align)) % align);
    }

    flattenInitializer(values) {
        const flat = [];
        for (const v of values) {
            if (v.type === 'brace') flat.push(...this.flattenInitializer(v.values));
            else flat.push(v);
        }
        return flat;
    }

    applyStructInitializer(members, values) {
        for (let i = 0; i < Math.min(members.length, values.length); i++) {
            const member = members[i];
            const valExpr = values[i];
            
            if (member.kind === 'array' && member.type === 'char' && valExpr.type === 'string') {
                 const str = valExpr.value;
                 const len = member.length || str.length + 1;
                 const bytes = [];
                 for(let j=0; j<len; j++) bytes.push(j<str.length ? str.charCodeAt(j) : 0);
                 member.values = bytes;
                 member.length = len;
            } else if (member.kind === 'array' && valExpr.type === 'brace') {
                 const flat = this.flattenInitializer(valExpr.values);
                 member.values = flat.map(v => this.evaluateExpression(v));
                 if (!member.length || member.length === 0) {
                     member.length = member.values.length;
                     member.size = member.length * (member.elementSize || this.getTypeSize(member.type));
                 }
            } else if (member.kind === 'struct' && valExpr.type === 'brace') {
                 this.applyStructInitializer(member.members, valExpr.values);
                 if (member.members.some(m => m.flexible)) {
                     member.size = this.recomputeStructLayout(member.members, member.alignment);
                 }
            } else {
                 member.value = this.evaluateExpression(valExpr);
            }
        }
    }

    parseAssignmentStatement() {
        const target = this.parseLValue();
        if (!target || !this.consume('SYMBOL', '=')) return null;
        
        let valueExpr;
        if (this.match('SYMBOL', '{')) {
            valueExpr = this.parseBraceInitializer();
        } else {
            valueExpr = this.parseExpression();
        }
        this.consume('SYMBOL', ';');
        
        if (target && target.type === 'lvalue_string') {
            const isSimpleId = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(target.value);
            
            if (valueExpr.type === 'brace') {
                 if (isSimpleId) {
                     return { 
                         kind: 'struct_assignment',
                         name: target.value,
                         values: valueExpr.values
                     };
                 }
                 return null;
            }
            
            return {
                kind: 'assignment',
                target: target.value,
                value: this.evaluateExpression(valueExpr)
            };
        }
        
        return null; 
    }
    
    parseLValue() {
        let prefix = "";
        while (this.match('SYMBOL', '*')) {
            this.consume();
            prefix += "*";
        }
        
        const id = this.consume('IDENTIFIER');
        if (!id) return null;
        
        let expr = prefix + id.value;
        
        while (true) {
            if (this.match('OPERATOR', '->') || this.match('SYMBOL', '.')) {
                 const op = this.consume().value; 
                 const field = this.consume('IDENTIFIER');
                 expr += op + field.value;
            } else if (this.match('SYMBOL', '[')) {
                this.consume();
                const index = this.consume('NUMBER');
                this.consume('SYMBOL', ']');
                // Basic array indexing support for assignment target string
                if (index) {
                    expr += `[${index.value}]`;
                }
            } else {
                break;
            }
        }
        return { type: 'lvalue_string', value: expr };
    }

    parseExpression() {
        if (this.match('SYMBOL', '-')) {
            this.consume();
            const term = this.parseBinary(1);
            if (term.type === 'literal') return { type: 'literal', value: -term.value };
            return term;
        }

        if (this.match('KEYWORD', 'malloc') || (this.match('SYMBOL', '(') && this.peekAfter(1)?.value === 'malloc')) {
             return this.parseMalloc();
        }
        
        if (this.match('SYMBOL', '(')) {
             const savedPos = this.pos;
             this.skipBalanced('(', ')');
             if (this.match('KEYWORD', 'malloc')) {
                 this.pos = savedPos;
                 this.consume('SYMBOL', '(');
                 while(!this.match('SYMBOL', ')')) this.consume();
                 this.consume('SYMBOL', ')');
                 return this.parseMalloc();
             }
             this.pos = savedPos;
        }

        if (this.match('SYMBOL', '&')) {
            this.consume();
            const id = this.consume('IDENTIFIER');
            let suffix = "";
            while (true) {
                 if (this.match('SYMBOL', '.') || this.match('OPERATOR', '->')) {
                     const op = this.consume().value;
                     const f = this.consume('IDENTIFIER');
                     suffix += op + f.value;
                 } else if (this.match('SYMBOL', '[')) {
                     this.consume();
                     const index = this.consume('NUMBER');
                     this.consume('SYMBOL', ']');
                     if (index) suffix += `[${index.value}]`;
                 } else {
                     break;
                 }
            }
            
            // Check for offset + 2 after address? &arr[0] + 2
            // Not supporting complex expression in address_of yet
            
            return { type: 'address_of', target: id.value + suffix };
        }
        
        return this.parseBinary(1);
    }

    parseBinary(minPrec) {
        const PREC = { '+': 2, '-': 2, '*': 3, '/': 3, '%': 3 };
        let left = this.parseTerm();

        while (true) {
            const t = this.peek();
            if (!t || (t.type !== 'SYMBOL' && t.type !== 'OPERATOR')) break;
            const op = t.value;
            if (!(op in PREC)) break;
            if (PREC[op] < minPrec) break;

            this.consume();
            const right = this.parseBinary(PREC[op] + 1);

            if (left.type !== 'literal' || right.type !== 'literal') {
                left = { type: 'binop', op, left, right };
                continue;
            }
            const a = left.value, b = right.value;
            switch (op) {
                case '+': left = { type: 'literal', value: a + b }; break;
                case '-': left = { type: 'literal', value: a - b }; break;
                case '*': left = { type: 'literal', value: a * b }; break;
                case '/': left = b === 0 ? { type: 'literal', value: 0 } : { type: 'literal', value: Math.trunc(a / b) }; break;
                case '%': left = b === 0 ? { type: 'literal', value: 0 } : { type: 'literal', value: a % b }; break;
            }
        }
        return left;
    }
    
    peekAfter(n) {
        return this.tokens[this.pos + n];
    }

    parseMalloc() {
        this.consume('KEYWORD', 'malloc');
        this.consume('SYMBOL', '(');
        const sizeExpr = this.parseSizeExpr();
        this.consume('SYMBOL', ')');
        return { type: 'malloc', size: sizeExpr };
    }

    parseSizeExpr() {
        let size = this.parseSizeFactor();
        while (this.match('SYMBOL', '*')) {
            this.consume();
            size *= this.parseSizeFactor();
        }
        return size;
    }

    parseSizeFactor() {
        if (this.match('KEYWORD', 'sizeof')) {
            this.consume();
            this.consume('SYMBOL', '(');
            const spec = this.parseTypeSpecifier();
            let ptrs = 0;
            while (this.match('SYMBOL', '*')) { this.consume(); ptrs++; }

            let s;
            if (ptrs > 0) s = this.pointerSize;
            else if (spec.isStruct) s = this.structDefs[spec.structName]?.size || 0;
            else s = this.getTypeSize(spec.typeName);

            this.consume('SYMBOL', ')');
            return s;
        }
        if (this.match('NUMBER')) return parseInt(this.consume().value);
        return 1;
    }

    parseTerm() {
        if (this.match('SYMBOL', '*')) {
            this.consume();
            const inner = this.parseTerm();
            return { type: 'deref', target: inner };
        }
        if (this.match('NUMBER')) return { type: 'literal', value: Number(this.consume().value) };
        if (this.match('HEX')) return { type: 'literal', value: parseInt(this.consume().value, 16) };
        if (this.match('CHAR')) {
            const raw = this.consume().value.slice(1, -1);
            const escapes = { '\\n': 10, '\\t': 9, '\\r': 13, '\\0': 0, '\\\\': 92, "\\'": 39, '\\"': 34 };
            const code = escapes.hasOwnProperty(raw) ? escapes[raw] : raw.charCodeAt(0);
            return { type: 'literal', value: code };
        }
        if (this.match('STRING')) return { type: 'string', value: this.consume().value.slice(1, -1) };
        if (this.match('KEYWORD', 'NULL')) { this.consume(); return { type: 'literal', value: 0 }; }
        if (this.match('IDENTIFIER')) {
             const id = this.consume();

             // Function call in expression: add(3, 4)
             if (this.match('SYMBOL', '(')) {
                 this.consume();
                 const args = [];
                 while (!this.match('SYMBOL', ')')) {
                     const argExpr = this.parseExpression();
                     args.push(this.evaluateExpression(argExpr));
                     if (this.match('SYMBOL', ',')) this.consume();
                 }
                 this.consume('SYMBOL', ')');
                 const fnDef = this.functionDefs[id.value] || null;
                 if (!fnDef) {
                     this.errors.push({
                         message: '알 수 없는 함수 호출: ' + id.value + '()',
                         token: id.value,
                         position: this.pos,
                         hint: '함수를 호출하기 전에 먼저 정의해야 해요. 예: int ' + id.value + '(int x) { ... }'
                     });
                 }
                 return { type: 'func_call', name: id.value, args, fnDef };
             }

             let offset = 0;
             
             // Array indexing in expression: arr[2]
             if (this.match('SYMBOL', '[')) {
                 this.consume();
                 const index = this.consume('NUMBER');
                 this.consume('SYMBOL', ']');
                 if (index) offset = parseInt(index.value);
                 // If followed by + ?
             }
             
             return { type: 'identifier', value: id.value, offset: offset };
        }
        return { type: 'literal', value: 0 };
    }
    
    evaluateExpression(expr) {
        if (!expr) return 0;
        if (expr.type === 'literal') return expr.value;
        if (expr.type === 'string') return expr.value; 
        if (expr.type === 'binop' || expr.type === 'deref') return expr;
        if (expr.type === 'identifier') {
            for (const def of Object.values(this.enumDefs)) {
                const found = def.members.find(m => m.name === expr.value);
                if (found) return found.value;
            }
            return { type: 'varref', name: expr.value, offset: expr.offset || 0 };
        }
        if (expr.type === 'address_of') return '&' + expr.target;
        if (expr.type === 'func_call') return expr;
        return 0;
    }
    
    removeComments(code) {
        return code;
    }
}

window.CParser = CParser;
