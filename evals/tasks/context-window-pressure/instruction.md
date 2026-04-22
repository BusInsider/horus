# Task: Add Logging to the Payment Flow

The payment processing flow has 3 key files that need structured logging added. Find them and add a `logger.info()` call at the start of each key function:

1. The function that validates payment cards
2. The function that processes the actual charge
3. The function that sends the payment receipt

Use the existing `logger.js` module. Do NOT modify any other files.

The key functions are named `validateCard`, `processCharge`, and `sendReceipt` respectively, but they might be in files with similar names to unrelated functions.
