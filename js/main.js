/**
 * Main Application Controller
 * Initializes and coordinates all components
 */

document.addEventListener('DOMContentLoaded', function () {
    // Initialize components
    const parser = new CParser();
    const memory = new VirtualMemory(64);

    const tableBody = document.getElementById('memoryTableBody');
    const visualizer = new MemoryVisualizer(tableBody, memory);
    const minimap = new MinimapVisualizer('minimapSvg');
    const usageView = new MemoryUsageView(document.getElementById('usageStrip'), memory);

    // Initialize CodeMirror editor
    const codeTextarea = document.getElementById('codeEditor');
    const editor = CodeMirror.fromTextArea(codeTextarea, {
        mode: 'text/x-csrc',
        theme: 'dracula',
        lineNumbers: true,
        indentUnit: 4,
        tabSize: 4,
        smartIndent: false,
        electricChars: false,
        lineWrapping: true,
        matchBrackets: true,
        scrollbarStyle: window.matchMedia('(max-width: 639.98px)').matches ? 'null' : 'native',
        autocorrect: false,
        autocapitalize: false,
        spellcheck: false
    });

    // Event Listeners
    const analyzeBtn = document.getElementById('analyzeBtn');
    const resetBtn = document.getElementById('resetBtn'); // Changed clearBtn to resetBtn to match index.html
    const addressModeRadios = document.querySelectorAll('input[name="addressMode"]');
    const displayModeRadios = document.querySelectorAll('input[name="displayMode"]');
    const byteOrderRadios = document.querySelectorAll('input[name="byteOrder"]');

    // Code Examples
    const EXAMPLES = {
        basic: `// 1. Primitive Types & Basic Pointers
int a = 10;
int b = 20;
int *p = &a;

// Variable assignment via pointer
*p = 30; // a becomes 30

p = &b; // p now points to b
`,
        array: `// 2. Arrays and Pointers
int numbers[5] = {10, 20, 30, 40, 50};

// Array name decays to pointer to first element
int *ptr = numbers; 

// Pointer arithmetic
int *p2 = ptr + 2; // Points to numbers[2] (30)

// Array of characters
char str[6] = "Hello";
char *c = str;
`,
        dynamic: `// 3. Dynamic Allocation (Heap)
// Allocate memory for 5 integers in Heap
int *arr = (int*)malloc(sizeof(int) * 5);

// Use memory like an array
*arr = 10;        // arr[0]
*(arr + 1) = 20;  // arr[1]

// Another allocation
char *buffer = (char*)malloc(16);
`,
        linked_list: `// 4. Linked List (Stack + Heap)
struct Node {
    int data;
    struct Node *next;
};

// Head pointer on Stack
struct Node *head = (struct Node*)malloc(sizeof(struct Node));
head->data = 10;

// Second node on Heap
struct Node *second = (struct Node*)malloc(sizeof(struct Node));
second->data = 20;

// Link them
head->next = second;
second->next = 0; // NULL
`,
        struct: `// 5. Struct Definition & Usage
struct Point {
    int x;
    int y;
};

struct Rect {
    struct Point p1;
    struct Point p2;
};

struct Point start = {0, 0};
struct Point end = {100, 200};

struct Rect box = {
    {0, 0},
    {100, 200}
};
`,
        double_ptr: `// 6. Double Pointers (Pointer to Pointer)
int value = 42;
int *ptr1 = &value;
int **ptr2 = &ptr1;

// Accessing value
// **ptr2 == *ptr1 == value == 42
`,
        string: `// 7. String Handling
char fixed_buf[10] = "Fixed";
char flexible[] = "Flexible"; // Size determined by init string

char *s_ptr = flexible;

// String array
char *keywords[3] = {
    "if",
    "else",
    "while"
};
`,
        struct_ptr: `// 8. Struct Pointers
struct Person {
    int id;
    int age;
};

struct Person user = {1001, 25};
struct Person *p_user = &user;

// Access member via pointer
// p_user->age is same as (*p_user).age
`,
        struct_array: `// 9. Array of Structs
struct Item {
    int id;
    int cost;
};

struct Item inventory[3] = {
    {1, 100},
    {2, 250},
    {3, 500}
};

struct Item *cursor = inventory;
// cursor points to {1, 100}
// cursor+1 points to {2, 250}
`,
        pointer_arith: `// Pointer Arithmetic (Offsets)
int data[6] = {10, 20, 30, 40, 50, 60};
int *p = data;
int *p_mid = p + 2;
int *p_last = p + 5;
`,
        multi_ptr: `// Multi-level Pointers
int value = 7;
int *p = &value;
int **pp = &p;
int ***ppp = &pp;
`,
        nested_struct: `// Nested Struct
struct Address {
    int zip;
    int code;
};

struct Person {
    struct Address addr;
    int id;
};

struct Person person;
`,
        func_ptr: `// Function Pointer (Declaration only)
int (*op)(int, int);
void (*callback)();
`,
        buffer_overflow: `// Buffer Overflow Concept (Not executed)
char buf[4] = "ABCD";
char guard[4] = "ZZZZ";
// Writing beyond buf[3] would overwrite guard in real C
`,
        padding: `// Alignment & Padding
struct Pad {
    char a;
    int b;
    char c;
};

struct Pad pad = {1, 100, 2};
`,
        union_example: `// Union Example
union Data {
    int i;
    char c;
};

union Data d = {65};
`,
        swap: `// 17. 값 전달 vs 주소 전달 (Swap)
int a = 10;
int b = 20;
int *pa = &a;
int *pb = &b;

// 포인터 역참조로 실제 메모리 값을 교환
int temp = *pa;
*pa = *pb;
*pb = temp;
// a = 20, b = 10
`,
        overflow: `// 18. 정수 오버플로우 (2의 보수 감싸기)
int max = 2147483647;   // INT_MAX
int wrapped = max + 1;  // 경고: 표현 범위를 벗어나 감쌌음
int negative = -1;      // 0xFFFFFFFF
// REPRESENT 열의 툴팁에서 2의 보수 설명을 확인하세요
`,
        bits: `// 19. 비트 패턴 & 2의 보수
unsigned char flags = 10;   // 0000 1010 (0x0A)
int negative = -42;         // 2의 보수: 0xFFFFFFD6
int big = 255;              // 0xFF
// 2진수 표시 모드와 REPRESENT 툴팁으로 비트 패턴을 확인하세요
`,
        strcpy_overflow: `// 20. strcpy 버퍼 오버플로우 (개념)
char small[4];

// 6글자 "SECRET"을 4바이트 버퍼에 복사
small[0] = 'S';
small[1] = 'E';
small[2] = 'C';
small[3] = 'R';
// small[4]부터는 인접 메모리 침범 (실제 C: 미정의 동작)
`,
        typedef_enum: `// 21. typedef & enum
typedef unsigned int u32;
typedef struct Item Item;

enum Color { RED, GREEN = 5, BLUE };

struct Item {
    u32 id;
    int price;
};

Item book = {1, 9900};
enum Color c = BLUE;   // BLUE = 6
`,
        free_dangling: `// 22. free() & 댕글링 포인터
int *p = (int*)malloc(5 * sizeof(int));
p[0] = 100;
p[1] = 200;

free(p);
// 힙 블록이 흐리게 표시되고 free 배지가 붙습니다
// p는 여전히 예전 주소를 가리킴 = 댕글링 포인터 (접근 시 UB)
`,
        functions: `// 23. 함수 호출 & 스택 프레임
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
// main() 프레임 → add(3, 4) 프레임이 스택에 쌓입니다
// 각 프레임은 반환 주소와 지역 변수/파라미터를 가집니다
`,
        recursion: `// 24. 재귀 호출 & 프레임 깊이
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
// factorial(5) → factorial(4) → ... 프레임이 연속 생성
// if (n <= 1) return 1; 기본 조건에서 멈추고 결과가 위로 전달됨
// f = 120, 깊이가 깊어질수록 스택 사용량이 커집니다 (시뮬레이션은 7단계 제한)
`,
        swap_func: `// 25. 포인터 인자 & 역참조 쓰기 (함수 버전 swap)
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
    // x = &a, y = &b 로 주소가 전달되고,
    // *x = *y 는 main의 a, b 메모리에 직접 쓰기
    return 0;
}
// swap 프레임의 x, y가 main의 a, b 주소를 가리킴 (포인터 배지)
// 호출 후 a = 20, b = 10 — 값이 아니라 주소로 바뀌는 과정 확인
`,
        loops: `// 26. while/for 루프 & 누적 합
int sum_while() {
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
    int a;
    int b;
    a = sum_while();  // 1+2+3+4+5 = 15
    b = sum_for();    // 0+1+...+9 = 45
    return 0;
}
// 루프 본문이 반복 실행되며 sum/i 값이 단계적으로 누적됩니다
// (시뮬레이션은 루프당 최대 200회 반복)
`,
        array_func: `// 27. 배열 인자 & arr[i] 인덱싱 (함수)
int sum_array(int arr[], int n) {
    int s;
    int i;
    s = 0;
    for (i = 0; i < n; i++) {
        s = s + arr[i];      // arr[i] → arr의 주소 + i*4 읽기
    }
    return s;
}

int max_of(int a[], int n) {
    int best;
    int i;
    best = a[0];
    i = 1;
    while (i < n) {
        if (a[i] > best) {  // if 블록: 조건이 참일 때만 실행
            best = a[i];
        }
        i = i + 1;
    }
    return best;
}

int main() {
    int values[5];
    int sum;
    int max;
    values[0] = 3;
    values[1] = 1;
    values[2] = 4;
    values[3] = 1;
    values[4] = 5;
    sum = sum_array(values, 5);  // 3+1+4+1+5 = 14
    max = max_of(values, 5);     // 5
    return 0;
}
// 배열 인자는 포인터로 붕괴(decay) — arr은 values의 시작 주소를 가리킴.
// arr[i] = i번째 요소(4바이트) 읽기/쓰기 → 호출자의 배열에 직접 반영.
`,
        break_continue: `// 28. break / continue & 중첩 루프
int main() {
    int total;
    int i;
    int j;
    total = 0;
    for (i = 1; i <= 3; i++) {
        for (j = 1; j <= 4; j++) {
            if (j == 3) {
                break;           // j==3이면 안쪽 루프만 종료
            }
            total = total + i * j;  // 1*1+1*2 + 2*1+2*2 + 3*1+3*2 = 18
        }
    }
    return 0;
}
// break: 현재 루프(가장 안쪽)를 즉시 종료, continue: 다음 반복으로 점프.
// 중첩 루프: 바깥 루프가 한 번 돌 때마다 안쪽 루프가 통째로 반복.
`
    };

    // Learning points per example
    const POINTS = {
        basic: '기본 타입과 포인터 — *p = 30으로 a가 바뀌고, p = &b로 대상이 바뀌는 과정',
        array: '배열 이름은 첫 요소 주소로 붕괴(decay) — ptr = numbers, ptr + 2가 numbers[2]',
        dynamic: '힙 할당 — malloc으로 스택과 분리된 힙 영역에 5 int 할당, *arr / *(arr+1) 쓰기',
        linked_list: '자기 참조 구조체 — head->next = second로 힙 위 노드 연결, 스택은 포인터만',
        struct: '구조체 — 멤버 순서대로 메모리 배치, p1.x는 첫 멤버 위치',
        double_ptr: '이중 포인터 — **ptr2 == *ptr1 == value == 42 참조 사슬',
        string: '문자열 — flexible[]는 초기화 문자열 크기로 결정, char 포인터 배열',
        struct_ptr: '구조체 포인터 — p_user->age는 (*p_user).age와 동일, 역참조 과정',
        struct_array: '구조체 배열 — 요소가 연속 배치, cursor = inventory가 첫 요소를 가리킴',
        pointer_arith: '포인터 산술 — p + 2는 2바이트가 아닌 요소 크기(4바이트)만큼 이동',
        multi_ptr: '다중 포인터 — ppp → pp → p → value 단계별 주소 값 확',
        nested_struct: '중첩 구조체 — 내부 구조체가 멤버 오프셋을 차지하는 방식',
        func_ptr: '함수 포인터 — 함수는 실행되지 않고 선언/주소 개념만 확인',
        buffer_overflow: '버퍼 오버플로우 개념 — strcpy는 시뮬레이션되지 않음',
        padding: '정렬/패딩 — char → int → char 배치에서 패딩 바이트가 추가됨',
        union_example: '유니온 — 모든 멤버가 같은 시작 주소 공유 (가장 큰 멤버 크기)',
        swap: '값 vs 주소 전달 — 포인터 역참조로만 실제 메모리 값 교체 가능',
        overflow: '정수 오버플로우 — INT_MAX + 1이 음수로 감싸지는 2의 보수 특성',
        bits: '비트 패턴 — 2의 보수로 음수 저장, 2진수 모드로 비트 확인',
        strcpy_overflow: 'strcpy 오버플로우 — 대상 버퍼 크기를 넘어서는 접근 = 인접 메모리 침범',
        typedef_enum: 'typedef/enum — 타입 별칭으로 선언 간소화, enum 값은 자동 증가',
        free_dangling: 'free()/댕글링 — 해제 후 주소는 남지만 접근은 미정의 동작, 이중 free 위험',
        functions: '함수 호출 — main → add 프레임이 쌓이고, 파라미터/지역변수/반환 주소가 프레임에 속함',
        recursion: '재귀 — 함수가 자기 자신을 호출하면 프레임이 계속 쌓임 (스택 오버플로우 위험)',
        swap_func: '포인터 인자 — 주소(&a)가 전달되면 역참조 쓰기(*x = *y)가 호출자의 변수에 직접 반영됨',
        loops: 'while/for 루프 — 조건과 반복 누적(+=)으로 변수 값이 단계적으로 변하는 과정을 스택에서 확인',
        array_func: '배열 인자 — arr[]는 포인터로 붕괴, arr[i] 인덱싱으로 호출자 배열 읽기/쓰기 (합계/최대값)',
        break_continue: 'break/continue & 중첩 루프 — break로 루프 종료, continue로 스킵, 이중 for 곱셈 (j==3 break)'
    };

    function showLearningPoint(key) {
        const lp = document.getElementById('learningPoints');
        if (!lp) return;
        if (!key || key === 'custom' || !POINTS[key]) {
            lp.hidden = true;
            return;
        }
        lp.textContent = '🎯 학습 포인트: ' + POINTS[key];
        lp.hidden = false;
    }

    analyzeBtn.addEventListener('click', analyze);
    if (resetBtn) resetBtn.addEventListener('click', clearAll);

    // Setup Example Selector
    const exampleSelect = document.getElementById('exampleSelect');
    if (exampleSelect) {
        // Load initial example
        if (exampleSelect.value !== 'custom' && EXAMPLES[exampleSelect.value]) {
             editor.setValue(EXAMPLES[exampleSelect.value]);
             showLearningPoint(exampleSelect.value);
        }

        exampleSelect.addEventListener('change', function() {
            const val = this.value;
            if (val === 'custom') {
                // Don't clear, just let user edit
                return;
            }
            if (EXAMPLES[val]) {
                editor.setValue(EXAMPLES[val]);
                showLearningPoint(val);
                analyze(); // Auto-analyze when example changes
            }
        });
        
        // When user edits code manually, switch select to 'custom'
        // and auto-analyze after a short debounce
        let autoAnalyzeTimer = null;
        editor.on('change', function (cm, change) {
            if (change.origin !== 'setValue') {
                exampleSelect.value = 'custom';
                showLearningPoint('custom');
                clearTimeout(autoAnalyzeTimer);
                autoAnalyzeTimer = setTimeout(analyze, 800);
            }
        });
    }


    addressModeRadios.forEach(radio => {
        radio.addEventListener('change', function () {
            const mode = parseInt(this.value);
            memory.setAddressMode(mode);
            parser.setArchitecture(mode);
            analyze();
        });
    });

    displayModeRadios.forEach(radio => {
        radio.addEventListener('change', function () {
            visualizer.setDisplayMode(this.value);
            visualizer.render();
            // Minimap doesn't depend on display mode (data view), but could re-render if needed
            setupPointerClickHandlers();
        });
    });

    byteOrderRadios.forEach(radio => {
        radio.addEventListener('change', function () {
            visualizer.setByteOrder(this.value);
            visualizer.render();
        });
    });

    // Panel resizer
    initResizer();

    // Setup minimap interactions
    setupMinimapInteractions();

    // 640px boundary watcher (initial apply + on crossing)
    updateViewVisibility();

    // Mobile (< 640px): segmented view tabs switch which single panel is visible
    const viewTabs = document.getElementById('viewTabs');
    const viewPanels = {
        memory: document.querySelector('.panel.memory-view'),
        code: document.querySelector('.panel.editor-pane'),
        minimap: document.querySelector('.panel.side-pane')
    };

    function switchView(target) {
        document.body.dataset.view = target;
        for (const key of Object.keys(viewPanels)) {
            if (viewPanels[key]) viewPanels[key].classList.toggle('active', key === target);
        }
        if (viewTabs) {
            viewTabs.querySelectorAll('button[data-target]').forEach(function (btn) {
                btn.setAttribute('aria-pressed', String(btn.dataset.target === target));
            });
        }
        // CodeMirror must re-measure after coming back from display:none
        if (target === 'code') editor.refresh();
    }

    if (viewTabs) {
        viewTabs.addEventListener('click', function (e) {
            const btn = e.target.closest('button[data-target]');
            if (btn) switchView(btn.dataset.target);
        });
    }

    switchView(document.body.dataset.view || 'memory');

    // Main analyze function
    let stepIndex = 0;

    function refreshRender() {
        visualizer.render();
        minimap.render(memory.getAllocations(), memory.frames);
        usageView.render();
        syncUsageResizer();
        setupPointerClickHandlers();
    }

    function updateStepUI() {
        const total = memory.getStepEventCount();
        if (stepIndex > total) stepIndex = total;
        const slider = document.getElementById('stepSlider');
        const info = document.getElementById('stepInfo');
        if (slider) {
            slider.max = String(total);
            slider.value = String(stepIndex);
        }
        if (info) {
            const label = stepIndex < total ? memory.getStepLabel(stepIndex) : '';
            info.textContent = `단계 ${stepIndex}/${total}${label ? ' · ' + label : ''}`;
            info.title = label;
        }
    }

    function analyze() {
        try {
            const code = editor.getValue();

            // Reset memory
            memory.reset();

            // Parse code
            const declarations = parser.parse(code);

            // Provide function definitions to memory for nested/recursive calls
            memory.setFnDefs(parser.functionDefs);

            // Record step-by-step execution trace
            memory.beginStepTrace();

            // Allocate memory for each declaration
            for (const decl of declarations) {
                if (decl) {
                    memory.allocate(decl);
                    memory.traceTopLevel(decl);
                }
            }

            // Resolve pointer references
            memory.resolvePointers();

            stepIndex = memory.getStepEventCount();

            // Render visualization
            refreshRender();

            // Setup pointer badge click handlers
            setupPointerClickHandlers();
        } catch (e) {
            console.error("Analysis error:", e);
            parser.errors.push({ message: e.message, token: '', position: 0 });
        }

        renderStatus();
        updateStepUI();
        if (exampleSelect) showLearningPoint(exampleSelect.value);
    }

    function stepTo(index) {
        const total = memory.getStepEventCount();
        if (index < 0) index = 0;
        if (index > total) index = total;
        if (index === stepIndex) { updateStepUI(); return; }
        stepIndex = index;
        if (stepIndex < total) {
            memory.applyStepEvent(stepIndex);
        } else {
            analyze();
        }
        refreshRender();
        renderStatus();
        updateStepUI();
    }

    const stepBackBtn = document.getElementById('stepBackBtn');
    const stepNextBtn = document.getElementById('stepNextBtn');
    const stepSlider = document.getElementById('stepSlider');
    if (stepBackBtn) stepBackBtn.addEventListener('click', () => stepTo(stepIndex - 1));
    if (stepNextBtn) stepNextBtn.addEventListener('click', () => stepTo(stepIndex + 1));
    if (stepSlider) {
        stepSlider.addEventListener('input', function () {
            stepTo(parseInt(this.value));
        });
    }

    function renderStatus() {
        const statusEl = document.getElementById('analysisStatus');
        const panel = document.getElementById('errorPanel');
        const list = document.getElementById('errorList');
        if (!statusEl || !panel || !list) return;

        const items = [];
        for (const err of parser.errors) {
            const where = err.token ? ` (토큰: "${err.token}")` : '';
            let text = `구문 오류: ${err.message}${where}`;
            if (err.hint) text += ` — 💡 ${err.hint}`;
            items.push(text);
        }
        for (const w of memory.overflowWarnings) {
            if (w.kind === 'range') {
                items.push(`범위 경고: ${w.name} (${w.type}) = ${w.value} — ${w.type} 표현 범위(${w.min}~${w.max})를 벗어나 감싸서 저장했어요`);
            } else if (w.kind === 'free') {
                items.push(w.message);
            } else {
                const addrHex = '0x' + w.address.toString(16).toUpperCase();
                items.push(`버퍼 오버플로우 감지: ${w.name} 블록 밖으로 ${w.overflowBytes}바이트 쓰기 시도 (주소 ${addrHex})`);
            }
        }

        const now = new Date().toLocaleTimeString('ko-KR', { hour12: false });
        if (items.length === 0) {
            statusEl.innerHTML = `<span class="status-dot success"></span> 분석 완료 (${now})`;
            statusEl.classList.remove('has-error');
            panel.hidden = true;
            list.innerHTML = '';
        } else {
            statusEl.innerHTML = `<span class="status-dot error"></span> 분석됨 (${now}) · 문제 ${items.length}건`;
            statusEl.classList.add('has-error');
            list.innerHTML = '';
            for (const item of items) {
                const li = document.createElement('li');
                li.textContent = item;
                list.appendChild(li);
            }
            panel.hidden = false;
        }

        // <640px: error/learning-point panels live inside the editor pane, so an
        // active diagnostic must pull the user back to the code view
        if (window.matchMedia('(max-width: 639.98px)').matches && document.body.dataset.view !== 'code') {
            const lp = document.getElementById('learningPoints');
            if (panel.hidden === false || (lp && lp.hidden === false)) {
                switchView('code');
                editor.refresh();
            }
        }
    }

    const errorCloseBtn = document.getElementById('errorCloseBtn');
    if (errorCloseBtn) {
        errorCloseBtn.addEventListener('click', function () {
            const panel = document.getElementById('errorPanel');
            if (panel) panel.hidden = true;
        });
    }

    function highlightAndScrollTo(targetAddr, varName) {
        // Find target row
        const targetRow = tableBody.querySelector(`tr[data-address="${targetAddr}"]`);
        if (!targetRow) return;

        // Clear previous highlights
        tableBody.querySelectorAll('.pointer-target-active').forEach(el => {
            el.classList.remove('pointer-target-active');
        });

        // Scroll target to just below the header
        const tableContainer = document.querySelector('.memory-table-container');
        const thead = document.querySelector('.memory-table thead');
        const theadHeight = thead ? thead.offsetHeight : 40;

        // Calculate scroll position to place target row just below header
        const targetOffsetTop = targetRow.offsetTop;
        tableContainer.scrollTo({
            top: targetOffsetTop - theadHeight,
            behavior: 'smooth'
        });

        // Add highlight to target block
        // Use provided varName or derive from row
        const targetVarName = varName || targetRow.dataset.varName;

        if (targetVarName) {
            tableBody.querySelectorAll(`tr[data-var-name="${targetVarName}"]`).forEach(row => {
                row.classList.add('pointer-target-active');
            });
        } else {
            targetRow.classList.add('pointer-target-active');
        }

        // Remove highlight after delay
        setTimeout(() => {
            tableBody.querySelectorAll('.pointer-target-active').forEach(el => {
                el.classList.remove('pointer-target-active');
            });
        }, 2000);
    }

    // Handle pointer badge clicks
    function setupPointerClickHandlers() {
        tableBody.querySelectorAll('.pointer-badge.clickable').forEach(badge => {
            badge.addEventListener('click', function () {
                const targetAddr = this.dataset.targetAddr;
                const targetVar = this.dataset.targetVar; // Ensure visualizer adds this
                highlightAndScrollTo(targetAddr, targetVar);
            });
        });
    }

    function setupMinimapInteractions() {
        const minimapSvg = document.getElementById('minimapSvg');
        if (!minimapSvg) return;

        minimapSvg.addEventListener('minimap-node-click', function (e) {
            const { address, name, resolvedAddress } = e.detail;

            // Re-implement simplified formatting matching visualizer:
            const is64Bit = memory.addressMode === 64;
            let searchAddr;
            if (is64Bit) {
                searchAddr = BigInt(address).toString(16);
            } else {
                searchAddr = Number(address).toString(16);
            }

            highlightAndScrollTo(searchAddr, name);
        });

        // Zoom interactions (Wheel only handled in minimap.js)
        // Buttons removed as per user request
    }

    function clearAll() {
        editor.setValue('// C언어 코드를 입력하세요\n\n');
        memory.reset();
        visualizer.render();
        minimap.render([]);
        usageView.render();
        syncUsageResizer();
        const statusEl = document.getElementById('analysisStatus');
        if (statusEl) {
            statusEl.innerHTML = '<span class="status-dot ready"></span> 준비됨';
            statusEl.classList.remove('has-error');
        }
        const panel = document.getElementById('errorPanel');
        if (panel) panel.hidden = true;
        const lp = document.getElementById('learningPoints');
        if (lp) lp.hidden = true;
    }

    // Initialize resizer for panel resizing
    function initResizer() {
        const resizerLeft = document.getElementById('resizerLeft');
        const resizerRight = document.getElementById('resizerRight');
        const resizerUsage = document.getElementById('resizerUsage');
        const memoryPanel = document.querySelector('.memory-view');
        const minimapPanel = document.querySelector('.minimap-pane');
        const editorPanel = document.querySelector('.editor-pane');
        const sidePane = document.querySelector('.side-pane');
        const usageStrip = document.getElementById('usageStrip');
        const container = document.querySelector('.main-content');

        if (!resizerLeft || !resizerRight) return;

        let isResizingLeft = false;
        let isResizingRight = false;
        let isResizingUsage = false;

        function handleResizePointerMove(e) {
            if (!isResizingLeft && !isResizingRight && !isResizingUsage) return;

            const containerRect = container.getBoundingClientRect();

            if (isResizingLeft) {
                // Resize memory panel width
                // Calculate width based on pointer position relative to container left
                let newWidth = e.clientX - containerRect.left;
                if (newWidth < 200) newWidth = 200;
                if (newWidth > containerRect.width - 400) newWidth = containerRect.width - 400; // Leave space for minimap + editor

                memoryPanel.style.flex = `0 0 ${newWidth}px`;
            }
            else if (isResizingRight && sidePane) {
                // Resize side rail width
                // The position of right resizer determines the end of side rail
                // Easier: Calculate side rail width = containerRight - pointerX
                let newWidth = containerRect.right - e.clientX;
                if (newWidth < 200) newWidth = 200;
                if (newWidth > containerRect.width - memoryPanel.getBoundingClientRect().width - 200) {
                    newWidth = containerRect.width - memoryPanel.getBoundingClientRect().width - 200;
                }

                sidePane.style.flex = `0 0 ${newWidth}px`;
            }
            else if (isResizingUsage && sidePane && usageStrip) {
                // Resize usage panel height within right rail
                const paneRect = sidePane.getBoundingClientRect();
                let newHeight = e.clientY - paneRect.top;
                newHeight = Math.max(140, newHeight);
                newHeight = Math.min(newHeight, paneRect.height * 0.45);

                usageStrip.style.flex = `0 0 ${newHeight}px`;
            }
        }

        function endResize() {
            isResizingLeft = false;
            isResizingRight = false;
            isResizingUsage = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }

        function beginResize(e, axis) {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            if (axis === 'col') {
                document.body.style.cursor = 'col-resize';
            } else {
                document.body.style.cursor = 'row-resize';
            }
            document.body.style.userSelect = 'none';
            e.target.setPointerCapture(e.pointerId);
            return true;
        }

        resizerLeft.addEventListener('pointerdown', function (e) {
            if (!beginResize(e, 'col')) return;
            isResizingLeft = true;
        });

        resizerLeft.addEventListener('pointermove', handleResizePointerMove);
        resizerLeft.addEventListener('pointerup', endResize);
        resizerLeft.addEventListener('pointercancel', endResize);

        resizerRight.addEventListener('pointerdown', function (e) {
            if (!beginResize(e, 'col')) return;
            isResizingRight = true;
        });

        resizerRight.addEventListener('pointermove', handleResizePointerMove);
        resizerRight.addEventListener('pointerup', endResize);
        resizerRight.addEventListener('pointercancel', endResize);

        if (resizerUsage) {
            resizerUsage.addEventListener('pointerdown', function (e) {
                if (!beginResize(e, 'row')) return;
                isResizingUsage = true;
            });

            resizerUsage.addEventListener('pointermove', handleResizePointerMove);
            resizerUsage.addEventListener('pointerup', endResize);
            resizerUsage.addEventListener('pointercancel', endResize);
        }
    }

    // Watch the 640px boundary so layout-facing state (and CodeMirror measurement)
    // is re-applied whenever the viewport crosses it. Applies once on initial load.
    function updateViewVisibility() {
        const mq = window.matchMedia('(min-width: 640px)');

        function applyViewVisibility() {
            // Clear any stale drag state left behind by an interrupted resize
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            // CodeMirror must re-measure and pick the right scrollbar mode when
            // the layout changes across the boundary
            editor.setOption('scrollbarStyle', window.matchMedia('(max-width: 639.98px)').matches ? 'null' : 'native');
            editor.refresh();
        }

        applyViewVisibility();

        if (typeof mq.addEventListener === 'function') {
            mq.addEventListener('change', applyViewVisibility);
        } else if (typeof mq.addListener === 'function') {
            mq.addListener(applyViewVisibility);
        }

        // Any resize can reflow the editor (e.g. rotate within the same breakpoint)
        let resizeTimer = null;
        const refreshOnResize = function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () {
                editor.refresh();
            }, 150);
        };
        window.addEventListener('resize', refreshOnResize);
        window.addEventListener('orientationchange', refreshOnResize);
    }

    // Keep usage resizer hidden while the usage panel is hidden
    function syncUsageResizer() {
        const usageStrip = document.getElementById('usageStrip');
        const resizerUsage = document.getElementById('resizerUsage');
        if (usageStrip && resizerUsage) {
            resizerUsage.hidden = usageStrip.hidden;
        }
    }

    // Run initial analysis with default code
    setTimeout(analyze, 500);
});
