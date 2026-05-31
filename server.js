const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

// Load environment variables
dotenv.config();

// 1. Terminal Log Buffer to Prevent Screen Freezing
const MAX_TERMINAL_LINES = 50;
const terminalBuffer = [];

function formatArgs(args) {
    return args.map(arg => {
        if (typeof arg === 'object' && arg !== null) {
            try {
                return JSON.stringify(arg);
            } catch (e) {
                return String(arg);
            }
        }
        return String(arg);
    }).join(' ');
}

function updateTerminalScreen() {
    // Clear console using ANSI sequences (supported in modern Windows CMD/PowerShell)
    process.stdout.write('\u001b[2J\u001b[0;0H');
    terminalBuffer.forEach(line => {
        process.stdout.write(line + '\n');
    });
}

function pushLog(formattedText) {
    terminalBuffer.push(formattedText);
    if (terminalBuffer.length > MAX_TERMINAL_LINES) {
        terminalBuffer.shift();
    }
    updateTerminalScreen();
}

console.log = (...args) => {
    pushLog(formatArgs(args));
};

console.warn = (...args) => {
    pushLog('\x1b[33m[WARN] ' + formatArgs(args) + '\x1b[0m');
};

console.error = (...args) => {
    pushLog('\x1b[31m[ERROR] ' + formatArgs(args) + '\x1b[0m');
};


const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// 1. Initialize SQLite Database
const dbDir = path.join(__dirname, 'database');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}
const dbPath = path.join(dbDir, 'polytrader.db');
console.log(`[Database] Veritabanı başlatılıyor: ${dbPath}`);

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');

// Execute SQL Schema
const schemaPath = path.join(dbDir, 'schema.sql');
if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schemaSql);
    console.log('[Database] Tablolar ve şema başarıyla yüklendi.');
    
    // Dynamic database migrations for Take Profit & Stop Loss
    try {
        db.exec('ALTER TABLE tracked_wallets ADD COLUMN take_profit_percentage REAL DEFAULT 0.0');
    } catch(e) {}
    try {
        db.exec('ALTER TABLE tracked_wallets ADD COLUMN stop_loss_percentage REAL DEFAULT 0.0');
    } catch(e) {}
    try {
        db.exec('ALTER TABLE copied_trades ADD COLUMN is_closed INTEGER DEFAULT 0');
    } catch(e) {}
} else {
    console.error('[Database] HATA: schema.sql bulunamadı!');
    process.exit(1);
}

// Initialize Default Settings in bot_settings if they don't exist
const defaultSettings = [
    { key: 'test_mode', value: '1' }, // 1 = Simulation mode, 0 = Live mainnet trading
    { key: 'scan_interval', value: '30' }, // seconds
    { key: 'slippage_tolerance', value: '5' }, // percent
    { key: 'daily_loss_limit', value: '500' }, // USDC
    { key: 'max_open_positions', value: '10' },
    { key: 'max_single_trade_usdc', value: '250' }, // USDC
    { key: 'emergency_stop', value: '0' }, // 1 = Active, 0 = Inactive
    { key: 'notification_success', value: '1' },
    { key: 'notification_fail', value: '1' },
    { key: 'notification_error', value: '1' },
    { key: 'telegram_bot_token', value: '' },
    { key: 'telegram_chat_id', value: '' },
    { key: 'private_key', value: '' },
    { key: 'default_tp', value: '0' },
    { key: 'default_sl', value: '0' },
    { key: 'copy_existing_trades', value: '0' }
];

const insertSettingStmt = db.prepare(`
    INSERT OR IGNORE INTO bot_settings (key, value)
    VALUES (?, ?)
`);

db.exec('BEGIN TRANSACTION');
try {
    defaultSettings.forEach(s => {
        insertSettingStmt.run(s.key, s.value);
    });
    db.exec('COMMIT');
} catch (e) {
    db.exec('ROLLBACK');
    throw e;
}

// 2. Initialize Services and Core Engines
const WalletService = require('./src/services/walletService');
const TradeService = require('./src/services/tradeService');
const NotificationService = require('./src/services/notificationService');
const CopyTrader = require('./src/bot/copyTrader');
const WalletMonitor = require('./src/bot/monitor');

const walletService = new WalletService(db);
const tradeService = new TradeService(db);
const notificationService = new NotificationService(db);

// Generate initial demo data for a stunning dashboard out of the box
tradeService.seedDemoData();

// 3. Initialize Express and HTTP Server
const app = express();
const server = http.createServer(app);

// Setup Socket.io
const io = new Server(server, {
    cors: {
        origin: 'http://localhost:' + PORT,
        methods: ['GET', 'POST']
    }
});

// Create CopyTrader and Monitor instances
const copyTrader = new CopyTrader(db, io, notificationService);
const monitor = new WalletMonitor(db, copyTrader, io);

// 4. Server Middleware Setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS configuration (allow localhost only for security)
app.use(cors({
    origin: NODE_ENV === 'production' ? false : true,
    credentials: true
}));

// Helmet security setup (configured to support CDN resources like Tailwind and Google Fonts)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "script-src": ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net"],
            "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            "font-src": ["'self'", "https://fonts.gstatic.com"],
            "img-src": ["'self'", "data:", "https://*"],
            "connect-src": ["'self'", "ws://localhost:" + PORT, "http://localhost:" + PORT, "https://*"]
        }
    }
}));

// Express Rate Limiter for APIs
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // Limit each IP to 100 requests per windowMs
    message: { error: 'Çok fazla istek gönderildi. Lütfen bir dakika sonra tekrar deneyin.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api', apiLimiter);

// 5. Mount Rotas
const apiRouter = require('./src/routes/api')({
    db,
    walletService,
    tradeService,
    notificationService,
    monitor,
    copyTrader
});
const dashboardRouter = require('./src/routes/dashboard');

// Static folder mapping
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', apiRouter);
app.use('/', dashboardRouter);

// 6. Socket.io handlers
io.on('connection', (socket) => {
    console.log(`[Socket.io] Yeni istemci bağlandı: ${socket.id}`);
    
    // Send immediate status upon connecting
    socket.emit('bot_status_changed', {
        status: monitor.isRunning ? 'running' : 'stopped',
        timestamp: new Date().toISOString()
    });

    socket.on('disconnect', () => {
        console.log(`[Socket.io] İstemci ayrıldı: ${socket.id}`);
    });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('[Server Error]:', err.message);
    res.status(500).json({ error: 'Sunucu tarafında kritik bir hata oluştu.' });
});

// 7. Start Server & Auto-Start Monitor
server.listen(PORT, () => {
    console.log('==================================================');
    console.log(`🚀 PolyTrader Sunucusu Çalışıyor!`);
    console.log(`🌐 Dashboard: http://localhost:${PORT}`);
    console.log(`📁 Ortam: ${NODE_ENV}`);
    console.log('==================================================');
    
    // Auto-start scanning loop
    monitor.start();
});

// Graceful Shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM alınıyor. Bot kapatılıyor...');
    monitor.stop();
    db.close();
    server.close(() => {
        process.exit(0);
    });
});
