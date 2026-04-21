# Task: Refactor the User Type

The `User` interface in `src/models/user.ts` currently has `id` as a `number`. 

Change it to a `string` (UUID format) and update ALL files that reference the `User` type or use `.id` as a number. This includes:
- `src/models/user.ts`
- `src/services/user-service.ts`
- `src/api/routes.ts`
- `src/db/repository.ts`
- `test/user.test.ts`

Make sure type consistency is maintained across the entire codebase. Run the TypeScript compiler to verify.
