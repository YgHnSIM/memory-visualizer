/* 
 * C Memory Visualizer - Comprehensive Test Suite
 * This code demonstrates all supported features and types.
 */

// 1. Primitive Types
char c = 'A';              // 1 byte
short s = -12345;          // 2 bytes
int i = 0x12345678;        // 4 bytes
long l = 1234567890L;      // 8 bytes (in this visualizer)
float f = 3.14159;         // 4 bytes
double d = 1.23456789;     // 8 bytes

// 2. Arrays
int numbers[5] = {10, 20, 30, 40, 50};
char str_fixed[10] = "Fixed";
char str_auto[] = "Flexible";

// 3. Struct Definitions
struct Point {
    int x;
    int y;
};

struct Person {
    int id;
    char name[];  // Flexible array member
};

// 4. Struct Initialization
struct Point p1 = {100, 200};
struct Person user = {1, "Alice"};

// 5. Pointers (The Magic)
// Basic pointer
int *ptr_i = &i;

// Array pointers & Decay
int *ptr_arr = numbers;         // Points to numbers[0]
char *ptr_str = str_auto;       // Points to 'F'

// Element pointer
int *ptr_elem = &numbers[2];    // Points to 30

// Struct pointers
int *ptr_member = &p1.y;        // Points to 200

// 6. Advanced
// Struct variable declaration (no init)
struct Point p2;

// Assignment after declaration
p2 = {300, 400};

// String literal parsing in assignment
struct Person boss;
boss = {99, "Boss"};

// Double pointer
int **pp_i = &ptr_i;
