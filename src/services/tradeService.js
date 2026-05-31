/**
 * Trade Service (tradeService.js)
 * Handles trade queries, stats aggregation, time series calculations, and demo seed data.
 */

class TradeService {
    constructor(db) {
        this.db = db;
    }

    /**
     * Get all copied trades with pagination and filters
     * 
     * @param {Object} filters - { wallet_id, status, startDate, endDate, page, limit }
     * @returns {Object} { trades, total, page, limit, totalPages }
     */
    getTrades(filters = {}) {
        const page = parseInt(filters.page || '1');
        const limit = parseInt(filters.limit || '10');
        const offset = (page - 1) * limit;

        let query = `
            SELECT t.*, w.label as wallet_label, w.address as wallet_address 
            FROM copied_trades t
            JOIN tracked_wallets w ON t.wallet_id = w.id
            WHERE 1=1
        `;
        let countQuery = `
            SELECT COUNT(*) as count 
            FROM copied_trades t
            JOIN tracked_wallets w ON t.wallet_id = w.id
            WHERE 1=1
        `;
        
        const params = [];

        if (filters.wallet_id) {
            query += ' AND t.wallet_id = ?';
            countQuery += ' AND t.wallet_id = ?';
            params.push(filters.wallet_id);
        }

        if (filters.status) {
            query += ' AND t.status = ?';
            countQuery += ' AND t.status = ?';
            params.push(filters.status.toUpperCase());
        }

        if (filters.startDate) {
            query += ' AND t.created_at >= ?';
            countQuery += ' AND t.created_at >= ?';
            params.push(filters.startDate);
        }

        if (filters.endDate) {
            query += ' AND t.created_at <= ?';
            countQuery += ' AND t.created_at <= ?';
            params.push(filters.endDate);
        }

        // Order by date descending
        query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
        const queryParams = [...params, limit, offset];

        try {
            const countRow = this.db.prepare(countQuery).get(...params);
            const total = countRow ? countRow.count : 0;
            
            const trades = this.db.prepare(query).all(...queryParams);
            const totalPages = Math.ceil(total / limit);

            return {
                trades,
                total,
                page,
                limit,
                totalPages
            };
        } catch (error) {
            console.error('getTrades database error:', error.message);
            throw error;
        }
    }

    /**
     * Get details of a single trade by ID
     */
    getTradeById(id) {
        try {
            return this.db.prepare(`
                SELECT t.*, w.label as wallet_label, w.address as wallet_address 
                FROM copied_trades t
                JOIN tracked_wallets w ON t.wallet_id = w.id
                WHERE t.id = ?
            `).get(id);
        } catch (error) {
            console.error('getTradeById database error:', error.message);
            throw error;
        }
    }

    /**
     * Get aggregate KPI values for dashboard
     */
    getDashboardSummary() {
        try {
            // 1. Wallets summary
            const walletCountRow = this.db.prepare(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active
                FROM tracked_wallets
            `).get();

            // 2. Trades summary
            const tradesRow = this.db.prepare(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as success,
                    SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
                    SUM(CASE WHEN status = 'SKIPPED' THEN 1 ELSE 0 END) as skipped,
                    SUM(profit_loss) as total_pnl
                FROM copied_trades
            `).get();

            // Win rate = successful trades with positive pnl / total successful trades
            const winTradesRow = this.db.prepare(`
                SELECT COUNT(*) as wins 
                FROM copied_trades 
                WHERE status = 'SUCCESS' AND profit_loss > 0
            `).get();

            const totalSuccess = tradesRow.success || 0;
            const wins = winTradesRow.wins || 0;
            const winRate = totalSuccess > 0 ? (wins / totalSuccess) * 100 : 0.0;

            // 3. Today's volume (copied amount where status is SUCCESS, executed in last 24h)
            const startOfDay = new Date();
            startOfDay.setHours(0,0,0,0);
            const isoToday = startOfDay.toISOString();

            const volumeRow = this.db.prepare(`
                SELECT SUM(copied_amount * price) as daily_volume 
                FROM copied_trades 
                WHERE status = 'SUCCESS' AND executed_at >= ?
            `).get(isoToday);

            return {
                total_wallets: walletCountRow.total || 0,
                active_wallets: walletCountRow.active || 0,
                total_trades: tradesRow.total || 0,
                successful_trades: totalSuccess,
                failed_trades: tradesRow.failed || 0,
                skipped_trades: tradesRow.skipped || 0,
                total_pnl: parseFloat(tradesRow.total_pnl || 0),
                win_rate: parseFloat(winRate.toFixed(1)),
                today_volume: parseFloat(volumeRow.daily_volume || 0)
            };
        } catch (error) {
            console.error('getDashboardSummary database error:', error.message);
            throw error;
        }
    }

