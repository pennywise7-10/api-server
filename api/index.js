const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// File paths
const DATA_FILE = path.join(__dirname, 'data.json');
const LOG_FILE = path.join(__dirname, 'log.json');

// Initialize files if not exist
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({}));
}
if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, JSON.stringify([]));
}

// Helper functions
const loadData = () => {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return {};
    }
};

const saveData = (data) => {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4));
};

const loadLog = () => {
    try {
        const log = fs.readFileSync(LOG_FILE, 'utf8');
        return JSON.parse(log);
    } catch (error) {
        return [];
    }
};

const saveLog = (log) => {
    fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 4));
};

const addLog = (action, apiKey) => {
    const log = loadLog();
    log.push({
        action: action,
        api_key: apiKey,
        time: new Date().toISOString()
    });
    saveLog(log);
};

// Routes

// API Routes
app.get('/api/keys', (req, res) => {
    const data = loadData();
    res.json(data);
});

app.post('/api/add', (req, res) => {
    const { api_key, expired_time } = req.body;
    
    if (!api_key || !expired_time) {
        return res.json({ status: 'error', message: 'API key and expired time are required!' });
    }
    
    const data = loadData();
    
    if (data[api_key]) {
        return res.json({ status: 'error', message: 'API key already exists!' });
    }
    
    data[api_key] = {
        expired: expired_time,
        created_at: new Date().toISOString(),
        deleted: false
    };
    
    saveData(data);
    addLog('add', api_key);
    
    res.json({ status: 'success', message: 'API key added!' });
});

app.get('/api/get/:api_key', (req, res) => {
    const { api_key } = req.params;
    const data = loadData();
    const keyData = data[api_key];
    
    if (!keyData) {
        return res.json({ status: 'invalid', message: 'API key not found!' });
    }
    
    if (keyData.deleted) {
        return res.json({ status: 'deleted', message: 'API key has been marked as deleted!' });
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
        data: keyData,
        expired_time: keyData.expired
    });
});

app.post('/api/deleted/:api_key', (req, res) => {
    const { api_key } = req.params;
    const data = loadData();
    
    if (data[api_key]) {
        data[api_key].deleted = true;
        saveData(data);
        addLog('deleted', api_key);
        
        return res.json({ status: 'success', message: 'API key marked as deleted!' });
    }
    
    res.json({ status: 'error', message: 'API key not found!' });
});

app.delete('/api/delete/:api_key', (req, res) => {
    const { api_key } = req.params;
    const data = loadData();
    
    if (data[api_key]) {
        delete data[api_key];
        saveData(data);
        addLog('delete', api_key);
        
        return res.json({ status: 'success', message: 'API key deleted!' });
    }
    
    res.json({ status: 'error', message: 'API key not found!' });
});

app.get('/api/logs', (req, res) => {
    const logs = loadLog();
    res.json(logs);
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Access: http://localhost:${PORT}`);
});