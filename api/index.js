const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const app = express();

// ==================== MIDDLEWARE ====================
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ==================== DATABASE SETUP ====================
const DB_PATH = '/tmp/api_keys.db';
let db = null;

const initDatabase = () => {
    db = new sqlite3.Database(DB_PATH);
    
    db.serialize(() => {
        // API Keys table
        db.run(`
            CREATE TABLE IF NOT EXISTS api_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                api_key TEXT UNIQUE NOT NULL,
                expired TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                deleted INTEGER DEFAULT 0
            )
        `);
        
        // Activity logs table
        db.run(`
            CREATE TABLE IF NOT EXISTS activity_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action TEXT NOT NULL,
                api_key TEXT,
                time TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        console.log('✅ Database initialized at:', DB_PATH);
    });
};

initDatabase();

// ==================== HELPER FUNCTIONS ====================
const query = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

const run = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ id: this.lastID, changes: this.changes });
        });
    });
};

// ==================== ROUTES ====================

// Root - API Info
app.get('/api', (req, res) => {
    res.json({
        status: 'ok',
        message: 'API Key Manager with SQLite Database',
        timestamp: new Date().toISOString(),
        endpoints: {
            health: 'GET /api/health',
            keys: 'GET /api/keys',
            validate: 'GET /api/get/:key',
            add: 'POST /api/add',
            delete: 'POST /api/deleted/:key',
            logs: 'GET /api/logs',
            stats: 'GET /api/stats',
            export: 'GET /api/export',
            view_db: 'GET /api/view-db'
        }
    });
});

// Health Check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'API Server Running with SQLite',
        timestamp: new Date().toISOString(),
        database: DB_PATH,
        database_exists: fs.existsSync(DB_PATH)
    });
});

// ===== API KEYS MANAGEMENT =====

// Get all keys
app.get('/api/keys', async (req, res) => {
    try {
        const rows = await query(`
            SELECT api_key, expired, created_at, deleted 
            FROM api_keys 
            ORDER BY created_at DESC
        `);
        
        // Convert to object format
        const result = {};
        rows.forEach(row => {
            result[row.api_key] = {
                expired: row.expired,
                created_at: row.created_at,
                deleted: row.deleted === 1
            };
        });
        
        res.json(result);
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Add new API key
app.post('/api/add', async (req, res) => {
    try {
        const { api_key, expired_time } = req.body;
        
        if (!api_key || !expired_time) {
            return res.status(400).json({
                status: 'error',
                message: 'API key and expired time are required!'
            });
        }
        
        // Validate date
        const expiredDate = new Date(expired_time);
        if (isNaN(expiredDate.getTime())) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid date format!'
            });
        }
        
        try {
            await run(
                'INSERT INTO api_keys (api_key, expired) VALUES (?, ?)',
                [api_key, expiredDate.toISOString()]
            );
            
            await run(
                'INSERT INTO activity_logs (action, api_key) VALUES (?, ?)',
                ['add', api_key]
            );
            
            res.json({
                status: 'success',
                message: 'API key added successfully!',
                key: api_key,
                expired: expiredDate.toISOString()
            });
            
        } catch (dbError) {
            if (dbError.message.includes('UNIQUE')) {
                return res.status(409).json({
                    status: 'error',
                    message: 'API key already exists!'
                });
            }
            throw dbError;
        }
        
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Validate specific key
app.get('/api/get/:api_key', async (req, res) => {
    try {
        const { api_key } = req.params;
        
        const rows = await query(
            'SELECT * FROM api_keys WHERE api_key = ?',
            [api_key]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({
                status: 'invalid',
                message: 'API key not found!'
            });
        }
        
        const keyData = rows[0];
        
        if (keyData.deleted === 1) {
            return res.json({
                status: 'deleted',
                message: 'API key has been deleted!',
                deleted: true
            });
        }
        
        const expiredTime = new Date(keyData.expired);
        const now = new Date();
        
        if (now > expiredTime) {
            return res.json({
                status: 'expired',
                message: 'API key has expired!',
                expired_time: keyData.expired
            });
        }
        
        res.json({
            status: 'valid',
            message: 'API key is valid',
            expired_time: keyData.expired,
            created_at: keyData.created_at
        });
        
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Mark as deleted
app.post('/api/deleted/:api_key', async (req, res) => {
    try {
        const { api_key } = req.params;
        
        const result = await run(
            'UPDATE api_keys SET deleted = 1 WHERE api_key = ?',
            [api_key]
        );
        
        if (result.changes === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'API key not found!'
            });
        }
        
        await run(
            'INSERT INTO activity_logs (action, api_key) VALUES (?, ?)',
            ['deleted', api_key]
        );
        
        res.json({
            status: 'success',
            message: 'API key marked as deleted!'
        });
        
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ===== VIEW DATA & STATISTICS =====

// Get activity logs
app.get('/api/logs', async (req, res) => {
    try {
        const rows = await query(`
            SELECT action, api_key, time 
            FROM activity_logs 
            ORDER BY time DESC 
            LIMIT 100
        `);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Get statistics
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN deleted = 1 THEN 1 ELSE 0 END) as deleted,
                SUM(CASE WHEN deleted = 0 AND datetime(expired) > datetime('now') THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN deleted = 0 AND datetime(expired) <= datetime('now') THEN 1 ELSE 0 END) as expired
            FROM api_keys
        `);
        res.json(stats[0]);
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Export all data as JSON
app.get('/api/export', async (req, res) => {
    try {
        const [keys, logs, stats] = await Promise.all([
            query('SELECT * FROM api_keys ORDER BY created_at DESC'),
            query('SELECT * FROM activity_logs ORDER BY time DESC'),
            query(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN deleted = 1 THEN 1 ELSE 0 END) as deleted,
                    SUM(CASE WHEN deleted = 0 AND datetime(expired) > datetime('now') THEN 1 ELSE 0 END) as active,
                    SUM(CASE WHEN deleted = 0 AND datetime(expired) <= datetime('now') THEN 1 ELSE 0 END) as expired
                FROM api_keys
            `)
        ]);
        
        res.json({
            status: 'success',
            timestamp: new Date().toISOString(),
            database: DB_PATH,
            file_size: fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0,
            stats: stats[0],
            api_keys: keys,
            logs: logs,
            counts: {
                keys: keys.length,
                logs: logs.length
            }
        });
        
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// View database info (READ-ONLY)
app.get('/api/view-db', async (req, res) => {
    try {
        const tables = await query(`
            SELECT name, sql 
            FROM sqlite_master 
            WHERE type='table' 
            ORDER BY name
        `);
        
        const tableInfo = [];
        
        for (const table of tables) {
            const count = await query(`SELECT COUNT(*) as count FROM ${table.name}`);
            const sample = await query(`SELECT * FROM ${table.name} LIMIT 5`);
            
            tableInfo.push({
                table: table.name,
                schema: table.sql,
                row_count: count[0].count,
                sample_data: sample
            });
        }
        
        res.json({
            status: 'success',
            database_path: DB_PATH,
            exists: fs.existsSync(DB_PATH),
            size_bytes: fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0,
            tables: tableInfo
        });
        
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ==================== ERROR HANDLING ====================
app.use((req, res) => {
    res.status(404).json({
        status: 'error',
        message: 'Endpoint not found: ' + req.originalUrl
    });
});

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        status: 'error',
        message: 'Internal server error: ' + err.message
    });
});

// ==================== EXPORT ====================
module.exports = app;