    /**
     * Get P&L time-series data for Chart.js
     * Computes cumulative P&L sequence chronologically.
     * 
     * @param {string} timeframe - '24S', '7G', '30G', 'all'
     * @returns {Array} List of { timestamp, pnl, cumulativePnL }
     */
    getPnLTimeSeries(timeframe = 'all') {
        try {
            let filterQuery = "WHERE status = 'SUCCESS'";
            const params = [];

            if (timeframe === '24S') {
                const limitDate = new Date();
                limitDate.setHours(limitDate.getHours() - 24);
                filterQuery += ' AND executed_at >= ?';
                params.push(limitDate.toISOString());
            } else if (timeframe === '7G') {
                const limitDate = new Date();
                limitDate.setDate(limitDate.getDate() - 7);
                filterQuery += ' AND executed_at >= ?';
                params.push(limitDate.toISOString());
            } else if (timeframe === '30G') {
                const limitDate = new Date();
                limitDate.setDate(limitDate.getDate() - 30);
                filterQuery += ' AND executed_at >= ?';
                params.push(limitDate.toISOString());
            }

            // Retrieve all chronologically
            const trades = this.db.prepare(`
                SELECT executed_at, profit_loss, side, outcome, market_question
                FROM copied_trades
                ${filterQuery}
                ORDER BY executed_at ASC
            `).all(...params);

            let cumulative = 0.0;
            const points = [];

            // Add starting point
            points.push({
                timestamp: timeframe === '24S' || timeframe === '7G' ? new Date(Date.now() - 86400000 * 2).toISOString() : new Date(Date.now() - 86400000 * 45).toISOString(),
                pnl: 0,
                cumulativePnL: 0,
                label: 'Bot Başlangıcı'
            });

            trades.forEach(t => {
                const pnl = parseFloat(t.profit_loss || 0);
                cumulative += pnl;
                
                points.push({
                    timestamp: t.executed_at,
                    pnl: pnl,
                    cumulativePnL: parseFloat(cumulative.toFixed(2)),
                    label: `${t.side} - ${t.outcome} (${t.market_question.substring(0, 15)}...)`
                });
            });

            return points;
        } catch (error) {
            console.error('getPnLTimeSeries database error:', error.message);
            throw error;
        }
    }

