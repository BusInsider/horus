# Technical Debt Breakdown

## 1. Unused Variables (37 remaining)

These are mostly:
- Unused imports (homedir, join, etc.)
- Function parameters that aren't used
- Variables declared but never referenced

**Fix**: Prefix with _ or remove

## 2. Explicit any Types (25 remaining)

These are in:
- checkpoint.ts - Database result rows
- cli-enhanced.ts - Database queries
- github/review.ts - Tool arguments
- 	ools/ - Tool argument parsing
- memory/ - Embedding cache items

**Why they exist**: 
- Database rows come back as ny
- Tool arguments are dynamic JSON
- Some external APIs lack types

**Fix strategy**:
- Define proper interfaces for database rows
- Use unknown instead of ny where possible
- Add type guards for dynamic data

## 3. Non-null Assertions (40+ remaining)

These look like: alue!.property

**Why they exist**:
- We know something exists but TypeScript doesn't
- After null checks, TypeScript still complains
- External API returns might be null

**Fix strategy**:
- Use optional chaining: alue?.property
- Add proper null checks with early returns
- Use type guards

## Priority

**High** (fix now):
- Unused imports in core files
- any types in public APIs

**Medium** (fix gradually):
- Non-null assertions that could crash
- any types in internal utilities

**Low** (cosmetic):
- Unused function parameters with _ prefix
- any types in test files
