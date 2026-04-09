const Database = require('better-sqlite3');
const db = new Database('/home/jackm/.horus/memory.db');
const rows = db.prepare('SELECT * FROM messages ORDER BY created_at').all();
for (const row of rows) {
  console.log(`[${row.role}] reasoning_content: "${row.reasoning_content}" tool_calls: ${row.tool_calls ? 'yes' : 'no'}`);
}