    /**
     * Create mock demo data if database is empty.
     * Inserts 2 wallets and 5 mock copied trades to immediately showcase dashboard features.
     */
    seedDemoData() {
        try {
            // Check if wallets exist
            const walletCount = this.db.prepare('SELECT COUNT(*) as count FROM tracked_wallets').get().count;
            if (walletCount > 0) return; // DB already has data

            console.log('[TradeService] Veritabanı boş. Arayüz için demo verileri ekleniyor...');

            // 1. Insert 2 tracked wallets
            const w1Result = this.db.prepare(`
                INSERT INTO tracked_wallets (address, label, is_active, min_trade_amount, max_copy_amount, copy_percentage, total_profit_loss, win_rate, total_trades)
                VALUES ('0xeE2D27d4204F2F1FaEFE1057eD1cFE825E674681', 'Smart Money - Whale 1', 1, 10.0, 250.0, 100.0, 315.50, 75.0, 4)
            `).run();
            const w1Id = Number(w1Result.lastInsertRowid);

            const w2Result = this.db.prepare(`
                INSERT INTO tracked_wallets (address, label, is_active, min_trade_amount, max_copy_amount, copy_percentage, total_profit_loss, win_rate, total_trades)
                VALUES ('0x8a927a483Cd8DC4eD66522c062CEFfCcf286bC3a', 'Alpha Trader 2', 1, 5.0, 100.0, 50.0, -25.20, 0.0, 1)
            `).run();
            const w2Id = Number(w2Result.lastInsertRowid);

            // 2. Insert 5 copied trades with different timestamps
            const now = new Date();
            
            // Trade 1: Successful trade from wallet 1 (profit)
            const d1 = new Date(); d1.setDate(now.getDate() - 5);
            this.db.prepare(`
                INSERT INTO copied_trades (wallet_id, original_tx_hash, copy_tx_hash, market_id, market_question, outcome, side, original_amount, copied_amount, price, status, profit_loss, created_at, executed_at)
                VALUES (?, '0xorig_hash_1', '0xcopy_hash_1', 'market_pol_1', 'ABD 2024 Seçimini Donald Trump mı Kazanacak?', 'Yes', 'BUY', 500.0, 250.0, 0.52, 'SUCCESS', 150.00, ?, ?)
            `).run(w1Id, d1.toISOString(), d1.toISOString());

            // Trade 2: Another successful trade from wallet 1 (profit)
            const d2 = new Date(); d2.setDate(now.getDate() - 3);
            this.db.prepare(`
                INSERT INTO copied_trades (wallet_id, original_tx_hash, copy_tx_hash, market_id, market_question, outcome, side, original_amount, copied_amount, price, status, profit_loss, created_at, executed_at)
                VALUES (?, '0xorig_hash_2', '0xcopy_hash_2', 'market_pol_2', 'FED Haziran Ayında Faiz İndirecek mi?', 'No', 'BUY', 200.0, 200.0, 0.65, 'SUCCESS', 165.50, ?, ?)
            `).run(w1Id, d2.toISOString(), d2.toISOString());

            // Trade 3: Unsuccessful trade from wallet 2 (loss)
            const d3 = new Date(); d3.setDate(now.getDate() - 2);
            this.db.prepare(`
                INSERT INTO copied_trades (wallet_id, original_tx_hash, copy_tx_hash, market_id, market_question, outcome, side, original_amount, copied_amount, price, status, profit_loss, created_at, executed_at)
                VALUES (?, '0xorig_hash_3', '0xcopy_hash_3', 'market_pol_3', 'Ethereum 2026 sonunda 5000 doları aşacak mı?', 'Yes', 'BUY', 150.0, 75.0, 0.45, 'SUCCESS', -25.20, ?, ?)
            `).run(w2Id, d3.toISOString(), d3.toISOString());

            // Trade 4: Failed trade (Contract execution error simulation)
            const d4 = new Date(); d4.setDate(now.getDate() - 1);
            this.db.prepare(`
                INSERT INTO copied_trades (wallet_id, original_tx_hash, copy_tx_hash, market_id, market_question, outcome, side, original_amount, copied_amount, price, status, profit_loss, error_message, created_at, executed_at)
                VALUES (?, '0xorig_hash_4', NULL, 'market_pol_4', 'Bitcoin bu hafta sonu 75k doları görecek mi?', 'Yes', 'BUY', 300.0, 250.0, 0.35, 'FAILED', 0.0, 'Slippage limit reached (actual 12% > allowance 5%)', ?, ?)
            `).run(w1Id, d4.toISOString(), d4.toISOString());

            // Trade 5: Skipped trade (Sizing too small simulation)
            const d5 = new Date();
            this.db.prepare(`
                INSERT INTO copied_trades (wallet_id, original_tx_hash, copy_tx_hash, market_id, market_question, outcome, side, original_amount, copied_amount, price, status, profit_loss, error_message, created_at, executed_at)
                VALUES (?, '0xorig_hash_5', NULL, 'market_pol_5', 'Polkadot 2.0 lansmanı Q3''te tamamlanacak mı?', 'Yes', 'BUY', 5.0, 1.0, 0.88, 'SKIPPED', 0.0, 'İşlem miktarı ($1.00) cüzdan minimum işlem limitinin ($10.00) altında, atlandı.', ?, ?)
            `).run(w1Id, d5.toISOString(), d5.toISOString());

            // 3. Insert some demo logs
            this.db.prepare(`
                INSERT INTO trade_log (level, message, created_at)
                VALUES ('INFO', 'Sistem başarıyla kuruldu. Veritabanı ve tablolar ilklendirildi.', ?)
            `).run(d1.toISOString());

            this.db.prepare(`
                INSERT INTO trade_log (level, message, created_at)
                VALUES ('INFO', 'Cüzdan Smart Money - Whale 1 takibe alındı.', ?)
            `).run(d1.toISOString());

            this.db.prepare(`
                INSERT INTO trade_log (level, message, created_at)
                VALUES ('INFO', 'Cüzdan Alpha Trader 2 takibe alındı.', ?)
            `).run(d3.toISOString());

            this.db.prepare(`
                INSERT INTO trade_log (level, message, created_at)
                VALUES ('WARN', 'Bitcoin işlem kopyalama başarısız oldu. Hata: Slippage limit reached.', ?)
            `).run(d4.toISOString());

            console.log('[TradeService] Demo verileri veritabanına başarıyla yerleştirildi.');
        } catch (error) {
            console.error('seedDemoData database error:', error.message);
        }
    }
}

module.exports = TradeService;
