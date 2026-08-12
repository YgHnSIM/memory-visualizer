/**
 * Memory Visualizer
 * Renders memory table with bit boxes and pointer arrows
 */

class MemoryVisualizer {
    constructor(tableBody, memory) {
        this.tableBody = tableBody;
        this.memory = memory;
        this.displayMode = 'hex';
        this.byteOrder = 'little';
    }

    setDisplayMode(mode) {
        this.displayMode = mode;
    }

    setByteOrder(order) {
        this.byteOrder = order === 'big' ? 'big' : 'little';
    }

    render() {
        this.tableBody.innerHTML = '';
        const allAllocations = this.memory.getAllocations();

        if (allAllocations.length === 0) {
            this.renderEmptyState();
            return;
        }

        // Separate Stack and Heap
        const stackAllocations = allAllocations.filter(a => !a.section || a.section === 'stack');
        const heapAllocations = allAllocations.filter(a => a.section === 'heap');

        // Render Stack
        if (stackAllocations.length > 0) {
            this.renderSectionHeader('STACK SEGMENT');

            // Stack frames first (function call frames), then remaining stack allocations
            const frames = this.memory.frames || [];
            const renderedByFrame = new Set();
            for (const frame of frames) {
                this.renderFrameHeader(frame);
                for (const p of frame.params || []) { renderedByFrame.add(p); this.renderAllocation(p); }
                for (const l of frame.locals || []) { renderedByFrame.add(l); this.renderAllocation(l); }
            }

            for (const alloc of stackAllocations) {
                if (!renderedByFrame.has(alloc)) {
                    this.renderAllocation(alloc);
                }
            }
        }

        // Render Heap
        if (heapAllocations.length > 0) {
            this.renderSectionHeader('HEAP SEGMENT');
            for (const alloc of heapAllocations) {
                this.renderAllocation(alloc);
            }
        }
    }
    
    renderFrameHeader(frame) {
        const tr = document.createElement('tr');
        tr.className = 'frame-header-row';
        tr.dataset.frameDepth = frame.depth || 0;

        const retAddr = typeof frame.returnAddress === 'bigint'
            ? '0x' + frame.returnAddress.toString(16).toUpperCase()
            : '0x' + (frame.returnAddress || 0).toString(16).toUpperCase();

        let retInfo = '';
        if (frame.returnValue !== undefined && frame.returnValue !== 0) {
            retInfo = `<span class="frame-meta frame-return">반환값 ${frame.returnValue}</span>`;
        }
        const calls = (frame.calls || []).filter(c => c && c.name);
        let callInfo = '';
        if (calls.length > 0) {
            callInfo = `<span class="frame-meta frame-calls">호출 ${calls.map(c => c.name + '()').join(', ')}</span>`;
        }

        tr.innerHTML = `
            <td colspan="5" class="frame-header">
                <span class="frame-tag">STACK FRAME</span>
                <span class="frame-name">${frame.displayName || (frame.name + '()')}</span>
                <span class="frame-meta">반환 주소 ${retAddr}</span>
                ${retInfo}${callInfo}
            </td>
        `;
        this.tableBody.appendChild(tr);
    }

    renderSectionHeader(title) {
        const tr = document.createElement('tr');
        tr.className = 'section-header-row';
        tr.innerHTML = `
            <td colspan="5" class="section-header">
                <span class="section-title">${title}</span>
            </td>
        `;
        this.tableBody.appendChild(tr);
    }

    renderEmptyState() {
        const tr = document.createElement('tr');
        tr.className = 'empty-state';
        tr.innerHTML = `
            <td colspan="5">
                <div class="empty-message">
                    <span class="empty-icon">💡</span>
                    <p>우측에 C 코드를 입력하고<br>"분석하기" 버튼을 클릭하세요</p>
                </div>
            </td>
        `;
        this.tableBody.appendChild(tr);
    }

    createNameCell(name, displayType, rowSpan, overflow) {
        const td = document.createElement('td');
        td.className = 'name-cell';
        td.rowSpan = rowSpan;

        const indicator = document.createElement('div');
        indicator.className = 'type-indicator';

        const nameDiv = document.createElement('div');
        nameDiv.className = 'var-name';
        nameDiv.textContent = name;

        const typeSpan = document.createElement('span');
        typeSpan.className = 'var-type';
        typeSpan.textContent = displayType;

        td.appendChild(indicator);
        td.appendChild(nameDiv);
        td.appendChild(typeSpan);

        if (overflow) {
            const badge = document.createElement('span');
            badge.className = 'overflow-badge';
            badge.textContent = '⚠ OVERFLOW';
            td.appendChild(badge);
        }

        return td;
    }

    createPointerBadge(text) {
        const badge = document.createElement('span');
        badge.className = 'pointer-badge clickable';

        const arrow = document.createElement('span');
        arrow.className = 'arrow-icon';
        arrow.textContent = '→';

        badge.appendChild(arrow);
        badge.appendChild(document.createTextNode(' ' + text));
        return badge;
    }

