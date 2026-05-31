const polymarketAPI = require('./polymarketAPI');

/**
 * Wallet Monitor Engine (monitor.js)
 * High-frequency polling engine supporting sub-second (millisecond / salise) resolutions.
 * Replaced node-cron with a recursive setTimeout loop to prevent overlapping calls and support decimals.
 */

class WalletMonitor {
    constructor(db, copyTrader, io) {
        this.db = db;
        this.copyTrader = copyTrader;
        this.io = io;
        this.timer = null;
        this.isRunning = false;
        this.pollIntervalMs = 30000; // default 30s in milliseconds
    }

    /**
     * Start the background monitoring loop
     */
    start() {
        if (this.isRunning) {
            console.log('[Monitor] Bot zaten aktif durumda.');
            return;
        }

        // Fetch scan interval from settings if available (supports decimals e.g., 0.1 for 100ms)
        try {
            const row = this.db.prepare("SELECT value FROM bot_settings WHERE key = 'scan_interval'").get();
            if (row && row.value) {
                const intervalSeconds = parseFloat(row.value) || 30.0;
                // Minimum boundary of 10ms to protect system resources
                this.pollIntervalMs = Math.max(10, Math.round(intervalSeconds * 1000));
            }
        } catch (e) {
            console.error('Failed to load scan interval, defaulting to 30s:', e.message);
            this.pollIntervalMs = 30000;
        }

        console.log(`[Monitor] Cüzdan izleme motoru başlatıldı. Tarama aralığı: ${this.pollIntervalMs} ms.`);
        
        this.startTime = new Date();
        this.isRunning = true;
        this.copyTrader.logToDB('INFO', `İzleme motoru başlatıldı. Tarama aralığı: ${this.pollIntervalMs / 1000} saniye.`);
        
        this.io.emit('bot_status_changed', {
            status: 'running',
            timestamp: new Date().toISOString()
        });

        // Fire first execution block
        this.tick();
    }

