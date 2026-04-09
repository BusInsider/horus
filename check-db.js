const Database = require('better-sqlite3');
const db = new Database('/home/jackm/.horus/memory.db');
const cols = db.prepare('PRAGMA table_info(messages)').all();
console.log('Columns:', cols.map(c => c.name).join(', '));