    renderPaddingAllocation(alloc) {
        const bytes = alloc.bytes;
        const typeClass = 'type-padding';

        for (let i = 0; i < bytes.length; i++) {
            const tr = document.createElement('tr');
            tr.className = `memory-row ${typeClass}`;
            tr.dataset.address = this.getAddressString(alloc.address, i);
            
            // Address cell
            const addrTd = document.createElement('td');
            addrTd.className = 'address';
            addrTd.textContent = this.formatByteAddress(alloc.address, i);
            tr.appendChild(addrTd);

            // Name cell (only for first row)
            if (i === 0) {
                tr.appendChild(this.createNameCell('PADDING', '', bytes.length, false));
            }

            // Element cell (empty)
            if (i === 0) {
                const elemTd = document.createElement('td');
                elemTd.className = 'element-cell';
                elemTd.rowSpan = bytes.length;
                elemTd.textContent = '-';
                tr.appendChild(elemTd);
            }

            // Data cell
            const dataTd = document.createElement('td');
            dataTd.className = 'data-cell';
            dataTd.appendChild(this.renderByte(bytes[i]));
            tr.appendChild(dataTd);

            // Represent cell
            if (i === 0) {
                const repTd = document.createElement('td');
                repTd.className = 'represent-cell';
                repTd.rowSpan = bytes.length;
                const span = document.createElement('span');
                span.className = 'represent-ascii';
                span.textContent = '(alignment)';
                repTd.appendChild(span);
                tr.appendChild(repTd);
            }

            this.tableBody.appendChild(tr);
        }
    }

    renderAllocation(alloc) {
        // Special handling for arrays - show element-based grid
        if (alloc.kind === 'array') {
            if (alloc.structTypeName) {
                this.renderStructArrayAllocation(alloc);
            } else {
                this.renderArrayAllocation(alloc);
            }
            return;
        }

        // Special handling for structs - show member info
        // Also handle heap_block if it has struct definition
        if (alloc.kind === 'struct' || (alloc.kind === 'heap_block' && alloc.structDef)) {
            this.renderStructAllocation(alloc);
            return;
        }

        // Special handling for padding
        if (alloc.kind === 'padding') {
            this.renderPaddingAllocation(alloc);
            return;
        }

        const bytes = alloc.bytes;
        const typeClass = this.getTypeClass(alloc);
        const overflowed = this.isOverflowed(alloc.name);
        const freed = alloc.freed;

        for (let i = 0; i < bytes.length; i++) {
            const tr = document.createElement('tr');
            tr.className = `memory-row ${typeClass}${overflowed ? ' type-overflow' : ''}${freed ? ' type-freed' : ''}`;
            tr.dataset.address = this.getAddressString(alloc.address, i);
            tr.dataset.varName = alloc.name;

            if (i === 0) tr.classList.add('block-start');
            if (i === bytes.length - 1) tr.classList.add('block-end');

            // Address cell
            const addrTd = document.createElement('td');
            addrTd.className = 'address';
            addrTd.textContent = this.formatByteAddress(alloc.address, i);
            tr.appendChild(addrTd);

            // Name cell (only for first row, spans all rows)
            if (i === 0) {
                const displayName = alloc.renderName || alloc.name;
                const nameCell = this.createNameCell(displayName, alloc.displayType, bytes.length, overflowed);
                if (freed) {
                    const badge = document.createElement('span');
                    badge.className = 'overflow-badge';
                    badge.textContent = 'FREE됨';
                    nameCell.appendChild(badge);
                }
                tr.appendChild(nameCell);
            }

            // Element cell (empty for regular variables, spans all rows)
            if (i === 0) {
                const elemTd = document.createElement('td');
                elemTd.className = 'element-cell';
                elemTd.rowSpan = bytes.length;
                elemTd.textContent = '-';
                tr.appendChild(elemTd);
            }

            // Data cell
            const dataTd = document.createElement('td');
            dataTd.className = 'data-cell';
            dataTd.appendChild(this.renderByte(bytes[i]));
            tr.appendChild(dataTd);

            // Represent cell (only for first row, spans all rows)
            if (i === 0) {
                const repTd = document.createElement('td');
                repTd.className = 'represent-cell';
                repTd.rowSpan = bytes.length;
                repTd.appendChild(this.renderRepresent(alloc));
                tr.appendChild(repTd);
            }

            this.tableBody.appendChild(tr);
        }
    }

