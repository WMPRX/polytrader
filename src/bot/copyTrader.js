const polymarketAPI = require('./polymarketAPI');
const riskManager = require('./riskManager');
const { ethers } = require('ethers');

/**
 * Copy Trader Engine (copyTrader.js)
 * Coordinates and executes copy trading lifecycle: risk assessment, sizing, execution, and state management.
 */

class CopyTrader {
    constructor(db, io, notificationService) {
        this.db = db;
        this.io = io;
        this.notificationService = notificationService;
    }

    /**
     * Process an incoming trade event detected from an active tracked wallet.
     * 
     * @param {Object} wallet - Tracked wallet record from DB
     * @param {Object} detectedTrade - Normalised trade object from Polymarket API
     */
    async processCopyTrade(wallet, detectedTrade) {
        const { txHash, marketId, question, outcome, side, amount: originalAmount, price: originalPrice } = detectedTrade;
        
        console.log(`[CopyTrader] Cüzdanından (${wallet.label}) yeni işlem algılandı: ${side} ${originalAmount} adet $${originalPrice} fiyatından.`);
        
        // Log transaction detection
        this.logToDB('INFO', `[${wallet.label}] Yeni işlem tespit edildi: ${side} ${originalAmount} adet, Market: "${question}"`, detectedTrade);

        // Notify client side
        this.io.emit('new_trade_detected', {
            walletAddress: wallet.address,
            walletLabel: wallet.label,
            marketQuestion: question,
            side: side,
            amount: originalAmount,
            price: originalPrice,
            outcome: outcome
        });

        // 1. Initial Checks: Check if wallet copy trading is active
        if (!wallet.is_active) {
            console.log(`[CopyTrader] Cüzdan (${wallet.label}) aktif değil, işlem atlanıyor.`);
            this.logToDB('INFO', `[${wallet.label}] Cüzdan aktif değil, kopyalama atlandı.`, { address: wallet.address });
            return;
        }

        // 2. Fetch Bot configuration
        const settingsRows = this.db.prepare('SELECT key, value FROM bot_settings').all();
        const settings = {};
        settingsRows.forEach(row => {
            settings[row.key] = row.value;
        });

        const testMode = parseInt(settings.test_mode || '1') === 1;
        const privateKey = settings.private_key || '';
        const slippageTolerance = parseFloat(settings.slippage_tolerance || '5'); // in percentage

        // 3. Trade Sizing Calculations
        // Size of trade = originalAmount * copyPercentage / 100
        let copyPercentage = parseFloat(wallet.copy_percentage || '100');
        let calculatedAmount = originalAmount * (copyPercentage / 100);

        // Cap to wallet max copy amount
        const maxCopy = parseFloat(wallet.max_copy_amount || '100');
        if (calculatedAmount > maxCopy) {
            calculatedAmount = maxCopy;
        }

        // Check if calculatedAmount is below wallet min_trade_amount
        const minTrade = parseFloat(wallet.min_trade_amount || '5');
        if (calculatedAmount < minTrade) {
            const skipMsg = `İşlem miktarı ($${calculatedAmount.toFixed(2)}) minimum limitin ($${minTrade}) altında, atlandı.`;
            console.log(`[CopyTrader] ${skipMsg}`);
            this.logToDB('WARN', `[${wallet.label}] ${skipMsg}`, { calculatedAmount, minTrade });
            this.saveTradeRecord(wallet.id, txHash, null, marketId, question, outcome, side, originalAmount, calculatedAmount, originalPrice, 'SKIPPED', skipMsg);
            return;
        }

        // 4. Balance check (Live trading only)
        if (!testMode) {
            if (!privateKey) {
                const errMsg = 'Cüzdan özel anahtarı (Private Key) eksik. Canlı işlemler kopyalanamaz. Lütfen Ayarlar sayfasından girin.';
                this.handleTradeFailure(wallet, detectedTrade, calculatedAmount, errMsg);
                return;
            }

            const usdcBalance = parseFloat(await polymarketAPI.getUSDCBalance(privateKey));
            const totalRequired = calculatedAmount * originalPrice; // Approx cost in USDC
            if (usdcBalance < totalRequired) {
                const skipMsg = `Yetersiz USDC bakiyesi. Gereken: ~$${totalRequired.toFixed(2)}, Mevcut: $${usdcBalance.toFixed(2)}`;
                console.log(`[CopyTrader] ${skipMsg}`);
                this.logToDB('WARN', `[${wallet.label}] ${skipMsg}`, { usdcBalance, totalRequired });
                this.saveTradeRecord(wallet.id, txHash, null, marketId, question, outcome, side, originalAmount, calculatedAmount, originalPrice, 'SKIPPED', skipMsg);
                return;
            }
        }

        // 5. Global Risk Limits Check
        const riskCheck = riskManager.checkRiskLimits(this.db, calculatedAmount);
        if (!riskCheck.allowed) {
            console.log(`[CopyTrader] Risk kontrolü başarısız: ${riskCheck.reason}`);
            this.logToDB('WARN', `[${wallet.label}] Risk kontrolü reddi: ${riskCheck.reason}`);
            this.saveTradeRecord(wallet.id, txHash, null, marketId, question, outcome, side, originalAmount, calculatedAmount, originalPrice, 'SKIPPED', riskCheck.reason);
            return;
        }
        calculatedAmount = riskCheck.cappedAmount; // Apply any risk sizing caps

        // 6. Slippage and Market Availability Check (Mocked validation for simulation)
        let executePrice = originalPrice;
        let tokenId = '';

        try {
            // Retrieve token identity for outcome if not in simulation mode
            if (!testMode) {
                const marketInfo = await polymarketAPI.getMarketInfo(marketId);
                if (!marketInfo.active) {
                    const skipMsg = 'Market kapalı veya sonlanmış. İşlem kopyalanamaz.';
                    console.log(`[CopyTrader] ${skipMsg}`);
                    this.saveTradeRecord(wallet.id, txHash, null, marketId, question, outcome, side, originalAmount, calculatedAmount, originalPrice, 'SKIPPED', skipMsg);
                    return;
                }

                // Resolve outcome token ID
                const outcomeToken = marketInfo.tokens.find(t => t.outcome.toLowerCase() === outcome.toLowerCase());
                if (!outcomeToken) {
                    throw new Error(`Market outcome "${outcome}" için token_id bulunamadı.`);
                }
                tokenId = outcomeToken.token_id;

                // Check orderbook bids/asks to verify slippage
                const book = await polymarketAPI.getOrderBook(tokenId);
                const orderSide = side.toUpperCase();
                
                if (orderSide === 'BUY' && book.asks && book.asks.length > 0) {
                    // Best offer price
                    executePrice = parseFloat(book.asks[0].price);
                } else if (orderSide === 'SELL' && book.bids && book.bids.length > 0) {
                    // Best bid price
                    executePrice = parseFloat(book.bids[0].price);
                }

                // Slippage = (Execute Price - Original Price) / Original Price * 100
                const priceDiffPct = Math.abs(executePrice - originalPrice) / originalPrice * 100;
                if (priceDiffPct > slippageTolerance) {
                    const skipMsg = `Yüksek slippage sapması! Orijinal: $${originalPrice}, Güncel: $${executePrice} (Sapma: %${priceDiffPct.toFixed(2)} > Tolerans: %${slippageTolerance})`;
                    console.log(`[CopyTrader] ${skipMsg}`);
                    this.logToDB('WARN', `[${wallet.label}] ${skipMsg}`);
                    this.saveTradeRecord(wallet.id, txHash, null, marketId, question, outcome, side, originalAmount, calculatedAmount, originalPrice, 'SKIPPED', skipMsg);
                    return;
                }
            } else {
                // Simulation mode: mock token ID
                tokenId = '0xmock_token_id_' + marketId.substring(0, 10);
            }
        } catch (err) {
            console.error(`[CopyTrader] Market/Token çözme hatası:`, err.message);
            if (!testMode) {
                const errMsg = `Slippage ve token doğrulama başarısız: ${err.message}`;
                this.handleTradeFailure(wallet, detectedTrade, calculatedAmount, errMsg);
                return;
            }
        }

        // 7. Save trade with PENDING status in database
        const tradeId = this.saveTradeRecord(
            wallet.id, 
            txHash, 
            null, 
            marketId, 
            question, 
            outcome, 
            side, 
            originalAmount, 
            calculatedAmount, 
            executePrice, 
            'PENDING'
        );

        // 8. Execute Trade
        try {
            const executionResult = await polymarketAPI.executeTrade(
                privateKey,
                marketId,
                tokenId,
                side,
                calculatedAmount,
                executePrice,
                testMode
            );

            if (executionResult && executionResult.success) {
                // Update trade status to SUCCESS in SQLite
                const pnl = 0.0; // P&L starts at 0 until outcome resolved, or we could simulate one for demo trades.
                
                this.db.prepare(`
                    UPDATE copied_trades 
                    SET status = 'SUCCESS', copy_tx_hash = ?, executed_at = CURRENT_TIMESTAMP, profit_loss = ?
                    WHERE id = ?
                `).run(executionResult.txHash, pnl, tradeId);

                // Update tracked wallet stats
                this.updateWalletStatistics(wallet.id);

                const succMsg = `[KOPYALANDI] ${side} ${calculatedAmount.toFixed(1)} Shares (${outcome}) - $${executePrice.toFixed(2)} | Wallet: ${wallet.label} | ${testMode ? 'SIMULASYON' : 'CANLI'}`;
                console.log(`[CopyTrader] ${succMsg}`);
                this.logToDB('INFO', succMsg, { tradeId, txHash: executionResult.txHash });

                // Emit event
                this.io.emit('trade_executed', {
                    tradeId,
                    walletLabel: wallet.label,
                    marketQuestion: question,
                    side,
                    amount: calculatedAmount,
                    price: executePrice,
                    status: 'SUCCESS',
                    txHash: executionResult.txHash,
                    testMode
                });

                // Send Telegram Notification
                this.notificationService.sendTradeNotification({
                    walletLabel: wallet.label,
                    question: question,
                    side: side,
                    amount: calculatedAmount,
                    price: executePrice,
                    outcome: outcome,
                    status: 'SUCCESS',
                    txHash: executionResult.txHash,
                    isSimulated: testMode
                });

                // Trigger balance update for UI
                if (!testMode && privateKey) {
                    const balance = await polymarketAPI.getUSDCBalance(privateKey);
                    this.io.emit('balance_update', { usdc: balance });
                }
            } else {
                throw new Error('Sipariş sunucu tarafından onaylanmadı.');
            }
        } catch (error) {
            console.error(`[CopyTrader] İşlem yürütme hatası (Trade ID: ${tradeId}):`, error.message);
            this.db.prepare(`
                UPDATE copied_trades 
                SET status = 'FAILED', error_message = ?, executed_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(error.message, tradeId);

            this.logToDB('ERROR', `[${wallet.label}] İşlem kopyalama hatası: ${error.message}`, { tradeId });

            this.io.emit('trade_failed', {
                tradeId,
                walletLabel: wallet.label,
                marketQuestion: question,
                error: error.message
            });

            this.notificationService.sendErrorNotification(
                `Kopyalama Hatası [${wallet.label}]`,
                `Market: ${question}\nİşlem: ${side} (${outcome})\nHata: ${error.message}`
            );
        }
    }

    /**
     * Handle immediate failure before order creation
     */
    handleTradeFailure(wallet, detectedTrade, calculatedAmount, errorMessage) {
        const { txHash, marketId, question, outcome, side, price } = detectedTrade;
        
        console.error(`[CopyTrader] Kopyalama başarısız: ${errorMessage}`);
        this.saveTradeRecord(wallet.id, txHash, null, marketId, question, outcome, side, detectedTrade.amount, calculatedAmount, price, 'FAILED', errorMessage);
        
        this.logToDB('ERROR', `[${wallet.label}] Kopyalama hatası: ${errorMessage}`, detectedTrade);
        
        this.io.emit('trade_failed', {
            walletLabel: wallet.label,
            marketQuestion: question,
            error: errorMessage
        });

        this.notificationService.sendErrorNotification(
            `Kopyalama Başarısız [${wallet.label}]`,
            `Market: ${question}\nHata: ${errorMessage}`
        );
    }

    /**
     * Save trade details to copied_trades SQLite table
     * 
     * @returns {number} Inserted Row ID
     */
    saveTradeRecord(walletId, originalTx, copyTx, marketId, question, outcome, side, origAmount, copyAmount, price, status, errMsg = null) {
        const stmt = this.db.prepare(`
            INSERT INTO copied_trades (
                wallet_id, original_tx_hash, copy_tx_hash, market_id, market_question, 
                outcome, side, original_amount, copied_amount, price, status, error_message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(walletId, originalTx, copyTx, marketId, question, outcome, side, origAmount, copyAmount, price, status, errMsg);
        return Number(result.lastInsertRowid);
    }

    /**
     * Update aggregated statistics for a tracked wallet
     */
    updateWalletStatistics(walletId) {
        try {
            // Count total successful trades
            const totalTradesRow = this.db.prepare(`
                SELECT COUNT(*) as total FROM copied_trades 
                WHERE wallet_id = ? AND status = 'SUCCESS'
            `).get(walletId);
            
            const totalTrades = totalTradesRow.total || 0;

            // Compute Win Rate (trades with positive profit)
            const winTradesRow = this.db.prepare(`
                SELECT COUNT(*) as wins FROM copied_trades 
                WHERE wallet_id = ? AND status = 'SUCCESS' AND profit_loss > 0
            `).get(walletId);

            const wins = winTradesRow.wins || 0;
            const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0.0;

            // Sum Profit Loss
            const pnlRow = this.db.prepare(`
                SELECT SUM(profit_loss) as total_pnl FROM copied_trades 
                WHERE wallet_id = ? AND status = 'SUCCESS'
            `).get(walletId);

            const totalPnL = parseFloat(pnlRow.total_pnl || 0);

            // Save stats
            this.db.prepare(`
                UPDATE tracked_wallets 
                SET total_trades = ?, win_rate = ?, total_profit_loss = ?
                WHERE id = ?
            `).run(totalTrades, winRate, totalPnL, walletId);

        } catch (error) {
            console.error(`updateWalletStatistics failed for wallet ${walletId}:`, error.message);
        }
    }

    /**
     * Append record to trade_log table
     */
    logToDB(level, message, metadata = null) {
        try {
            const metaString = metadata ? JSON.stringify(metadata) : null;
            this.db.prepare(`
                INSERT INTO trade_log (level, message, metadata) 
                VALUES (?, ?, ?)
            `).run(level, message, metaString);

            // Stream log to front-end live box
            this.io.emit('log_entry', {
                level,
                message,
                timestamp: new Date().toISOString()
            });
        } catch (err) {
            console.error('logToDB failed:', err.message);
        }
    }
}

module.exports = CopyTrader;
