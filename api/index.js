const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();

// ==================== MIDDLEWARE ====================
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.options('*', cors());

// ==================== FILE PATHS ====================
// GUNAKAN /tmp/ untuk writable files di Vercel
const DATA_FILE = '/tmp/api_data.json';
const LOG_FILE = '/tmp/api_log.json';

// ==================== HELPER FUNCTIONS ====================
const initializeFiles = () => {
    console.log('Initializing files in /tmp/ directory');
    console.log('DATA_FILE:', DATA_FILE);
    console.log('LOG_FILE:', LOG_FILE);
    
    // Cek jika file sudah ada
    if (!fs.existsSync(DATA_FILE)) {
        console.log('Creating empty data file');
        fs.writeFileSync(DATA_FILE, JSON.stringify({}));
    }
    
    if (!fs.existsSync(LOG_FILE)) {
        console.log('Creating empty log file');
        fs.writeFileSync(LOG_FILE, JSON.stringify([]));
    }
};

// Initialize files saat server start
initializeFiles();

const loadData = () => {
    try {
        console.log('Loading data from:', DATA_FILE);
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        const parsed = JSON.parse(data);
        console.log('Loaded', Object.keys(parsed).length, 'keys');
        return parsed;
    } catch (error) {
        console.error('Error loading data:', error);
        return {};
    }
};

const saveData = (data) => {
    try {
        console.log('Saving data to:', DATA_FILE);
        console.log('Data to save:', Object.keys(data).length, 'keys');
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        console.log('Data saved successfully');
        return true;
    } catch (error) {
        console.error('Error saving data:', error);
        console.error('Error details:', error.message, error.code);
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
        fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
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

// Root API endpoint
app.get('/api', (req, res) => {
    res.json({
        status: 'ok',
        message: 'API Key Management System',
        timestamp: new Date().toISOString(),
        storage: 'Using /tmp/ directory for data persistence',
        endpoints: {
            health: '/api/health',
            keys: '/api/keys',
            validate: 'GET /api/get/:api_key',
            add: 'POST /api/add',
            mark_deleted: 'POST /api/deleted/:api_key',
            delete: 'DELETE /api/delete/:api_key',
            logs: '/api/logs'
        }
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'API is running',
        timestamp: new Date().toISOString(),
        storage_path: DATA_FILE,
        storage_writable: fs.existsSync('/tmp') ? 'yes' : 'no'
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
            message: 'Failed to load keys: ' + error.message
        });
    }
});

// Add new API key
app.post('/api/add', (req, res) => {
    console.log('=== ADD API KEY REQUEST ===');
    console.log('Body received:', req.body);
    
    try {
        const { api_key, expired_time } = req.body;
        
        if (!api_key || !expired_time) {
            console.log('Validation failed: Missing fields');
            return res.status(400).json({
                status: 'error',
                message: 'API key and expired time are required!'
            });
        }
        
        // Validate date format
        const expiredDate = new Date(expired_time);
        if (isNaN(expiredDate.getTime())) {
            console.log('Validation failed: Invalid date format');
            return res.status(400).json({
                status: 'error',
                message: 'Invalid date format!'
            });
        }
        
        const data = loadData();
        console.log('Current data keys:', Object.keys(data).length);
        
        // Check if key already exists
        if (data[api_key]) {
            console.log('Key already exists');
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
        
        console.log('Attempting to save data...');
        
        // Save data
        if (!saveData(data)) {
            console.log('Save failed');
            return res.status(500).json({
                status: 'error',
                message: 'Failed to save data to storage'
            });
        }
        
        // Add log
        addLog('add', api_key);
        console.log('Key added successfully:', api_key);
        
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
            message: 'Internal server error: ' + error.message
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
        
        if (keyData.deleted) {
            return res.json({
                status: 'deleted',
                message: 'API key has been marked as deleted!',
                deleted: true
            });
        }
        
        const expiredTime = new Date(keyData.expired);
        const now = new Date();
        
        if (now > expiredTime) {
            return res.json({
                status: 'expired',
                message: 'API key has expired!',
                expired_time: keyData.expired,
                expired: true
            });
        }
        
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
        
        data[api_key].deleted = true;
        
        if (!saveData(data)) {
            return res.status(500).json({
                status: 'error',
                message: 'Failed to save data'
            });
        }
        
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
        
        delete data[api_key];
        
        if (!saveData(data)) {
            return res.status(500).json({
                status: 'error',
                message: 'Failed to save data'
            });
        }
        
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

// ==================== VERCEL EXPORT ====================
module.exports = app;