    // Render struct with member info in ELEMENT column
    renderStructAllocation(alloc) {
        const typeClass = this.getTypeClass(alloc);
        const overflowed = this.isOverflowed(alloc.name);
        let byteOffset = 0;

        for (let memberIdx = 0; memberIdx < alloc.members.length; memberIdx++) {
            const member = alloc.members[memberIdx];
            
            // Check for internal padding before this member
            if (member.padding && member.padding > 0) {
                // Render internal padding rows
                for (let p = 0; p < member.padding; p++) {
                   const globalByteIdx = byteOffset;
                   const tr = document.createElement('tr');
                   tr.className = `memory-row type-padding`;
                   tr.dataset.address = this.getAddressString(alloc.address, globalByteIdx);
                   
                   // Address
                   const addrTd = document.createElement('td');
                   addrTd.className = 'address';
                   addrTd.textContent = this.formatByteAddress(alloc.address, globalByteIdx);
                   tr.appendChild(addrTd);

                   // Name cell (only if first byte of struct)
                   if (globalByteIdx === 0) {
                       tr.appendChild(this.createNameCell(alloc.name, alloc.displayType, alloc.bytes.length, overflowed));
                   }

                   // Element cell for padding
                   const elemTd = document.createElement('td');
                   elemTd.className = 'element-cell';
                   const padBadge = document.createElement('span');
                   padBadge.className = 'member-badge';
                   padBadge.textContent = 'pad';
                   padBadge.style.borderColor = 'var(--text-muted)';
                   padBadge.style.color = 'var(--text-muted)';
                   padBadge.style.background = 'rgba(255,255,255,0.05)';
                   elemTd.appendChild(padBadge);
                   tr.appendChild(elemTd);

                   // Data
                   const dataTd = document.createElement('td');
                   dataTd.className = 'data-cell';
                   dataTd.appendChild(this.renderByte(0)); // Padding is 0
                   tr.appendChild(dataTd);

                   // Represent
                   const repTd = document.createElement('td');
                   repTd.className = 'represent-cell';
                   tr.appendChild(repTd);

                   this.tableBody.appendChild(tr);
                   byteOffset++;
                }
            }

            const memberSize = member.size;

            for (let byteIdx = 0; byteIdx < memberSize; byteIdx++) {
                const globalByteIdx = byteOffset; // byteOffset now tracks global position
                const tr = document.createElement('tr');
                tr.className = `memory-row ${typeClass}${overflowed ? ' type-overflow' : ''}`;
                tr.dataset.address = this.getAddressString(alloc.address, globalByteIdx);
                tr.dataset.varName = alloc.name;
                tr.dataset.memberName = member.name;

                // Mark boundaries
                if (byteIdx === 0) tr.classList.add('member-start');
                if (byteIdx === memberSize - 1) tr.classList.add('member-end');
                if (globalByteIdx === 0) tr.classList.add('block-start');
                if (globalByteIdx === alloc.bytes.length - 1) tr.classList.add('block-end');

                // Address cell
                const addrTd = document.createElement('td');
                addrTd.className = 'address';
                addrTd.textContent = this.formatByteAddress(alloc.address, globalByteIdx);
                tr.appendChild(addrTd);

                // Name cell (only for first row of entire struct)
                if (globalByteIdx === 0) {
                    tr.appendChild(this.createNameCell(alloc.name, alloc.displayType, alloc.bytes.length, overflowed));
                }

                // Element cell (shows member name, spans member bytes)
                if (byteIdx === 0) {
                    const elemTd = document.createElement('td');
                    elemTd.className = 'element-cell member-info';
                    elemTd.rowSpan = memberSize;
                    const badge = document.createElement('span');
                    badge.className = 'member-badge';
                    badge.textContent = '.' + member.name;
                    elemTd.appendChild(badge);
                    tr.appendChild(elemTd);
                }

                // Data cell
                const dataTd = document.createElement('td');
                dataTd.className = 'data-cell';
                dataTd.appendChild(this.renderByte(alloc.bytes[globalByteIdx]));
                tr.appendChild(dataTd);

                // Represent cell (only for first byte of each member)
                if (byteIdx === 0) {
                    const repTd = document.createElement('td');
                    repTd.className = 'represent-cell member-value';
                    repTd.rowSpan = memberSize;

                    const valueSpan = document.createElement('span');
                    valueSpan.className = 'represent-main';

                    // Handle array members visualization
                    if (member.kind === 'array') {
                        if (member.type === 'char' && member.values) {
                            const str = String.fromCharCode(...member.values.filter(c => c !== 0));
                            valueSpan.textContent = `"${str}"`;
                            valueSpan.classList.add('char-value');
                        } else {
                            valueSpan.textContent = `[${member.length}]`;
                        }
                    } else {
                        // Reconstruct value from bytes for accurate representation
                        // (Because assignment only updates bytes, not member.value)
                        let val = member.value; // Default fallback
                        
                        // Try to read actual value from bytes
                        if (member.type === 'int' || member.type === 'long' || member.type === 'short' || member.type === 'char') {
                            if (member.type === 'long' && member.size === 8) {
                                let v = 0n;
                                for (let k = 0; k < 8; k++) {
                                    v += BigInt(alloc.bytes[globalByteIdx + k] || 0) << BigInt(k * 8);
                                }
                                val = v;
                            } else {
                                let reconstructed = 0;
                                // Little endian read
                                for (let k = 0; k < member.size; k++) {
                                    reconstructed |= (alloc.bytes[globalByteIdx + k] || 0) << (k * 8);
                                }
                                // Sign extension for smaller signed types
                                if (member.type === 'char' && member.size === 1) {
                                    reconstructed = (reconstructed << 24) >> 24;
                                } else if (member.type === 'short' && member.size === 2) {
                                    reconstructed = (reconstructed << 16) >> 16;
                                } else if (member.type === 'int' && member.size === 4) {
                                    reconstructed = reconstructed | 0;
                                }
                                val = reconstructed;
                            }
                        }
                        
                        // For pointers, show address or arrow if resolved
                        if (member.kind === 'pointer') {
                             // Pointer value reconstruction (4 or 8 bytes)
                             let ptrVal = 0n;
                             for (let k = 0; k < member.size; k++) {
                                 ptrVal += BigInt(alloc.bytes[globalByteIdx + k] || 0) << BigInt(k * 8);
                             }
                             
                             if (ptrVal === 0n) {
                                 val = 'NULL';
                             } else {
                                 // Check if it resolves to a known allocation
                                 // We need access to all allocations to find name? 
                                 // Visualizer has 'this.memory'.
                                 const targetAlloc = this.memory.getAllocations().find(a => {
                                     return this.memory.addressMode === 64 
                                         ? BigInt(a.address) === ptrVal 
                                         : a.address === Number(ptrVal);
                                 });
                                 
                                 if (targetAlloc) {
                                     // Render arrow badge
                                     const badge = this.createPointerBadge('&' + targetAlloc.name);
                                     badge.dataset.targetVar = targetAlloc.name;
                                     badge.dataset.targetAddr = ptrVal.toString(16);
                                     
                                     // Replace valueSpan with badge
                                     valueSpan.textContent = ''; 
                                     valueSpan.appendChild(badge);
                                     
                                     // Don't set val text below
                                     val = null; 
                                 } else {
                                     val = `0x${ptrVal.toString(16)}`;
                                 }
                             }
                        }

                        if (val !== null) valueSpan.textContent = val;
                    }

                    repTd.appendChild(valueSpan);
                    tr.appendChild(repTd);
                }

                this.tableBody.appendChild(tr);
                byteOffset++;
            }
        }
        
        // Trailing padding?
        // Alloc.bytes.length might be larger than current byteOffset if there's trailing padding
        while (byteOffset < alloc.bytes.length) {
             const globalByteIdx = byteOffset;
             const tr = document.createElement('tr');
             tr.className = `memory-row type-padding`;
             tr.dataset.address = this.getAddressString(alloc.address, globalByteIdx);

             const addrTd = document.createElement('td');
             addrTd.className = 'address';
             addrTd.textContent = this.formatByteAddress(alloc.address, globalByteIdx);
             tr.appendChild(addrTd);

             // Name cell logic handled by first row check, but trailing padding is never first row unless empty struct
             
             const elemTd = document.createElement('td');
             elemTd.className = 'element-cell';
             const padBadge = document.createElement('span');
             padBadge.className = 'member-badge';
             padBadge.textContent = 'pad';
             padBadge.style.borderColor = 'var(--text-muted)';
             padBadge.style.color = 'var(--text-muted)';
             padBadge.style.background = 'rgba(255,255,255,0.05)';
             elemTd.appendChild(padBadge);
             tr.appendChild(elemTd);

             const dataTd = document.createElement('td');
             dataTd.className = 'data-cell';
             dataTd.appendChild(this.renderByte(0));
             tr.appendChild(dataTd);

             const repTd = document.createElement('td');
             repTd.className = 'represent-cell';
             tr.appendChild(repTd);

             this.tableBody.appendChild(tr);
             byteOffset++;
        }
    }

