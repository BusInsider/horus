# Task: Multi-File Refactoring

You have 3 JavaScript files that all have duplicated logging logic. Refactor them to use a shared `logger.js` utility:

1. Create `utils/logger.js` with a `log(message)` function
2. Update `file1.js`, `file2.js`, and `file3.js` to import and use the shared logger
3. Remove the duplicated `console.log` statements from each file

The files are in the current directory.
