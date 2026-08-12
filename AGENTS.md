# PROJECT KNOWLEDGE BASE

**Generated:** 2026-01-11 (updated for break/continue/nested loops, op precedence)
**Context:** C Memory Visualizer (Vanilla JS)

## OVERVIEW
Browser-based tool to visualize C memory layout (stack, heap, pointers). 
**Stack:** HTML5, Vanilla JS, CSS3, CodeMirror (CDN). No build step.

## STRUCTURE
```
.
├── index.html        # Entry point (layouts 3 panels: Memory, Minimap, Code)
├── js/               # Core logic (Script tag order matters!)
│   ├── parser.js     # CParser: Parses subset of C syntax
│   ├── memory.js     # VirtualMemory: Simulates 32/64-bit addressing
│   ├── visualizer.js # MemoryVisualizer: Renders table view
│   ├── minimap.js    # MinimapVisualizer: SVG-based minimap
│   └── main.js       # Controller: Event handling & orchestration
└── css/
    └── styles.css    # Custom variables & Dracula theme overrides
└── tests/            # Node test suite (no deps; loads browser JS via lib.js)
    ├── lib.js        # Shared loader: window.X→globalThis rewrite, loadCore/loadVisualizer/loadMinimap/loadExamples/analyze
    ├── run_all.js    # Runs all *.test.js sequentially, aggregates exit code
    ├── 01_functions_core.test.js    # WP5: frames, calls, recursion caps, loops, pointer params
    ├── 02_array_params.test.js      # arr[] decay, arr[i] read/write through
    ├── 03_break_continue.test.js    # break/continue, nested loops
    ├── 04_step_mode.test.js         # step trace events, replay isolation
    ├── 05_examples_regression.test.js # every main.js EXAMPLES entry parses+executes
    ├── 06_visualizer_smoke.test.js  # renderer w/ DOM stubs (frame headers, badges)
    └── 07_minimap_frames.test.js    # minimap frame panels & nesting
```

## ARCHITECTURE
**Data Flow:**
1. User input (CodeMirror) -> `main.js` triggers `analyze()`
2. `CParser` -> AST/Declarations
3. `VirtualMemory` -> Allocates & resolves pointers (simulated RAM)
4. `MemoryVisualizer` -> Updates DOM Table
5. `MinimapVisualizer` -> Updates SVG

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| **C Syntax Support** | `js/parser.js` | Structs, pointers, arrays, **function defs + bodies (while/for loops with break/continue, nested loops, if-blocks, if-return, & / * exprs; binop precedence: 비교 < 덧셈 < 곱셈)** |
| **Addressing Logic** | `js/memory.js` | 32 vs 64-bit offsets & endianness; **`handleFunctionCall`/`execFrameStatement`/`evalFrameExpr` run function bodies (depth cap 7/30, loop cap 200); array params decay to pointers, break/continue 컨트롤 반환** |
| **UI/Rendering** | `js/visualizer.js` | DOM manipulation for memory table; **frame headers show 반환주소/반환값/호출 목록** |
| **Minimap** | `js/minimap.js` | SVG zoom/pan; **stack allocations grouped into frame panels (`drawFramePanel`), nested by depth** |
| **Theme/Layout** | `css/styles.css` | Flexbox layout, resizers, colors |
| **Events** | `js/main.js` | Click, Resize, Zoom handling; **EXAMPLES/POINTS maps (28 examples, incl. functions/recursion/swap_func/loops/array_func/break_continue), step mode UI** |

## KEY COMPONENTS (Global Scope)
| Class | File | Role |
|-------|------|------|
| `CParser` | `parser.js` | Tokenizes and parses C declarations + function definitions/bodies; `functionDefs` map |
| `VirtualMemory` | `memory.js` | Manages `allocations` array, pointer resolution, and **frame-based function execution** (`frames` array, `setFnDefs(map)`), **step-mode trace & replay** (`beginStepTrace`/`applyStepEvent`/`getStepLabel`, snapshot deep-clone incl. BigInt/Map) |
| `MemoryVisualizer` | `visualizer.js` | Syncs memory state to HTML Table (incl. frame headers) |
| `MinimapVisualizer` | `minimap.js` | Handles SVG zoom/pan, node rendering, **frame panels** (`render(allocs, frames)`) |
| `main.js` | `main.js` | **`stepTo(index)` + `updateStepUI()`: ◀/▶ buttons + range slider scrub execution trace (slider→end 재-analyze)** |

## CONVENTIONS
- **Dependency Management**: Manual `<script>` tag order in `index.html`.
  - Order: `parser` -> `memory` -> `visualizer` -> `minimap` -> `main`.
- **Styling**: Vanilla CSS with variables (`var(--...)`). No Preprocessor.
- **State**: `main.js` holds instances; `VirtualMemory` holds data state.

## ANTI-PATTERNS (THIS PROJECT)
- **DO NOT** introduce `npm` or build steps (Webpack/Vite) without migration plan.
- **DO NOT** reorder script tags in `index.html` (Classes must be defined before use).
- **DO NOT** use modern ES6 modules (`import/export`) unless refactoring to `<script type="module">`.

## COMMANDS
```bash
# Run Locally
open index.html   # No server needed, works directly in browser
# OR
npx serve .       # If CORS issues arise (though none expected)

# Run tests (Node, no deps)
node tests/run_all.js
```

## NOTES
- **Step mode**: analyze()는 항상 `beginStepTrace()` 후 전체 실행(스텝 트레이스 기록). `stepTo(index)`/슬라이더로 어떤 단계든 재생 — 각 스텝은 전역 상태(BigInt/Map 포함) 딥클론 스냅샷, 끝으로 가면 analyze() 재실행. 루프 200회 cap 덕에 트레이스 폭주 없음.
- **C Support**: Functions with bodies (while/for/if-return, &/* 표현식) 실행 시뮬레이션 포함. 실행은 깊이 7(자식 프레임)/30(하드)/루프 200회로 제한.
- **Binop precedence**: parseBodyExpr → parseAdditiveExpr → parseMultExpr → parseBodyTerm (비교 < 덧셈 < 곱셈). `a + b * c`는 `a + (b*c)`.
- **break/continue**: tokenizer 키워드에 포함. 문장은 `{kind:'break'|'continue'}`로 추출, `if (c) break;`는 if-블록으로. execFrameStatement가 'break'/'continue' 문자열을 반환해 루프가 소비 (중첩 루프는 가장 안쪽 루프에만 적용).
- **External Libs**: CodeMirror loaded via CDN (requires internet).