    getElementLabel(alloc, flatIdx) {
        if (alloc.dims && alloc.dims.length > 1) {
            const label = [];
            let remaining = flatIdx;
            for (let d = alloc.dims.length - 1; d >= 0; d--) {
                const dim = alloc.dims[d] || 1;
                label.unshift(remaining % dim);
                remaining = Math.floor(remaining / dim);
            }
            return `[${label.join('][')}]`;
        }
        return `[${flatIdx}]`;
    }

    // Render array with element-based grid visualization
    renderArrayAllocation(alloc) {
        const typeClass = this.getTypeClass(alloc);
        const elementSize = alloc.elementSize;
        const overflowed = this.isOverflowed(alloc.name);

        for (let elemIdx = 0; elemIdx < alloc.length; elemIdx++) {
            // Render each element's bytes
            for (let byteIdx = 0; byteIdx < elementSize; byteIdx++) {
                const globalByteIdx = elemIdx * elementSize + byteIdx;
                const tr = document.createElement('tr');
                tr.className = `memory-row ${typeClass}${overflowed ? ' type-overflow' : ''}`;
                tr.dataset.address = this.getAddressString(alloc.address, globalByteIdx);
                tr.dataset.varName = alloc.name;
                tr.dataset.arrayIndex = elemIdx;

                // Mark element boundaries
                if (byteIdx === 0) tr.classList.add('element-start');
                if (byteIdx === elementSize - 1) tr.classList.add('element-end');
                if (globalByteIdx === 0) tr.classList.add('block-start');
                if (globalByteIdx === alloc.bytes.length - 1) tr.classList.add('block-end');

                // Address cell
                const addrTd = document.createElement('td');
                addrTd.className = 'address';
                addrTd.textContent = this.formatByteAddress(alloc.address, globalByteIdx);
                tr.appendChild(addrTd);

                // Name cell (only for first row of entire array)
                if (globalByteIdx === 0) {
                    tr.appendChild(this.createNameCell(alloc.name, alloc.displayType, alloc.bytes.length, overflowed));
                }

                // Element cell (shows array index, spans element bytes)
                if (byteIdx === 0) {
                    const elemTd = document.createElement('td');
                    elemTd.className = 'element-cell array-index';
                    elemTd.rowSpan = elementSize;
                    const badge = document.createElement('span');
                    badge.className = 'array-index-badge';
                    badge.textContent = this.getElementLabel(alloc, elemIdx);
                    elemTd.appendChild(badge);
                    tr.appendChild(elemTd);
                }

                // Data cell
                const dataTd = document.createElement('td');
                dataTd.className = 'data-cell';
                dataTd.appendChild(this.renderByte(alloc.bytes[globalByteIdx]));
                tr.appendChild(dataTd);

                // Represent cell (only for first byte of each element)
                if (byteIdx === 0) {
                    const repTd = document.createElement('td');
                    repTd.className = 'represent-cell element-value';
                    repTd.rowSpan = elementSize;

                    const value = alloc.values[elemIdx];
                    const valueSpan = document.createElement('span');
                    valueSpan.className = 'represent-main';

                    if (alloc.type === 'char') {
                        if (value >= 32 && value <= 126) {
                            const charSpan = document.createElement('span');
                            charSpan.className = 'char';
                            charSpan.textContent = String.fromCharCode(value);
                            valueSpan.appendChild(document.createTextNode("'"));
                            valueSpan.appendChild(charSpan);
                            valueSpan.appendChild(document.createTextNode(`' (${value})`));
                        } else if (value === 0) {
                            const charSpan = document.createElement('span');
                            charSpan.className = 'char';
                            charSpan.textContent = '\\0';
                            valueSpan.appendChild(document.createTextNode("'"));
                            valueSpan.appendChild(charSpan);
                            valueSpan.appendChild(document.createTextNode("' (0)"));
                        } else {
                            valueSpan.textContent = value;
                        }
                    } else {
                        valueSpan.textContent = value;
                    }
                    repTd.appendChild(valueSpan);
                    tr.appendChild(repTd);
                }

                this.tableBody.appendChild(tr);
            }
        }
    }

