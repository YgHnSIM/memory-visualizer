class MinimapVisualizer {
    constructor(svgId) {
        this.svg = document.getElementById(svgId);
        this.container = this.svg.parentElement;
        this.baseAddress = BigInt('0x7FFF00000000'); // Default start, will adjust dynamically

        // Scale configs
        this.baseByteHeight = 8;
        this.baseBlockWidth = 100;
        this.currentScale = 1.0;

        this.byteHeight = this.baseByteHeight;
        this.blockWidth = this.baseBlockWidth;

        this.padding = { top: 40, left: 60, right: 60, bottom: 20 };
        this.gapThreshold = 64;

        this.colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98FB98',
            '#DDA0DD', '#FFD700', '#87CEFA', '#F08080', '#20B2AA'
        ];

        this.lastDeclarations = [];

        // Reference Maps for highlighting
        this.forwardRefs = new Map(); // name -> Set(targetNames)
        this.backwardRefs = new Map(); // name -> Set(sourceNames)

        // Panning state (Transform)
        this.isDragging = false;
        this.startPos = { x: 0, y: 0 };
        this.pan = { x: 0, y: 0 }; // Current pan offset

        // Touch panning state (mobile)
        this.touchPointers = new Map(); // pointerId -> {x, y}
        this.touchPendingToggle = false;

        this.init();
        this.enableDragPan();
    }

    init() {
        const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        this.svg.appendChild(defs);

        this.contentGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        this.updateTransform();
        this.svg.appendChild(this.contentGroup);
    }

    updateTransform() {
        this.contentGroup.setAttribute("transform",
            `translate(${this.padding.left + this.pan.x}, ${this.padding.top + this.pan.y}) scale(${this.currentScale})`);
    }

    enableDragPan() {
        const container = this.container;

        // Wheel Zoom
        container.addEventListener('wheel', (e) => {
            e.preventDefault();

            const ZOOM_STEP = 0.1;
            const delta = -Math.sign(e.deltaY) * ZOOM_STEP;
            let newScale = this.currentScale + delta;
            newScale = Math.min(Math.max(newScale, 0.5), 2.0); // Clamp 0.5 to 2.0

            if (Math.abs(newScale - this.currentScale) < 0.01) return;

            // Zoom towards mouse cursor
            const rect = container.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // Current mouse position relative to content origin (padding + pan)
            const ratio = newScale / this.currentScale;

            const pdLeft = this.padding.left;
            const pdTop = this.padding.top;

            this.pan.x = (mouseX - pdLeft) - (mouseX - pdLeft - this.pan.x) * ratio;
            this.pan.y = (mouseY - pdTop) - (mouseY - pdTop - this.pan.y) * ratio;

            this.setScale(newScale);
            this.updateTransform();

            // Dispatch zoom event for UI (optional, UI removed but event kept for compatibility)
            this.svg.dispatchEvent(new CustomEvent('minimap-zoom', { detail: { scale: newScale }, bubbles: true }));
        });

        container.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;

            this.isDragging = false;
            this.startPos = { x: e.clientX, y: e.clientY };
            this.panStart = { x: this.pan.x, y: this.pan.y };

            this.dragState = 'potential';

            container.style.cursor = 'grabbing';
        });

        window.addEventListener('mousemove', (e) => {
            if (this.dragState !== 'potential' && this.dragState !== 'dragging') return;

            const dx = e.clientX - this.startPos.x;
            const dy = e.clientY - this.startPos.y;

            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                this.dragState = 'dragging';
                this.isDragging = true;
            }

            if (this.dragState === 'dragging') {
                this.pan.x = this.panStart.x + dx;
                this.pan.y = this.panStart.y + dy;
                this.updateTransform();
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.dragState) {
                container.style.cursor = '';
                setTimeout(() => {
                    this.isDragging = false;
                    this.dragState = null;
                }, 50);
            }
        });

        const TOUCH_DRAG_THRESHOLD = 6;
        if (typeof container.style.setProperty === 'function') {
            container.style.setProperty('touch-action', 'none');
        } else {
            container.style.touchAction = 'none';
        }

        const touchEnd = (e) => {
            if (e.pointerType !== 'touch') return;
            if (!this.touchPointers.has(e.pointerId)) return;
            this.touchPointers.delete(e.pointerId);
            if (this.dragState) {
                container.style.cursor = '';
                this.isDragging = false;
                this.dragState = null;
            }
            this.touchPendingToggle = false;
        };

        container.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'touch') return;
            if (this.touchPointers.size >= 2) return;
            if (e.target && typeof e.target.setPointerCapture === 'function') {
                try { e.target.setPointerCapture(e.pointerId); } catch (err) {}
            }
            this.touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (this.touchPointers.size === 1) {
                this.dragState = 'potential';
                this.isDragging = false;
                this.startPos = { x: e.clientX, y: e.clientY };
                this.panStart = { x: this.pan.x, y: this.pan.y };
                this.svg.classList.toggle('touch-minimize');
                this.touchPendingToggle = true;
                container.style.cursor = 'grabbing';
            } else {
                this.dragState = null;
                this.isDragging = false;
                if (this.touchPendingToggle) {
                    this.svg.classList.toggle('touch-minimize');
                    this.touchPendingToggle = false;
                }
                container.style.cursor = '';
            }
            if (typeof e.preventDefault === 'function') e.preventDefault();
        });

        container.addEventListener('pointermove', (e) => {
            if (e.pointerType !== 'touch') return;
            if (this.touchPointers.size >= 2) return;
            if (!this.touchPointers.has(e.pointerId)) return;
            if (this.dragState !== 'potential' && this.dragState !== 'dragging') return;

            const p = this.touchPointers.get(e.pointerId);
            p.x = e.clientX;
            p.y = e.clientY;

            const dx = e.clientX - this.startPos.x;
            const dy = e.clientY - this.startPos.y;

            if (Math.abs(dx) > TOUCH_DRAG_THRESHOLD || Math.abs(dy) > TOUCH_DRAG_THRESHOLD) {
                if (this.dragState === 'potential') {
                    this.dragState = 'dragging';
                    this.isDragging = true;
                    if (this.touchPendingToggle) {
                        this.svg.classList.toggle('touch-minimize');
                        this.touchPendingToggle = false;
                    }
                }
            }

            if (this.dragState === 'dragging') {
                this.pan.x = this.panStart.x + dx;
                this.pan.y = this.panStart.y + dy;
                this.updateTransform();
            }

            if (typeof e.stopPropagation === 'function') e.stopPropagation();
            if (typeof e.preventDefault === 'function') e.preventDefault();
        });

        window.addEventListener('pointerup', touchEnd);
        window.addEventListener('pointercancel', touchEnd);
    }

    setScale(scale) {
        this.currentScale = scale;
        // No re-render needed: scaling is applied via SVG transform,
        // so zooming stays cheap even on large layouts.
        this.updateTransform();
    }

    render(declarations, frames) {
        this.lastDeclarations = declarations;
        this.lastFrames = frames || [];
        this.contentGroup.innerHTML = '';
        
        // Reset reference maps
        this.forwardRefs.clear();
        this.backwardRefs.clear();

        if (!declarations || declarations.length === 0) return;

        // Separate Stack and Heap
        const stackAllocations = declarations.filter(a => !a.section || a.section === 'stack').sort((a, b) => Number(a.address - b.address));
        const heapAllocations = declarations.filter(a => a.section === 'heap').sort((a, b) => Number(a.address - b.address));

        // Layout Parameters
        const STACK_START_Y = 0;
        let HEAP_START_Y = 0;
        const SECTION_GAP = 60; // Gap between stack and heap visualization

        // Position Map: name -> {x, y, width, height, center}
        // Note: y will be global y within the svg content group
        const positions = new Map();

        // --- Render Stack ---
        let currentY = STACK_START_Y;
        
        if (stackAllocations.length > 0) {
            const stackBase = stackAllocations[0].address;
            
            // Add Stack Label
            this.drawSectionLabel("STACK", 0, currentY - 20);

            // Group allocations into call-stack frames (by frameId)
            const groups = [];
            let curGroup = null;
            stackAllocations.forEach(alloc => {
                const offset = Number(alloc.address - stackBase);
                const y = STACK_START_Y + (offset * this.byteHeight);
                const height = alloc.kind === 'padding' ? 2 : alloc.size * this.byteHeight;
                if (!curGroup || curGroup.frameId !== alloc.frameId) {
                    curGroup = { frameId: alloc.frameId, yStart: y, yEnd: y + height, allocs: [] };
                    groups.push(curGroup);
                }
                curGroup.yEnd = y + height;
                curGroup.allocs.push(alloc);
            });

            groups.forEach((group, gi) => {
                const frame = this.lastFrames.find(f => f.depth === group.frameId);
                let label = group.frameId === undefined || group.frameId === null
                    ? '전역 (Global)'
                    : (frame ? frame.name + '()' : 'frame #' + group.frameId);
                if (frame && frame.returnValue !== undefined && frame.returnValue !== 0) {
                    label += '  →  ' + frame.returnValue;
                }
                if (frame) label += '  · depth ' + frame.depth;
                const panelX = 0;
                const panelY = group.yStart - 4;
                const panelH = (group.yEnd - group.yStart) + 8;
                this.drawFramePanel(panelX + (gi * 14), panelY, this.blockWidth, panelH, label, group.frameId);

                group.allocs.forEach(alloc => {
                    const offset = Number(alloc.address - stackBase);
                    const y = STACK_START_Y + (offset * this.byteHeight);
                    const height = alloc.kind === 'padding' ? 2 : alloc.size * this.byteHeight;
                    
                    const globalY = y;
                    const x = gi * 14; // nest deeper frames to the right
                    positions.set(alloc.name, { 
                        x,
                        y: globalY, 
                        width: this.blockWidth, 
                        height, 
                        center: globalY + height / 2, 
                        name: alloc.name 
                    });

                    this.drawBlock(alloc, x, globalY, this.blockWidth, height);
                    currentY = Math.max(currentY, globalY + height);
                });
            });
        }

        // --- Render Heap ---
        // Heap starts after Stack + Gap
        // If stack is empty, start at 40
        const heapStartY = stackAllocations.length > 0 ? currentY + SECTION_GAP : 40;
        
        if (heapAllocations.length > 0) {
            const heapBase = heapAllocations[0].address;

            // Draw Separator
            if (stackAllocations.length > 0) {
                this.drawSeparator(0, currentY + (SECTION_GAP / 2), this.blockWidth);
            }

            // Add Heap Label
            this.drawSectionLabel("HEAP", 0, heapStartY - 20);

            heapAllocations.forEach(alloc => {
                const offset = Number(alloc.address - heapBase);
                const y = heapStartY + (offset * this.byteHeight);
                const height = alloc.kind === 'padding' ? 2 : alloc.size * this.byteHeight;

                const globalY = y;
                positions.set(alloc.name, { 
                    x: 0, 
                    y: globalY, 
                    width: this.blockWidth, 
                    height, 
                    center: globalY + height / 2, 
                    name: alloc.name 
                });

                this.drawBlock(alloc, 0, globalY, this.blockWidth, height);
            });
        }

        // Set SVG size to match container to receive events everywhere
        this.svg.setAttribute("width", "100%");
        this.svg.setAttribute("height", "100%");

        // --- Render Connections ---
        let connectionInfoList = [];

        // Check pointers in both stack and heap
        const allAllocs = [...stackAllocations, ...heapAllocations];
        
        allAllocs.forEach(alloc => {
            if (alloc.kind === 'pointer' && alloc.pointsTo) {
                const targetName = alloc.pointsTo;
                
                // Build reference maps
                if (!this.forwardRefs.has(alloc.name)) this.forwardRefs.set(alloc.name, new Set());
                this.forwardRefs.get(alloc.name).add(targetName);

                if (!this.backwardRefs.has(targetName)) this.backwardRefs.set(targetName, new Set());
                this.backwardRefs.get(targetName).add(alloc.name);

                let targetPos = positions.get(targetName);
                if (targetPos) {
                    const sourcePos = positions.get(alloc.name);
                    connectionInfoList.push({ source: sourcePos, target: targetPos });
                }
            }
        });

        connectionInfoList.forEach((conn, index) => {
            const side = index % 2 === 0 ? 'right' : 'left';
            this.drawConnection(conn.source, conn.target, side);
        });
    }

    drawSectionLabel(text, x, y) {
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", x);
        label.setAttribute("y", y);
        label.setAttribute("fill", "var(--text-secondary)");
        label.setAttribute("font-size", "12px");
        label.setAttribute("font-weight", "bold");
        label.setAttribute("letter-spacing", "0.1em");
        label.textContent = text;
        this.contentGroup.appendChild(label);
    }

    drawFramePanel(x, y, width, height, label, frameId) {
        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        group.setAttribute("class", "frame-panel");

        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", x);
        rect.setAttribute("y", y);
        rect.setAttribute("width", width);
        rect.setAttribute("height", Math.max(height, 2));
        rect.setAttribute("rx", "6");
        rect.setAttribute("fill", frameId === undefined || frameId === null ? "rgba(120,120,120,0.06)" : "rgba(80,140,255,0.07)");
        rect.setAttribute("stroke", frameId === undefined || frameId === null ? "rgba(120,120,120,0.35)" : "rgba(80,140,255,0.45)");
        rect.setAttribute("stroke-width", "1.2");
        rect.setAttribute("stroke-dasharray", "5 3");
        group.appendChild(rect);

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", x + 5);
        text.setAttribute("y", y - 6);
        text.setAttribute("fill", frameId === undefined || frameId === null ? "var(--text-secondary)" : "#8ab4ff");
        text.setAttribute("font-size", "11px");
        text.setAttribute("font-weight", "bold");
        text.textContent = label;
        group.appendChild(text);

        this.contentGroup.appendChild(group);
    }

    drawSeparator(x, y, width) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", x - 20);
        line.setAttribute("y1", y);
        line.setAttribute("x2", x + width + 20);
        line.setAttribute("y2", y);
        line.setAttribute("stroke", "var(--border-color)");
        line.setAttribute("stroke-width", "1");
        line.setAttribute("stroke-dasharray", "4 4");
        this.contentGroup.appendChild(line);
    }


    drawBlock(alloc, x, y, width, height) {
        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        group.setAttribute("data-name", alloc.name); // Add data attribute for easier selection

        group.addEventListener('click', (e) => {
            if (this.isDragging) {
                e.stopPropagation();
                return;
            }
            this.svg.dispatchEvent(new CustomEvent('minimap-node-click', {
                detail: {
                    address: alloc.address,
                    name: alloc.name,
                    resolvedAddress: alloc.resolvedAddress || alloc.address
                },
                bubbles: true
            }));
        });

        group.addEventListener('mouseover', () => {
            if (!this.isDragging) {
                group.style.cursor = "pointer";
                this.highlightConnection(alloc.name);
            }
        });

        group.addEventListener('mouseout', () => {
            this.clearHighlights();
        });

        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", x);
        rect.setAttribute("y", y);
        rect.setAttribute("width", width);
        rect.setAttribute("height", Math.max(height - 2, 2));
        rect.setAttribute("class", "minimap-node");

        group.appendChild(rect);

        if (alloc.kind === 'padding') {
            // Padding sliver: no internal detail, no labels
            this.contentGroup.appendChild(group);
            return;
        }

        if (height > 10) {
            if (alloc.kind === 'struct' && alloc.members) {
                let currentY = y;
                alloc.members.forEach((member, i) => {
                    const memberHeight = member.size * this.byteHeight;
                    if (memberHeight >= 2) {
                        const memberRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                        memberRect.setAttribute("x", x + 2);
                        memberRect.setAttribute("y", currentY);
                        memberRect.setAttribute("width", width - 4);
                        memberRect.setAttribute("height", Math.max(memberHeight - 1, 1));
                        memberRect.setAttribute("fill", "none");
                        memberRect.setAttribute("stroke", "rgba(0,0,0,0.1)");
                        memberRect.setAttribute("stroke-width", "0.5");
                        group.appendChild(memberRect);

                        if (memberHeight > 10) {
                            const nameText = document.createElementNS("http://www.w3.org/2000/svg", "text");
                            nameText.setAttribute("x", x + 8);
                            nameText.setAttribute("y", currentY + memberHeight / 2 + 3);
                            nameText.setAttribute("class", "minimap-subtext");
                            nameText.style.fontSize = "9px";
                            nameText.style.opacity = "0.7";
                            nameText.style.pointerEvents = "none";
                            nameText.textContent = `.${member.name}`;
                            group.appendChild(nameText);
                        }
                    }
                    currentY += memberHeight;
                });
            } else if (alloc.kind === 'array' && alloc.length > 1) {
                const elementHeight = (alloc.size / alloc.length) * this.byteHeight;
                if (elementHeight > 3) {
                    for (let i = 1; i < alloc.length; i++) {
                        const lineY = y + (i * elementHeight);
                        if (lineY < y + height) {
                            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                            line.setAttribute("x1", x);
                            line.setAttribute("y1", lineY);
                            line.setAttribute("x2", x + width);
                            line.setAttribute("y2", lineY);
                            line.setAttribute("stroke", "rgba(0,0,0,0.1)");
                            line.setAttribute("stroke-width", "0.5");
                            group.appendChild(line);
                        }
                    }
                }
            }
        }

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", x + 5);
        text.setAttribute("y", y + 10);
        text.setAttribute("class", "minimap-text");
        text.style.fontSize = "12px";
        text.textContent = alloc.name;

        if (height < 12) {
            text.style.display = 'none';
        }

        group.appendChild(text);

        if (height >= 12) {
            const subtext = document.createElementNS("http://www.w3.org/2000/svg", "text");
            subtext.setAttribute("x", x + width + 5);
            subtext.setAttribute("y", y + 10);
            subtext.setAttribute("class", "minimap-subtext");
            subtext.style.fontSize = "10px";
            subtext.textContent = `0x...${alloc.address.toString(16).slice(-4).toUpperCase()}`;
            group.appendChild(subtext);
        }

        this.contentGroup.appendChild(group);
    }

    drawConnection(source, target, side = 'right') {
        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        group.setAttribute("data-source", source.name);
        group.setAttribute("data-target", target.name);
        group.setAttribute("class", "connection-group");

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

        let colorIndex = 0;
        if (source.name) {
            for (let i = 0; i < source.name.length; i++) {
                colorIndex += source.name.charCodeAt(i);
            }
        }
        const color = this.colors ? this.colors[colorIndex % this.colors.length] : 'var(--type-pointer)';

        let d;
        let arrowX, arrowY;
        let arrowAngle = 0;

        const outerCurveOffset = 40;

        if (side === 'right') {
            const startX = source.x + source.width;
            const startY = source.center;
            const endX = target.x + target.width;
            const endY = target.center;

            d = `M ${startX} ${startY} C ${startX + outerCurveOffset} ${startY}, ${endX + outerCurveOffset} ${endY}, ${endX} ${endY}`;

            arrowX = endX;
            arrowY = endY;
            arrowAngle = 0;
        } else {
            const startX = source.x;
            const startY = source.center;
            const endX = target.x;
            const endY = target.center;

            d = `M ${startX} ${startY} C ${startX - outerCurveOffset} ${startY}, ${endX - outerCurveOffset} ${endY}, ${endX} ${endY}`;

            arrowX = endX;
            arrowY = endY;
            arrowAngle = 180;
        }

        path.setAttribute("d", d);
        path.setAttribute("class", "connection-line");
        path.style.stroke = color;
        path.style.strokeWidth = "1.5px";
        path.style.fill = "none";

        // Store color for highlighting restoration
        path.dataset.originalColor = color;
        path.dataset.originalWidth = "1.5px";

        group.appendChild(path);
        group.appendChild(this.createArrowHead(arrowX, arrowY, color, arrowAngle));

        this.contentGroup.appendChild(group);
    }

    createArrowHead(x, y, color, angle = 0) {
        const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const size = 6;
        const halfSize = size / 2;
        const d = `M 0 0 L ${size} ${-halfSize} L ${size} ${halfSize} Z`;

        arrow.setAttribute("d", d);
        arrow.setAttribute("fill", color);
        arrow.setAttribute("class", "arrowhead");
        arrow.setAttribute("transform", `translate(${x}, ${y}) rotate(${angle})`);

        return arrow;
    }
    
    highlightConnection(name) {
        // Collect all related nodes (self, targets, sources)
        const relatedNodes = new Set();
        relatedNodes.add(name);
        
        if (this.forwardRefs.has(name)) {
            this.forwardRefs.get(name).forEach(t => relatedNodes.add(t));
        }
        if (this.backwardRefs.has(name)) {
            this.backwardRefs.get(name).forEach(s => relatedNodes.add(s));
        }

        // Highlight nodes
        const groups = this.contentGroup.querySelectorAll('g[data-name]');
        groups.forEach(g => {
            const nodeName = g.getAttribute('data-name');
            if (relatedNodes.has(nodeName)) {
                g.querySelector('.minimap-node').classList.add('highlighted');
            } else {
                g.style.opacity = '0.3'; // Dim unrelated nodes
            }
        });

        // Highlight connection groups (line + arrowhead together)
        const connGroups = this.contentGroup.querySelectorAll('g.connection-group');
        connGroups.forEach(g => {
            const source = g.getAttribute('data-source');
            const target = g.getAttribute('data-target');

            if (source === name || target === name) {
                g.classList.add('highlighted');
                // Move to front to be visible on top of dimmed elements
                this.contentGroup.appendChild(g);
            } else {
                g.style.opacity = '0.1';
            }
        });
    }

    clearHighlights() {
        // Remove highlight classes
        const groups = this.contentGroup.querySelectorAll('g[data-name]');
        groups.forEach(g => {
            g.querySelector('.minimap-node').classList.remove('highlighted');
            g.style.opacity = '1';
        });

        const connGroups = this.contentGroup.querySelectorAll('g.connection-group');
        connGroups.forEach(g => {
            g.classList.remove('highlighted');
            g.style.opacity = '';
        });
    }
}
