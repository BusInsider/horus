# Task: Refactor Nested Conditionals

The file `src/auth.js` has deeply nested conditionals that are hard to read and maintain. 

Steps:
1. View `src/auth.js` to understand the current logic
2. Edit `src/auth.js` to use early returns and flatten the nesting
3. Run `node test/auth.test.js` to verify behavior is preserved

Requirements:
- No nested `if` blocks deeper than 2 levels
- All original conditions must still be checked in the same order
- All return values must be identical for every input combination
- Do NOT change the function signatures
- If tests fail, edit the file again until all tests pass