    renderRepresent(alloc) {
        const container = document.createElement('div');
        container.className = 'represent-value';

        switch (alloc.kind) {
            case 'variable':
                container.appendChild(this.renderVariableRepresent(alloc));
                break;
            case 'pointer':
                container.appendChild(this.renderPointerRepresent(alloc));
                break;
            case 'array':
                container.appendChild(this.renderArrayRepresent(alloc));
                break;
            case 'struct':
                container.appendChild(this.renderStructRepresent(alloc));
                break;
            case 'union':
                container.appendChild(this.renderUnionRepresent(alloc));
                break;
            default:
                const span = document.createElement('span');
                span.className = 'represent-main';
                span.textContent = '?';
                container.appendChild(span);
        }

        return container;
    }

    renderVariableRepresent(alloc) {
        const wrapper = document.createElement('div');

        const mainSpan = document.createElement('span');
        mainSpan.className = 'represent-main';

        if (alloc.type === 'float' || alloc.type === 'double') {
            mainSpan.textContent = alloc.value.toFixed(6);
        } else {
            mainSpan.textContent = alloc.value;
        }
        wrapper.appendChild(mainSpan);

        const chips = this.renderByteChips(alloc);
        if (chips) wrapper.appendChild(chips);

        const tip = this.buildValueTooltip(alloc, alloc.value);
        if (tip) wrapper.title = tip;

        // Add ASCII representation for char type
        if (alloc.type === 'char' || alloc.type === 'unsigned char') {
            // Clear and rebuild for char type with new format
            mainSpan.textContent = '';
            const charVal = alloc.value;

            const charSpan = document.createElement('span');
            charSpan.className = 'char';

            let note = '';
            let displayChar = '';

            if (charVal >= 32 && charVal <= 126) {
                displayChar = String.fromCharCode(charVal);
                note = ` (ASCII:${charVal})`;
            } else if (charVal === 0) {
                displayChar = '\\0';
                note = ` (ASCII:0, NULL)`;
            } else if (charVal === 10) {
                displayChar = '\\n';
                note = ` (ASCII:10, LF)`;
            } else if (charVal === 13) {
                displayChar = '\\r';
                note = ` (ASCII:13, CR)`;
            } else if (charVal === 9) {
                displayChar = '\\t';
                note = ` (ASCII:9, TAB)`;
            } else {
                displayChar = '';
                note = `(ASCII:${charVal}, non-printable)`;
            }

            charSpan.textContent = displayChar;
            if (displayChar === '') {
                mainSpan.appendChild(document.createTextNode(note));
            } else {
                mainSpan.appendChild(document.createTextNode("'"));
                mainSpan.appendChild(charSpan);
                mainSpan.appendChild(document.createTextNode("'" + note));
            }
        }

        return wrapper;
    }

    // Endianness-aware byte chips (LE = memory order, BE = reversed)
    renderByteChips(alloc) {
        if (!alloc.bytes || alloc.bytes.length < 2 || alloc.type === 'char' || alloc.type === 'unsigned char') {
            return null;
        }
        const chips = document.createElement('span');
        chips.className = 'byte-chips';

        const order = this.byteOrder === 'big' ? 'big' : 'little';
        const indexes = [];
        for (let i = 0; i < alloc.bytes.length; i++) {
            indexes.push(order === 'big' ? alloc.bytes.length - 1 - i : i);
        }

        for (const i of indexes) {
            const chip = document.createElement('span');
            chip.className = 'byte-chip';
            chip.textContent = alloc.bytes[i].toString(16).padStart(2, '0').toUpperCase();
            const role = order === 'big'
                ? (i === 0 ? 'MSB (최상위)' : i === alloc.bytes.length - 1 ? 'LSB (최하위)' : `byte ${i}`)
                : (i === 0 ? 'LSB (최하위)' : i === alloc.bytes.length - 1 ? 'MSB (최상위)' : `byte ${i}`);
            chip.title = role + ` — 물리 바이트 ${i}`;
            if (order === 'big' && i === 0) chip.classList.add('chip-msb');
            if (order === 'little' && i === 0) chip.classList.add('chip-lsb');
            chips.appendChild(chip);
        }
        return chips;
    }

    // Value tooltip: IEEE-754 breakdown for floats, two's complement note for negatives
    buildValueTooltip(alloc, value) {
        if (alloc.type === 'float' || alloc.type === 'double') {
            const bytes = alloc.bytes || [];
            const size = alloc.type === 'float' ? 4 : 8;
            const buf = new ArrayBuffer(size);
            const view = new DataView(buf);
            for (let i = 0; i < size && i < bytes.length; i++) view.setUint8(i, bytes[i]);
            const num = alloc.type === 'float' ? view.getFloat32(0, true) : view.getFloat64(0, true);
            const bits = alloc.type === 'float' ? 32 : 64;
            const expBits = alloc.type === 'float' ? 8 : 11;
            const sign = num < 0 ? 1 : 0;
            const bin = num === 0 ? '0' : Math.abs(num).toString(2).split('.')[0];
            return `${alloc.type} ${num} — IEEE 754 ${bits}비트: 부호 1 + 지수 ${expBits} + 가수 ${bits - expBits - 1} (메모리엔 2진수로 저장됨)`;
        }
        const n = Number(value);
        if (Number.isFinite(n) && n < 0 && /int|short|long|char/.test(alloc.type)) {
            const bits = alloc.type.includes('long') ? 64 : alloc.type.includes('short') ? 16 : alloc.type.includes('char') ? 8 : 32;
            const mask = BigInt(1) << BigInt(bits);
            const twos = (BigInt(n) + mask) % mask;
            return `2의 보수: ${n} = 0x${twos.toString(16).toUpperCase()} (${bits}비트)`;
        }
        return null;
    }

