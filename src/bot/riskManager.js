/**
 * Risk Manager Module (riskManager.js)
 * Validates risk limits, trade sizes, and daily statistics against bot configurations.
 */

/**
 * Check if the bot is allowed to trade based on configured risk parameters.
 * 
 * @param {Object} db - SQLite Database connection
 * @param {number} requestedAmount - Proposed trade amount in USDC
 * @returns {Promise<Object>} Object { allowed: boolean, reason: string|null, cappedAmount: number }
 */
function checkRiskLimits(db, requestedAmount) {
    try {
        // 1. Fetch current bot settings
        const settingsRows = db.prepare('SELECT key, value FROM bot_settings').all();
        const settings = {};
        settingsRows.forEach(row => {
            settings[row.key] = row.value;
        });

        // Parse risk configurations
        const emergencyStop = parseInt(settings.emergency_stop || '0') === 1;
        const maxSingleTrade = parseFloat(settings.max_single_trade_usdc || '100');
        const dailyLossLimit = parseFloat(settings.daily_loss_limit || '500');
        const maxOpenPositions = parseInt(settings.max_open_positions || '10');

        // Check 1: Manual Emergency Stop
        if (emergencyStop) {
            return {
                allowed: false,
                reason: 'Acil durdurma (Emergency Stop) aktif. Bot işlemleri askıya aldı.',
                cappedAmount: 0
            };
        }

        // Check 2: Single Trade USDC Limit
        let finalAmount = requestedAmount;
        if (requestedAmount > maxSingleTrade) {
            console.log(`Risk uyarısı: İşlem miktarı ($${requestedAmount}) tek işlem limitini ($${maxSingleTrade}) aşıyor. Miktar limit değerine düşürüldü.`);
            finalAmount = maxSingleTrade;
        }

        // Check 3: Daily Loss Limit
        // Calculate cumulative profit/loss for today
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const isoStartOfDay = startOfDay.toISOString();

        const todayPnLRow = db.prepare(`
            SELECT SUM(profit_loss) as total_pnl 
            FROM copied_trades 
            WHERE status = 'SUCCESS' 
            AND executed_at >= ?
        `).get(isoStartOfDay);

        const todayPnL = parseFloat(todayPnLRow.total_pnl || 0);
        
        // If we lost more than the allowed loss limit (PnL is negative, e.g., todayPnL = -600 and dailyLossLimit = 500)
        if (todayPnL < 0 && Math.abs(todayPnL) >= dailyLossLimit) {
            return {
                allowed: false,
                reason: `Günlük zarar limiti ($${dailyLossLimit}) aşıldı. Anlık günlük zarar: $${Math.abs(todayPnL).toFixed(2)}. İşlem durduruldu.`,
                cappedAmount: 0
            };
        }

        // Check 4: Max Open Positions
        // For simplified copy-trading, let's treat PENDING or trades without matching closing trades as open positions.
        // Let's count "SUCCESS" trades in the last 24 hours that are BUY and haven't been matched by a SELL.
        // For standard prediction market platforms, let's count currently active trades.
        const activePositionsRow = db.prepare(`
            SELECT COUNT(*) as active_count 
            FROM copied_trades 
            WHERE status = 'PENDING'
        `).get();

        const activeCount = parseInt(activePositionsRow.active_count || 0);
        if (activeCount >= maxOpenPositions) {
            return {
                allowed: false,
                reason: `Maksimum açık işlem/pozisyon limiti (${maxOpenPositions}) doldu. Mevcut açık: ${activeCount}.`,
                cappedAmount: 0
            };
        }

        return {
            allowed: true,
            reason: null,
            cappedAmount: finalAmount
        };
    } catch (error) {
        console.error('checkRiskLimits error in RiskManager:', error.message);
        return {
            allowed: false,
            reason: `Risk değerlendirmesi sırasında veritabanı hatası: ${error.message}`,
            cappedAmount: 0
        };
    }
}

module.exports = {
    checkRiskLimits
};
