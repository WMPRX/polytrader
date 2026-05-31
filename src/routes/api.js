const express = require('express');
const { ethers } = require('ethers');
const polymarketAPI = require('../bot/polymarketAPI');

/**
 * REST API Routes (api.js)
 * Mounts standard endpoint routes for bot operations, data fetching, settings, and CRUD actions.
 */
function createApiRouter(services) {
    const router = express.Router();
    const { db, walletService, tradeService, notificationService, monitor, copyTrader } = services;

    // ==========================================
    // CÜZDAN YÖNETİMİ ENDPOINTS (tracked_wallets)
    // ==========================================

    // GET /api/wallets → Retrieve all tracked wallets
    router.get('/wallets', (req, res) => {
        try {
            const wallets = walletService.getAllWallets();
            res.json(wallets);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // POST /api/wallets → Register a new wallet
    router.post('/wallets', (req, res) => {
        try {
            const newWallet = walletService.addWallet(req.body);
            copyTrader.logToDB('INFO', `Yeni cüzdan takibe alındı: ${newWallet.label} (${newWallet.address})`);
            res.status(201).json(newWallet);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    // PUT /api/wallets/:id → Update copy parameters for a wallet
    router.put('/wallets/:id', (req, res) => {
        try {
            const updated = walletService.updateWallet(req.params.id, req.body);
            copyTrader.logToDB('INFO', `Cüzdan ayarları güncellendi: ${updated.label}`);
            res.json(updated);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    // DELETE /api/wallets/:id → Remove wallet from tracker
    router.delete('/wallets/:id', (req, res) => {
        try {
            const wallet = walletService.getWalletById(req.params.id);
            const label = wallet ? wallet.label : req.params.id;
            const result = walletService.deleteWallet(req.params.id);
            copyTrader.logToDB('INFO', `Cüzdan takipten çıkarıldı: ${label}`);
            res.json(result);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    // POST /api/wallets/:id/toggle → Toggle is_active status
    router.post('/wallets/:id/toggle', (req, res) => {
        try {
            const result = walletService.toggleWallet(req.params.id);
            const wallet = walletService.getWalletById(req.params.id);
            const action = result.is_active === 1 ? 'aktif edildi' : 'pasifleştirildi';
            copyTrader.logToDB('INFO', `Cüzdan ${wallet.label} ${action}.`);
            res.json(result);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    // GET /api/wallets/:id/stats → Get performance overview for a wallet
    router.get('/wallets/:id/stats', (req, res) => {
        try {
            const stats = walletService.getWalletStats(req.params.id);
            res.json(stats);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    // ==========================================
    // İŞLEM GEÇMİŞİ ENDPOINTS (copied_trades)
    // ==========================================

    // GET /api/trades → Search and filter copied trades
    router.get('/trades', (req, res) => {
        try {
            const result = tradeService.getTrades(req.query);
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/trades/stats/summary → General metrics summary
    router.get('/trades/stats/summary', (req, res) => {
        try {
            const summary = tradeService.getDashboardSummary();
            res.json(summary);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/trades/:id → Retrieve single trade details
    router.get('/trades/:id', (req, res) => {
        try {
            const trade = tradeService.getTradeById(req.params.id);
            if (!trade) {
                return res.status(404).json({ error: 'İşlem bulunamadı.' });
            }
            res.json(trade);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // ==========================================
    // BOT KONTROLÜ ENDPOINTS
    // ==========================================

    // GET /api/bot/status → Monitor state
    router.get('/bot/status', (req, res) => {
        try {
            // Fetch USDC balance if wallet private key configured
            const settingsRows = db.prepare("SELECT value FROM bot_settings WHERE key = 'private_key'").get();
            const pKey = settingsRows ? settingsRows.value : '';

            const testModeRow = db.prepare("SELECT value FROM bot_settings WHERE key = 'test_mode'").get();
            const testMode = testModeRow ? parseInt(testModeRow.value || '1') === 1 : true;

            const emergencyRow = db.prepare("SELECT value FROM bot_settings WHERE key = 'emergency_stop'").get();
            const emergencyStop = emergencyRow ? parseInt(emergencyRow.value || '0') === 1 : false;

            polymarketAPI.getUSDCBalance(pKey).then(balance => {
                let walletAddress = 'Mevcut Değil';
                if (pKey && ethers.isHexString(pKey, 32)) {
                    walletAddress = new ethers.Wallet(pKey).address;
                }

                res.json({
                    isRunning: monitor.isRunning,
                    emergencyStop: emergencyStop,
                    testMode: testMode,
                    walletAddress: walletAddress,
                    usdcBalance: balance,
                    pollInterval: monitor.pollIntervalSeconds
                });
            }).catch(e => {
                res.json({
                    isRunning: monitor.isRunning,
                    emergencyStop: emergencyStop,
                    testMode: testMode,
                    walletAddress: 'Hata',
                    usdcBalance: '0.00',
                    pollInterval: monitor.pollIntervalSeconds
                });
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // POST /api/bot/start → Trigger start
    router.post('/bot/start', (req, res) => {
        try {
            monitor.start();
            res.json({ success: true, isRunning: true, message: 'Bot başarıyla başlatıldı.' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // POST /api/bot/stop → Trigger stop
    router.post('/bot/stop', (req, res) => {
        try {
            monitor.stop();
            res.json({ success: true, isRunning: false, message: 'Bot başarıyla durduruldu.' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // POST /api/bot/emergency-stop → Emergency override toggle
    router.post('/bot/emergency-stop', (req, res) => {
        try {
            const current = db.prepare("SELECT value FROM bot_settings WHERE key = 'emergency_stop'").get();
            const newValue = parseInt(current ? current.value : '0') === 1 ? '0' : '1';
            
            db.prepare("INSERT OR REPLACE INTO bot_settings (key, value, updated_at) VALUES ('emergency_stop', ?, CURRENT_TIMESTAMP)").run(newValue);

            const isEmergency = newValue === '1';
            if (isEmergency) {
                monitor.stop();
                copyTrader.logToDB('WARN', 'ACİL DURDURMA TETİKLENDİ! Tüm kopyalama işlemleri donduruldu.');
            } else {
                copyTrader.logToDB('INFO', 'Acil durdurma devre dışı bırakıldı. Bot hazır.');
            }

            res.json({
                success: true,
                emergencyStop: isEmergency,
                message: isEmergency ? 'Acil durdurma devreye sokuldu!' : 'Acil durdurma kapatıldı.'
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // ==========================================
    // AYARLAR ENDPOINTS
    // ==========================================

    // GET /api/settings → Fetch all configurations
    router.get('/settings', (req, res) => {
        try {
            const rows = db.prepare('SELECT key, value FROM bot_settings').all();
            const settings = {};
            rows.forEach(r => {
                // Return masked private key for security
                if (r.key === 'private_key' && r.value) {
                    settings[r.key] = r.value.substring(0, 6) + '...' + r.value.substring(r.value.length - 4);
                } else {
                    settings[r.key] = r.value;
                }
            });
            res.json(settings);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // POST /api/settings → Save configurations
    router.post('/settings', (req, res) => {
        try {
            const updates = req.body;
            
            // Start transaction
            db.exec('BEGIN TRANSACTION');
            try {
                for (const [key, value] of Object.entries(updates)) {
                    // Check if private key is sent masked. If masked, don't overwrite the existing one.
                    if (key === 'private_key' && value.includes('...')) {
                        continue;
                    }

                    // Validate private key if not empty and not masked
                    if (key === 'private_key' && value && value.trim() !== '') {
                        let trimmedVal = value.trim();
                        if (!trimmedVal.startsWith('0x')) {
                            trimmedVal = '0x' + trimmedVal;
                        }
                        // Validate private key format
                        if (!ethers.isHexString(trimmedVal, 32)) {
                            throw new Error('Geçersiz Private Key formatı. 64 karakterli hex formatında olmalıdır (0x ile başlayabilir).');
                        }
                        db.prepare(`
                            INSERT OR REPLACE INTO bot_settings (key, value, updated_at)
                            VALUES (?, ?, CURRENT_TIMESTAMP)
                        `).run(key, trimmedVal);
                        continue;
                    }

                    db.prepare(`
                        INSERT OR REPLACE INTO bot_settings (key, value, updated_at)
                        VALUES (?, ?, CURRENT_TIMESTAMP)
                    `).run(key, value.toString().trim());
                }
                db.exec('COMMIT');
            } catch (transError) {
                db.exec('ROLLBACK');
                throw transError;
            }

            // Re-apply interval timing if changed
            if (updates.scan_interval) {
                const intervalSeconds = parseFloat(updates.scan_interval) || 30.0;
                const intervalMs = Math.max(10, Math.round(intervalSeconds * 1000));
                if (intervalMs !== monitor.pollIntervalMs) {
                    const wasRunning = monitor.isRunning;
                    if (wasRunning) monitor.stop();
                    monitor.pollIntervalMs = intervalMs;
                    if (wasRunning) monitor.start();
                }
            }

            copyTrader.logToDB('INFO', 'Bot sistem ayarları başarıyla güncellendi.');
            res.json({ success: true, message: 'Ayarlar kaydedildi.' });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    // POST /api/settings/test-telegram → Trigger Telegram verification
    router.post('/settings/test-telegram', async (req, res) => {
        try {
            await notificationService.sendTestMessage();
            res.json({ success: true, message: 'Test bildirimi Telegram adresine gönderildi.' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // POST /api/settings/test-privatekey → Validate wallet connections
    router.post('/settings/test-privatekey', async (req, res) => {
        try {
            const { private_key } = req.body;
            let keyToTest = private_key ? private_key.trim() : '';

            if (private_key && private_key.includes('...')) {
                // Use existing stored key
                const stored = db.prepare("SELECT value FROM bot_settings WHERE key = 'private_key'").get();
                keyToTest = stored ? stored.value : '';
            }

            if (!keyToTest) {
                return res.status(400).json({ error: 'Özel anahtar ayarlanmamış.' });
            }

            if (!keyToTest.startsWith('0x')) {
                keyToTest = '0x' + keyToTest;
            }

            if (!ethers.isHexString(keyToTest, 32)) {
                return res.status(400).json({ error: 'Geçersiz Private Key formatı.' });
            }

            const wallet = new ethers.Wallet(keyToTest);
            const balance = await polymarketAPI.getUSDCBalance(keyToTest);
            
            // Check allowance
            const provider = await polymarketAPI.getProvider();
            const usdcContract = new ethers.Contract(polymarketAPI.USDC_ADDRESS, [
                'function allowance(address owner, address spender) external view returns (uint256)'
            ], provider);

            const allowance = await usdcContract.allowance(wallet.address, polymarketAPI.CTF_EXCHANGE_ADDRESS);
            const approved = allowance > 0;

            res.json({
                success: true,
                address: wallet.address,
                balance: balance,
                approved: approved
            });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    // POST /api/settings/clear-history → Purge all trade histories
    router.post('/settings/clear-history', (req, res) => {
        try {
            db.prepare('DELETE FROM copied_trades').run();
            // Reset wallets stats
            db.prepare('UPDATE tracked_wallets SET total_trades = 0, win_rate = 0.0, total_profit_loss = 0.0').run();
            copyTrader.logToDB('WARN', 'İşlem geçmişi ve cüzdan istatistikleri tamamen sıfırlandı.');
            res.json({ success: true, message: 'Tüm işlem geçmişi temizlendi.' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // POST /api/settings/approve-usdc → Send approval tx
    router.post('/settings/approve-usdc', async (req, res) => {
        try {
            const stored = db.prepare("SELECT value FROM bot_settings WHERE key = 'private_key'").get();
            const pKey = stored ? stored.value : '';

            if (!pKey) {
                return res.status(400).json({ error: 'Private Key girilmemiş.' });
            }

            const txHash = await polymarketAPI.approveUSDC(pKey);
            copyTrader.logToDB('INFO', `USDC onayı blockchain ağına başarıyla iletildi: ${txHash}`);
            res.json({ success: true, txHash, message: 'USDC harcama onayı başarıyla verildi!' });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    // ==========================================
    // DASHBOARD & TELEMETRY ENDPOINTS
    // ==========================================

    // GET /api/dashboard/summary → KPIs summary
    router.get('/dashboard/summary', (req, res) => {
        try {
            const summary = tradeService.getDashboardSummary();
            res.json(summary);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/dashboard/pnl → P&L chart time series
    router.get('/dashboard/pnl', (req, res) => {
        try {
            const timeframe = req.query.timeframe || 'all';
            const series = tradeService.getPnLTimeSeries(timeframe);
            res.json(series);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/dashboard/activity → Recent 10 trades + logs
    router.get('/dashboard/activity', (req, res) => {
        try {
            // Last 10 trades
            const trades = db.prepare(`
                SELECT t.*, w.label as wallet_label 
                FROM copied_trades t
                JOIN tracked_wallets w ON t.wallet_id = w.id
                ORDER BY t.created_at DESC 
                LIMIT 10
            `).all();

            // Last 20 log entries
            const logs = db.prepare(`
                SELECT * FROM trade_log 
                ORDER BY created_at DESC 
                LIMIT 20
            `).all();

            res.json({
                recentTrades: trades,
                recentLogs: logs
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // ==========================================
    // LOGLAR ENDPOINTS
    // ==========================================

    // GET /api/logs → Page queries
    router.get('/logs', (req, res) => {
        try {
            const page = parseInt(req.query.page || '1');
            const limit = parseInt(req.query.limit || '20');
            const offset = (page - 1) * limit;

            const countRow = db.prepare('SELECT COUNT(*) as count FROM trade_log').get();
            const total = countRow ? countRow.count : 0;

            const logs = db.prepare(`
                SELECT * FROM trade_log 
                ORDER BY created_at DESC 
                LIMIT ? OFFSET ?
            `).all(limit, offset);

            res.json({
                logs,
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

module.exports = createApiRouter;