    /**
     * Stop the background monitoring loop
     */
    stop() {
        if (!this.isRunning) {
            console.log('[Monitor] Bot zaten durdurulmuş durumda.');
            return;
        }

        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        this.isRunning = false;
        console.log('[Monitor] Cüzdan izleme motoru durduruldu.');
        this.copyTrader.logToDB('INFO', 'İzleme motoru durduruldu.');
        
        this.io.emit('bot_status_changed', {
            status: 'stopped',
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Recursive loop execution ensuring scans are executed sequentially without overlaps
     */
    async tick() {
        if (!this.isRunning) return;

        try {
            await this.scanWallets();
        } catch (error) {
            console.error('[Monitor] Hata: Tarama döngüsü yürütülemedi:', error.message);
        }

        // Schedule next check only if the bot is still running
        if (this.isRunning) {
            this.timer = setTimeout(() => this.tick(), this.pollIntervalMs);
        }
    }

    /**
     * Main polling loop iteration
     */
    async scanWallets() {
        try {
            // Check if global emergency stop is enabled
            const emergencyRow = this.db.prepare("SELECT value FROM bot_settings WHERE key = 'emergency_stop'").get();
            if (emergencyRow && parseInt(emergencyRow.value || '0') === 1) {
                console.log('[Monitor] Acil durdurma devrede. Tarama atlanıyor.');
                return;
            }

            const copyExistingRow = this.db.prepare("SELECT value FROM bot_settings WHERE key = 'copy_existing_trades'").get();
            const copyExisting = copyExistingRow ? parseInt(copyExistingRow.value || '0') === 1 : false;

            // Check Stop Loss & Take Profit limits on active copy positions first
            await this.checkStopLossTakeProfit();

            // Get all active tracked wallets
            const activeWallets = this.db.prepare('SELECT * FROM tracked_wallets WHERE is_active = 1').all();
            
            if (activeWallets.length === 0) {
                console.log('[Monitor] İzlenen aktif cüzdan bulunamadı. Bekleniyor...');
                return;
            }

            console.log(`[Monitor] ${activeWallets.length} aktif cüzdan taranıyor...`);

            for (const wallet of activeWallets) {
                try {
                    // Fetch recent activity using data-api
                    // Applying retry with exponential backoff on failure
                    const recentTrades = await this.fetchTradesWithRetry(wallet.address);

                    if (!recentTrades || recentTrades.length === 0) {
                        continue;
                    }

                    // Process trades sequentially (oldest first to preserve chronological ordering)
                    // Normal activity feed returns newest first, so we reverse it
                    const tradesToProcess = [...recentTrades].reverse();

                    for (const trade of tradesToProcess) {
                        // Check if this trade was already processed for this specific wallet
                        const existsRow = this.db.prepare(`
                            SELECT id FROM copied_trades 
                            WHERE wallet_id = ? AND original_tx_hash = ?
                        `).get(wallet.id, trade.txHash);

                        if (existsRow) {
                            // Already handled, ignore
                            continue;
                        }

                        // Check execution timestamp if copyExisting is disabled
                        const tradeTime = new Date(trade.timestamp);
                        if (!copyExisting && this.startTime && tradeTime < this.startTime) {
                            const skipMsg = `Orijinal işlem bot başlangıcından önce yapılmış (${trade.timestamp}), atlandı.`;
                            console.log(`[Monitor] [${wallet.label}] ${skipMsg}`);
                            this.db.prepare(`
                                INSERT INTO copied_trades (
                                    wallet_id, original_tx_hash, copy_tx_hash, market_id, market_question, 
                                    outcome, side, original_amount, copied_amount, price, status, error_message, created_at, executed_at
                                ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 0.0, ?, 'SKIPPED', ?, ?, CURRENT_TIMESTAMP)
                            `).run(
                                wallet.id,
                                trade.txHash,
                                trade.marketId,
                                trade.question,
                                trade.outcome,
                                trade.side,
                                trade.amount,
                                trade.price,
                                skipMsg,
                                trade.timestamp
                            );
                            continue;
                        }

                        // We found a new trade! Trigger copyTrader
                        await this.copyTrader.processCopyTrade(wallet, trade);
                    }

                    // If pollIntervalMs is fast (under 1 second), we bypass the delay to achieve rapid-polling
                    if (this.pollIntervalMs >= 1000) {
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }

                } catch (walletError) {
                    console.error(`[Monitor] Cüzdan tarama hatası (${wallet.label} - ${wallet.address}):`, walletError.message);
                    this.copyTrader.logToDB('ERROR', `Cüzdan tarama hatası [${wallet.label}]: ${walletError.message}`);
                }
            }
        } catch (error) {
            console.error('[Monitor] Global tarama hatası:', error.message);
            this.copyTrader.logToDB('ERROR', `İzleme motoru tarama hatası: ${error.message}`);
        }
    }

    /**
     * Scan open copy-positions and execute Stop Loss or Take Profit orders if limits are triggered.
     */
    async checkStopLossTakeProfit() {
        try {
            // Fetch open positions (BUY orders that are not closed yet)
            const openPositions = this.db.prepare(`
                SELECT t.*, w.take_profit_percentage, w.stop_loss_percentage, w.label as wallet_label
                FROM copied_trades t
                JOIN tracked_wallets w ON t.wallet_id = w.id
                WHERE t.is_closed = 0 AND t.status = 'SUCCESS' AND t.side = 'BUY'
            `).all();

            if (openPositions.length === 0) return;

            // Fetch settings for global fallbacks and testMode config
            const settingsRows = this.db.prepare('SELECT key, value FROM bot_settings').all();
            const settings = {};
            settingsRows.forEach(r => { settings[r.key] = r.value; });

            const globalTP = parseFloat(settings.default_tp || '0');
            const globalSL = parseFloat(settings.default_sl || '0');
            const testMode = parseInt(settings.test_mode || '1') === 1;
            const privateKey = settings.private_key || '';

            for (const position of openPositions) {
                try {
                    let tpLimit = parseFloat(position.take_profit_percentage || '0');
                    let slLimit = parseFloat(position.stop_loss_percentage || '0');

                    // Fallback to global defaults if cüzdan specific is 0
                    if (tpLimit === 0) tpLimit = globalTP;
                    if (slLimit === 0) slLimit = globalSL;

                    if (tpLimit === 0 && slLimit === 0) {
                        continue; // No SL/TP defined
                    }

                    // Get current price of outcome from Polymarket CLOB
                    let currentPrice = position.price; // fallback to buy price
                    let tokenId = '0xmock_token_id_' + position.market_id.substring(0, 10);

                    if (!testMode) {
                        // Query real token and orderbook
                        const marketInfo = await polymarketAPI.getMarketInfo(position.market_id);
                        const outcomeToken = marketInfo.tokens.find(t => t.outcome.toLowerCase() === position.outcome.toLowerCase());
                        
                        if (!outcomeToken) {
                            console.warn(`[SL/TP] Token not found for outcome "${position.outcome}" in market ${position.market_id}`);
                            continue;
                        }
                        
                        tokenId = outcomeToken.token_id;
                        const book = await polymarketAPI.getOrderBook(tokenId);
                        
                        // We are selling, so we look at the best buy bid price (book.bids[0].price)
                        if (book.bids && book.bids.length > 0) {
                            currentPrice = parseFloat(book.bids[0].price);
                        } else {
                            // If no active bids, skip to prevent selling into empty orderbook
                            continue;
                        }
                    } else {
                        // In simulation mode: mock slight price fluctuation for testing TP/SL triggers!
                        // Randomly fluctuate price up/down by up to 30% to demonstrate active triggers
                        const randomFluctuation = (Math.random() * 0.6) - 0.3; // -30% to +30%
                        currentPrice = Math.max(0.01, Math.min(0.99, parseFloat((position.price * (1 + randomFluctuation)).toFixed(2))));
                    }

                    // Calculate price change percentage
                    const changePct = ((currentPrice - position.price) / position.price) * 100;
                    
                    let isTriggered = false;
                    let triggerType = ''; // 'TP' or 'SL'

                    if (changePct > 0 && tpLimit > 0 && changePct >= tpLimit) {
                        isTriggered = true;
                        triggerType = 'TP';
                    } else if (changePct < 0 && slLimit > 0 && Math.abs(changePct) >= slLimit) {
                        isTriggered = true;
                        triggerType = 'SL';
                    }

                    if (isTriggered) {
                        const pnl = (currentPrice - position.price) * position.copied_amount;
                        const txType = triggerType === 'TP' ? 'TP_CLOSE' : 'SL_CLOSE';
                        const closeMsg = triggerType === 'TP'
                            ? `[KAR ALMA - TP] Pozisyon kapatıldı. Kar: +$${pnl.toFixed(2)} USDC (%${changePct.toFixed(1)} artış)`
                            : `[ZARAR DURDURMA - SL] Pozisyon kapatıldı. Zarar: -$${Math.abs(pnl).toFixed(2)} USDC (%${Math.abs(changePct).toFixed(1)} düşüş)`;

                        console.log(`[SL/TP] Triggered! ${closeMsg} | Market: ${position.market_question}`);

                        // 1. Mark open position as closed in DB
                        this.db.prepare('UPDATE copied_trades SET is_closed = 1 WHERE id = ?').run(position.id);

                        // 2. Execute closing SELL transaction
                        const closeResult = await polymarketAPI.executeTrade(
                            privateKey,
                            position.market_id,
                            tokenId,
                            'SELL',
                            position.copied_amount,
                            currentPrice,
                            testMode
                        );

                        if (closeResult && closeResult.success) {
                            // 3. Save new SELL trade in database
                            this.db.prepare(`
                                INSERT INTO copied_trades (
                                    wallet_id, original_tx_hash, copy_tx_hash, market_id, market_question,
                                    outcome, side, original_amount, copied_amount, price, status, profit_loss, error_message, executed_at
                                ) VALUES (?, ?, ?, ?, ?, ?, 'SELL', ?, ?, ?, 'SUCCESS', ?, ?, CURRENT_TIMESTAMP)
                            `).run(
                                position.wallet_id,
                                txType,
                                closeResult.txHash,
                                position.market_id,
                                position.market_question,
                                position.outcome,
                                position.original_amount,
                                position.copied_amount,
                                currentPrice,
                                pnl,
                                closeMsg
                            );

                            // 4. Update wallet performance statistics
                            this.copyTrader.updateWalletStatistics(position.wallet_id);

                            // 5. Append system log
                            this.copyTrader.logToDB('INFO', `${closeMsg} | Cüzdan: ${position.wallet_label}`);

                            // 6. Emit events via Socket.io to refresh dashboard
                            this.io.emit('trade_executed', {
                                tradeId: position.id,
                                walletLabel: position.wallet_label,
                                marketQuestion: position.market_question,
                                side: 'SELL',
                                amount: position.copied_amount,
                                price: currentPrice,
                                status: 'SUCCESS',
                                txHash: closeResult.txHash,
                                testMode
                            });

                            // 7. Send Telegram alert
                            this.copyTrader.notificationService.sendTradeNotification({
                                walletLabel: position.wallet_label,
                                question: position.market_question,
                                side: 'SELL',
                                amount: position.copied_amount,
                                price: currentPrice,
                                outcome: position.outcome,
                                status: 'SUCCESS',
                                txHash: closeResult.txHash,
                                isSimulated: testMode
                            });
                        }
                    }
                } catch (posError) {
                    console.error(`[SL/TP] Hata (Position ID: ${position.id}):`, posError.message);
                }
            }
        } catch (globalError) {
            console.error('[SL/TP] Global denetim hatası:', globalError.message);
        }
    }

    /**
     * Robust API caller using exponential backoff retry mechanism.
     */
    async fetchTradesWithRetry(address, retries = 3, delay = 500) {
        let lastError;
        for (let i = 0; i < retries; i++) {
            try {
                return await polymarketAPI.getWalletTrades(address, 10);
            } catch (err) {
                lastError = err;
                const nextDelay = delay * Math.pow(2, i);
                console.warn(`[Monitor] API hatası, yeniden deneniyor (${i + 1}/${retries}) ${nextDelay}ms sonra. Hata: ${err.message}`);
                await new Promise(resolve => setTimeout(resolve, nextDelay));
            }
        }
        throw new Error(`Polymarket API 3 denemeden sonra yanıt vermedi. Son Hata: ${lastError.message}`);
    }
}

module.exports = WalletMonitor;
