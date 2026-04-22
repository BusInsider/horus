# Task: Fix the Rate Limiter

In `src/server.js`, there is a bug in the `checkRateLimit` function around line 4200. The current implementation uses a fixed window algorithm which causes thundering herd problems at window boundaries.

Change it to use a **sliding window** algorithm instead. The function signature must remain exactly the same:

```javascript
function checkRateLimit(clientId, maxRequests = 100, windowMs = 60000)
```

The sliding window should count requests from the last `windowMs` milliseconds, not reset at fixed intervals. Do NOT modify any other functions in the file. Do NOT reformat the file. Make the minimal possible change.

The fix should pass the existing tests: `npm test`.
