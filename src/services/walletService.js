const { ethers } = require('ethers');

/**
 * Wallet Service (walletService.js)
 * Manages operations for tracked wallets database entries and statistics.
 */

class WalletService {
    constructor(db) {
        this.db = db;
    }

    /**
     * Get all tracked wallets
     * @returns {Array} List of wallets
     */
    getAllWallets() {
        try {
            return this.db.prepare('SELECT * FROM tracked_wallets ORDER BY id DESC').all();
        } catch (error) {
            console.error('getAllWallets database error:', error.message);
            throw error;
        }
    }

    /**
     * Get single wallet by ID
     * @returns {Object|undefined} Wallet record
     */
    getWalletById(id) {
        try {
            return this.db.prepare('SELECT * FROM tracked_wallets WHERE id = ?').get(id);
        } catch (error) {
            console.error('getWalletById database error:', error.message);
            throw error;
        }
    }

    /**
     * Add a new wallet to be tracked.
     * Validates Ethereum address using ethers.js.
     * 
     * @param {Object} data - { address, label, min_trade_amount, max_copy_amount, copy_percentage, is_active }
     * @returns {Object} Newly created wallet record
     */
    addWallet(data) {
        let { address, label, min_trade_amount, max_copy_amount, copy_percentage, is_active, take_profit_percentage, stop_loss_percentage } = data;

        // 1. Validate Ethereum Address
        if (!address || !ethers.isAddress(address.trim())) {
            throw new Error('Geçersiz Ethereum cüzdan adresi. Lütfen geçerli bir Polygon cüzdanı girin.');
        }

        // Normalize address to checksummed format
        address = ethers.getAddress(address.trim());

        if (!label || label.trim() === '') {
            label = `Cüzdan_${address.substring(2, 8)}`;
        }

        const minTrade = parseFloat(min_trade_amount || '10');
        const maxCopy = parseFloat(max_copy_amount || '100');
        const percentage = parseFloat(copy_percentage || '100');
        const active = is_active === undefined ? 1 : (is_active ? 1 : 0);
        const tp = parseFloat(take_profit_percentage || '0');
        const sl = parseFloat(stop_loss_percentage || '0');

        try {
            // Check if address is already tracked
            const existing = this.db.prepare('SELECT id FROM tracked_wallets WHERE address = ?').get(address);
            if (existing) {
                throw new Error('Bu cüzdan adresi zaten takip listesinde bulunuyor.');
            }

            const stmt = this.db.prepare(`
                INSERT INTO tracked_wallets (
                    address, label, min_trade_amount, max_copy_amount, copy_percentage, is_active, take_profit_percentage, stop_loss_percentage
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const result = stmt.run(address, label, minTrade, maxCopy, percentage, active, tp, sl);
            
            return this.getWalletById(Number(result.lastInsertRowid));
        } catch (error) {
            console.error('addWallet database error:', error.message);
            throw error;
        }
    }

    /**
     * Update configuration for a tracked wallet
     */
    updateWallet(id, data) {
        const { label, min_trade_amount, max_copy_amount, copy_percentage, is_active, take_profit_percentage, stop_loss_percentage } = data;

        const minTrade = parseFloat(min_trade_amount || '10');
        const maxCopy = parseFloat(max_copy_amount || '100');
        const percentage = parseFloat(copy_percentage || '100');
        const active = is_active === undefined ? 1 : (is_active ? 1 : 0);
        const tp = parseFloat(take_profit_percentage || '0');
        const sl = parseFloat(stop_loss_percentage || '0');

        try {
            const existing = this.getWalletById(id);
            if (!existing) {
                throw new Error('Güncellenmek istenen cüzdan bulunamadı.');
            }

            this.db.prepare(`
                UPDATE tracked_wallets 
                SET label = ?, min_trade_amount = ?, max_copy_amount = ?, copy_percentage = ?, is_active = ?, take_profit_percentage = ?, stop_loss_percentage = ?
                WHERE id = ?
            `).run(label || existing.label, minTrade, maxCopy, percentage, active, tp, sl, id);

            return this.getWalletById(id);
        } catch (error) {
            console.error('updateWallet database error:', error.message);
            throw error;
        }
    }

    /**
     * Delete a wallet from list
     */
    deleteWallet(id) {
        try {
            const existing = this.getWalletById(id);
            if (!existing) {
                throw new Error('Silinmek istenen cüzdan bulunamadı.');
            }

            this.db.prepare('DELETE FROM tracked_wallets WHERE id = ?').run(id);
            return { success: true, message: 'Cüzdan başarıyla takip listesinden kaldırıldı.' };
        } catch (error) {
            console.error('deleteWallet database error:', error.message);
            throw error;
        }
    }

    /**
     * Toggle active status of a wallet
     */
    toggleWallet(id) {
        try {
            const wallet = this.getWalletById(id);
            if (!wallet) {
                throw new Error('Cüzdan bulunamadı.');
            }

            const newStatus = wallet.is_active === 1 ? 0 : 1;
            this.db.prepare('UPDATE tracked_wallets SET is_active = ? WHERE id = ?').run(newStatus, id);
            return { success: true, is_active: newStatus };
        } catch (error) {
            console.error('toggleWallet database error:', error.message);
            throw error;
        }
    }

    /**
     * Get detailed performance statistics for a specific wallet
     */
    getWalletStats(id) {
        try {
            const wallet = this.getWalletById(id);
            if (!wallet) {
                throw new Error('Cüzdan bulunamadı.');
            }

            const tradesRow = this.db.prepare(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as success,
                    SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
                    SUM(CASE WHEN status = 'SKIPPED' THEN 1 ELSE 0 END) as skipped,
                    SUM(profit_loss) as pnl
                FROM copied_trades 
                WHERE wallet_id = ?
            `).get(id);

            return {
                wallet,
                total_recorded: tradesRow.total || 0,
                successful: tradesRow.success || 0,
                failed: tradesRow.failed || 0,
                skipped: tradesRow.skipped || 0,
                net_pnl: parseFloat(tradesRow.pnl || 0)
            };
        } catch (error) {
            console.error('getWalletStats database error:', error.message);
            throw error;
        }
    }
}

module.exports = WalletService;