    renderPointerRepresent(alloc) {
        const wrapper = document.createElement('div');

        if (alloc.pointsTo && alloc.resolvedAddress !== undefined) {
            let badgeText = `&${alloc.pointsTo}`;
            // Show array index if explicitly pointing to an element other than 0
            if (alloc.pointsToIndex !== null && alloc.pointsToIndex > 0) {
                badgeText += `[${alloc.pointsToIndex}]`;
            }
            // Show struct member if pointing to a member
            else if (alloc.pointsToMember) {
                badgeText += `.${alloc.pointsToMember}`;
            }

            const badge = this.createPointerBadge(badgeText);
            badge.dataset.targetVar = alloc.pointsTo;
            badge.dataset.targetAddr = alloc.resolvedAddress.toString(16);
            badge.title = '클릭하여 참조 대상으로 이동';
            wrapper.appendChild(badge);

            const addrSpan = document.createElement('span');
            addrSpan.className = 'represent-ascii';
            addrSpan.textContent = this.memory.formatAddress(alloc.resolvedAddress, 'hex');
            wrapper.appendChild(addrSpan);
        } else {
            const mainSpan = document.createElement('span');
            mainSpan.className = 'represent-main';
            mainSpan.textContent = alloc.value === 0 ? 'NULL' : `0x${alloc.value.toString(16)}`;
            wrapper.appendChild(mainSpan);
            if (alloc.isDangling && alloc.value !== 0) {
                const bad = document.createElement('span');
                bad.className = 'dangling-badge';
                bad.textContent = '댕글링';
                bad.title = 'free()된 메모리를 가리키는 포인터 — 접근하면 미정의 동작';
                wrapper.appendChild(bad);
            }
        }

        return wrapper;
    }

    renderArrayRepresent(alloc) {
        const wrapper = document.createElement('div');

        const mainSpan = document.createElement('span');
        mainSpan.className = 'represent-main';

        // Show first few values
        const displayVals = alloc.values.slice(0, 5);
        let text = '{' + displayVals.join(', ');
        if (alloc.values.length > 5) {
            text += ', ...';
        }
        text += '}';
        mainSpan.textContent = text;
        wrapper.appendChild(mainSpan);

        // For char arrays, show as string
        if (alloc.type === 'char' && alloc.isString) {
            const strSpan = document.createElement('span');
            strSpan.className = 'represent-ascii';
            let str = '';
            for (const v of alloc.values) {
                if (v === 0) break;
                if (v >= 32 && v <= 126) str += String.fromCharCode(v);
            }
            const charSpan = document.createElement('span');
            charSpan.className = 'char';
            charSpan.textContent = str;
            strSpan.appendChild(document.createTextNode(`String: "`));
            strSpan.appendChild(charSpan);
            strSpan.appendChild(document.createTextNode(`"`));
            wrapper.appendChild(strSpan);
        }

        return wrapper;
    }

    renderStructRepresent(alloc) {
        const wrapper = document.createElement('div');

        const mainSpan = document.createElement('span');
        mainSpan.className = 'represent-main';
        mainSpan.textContent = `{${alloc.members.map(m => m.name + '=' + m.value).join(', ')}}`;
        wrapper.appendChild(mainSpan);

        return wrapper;
    }

    renderUnionRepresent(alloc) {
        const wrapper = document.createElement('div');

        const mainSpan = document.createElement('span');
        mainSpan.className = 'represent-main';
        if (alloc.members.length > 0) {
            mainSpan.textContent = `${alloc.members[0].name}=${alloc.members[0].value}`;
        } else {
            mainSpan.textContent = '{}';
        }
        wrapper.appendChild(mainSpan);

        return wrapper;
    }

    getAddressString(baseAddr, offset) {
        if (this.memory.addressMode === 64) {
            return (BigInt(baseAddr) + BigInt(offset)).toString(16);
        }
        return (baseAddr + offset).toString(16);
    }

    formatByteAddress(baseAddr, offset) {
        if (this.memory.addressMode === 64) {
            const addr = BigInt(baseAddr) + BigInt(offset);
            return '0x' + addr.toString(16).toUpperCase().padStart(12, '0');
        } else {
            const addr = baseAddr + offset;
            return '0x' + addr.toString(16).toUpperCase().padStart(8, '0');
        }
    }

    renderByte(byteVal) {
        const container = document.createElement('div');
        container.className = 'data-cell';

        if (this.displayMode === 'bin' || this.displayMode === 'binary') {
            // 8 individual bit boxes
            for (let b = 7; b >= 0; b--) {
                const bit = (byteVal >> b) & 1;
                const box = document.createElement('span');
                box.className = 'bit-box';
                box.textContent = bit;
                container.appendChild(box);
            }
        } else {
            // 2 hex boxes (4 bits each)
            const high = (byteVal >> 4) & 0xF;
            const low = byteVal & 0xF;

            const boxHigh = document.createElement('span');
            boxHigh.className = 'bit-box hex';
            boxHigh.textContent = high.toString(16).toUpperCase();

            const boxLow = document.createElement('span');
            boxLow.className = 'bit-box hex';
            boxLow.textContent = low.toString(16).toUpperCase();

            container.appendChild(boxHigh);
            container.appendChild(boxLow);
        }

        return container;
    }

    getTypeClass(alloc) {
        if (alloc.kind === 'pointer') return 'type-pointer';
        if (alloc.kind === 'struct') return 'type-struct';
        if (alloc.kind === 'union') return 'type-union';
        if (alloc.kind === 'array') return 'type-array';
        if (alloc.kind === 'padding') return 'type-padding';
        if (alloc.kind === 'heap_block') return 'type-heap'; // New type

        const type = alloc.type.replace('unsigned ', '');
        return 'type-' + type;
    }

