# JS MODULE KNOWLEDGE BASE

**Context:** Core Logic for C Memory Visualizer

## OVERVIEW
Contains the pure JavaScript logic for parsing C code, simulating memory, and rendering the visualization.
**Architecture:** Class-based, ES6 modules (simulated via script tags), no bundler.

## STRUCTURE
```
js/
├── main.js       # CONTROLLER: Orchestrates Parser -> Memory -> Visualizer
├── parser.js     # MODEL: Regex-based C syntax parser (Fragile!)
├── memory.js     # MODEL: Virtual memory simulator (BigInt support)
├── visualizer.js # VIEW: DOM-based memory table & SVG pointers
└── minimap.js    # VIEW: SVG-based high-level memory map
```

## KEY CLASSES
| Class | File | Responsibility | Critical Note |
|-------|------|----------------|---------------|
| `CParser` | `parser.js` | Extract declarations from strings | **Regex-based**. Fails on complex nested syntax or macros. |
| `VirtualMemory` | `memory.js` | Allocate bytes & resolve addresses | Supports 32/64-bit. **No struct padding/alignment** simulated. |
| `MemoryVisualizer` | `visualizer.js` | Render `<table>` rows | Uses `innerHTML` wipe (Performance bottleneck on large data). |
| `MinimapVisualizer` | `minimap.js` | Render SVG nodes | Handles zoom/pan logic independently. |

## DATA FLOW
1. `main.js` captures CodeMirror input.
2. `parser.parse(code)` returns `Declaration[]`.
3. `memory.reset()` clears state -> `memory.allocate(decl)` populates `allocations`.
4. `visualizer.render()` & `minimap.render()` update DOM.

## CONVENTIONS
- **Global Scope**: All classes are attached to `window` (no `export`/`import`).
- **BigInt usage**: Addresses are stored as `BigInt` to support 64-bit simulation.
- **Manual dependency injection**: `main.js` instantiates classes in specific order.

## ANTI-PATTERNS (TECHNICAL DEBT)
- **Regex Parsing**: `parser.js` parses C via Regex. *Do not expect full C compliance.*
- **Memory Alignment**: `memory.js` packs data tightly. *Does not simulate architecture-specific padding.*
- **DOM Thrashing**: `visualizer.js` rebuilds the entire table on every analyze.
- **No Tests**: Logic changes must be verified manually using `test_suite.c`.

## COMMANDS
- **Debug**: Use browser console. `memory.allocations` is exposed on the `memory` instance in `main.js`.
