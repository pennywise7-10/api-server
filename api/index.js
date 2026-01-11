const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== MIDDLEWARE ====================
// FIX CORS - Izinkan semua origin
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Handle CORS preflight requests
app.options('*', cors());

// Serve static files from public folder
app.use(express.static(path.join(__dirname, '../public')));

// ==================== FILE PATHS ====================
const DATA_FILE = path.join(__dirname, 'data.json');
const LOG_FILE = path.join(__dirname, 'log.json');

// ==================== HELPER FUNCTIONS ====================
// Initialize files if not exist
const initializeFiles = () => {
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify({}));
        console.log('Created data.json');
    }
    
    if (!fs.existsSync(LOG_FILE)) {
        fs.writeFileSync(LOG_FILE, JSON.stringify([]));
        console.log('Created log.json');
    }
};

initializeFiles();

const loadData = () => {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading data:', error);
        return {};
    }
};

const saveData = (data) => {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4));
        return true;
    } catch (error) {
        console.error('Error saving data:', error);
        return false;
    }
};

const loadLog = () => {
    try {
        const log = fs.readFileSync(LOG_FILE, 'utf8');
        return JSON.parse(log);
    } catch (error) {
        console.error('Error loading log:', error);
        return [];
    }
};

const saveLog = (log) => {
    try {
        fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 4));
        return true;
    } catch (error) {
        console.error('Error saving log:', error);
        return false;
    }
};

const addLog = (action, apiKey) => {
    try {
        const log = loadLog();
        log.push({
            action: action,
            api_key: apiKey,
            time: new Date().toISOString()
        });
        
        // Keep only last 100 logs
        if (log.length > 100) {
            log.splice(0, log.length - 100);
        }
        
        saveLog(log);
        return true;
    } catch (error) {
        console.error('Error adding log:', error);
        return false;
    }
};

// ==================== ROUTES ====================

// Root route - serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Log page - serve log.html
app.get('/log', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/log.html'));
});

// ==================== API ROUTES ====================

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'API is running',
        timestamp: new Date().toISOString()
    });
});

// Get all keys
app.get('/api/keys', (req, res) => {
    try {
        const data = loadData();
        res.json(data);
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to load keys'
        });
    }
});

// Add new API key
app.post('/api/add', (req, res) => {
    try {
        const { api_key, expired_time } = req.body;
        
        console.log('Received add request:', { api_key, expired_time });
        
        // Validation
        if (!api_key || !expired_time) {
            return res.status(400).json({
                status: 'error',
                message: 'API key and expired time are required!'
            });
        }
        
        // Validate date format
        const expiredDate = new Date(expired_time);
        if (isNaN(expiredDate.getTime())) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid date format!'
            });
        }
        
        const data = loadData();
        
        // Check if key already exists
        if (data[api_key]) {
            return res.status(409).json({
                status: 'error',
                message: 'API key already exists!'
            });
        }
        
        // Add new key
        data[api_key] = {
            expired: expiredDate.toISOString(),
            created_at: new Date().toISOString(),
            deleted: false
        };
        
        // Save data
        if (!saveData(data)) {
            return res.status(500).json({
                status: 'error',
                message: 'Failed to save data'
            });
        }
        
        // Add log
        addLog('add', api_key);
        
        res.json({
            status: 'success',
            message: 'API key added successfully!',
            key: api_key,
            expired: data[api_key].expired
        });
        
    } catch (error) {
        console.error('Add key error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Internal server error'
        });
    }
});

// Validate/Get specific key
app.get('/api/get/:api_key', (req, res) => {
    try {
        const { api_key } = req.params;
        const data = loadData();
        const keyData = data[api_key];
        
        if (!keyData) {
            return res.status(404).json({
                status: 'invalid',
                message: 'API key not found!'
            });
        }
        
        // Check if deleted
        if (keyData.deleted) {
            return res.json({
                status: 'deleted',
                message: 'API key has been marked as deleted!',
                deleted: true
            });
        }
        
        const expiredTime = new Date(keyData.expired);
        const now = new Date();
        
        // Check if expired
        if (now > expiredTime) {
            return res.json({
                status: 'expired',
                message: 'API key has expired!',
                expired_time: keyData.expired,
                expired: true
            });
        }
        
        // Valid key
        res.json({
            status: 'valid',
            message: 'API key is valid',
            data: keyData,
            expired_time: keyData.expired,
            valid: true
        });
        
    } catch (error) {
        console.error('Get key error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Internal server error'
        });
    }
});

// Mark key as deleted
app.post('/api/deleted/:api_key', (req, res) => {
    try {
        const { api_key } = req.params;
        const data = loadData();
        
        if (!data[api_key]) {
            return res.status(404).json({
                status: 'error',
                message: 'API key not found!'
            });
        }
        
        // Mark as deleted
        data[api_key].deleted = true;
        
        if (!saveData(data)) {
            return res.status(500).json({
                status: 'error',
                message: 'Failed to save data'
            });
        }
        
        // Add log
        addLog('deleted', api_key);
        
        res.json({
            status: 'success',
            message: 'API key marked as deleted!'
        });
        
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Internal server error'
        });
    }
});

// Permanently delete key
app.delete('/api/delete/:api_key', (req, res) => {
    try {
        const { api_key } = req.params;
        const data = loadData();
        
        if (!data[api_key]) {
            return res.status(404).json({
                status: 'error',
                message: 'API key not found!'
            });
        }
        
        // Delete key
        delete data[api_key];
        
        if (!saveData(data)) {
            return res.status(500).json({
                status: 'error',
                message: 'Failed to save data'
            });
        }
        
        // Add log
        addLog('delete', api_key);
        
        res.json({
            status: 'success',
            message: 'API key permanently deleted!'
        });
        
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Internal server error'
        });
    }
});

// Get activity logs
app.get('/api/logs', (req, res) => {
    try {
        const logs = loadLog();
        res.json(logs);
    } catch (error) {
        console.error('Get logs error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to load logs'
        });
    }
});

// ==================== ERROR HANDLING ====================
// 404 handler
app.use((req, res) => {
    res.status(404).json({
        status: 'error',
        message: 'Endpoint not found'
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        status: 'error',
        message: 'Internal server error'
    });
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 API URL: http://localhost:${PORT}/api`);
    console.log(`📊 Web Interface: http://localhost:${PORT}`);
});