    isOverflowed(name) {
        return this.memory.overflowWarnings && this.memory.overflowWarnings.some(w => w.name === name);
    }

    // Render struct array with detailed member info
    renderStructArrayAllocation(alloc) {
        const typeClass = this.getTypeClass(alloc);
        const structDef = alloc.structDef;
        
        if (!structDef) {
            // Fallback if no definition found
            this.renderArrayAllocation(alloc);
            return;
        }

        let totalByteOffset = 0;
        const overflowed = this.isOverflowed(alloc.name);

        for (let elemIdx = 0; elemIdx < alloc.length; elemIdx++) {
            // Render each struct element
            const elemStartByte = totalByteOffset;
            
            for (let memberIdx = 0; memberIdx < structDef.members.length; memberIdx++) {
                const member = structDef.members[memberIdx];
                
                // Render padding before member
                if (member.padding && member.padding > 0) {
                    for (let p = 0; p < member.padding; p++) {
                        const globalByteIdx = totalByteOffset;
                        const tr = document.createElement('tr');
                        tr.className = `memory-row type-padding`;
                        tr.dataset.address = this.getAddressString(alloc.address, globalByteIdx);
                        tr.dataset.arrayIndex = elemIdx;
                        
                        // Address
                        const addrTd = document.createElement('td');
                        addrTd.className = 'address';
                        addrTd.textContent = this.formatByteAddress(alloc.address, globalByteIdx);
                        tr.appendChild(addrTd);

                        // Name (only for first row of entire array)
                        if (globalByteIdx === 0) {
                            tr.appendChild(this.createNameCell(alloc.name, alloc.displayType, alloc.bytes.length, overflowed));
                        }

                        // Element cell (padding)
                        const elemTd = document.createElement('td');
                        elemTd.className = 'element-cell';
                        const padBadge = document.createElement('span');
                        padBadge.className = 'member-badge';
                        padBadge.textContent = 'pad';
                        padBadge.style.opacity = '0.5';
                        elemTd.appendChild(padBadge);
                        tr.appendChild(elemTd);

                        // Data & Represent
                        const dataTd = document.createElement('td');
                        dataTd.className = 'data-cell';
                        dataTd.appendChild(this.renderByte(0));
                        tr.appendChild(dataTd);
                        
                        const repTd = document.createElement('td');
                        repTd.className = 'represent-cell';
                        tr.appendChild(repTd);

                        this.tableBody.appendChild(tr);
                        totalByteOffset++;
                    }
                }

                // Render member bytes
                for (let byteIdx = 0; byteIdx < member.size; byteIdx++) {
                    const globalByteIdx = totalByteOffset;
                    const tr = document.createElement('tr');
                    tr.className = `memory-row ${typeClass}${overflowed ? ' type-overflow' : ''}`;
                    tr.dataset.address = this.getAddressString(alloc.address, globalByteIdx);
                    tr.dataset.varName = alloc.name;
                    tr.dataset.arrayIndex = elemIdx;
                    tr.dataset.memberName = member.name;

                    // Boundaries
                    if (byteIdx === 0) tr.classList.add('member-start');
                    if (byteIdx === member.size - 1) tr.classList.add('member-end');
                    if (memberIdx === 0 && byteIdx === 0) tr.classList.add('element-start');
                    if (memberIdx === structDef.members.length - 1 && byteIdx === member.size - 1) tr.classList.add('element-end'); // Roughly
                    
                    // Address
                    const addrTd = document.createElement('td');
                    addrTd.className = 'address';
                    addrTd.textContent = this.formatByteAddress(alloc.address, globalByteIdx);
                    tr.appendChild(addrTd);

                    // Name (only for first row of entire array)
                    if (globalByteIdx === 0) {
                        tr.appendChild(this.createNameCell(alloc.name, alloc.displayType, alloc.bytes.length, overflowed));
                    }

                    // Element/Member Info
                    // Show "[0].id"
                    if (byteIdx === 0) {
                        const elemTd = document.createElement('td');
                        elemTd.className = 'element-cell member-info';
                        elemTd.rowSpan = member.size;
                        const idxBadge = document.createElement('span');
                        idxBadge.className = 'array-index-badge';
                        idxBadge.textContent = `[${elemIdx}]`;
                        const memberBadge = document.createElement('span');
                        memberBadge.className = 'member-badge';
                        memberBadge.textContent = `.${member.name}`;
                        elemTd.appendChild(idxBadge);
                        elemTd.appendChild(memberBadge);
                        tr.appendChild(elemTd);
                    }

                    // Data
                    const dataTd = document.createElement('td');
                    dataTd.className = 'data-cell';
                    dataTd.appendChild(this.renderByte(alloc.bytes[globalByteIdx] || 0));
                    tr.appendChild(dataTd);

                    // Represent
                    if (byteIdx === 0) {
                        const repTd = document.createElement('td');
                        repTd.className = 'represent-cell member-value';
                        repTd.rowSpan = member.size;
                        
                        // Need to reconstruct value from bytes or use alloc.values if available?
                        // alloc.values for struct array is flat bytes? No, Memory.arrayToBytes returns flat bytes.
                        // We don't have easy access to the structured value here unless we re-parse bytes.
                        // Or we can try to interpret bytes based on member type.
                        
                        // Reconstruct value from bytes
                        let val = 0;
                        // Simple int reconstruction
                        if (member.type === 'int') {
                            // Read 4 bytes from alloc.bytes at globalByteIdx
                            // Little endian assumption
                            let v = 0;
                            for(let k=0; k<4; k++) v |= (alloc.bytes[globalByteIdx+k] || 0) << (k*8);
                            val = v;
                        } else {
                            val = '?'; // Todo: full type reconstruction
                        }
                        
                        // Better approach: We parsed values in Memory.arrayToBytes, but lost the structure.
                        // But wait! We have the bytes. We can just show the bytes or simple int interpretation.
                        
                        const valueSpan = document.createElement('span');
                        valueSpan.className = 'represent-main';
                        valueSpan.textContent = val;
                        repTd.appendChild(valueSpan);
                        tr.appendChild(repTd);
                    }

                    this.tableBody.appendChild(tr);
                    totalByteOffset++;
                }
            }
            
            // Trailing struct padding
            // (omitted for brevity, assume packed or simple align)
        }
    }
}

