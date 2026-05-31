-- Database Schema for PolyTrader SQLite Database

-- 1. Tracked Wallets Table
CREATE TABLE IF NOT EXISTS tracked_wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    min_trade_amount REAL DEFAULT 10.0,
    max_copy_amount REAL DEFAULT 100.0,
    copy_percentage REAL DEFAULT 100.0,
    total_profit_loss REAL DEFAULT 0.0,
    win_rate REAL DEFAULT 0.0,
    total_trades INTEGER DEFAULT 0,
    take_profit_percentage REAL DEFAULT 0.0,
    stop_loss_percentage REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Copied Trades Table
CREATE TABLE IF NOT EXISTS copied_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id INTEGER NOT NULL,
    original_tx_hash TEXT NOT NULL,
    copy_tx_hash TEXT,
    market_id TEXT NOT NULL,
    market_question TEXT NOT NULL,
    outcome TEXT NOT NULL,
    side TEXT NOT NULL, -- BUY or SELL
    original_amount REAL NOT NULL,
    copied_amount REAL NOT NULL,
    price REAL NOT NULL,
    status TEXT NOT NULL, -- PENDING, SUCCESS, FAILED, SKIPPED
    profit_loss REAL DEFAULT 0.0,
    error_message TEXT,
    is_closed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    executed_at DATETIME,
    FOREIGN KEY(wallet_id) REFERENCES tracked_wallets(id) ON DELETE CASCADE
);

-- 3. Bot Settings Table
CREATE TABLE IF NOT EXISTS bot_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Trade Log Table
CREATE TABLE IF NOT EXISTS trade_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL, -- INFO, WARN, ERROR
    message TEXT NOT NULL,
    metadata TEXT, -- JSON string for additional context
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_copied_trades_wallet_id ON copied_trades(wallet_id);
CREATE INDEX IF NOT EXISTS idx_copied_trades_status ON copied_trades(status);
CREATE INDEX IF NOT EXISTS idx_trade_log_level ON trade_log(level);
