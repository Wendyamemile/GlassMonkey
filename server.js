const http = require('http');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'glassmonkey.db');

// Initialize SQLite Database
const db = new DatabaseSync(DB_PATH);

// Create database tables if they do not exist
db.exec(`
    CREATE TABLE IF NOT EXISTS appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT,
        vehicle TEXT NOT NULL,
        service TEXT NOT NULL,
        service_date TEXT NOT NULL,
        time_slot TEXT NOT NULL,
        location_type TEXT NOT NULL,
        address TEXT,
        zip TEXT,
        status TEXT DEFAULT 'Pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        subject TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

console.log('Database initialized at:', DB_PATH);

// Helper to parse JSON request body
function parseJSON(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}

// Helper to send JSON responses
function sendJSON(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS'
    });
    res.end(JSON.stringify(data));
}

// MIME types for static file serving
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
    // Handle CORS preflight options
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS'
        });
        return res.end();
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;

    // REST API ROUTES
    
    // 1. POST /api/book - Create new appointment booking
    if (req.method === 'POST' && pathname === '/api/book') {
        try {
            const data = await parseJSON(req);
            const { name, phone, email, vehicle, service, service_date, time_slot, location_type, address, zip } = data;

            if (!name || !phone || !service || !service_date || !time_slot || !location_type) {
                return sendJSON(res, 400, { error: 'Missing required booking fields' });
            }

            const stmt = db.prepare(`
                INSERT INTO appointments (name, phone, email, vehicle, service, service_date, time_slot, location_type, address, zip, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')
            `);

            const result = stmt.run(
                name,
                phone,
                email || '',
                vehicle || 'Vehicle Unspecified',
                service,
                service_date,
                time_slot,
                location_type,
                address || '',
                zip || ''
            );

            const insertedId = result.lastInsertRowid;
            const newBooking = db.prepare('SELECT * FROM appointments WHERE id = ?').get(insertedId);

            console.log(`[BOOKING CREATED] ID: ${insertedId} | Customer: ${name} | Service: ${service}`);
            return sendJSON(res, 201, { success: true, booking: newBooking });

        } catch (error) {
            console.error('Error creating booking:', error);
            return sendJSON(res, 500, { error: 'Failed to process booking submission' });
        }
    }

    // 2. GET /api/admin/appointments - Retrieve all appointments for Admin Dashboard
    if (req.method === 'GET' && pathname === '/api/admin/appointments') {
        try {
            const appointments = db.prepare('SELECT * FROM appointments ORDER BY id DESC').all();
            return sendJSON(res, 200, { success: true, appointments });
        } catch (error) {
            console.error('Error fetching appointments:', error);
            return sendJSON(res, 500, { error: 'Failed to retrieve appointments' });
        }
    }

    // 3. PATCH /api/admin/appointments/:id - Update appointment status
    if (req.method === 'PATCH' && pathname.startsWith('/api/admin/appointments/')) {
        try {
            const id = pathname.split('/').pop();
            const data = await parseJSON(req);
            const { status } = data;

            if (!status) {
                return sendJSON(res, 400, { error: 'Missing status field' });
            }

            const stmt = db.prepare('UPDATE appointments SET status = ? WHERE id = ?');
            stmt.run(status, id);

            const updated = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
            return sendJSON(res, 200, { success: true, booking: updated });
        } catch (error) {
            console.error('Error updating appointment status:', error);
            return sendJSON(res, 500, { error: 'Failed to update status' });
        }
    }

    // 4. DELETE /api/admin/appointments/:id - Delete appointment
    if (req.method === 'DELETE' && pathname.startsWith('/api/admin/appointments/')) {
        try {
            const id = pathname.split('/').pop();
            const stmt = db.prepare('DELETE FROM appointments WHERE id = ?');
            stmt.run(id);
            return sendJSON(res, 200, { success: true, message: 'Appointment deleted successfully' });
        } catch (error) {
            console.error('Error deleting appointment:', error);
            return sendJSON(res, 500, { error: 'Failed to delete appointment' });
        }
    }

    // 5. POST /api/contact - Submit direct message
    if (req.method === 'POST' && pathname === '/api/contact') {
        try {
            const data = await parseJSON(req);
            const { name, email, phone, subject, message } = data;

            if (!name || !email || !message) {
                return sendJSON(res, 400, { error: 'Missing required contact fields' });
            }

            const stmt = db.prepare(`
                INSERT INTO messages (name, email, phone, subject, message)
                VALUES (?, ?, ?, ?, ?)
            `);

            stmt.run(name, email, phone || '', subject || 'General Inquiry', message);
            return sendJSON(res, 201, { success: true, message: 'Inquiry saved successfully' });
        } catch (error) {
            console.error('Error processing contact message:', error);
            return sendJSON(res, 500, { error: 'Failed to process inquiry' });
        }
    }

    // 6. GET /api/admin/messages - Retrieve direct messages
    if (req.method === 'GET' && pathname === '/api/admin/messages') {
        try {
            const messages = db.prepare('SELECT * FROM messages ORDER BY id DESC').all();
            return sendJSON(res, 200, { success: true, messages });
        } catch (error) {
            return sendJSON(res, 500, { error: 'Failed to fetch messages' });
        }
    }

    // 7. DELETE /api/admin/messages/:id - Delete direct customer message
    if (req.method === 'DELETE' && pathname.startsWith('/api/admin/messages/')) {
        try {
            const id = pathname.split('/').pop();
            const stmt = db.prepare('DELETE FROM messages WHERE id = ?');
            stmt.run(id);
            return sendJSON(res, 200, { success: true, message: 'Customer message deleted successfully' });
        } catch (error) {
            console.error('Error deleting message:', error);
            return sendJSON(res, 500, { error: 'Failed to delete message' });
        }
    }

    // STATIC FILE SERVER
    let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

    // Prevent directory traversal
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        return res.end('Access Denied');
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            return res.end('<h1>404 Not Found</h1>');
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    });
});

server.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`🚀 GlassMonkey Express Server Running on Port ${PORT}`);
    console.log(`🌐 Website: http://localhost:${PORT}`);
    console.log(`🔐 Admin Dashboard: http://localhost:${PORT}/admin.html`);
    console.log(`==================================================`);
});