window.MemoryVisualizer = MemoryVisualizer;

/**
 * Memory Usage Summary View
 * Renders a compact occupancy gauge: segment split (stack/heap),
 * per-block stacked bar, and padding waste indicator.
 */
class MemoryUsageView {
    constructor(targetEl, memory) {
        this.el = targetEl;
        this.memory = memory;
        this.heapPalette = ['#f43f5e', '#fb7185', '#e11d48', '#fda4af', '#be123c'];
        this.typeColors = {
            'type-char': 'var(--type-char)',
            'type-short': 'var(--type-short)',
            'type-int': 'var(--type-int)',
            'type-long': 'var(--type-long)',
            'type-float': 'var(--type-float)',
            'type-double': 'var(--type-double)',
            'type-pointer': 'var(--type-pointer)',
            'type-struct': 'var(--type-struct)',
            'type-union': 'var(--type-union)',
            'type-array': 'var(--type-array)',
            'type-padding': 'var(--text-muted)',
            'type-heap': '#f43f5e'
        };
    }

    mk(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    getColor(alloc, heapIndex) {
        if (alloc.section === 'heap') {
            return this.heapPalette[heapIndex % this.heapPalette.length];
        }
        const cls = MemoryVisualizer.prototype.getTypeClass(alloc);
        return this.typeColors[cls] || 'var(--text-muted)';
    }

    render() {
        const allocations = this.memory.getAllocations();
        if (!this.el) return;
        this.el.hidden = allocations.length === 0;
        if (allocations.length === 0) return;

        this.el.innerHTML = '';
        const stats = this.memory.getStats();
        const total = stats.totalBytes || 1;

        // Header
        const header = this.mk('div', 'usage-header');
        header.appendChild(this.mk('span', 'usage-title', '점유 현황'));
        header.appendChild(this.mk('span', 'usage-total', `총 ${stats.totalBytes} B · 블록 ${stats.blockCount}`));
        this.el.appendChild(header);

        // Segment split: STACK vs HEAP
        const stackTotal = stats.stackBytes + stats.paddingBytes;
        const stackPct = (stackTotal / total) * 100;
        const heapPct = (stats.heapBytes / total) * 100;

        const segRow1 = this.mk('div', 'usage-row');
        segRow1.appendChild(this.mk('span', 'usage-seg-label', 'STACK'));
        const bar1 = this.mk('div', 'usage-bar');
        const fill1 = this.mk('div', 'usage-bar-fill usage-stack-fill');
        fill1.style.width = stackPct.toFixed(1) + '%';
        bar1.appendChild(fill1);
        segRow1.appendChild(bar1);
        segRow1.appendChild(this.mk('span', 'usage-seg-value', `${stats.stackBytes} B`));
        this.el.appendChild(segRow1);

        const segRow2 = this.mk('div', 'usage-row');
        segRow2.appendChild(this.mk('span', 'usage-seg-label', 'HEAP'));
        const bar2 = this.mk('div', 'usage-bar');
        if (heapPct > 0) {
            const fill2 = this.mk('div', 'usage-bar-fill usage-heap-fill');
            fill2.style.width = heapPct.toFixed(1) + '%';
            bar2.appendChild(fill2);
        }
        segRow2.appendChild(bar2);
        segRow2.appendChild(this.mk('span', 'usage-seg-value', `${stats.heapBytes} B`));
        this.el.appendChild(segRow2);

        // Per-block stacked bar (hover shows name/size)
        const blocksWrap = this.mk('div', 'usage-blocks');
        blocksWrap.appendChild(this.mk('div', 'usage-blocks-label', '블록 구성 (hover: 이름/크기)'));
        const blockBar = this.mk('div', 'usage-blockbar');
        let heapIndex = 0;
        for (const alloc of allocations) {
            const size = alloc.size || 0;
            if (size === 0) continue;
            const seg = this.mk('div', 'usage-block');
            seg.style.width = ((size / total) * 100).toFixed(2) + '%';
            seg.style.background = this.getColor(alloc, heapIndex);
            seg.title = `#${alloc.name} · ${size} B`;
            blockBar.appendChild(seg);
            if (alloc.section === 'heap') heapIndex++;
        }
        blocksWrap.appendChild(blockBar);
        this.el.appendChild(blocksWrap);

        // Summary chips
        const summary = this.mk('div', 'usage-summary-line');
        const paddingPct = ((stats.paddingBytes / total) * 100).toFixed(1);
        summary.appendChild(this.mk('span', 'usage-chip', `스택 ${stats.stackBytes} B`));
        summary.appendChild(this.mk('span', 'usage-chip', `힌 ${stats.heapBytes} B`));
        const padChip = this.mk('span', 'usage-chip padding', `패딩 ${stats.paddingBytes} B (${paddingPct}%)`);
        if (stats.paddingBytes === 0) padChip.style.opacity = '0.5';
        summary.appendChild(padChip);
        this.el.appendChild(summary);
    }
}

window.MemoryUsageView = MemoryUsageView;
