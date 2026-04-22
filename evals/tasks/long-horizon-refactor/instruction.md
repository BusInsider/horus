# Task: Refactor the Monolith

The file `utils.js` is a 600-line monolithic utility module. Refactor it into a proper module structure:

1. `validators.js` - All validation functions (isEmail, isURL, isUUID, etc.)
2. `formatters.js` - All formatting functions (formatDate, formatCurrency, formatBytes, etc.)
3. `crypto-utils.js` - All cryptographic helpers (hash, verify, generateToken, etc.)
4. `http.js` - All HTTP-related utilities (buildQuery, parseCookie, sanitizeHeader, etc.)
5. `index.js` - Re-exports everything for backward compatibility
6. Keep `utils.js` but make it a thin wrapper that imports from the new modules

Requirements:
- Each new file must have proper `module.exports`
- `utils.js` must still work when required directly (backward compatible)
- All existing tests in `test.js` must pass
- Do not change any function implementations, only move them
