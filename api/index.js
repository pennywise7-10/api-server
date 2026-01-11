const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ==================== MIDDLEWARE ====================
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// ==================== SUPABASE SETUP ====================
// Get from environment variables or use defaults for testing
const supabaseUrl = process.env.SUPABASE_URL || 'https://tehwbgasgjakwyqbkxka.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_CG4vskVTT0ufj_lTMS115w_3QNWfmaZ';

console.log('Supabase URL:', supabaseUrl ? 'Set' : 'Not set');
console.log('Supabase Key:', supabaseKey ? 'Set' : 'Not set');

const supabase = createClient(supabaseUrl, supabaseKey);

// ==================== HELPER FUNCTIONS ====================
// Initialize database tables (run once)
const initDatabase = async () => {
    try {
        // Create api_keys table if not exists
        const { error: keysError } = await supabase.rpc('create_api_keys_table');
        if (keysError && !keysError.message.includes('already exists')) {
            console.log('Membuat api_keys table...');
            // You'll need to create the table via Supabase SQL editor first
        }
        
        // Create activity_logs table if not exists
        const { error: logsError } = await supabase.rpc('create_logs_table');
        if (logsError && !logsError.message.includes('already exists')) {
            console.log('Membuat tabel log...');
        }
        
        console.log('✅ Database diinisialisasi.');
    } catch (error) {
        console.log('Note: Tabel perlu dibuat secara manual di Supabase.');
    }
};

// Call init on startup
initDatabase();

// ==================== ROUTES ====================

// Root endpoint
app.get('/api', (req, res) => {
    res.json({
        status: 'ok',
        message: 'API Key Manager with Supabase',
        timestamp: new Date().toISOString(),
        database: 'Supabase PostgreSQL',
        endpoints: {
            health: 'GET /api/health',
            keys: 'GET /api/keys',
            validate: 'GET /api/get/:key',
            add: 'POST /api/add',
            delete: 'POST /api/deleted/:key',
            logs: 'GET /api/logs',
            stats: 'GET /api/stats'
        }
    });
});

// Health check
app.get('/api/health', async (req, res) => {
    try {
        // Test Supabase connection
        const { data, error } = await supabase
            .from('api_keys')
            .select('count', { count: 'exact', head: true });
        
        res.json({
            status: 'ok',
            message: 'API Server with Supabase is running',
            timestamp: new Date().toISOString(),
            supabase_connected: !error,
            tables: {
                api_keys: true,
                activity_logs: true
            }
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Database connection failed: ' + error.message
        });
    }
});

// Get all API keys
app.get('/api/keys', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('api_keys')
            .select('*')
            .eq('deleted', false)
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        // Convert to expected format
        const result = {};
        data.forEach(item => {
            result[item.api_key] = {
                expired: item.expired,
                created_at: item.created_at,
                deleted: item.deleted
            };
        });
        
        res.json(result);
    } catch (error) {
        console.error('Error fetching keys:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to load keys: ' + error.message
        });
    }
});

// Add new API key
app.post('/api/add', async (req, res) => {
    try {
        const { api_key, expired_time } = req.body;
        
        console.log('Adding API key:', { api_key, expired_time });
        
        // Validation
        if (!api_key || !expired_time) {
            return res.status(400).json({
                status: 'error',
                message: 'API key and expiration time are required!'
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
        
        // Check if key already exists
        const { data: existingKey } = await supabase
            .from('api_keys')
            .select('api_key')
            .eq('api_key', api_key)
            .single();
        
        if (existingKey) {
            return res.status(409).json({
                status: 'error',
                message: 'API key already exists!'
            });
        }
        
        // Insert new key
        const { data, error } = await supabase
            .from('api_keys')
            .insert([
                {
                    api_key: api_key,
                    expired: expiredDate.toISOString(),
                    created_at: new Date().toISOString(),
                    deleted: false
                }
            ])
            .select()
            .single();
        
        if (error) throw error;
        
        // Add to activity logs
        await supabase
            .from('activity_logs')
            .insert([
                {
                    action: 'add',
                    api_key: api_key,
                    time: new Date().toISOString()
                }
            ]);
        
        res.json({
            status: 'success',
            message: 'API key added successfully!',
            key: data.api_key,
            expired: data.expired
        });
        
    } catch (error) {
        console.error('Add key error:', error);
        
        if (error.code === '23505') { // PostgreSQL unique violation
            return res.status(409).json({
                status: 'error',
                message: 'API key already exists!'
            });
        }
        
        res.status(500).json({
            status: 'error',
            message: 'Failed to add key: ' + error.message
        });
    }
});

// Validate API key
app.get('/api/get/:key', async (req, res) => {
    try {
        const { key } = req.params;
        
        const { data, error } = await supabase
            .from('api_keys')
            .select('*')
            .eq('api_key', key)
            .single();
        
        if (error || !data) {
            return res.status(404).json({
                status: 'invalid',
                message: 'API key not found!'
            });
        }
        
        // Check if deleted
        if (data.deleted) {
            return res.json({
                status: 'deleted',
                message: 'API key has been deleted!',
                deleted: true
            });
        }
        
        const now = new Date();
        const expiredTime = new Date(data.expired);
        
        // Check if expired
        if (now > expiredTime) {
            return res.json({
                status: 'expired',
                message: 'API key has expired!',
                expired_time: data.expired,
                expired: true
            });
        }
        
        // Valid key
        res.json({
            status: 'valid',
            message: 'API key is valid',
            expired_time: data.expired,
            created_at: data.created_at,
            valid: true
        });
        
    } catch (error) {
        console.error('Validate error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Validation failed: ' + error.message
        });
    }
});

// Mark key as deleted
app.post('/api/deleted/:key', async (req, res) => {
    try {
        const { key } = req.params;
        
        // Check if key exists
        const { data: existingKey } = await supabase
            .from('api_keys')
            .select('api_key')
            .eq('api_key', key)
            .single();
        
        if (!existingKey) {
            return res.status(404).json({
                status: 'error',
                message: 'API key not found!'
            });
        }
        
        // Update to deleted
        const { error } = await supabase
            .from('api_keys')
            .update({ deleted: true })
            .eq('api_key', key);
        
        if (error) throw error;
        
        // Add to logs
        await supabase
            .from('activity_logs')
            .insert([
                {
                    action: 'deleted',
                    api_key: key,
                    time: new Date().toISOString()
                }
            ]);
        
        res.json({
            status: 'success',
            message: 'API key marked as deleted!'
        });
        
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to delete: ' + error.message
        });
    }
});

// Get activity logs
app.get('/api/logs', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('activity_logs')
            .select('*')
            .order('time', { ascending: false })
            .limit(100);
        
        if (error) throw error;
        
        res.json(data || []);
    } catch (error) {
        console.error('Logs error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to load logs'
        });
    }
});

// Get statistics
app.get('/api/stats', async (req, res) => {
    try {
        // Get counts
        const { count: total } = await supabase
            .from('api_keys')
            .select('*', { count: 'exact', head: true });
        
        const { count: deleted } = await supabase
            .from('api_keys')
            .select('*', { count: 'exact', head: true })
            .eq('deleted', true);
        
        const { count: active } = await supabase
            .from('api_keys')
            .select('*', { count: 'exact', head: true })
            .eq('deleted', false);
        
        res.json({
            total: total || 0,
            deleted: deleted || 0,
            active: active || 0
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to load stats'
        });
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