const TelegramBot = require('node-telegram-bot-api');

/**
 * Notification Service (notificationService.js)
 * Manages Telegram bot messaging and alerts with database integration for state tracking.
 */

class NotificationService {
    constructor(db) {
        this.db = db;
        this.bot = null;
        this.lastToken = null;
    }

    /**
     * Helper to retrieve current Telegram settings from the database
     */
    getSettings() {
        try {
            const rows = this.db.prepare('SELECT key, value FROM bot_settings').all();
            const settings = {};
            rows.forEach(r => {
                settings[r.key] = r.value;
            });
            return settings;
        } catch (error) {
            console.error('getSettings error in NotificationService:', error.message);
            return {};
        }
    }

    /**
     * Initializes or reinstantiates the Telegram Bot instance if settings change
     */
    initBot() {
        const settings = this.getSettings();
        const token = settings.telegram_bot_token;

        if (!token || token.trim() === '') {
            this.bot = null;
            this.lastToken = null;
            return null;
        }

        // Recreate bot instance if token changed
        if (this.bot && this.lastToken === token) {
            return this.bot;
        }

        try {
            // Instantiate without polling (we only send messages, we don't listen to commands in this setup)
            this.bot = new TelegramBot(token.trim(), { polling: false });
            this.lastToken = token;
            return this.bot;
        } catch (error) {
            console.error('Telegram bot init error:', error.message);
            this.bot = null;
            this.lastToken = null;
            return null;
        }
    }

    /**
     * Core message sender
     * 
     * @param {string} message - Text formatted with HTML
     */
    async sendMessage(message) {
        const bot = this.initBot();
        if (!bot) return; // Telegram not configured

        const settings = this.getSettings();
        const chatId = settings.telegram_chat_id;

        if (!chatId || chatId.trim() === '') {
            console.warn('[Telegram] Chat ID ayarlanmadığı için bildirim gönderilemedi.');
            return;
        }

        try {
            await bot.sendMessage(chatId.trim(), message, { parse_mode: 'HTML' });
            console.log('[Telegram] Bildirim başarıyla gönderildi.');
        } catch (error) {
            console.error('[Telegram] Mesaj gönderme hatası:', error.message);
        }
    }

    /**
     * Send Trade Execution notification
     */
    async sendTradeNotification(tradeData) {
        const settings = this.getSettings();
        
        // Check if trade notification is enabled in settings
        const isSuccess = tradeData.status === 'SUCCESS';
        const isFail = tradeData.status === 'FAILED';

        if (isSuccess && parseInt(settings.notification_success || '1') !== 1) return;
        if (isFail && parseInt(settings.notification_fail || '1') !== 1) return;

        const { walletLabel, question, side, amount, price, outcome, txHash, isSimulated } = tradeData;

        let statusText = isSuccess ? '🟢 BAŞARILI' : '🔴 BAŞARISIZ';
        let simulationText = isSimulated ? '⚠️ [SİMÜLASYON MODU]' : '⚡ [POLYGON MAINNET]';

        let message = `
<b>🔔 PolyTrader işlem kopyalandı!</b>
${simulationText}

<b>Cüzdan:</b> ${walletLabel}
<b>Durum:</b> ${statusText}
<b>İşlem:</b> ${side.toUpperCase()} - ${amount.toFixed(1)} adet (${outcome})
<b>Fiyat:</b> $${price.toFixed(2)}
<b>Toplam Maliyet:</b> $${(amount * price).toFixed(2)} USDC

<b>Market Sorusu:</b>
<i>${question}</i>

${txHash ? `<b>İşlem Hash/ID:</b>
<code>${txHash}</code>` : ''}
`;
        await this.sendMessage(message.trim());
    }

    /**
     * Send general system error alerts
     */
    async sendErrorNotification(title, errorMessage) {
        const settings = this.getSettings();
        if (parseInt(settings.notification_error || '1') !== 1) return;

        let message = `
<b>⚠️ PolyTrader Kritik Hata Bildirimi!</b>

<b>Konu:</b> ${title}
<b>Zaman:</b> ${new Date().toLocaleString('tr-TR')}

<b>Hata Mesajı:</b>
<code>${errorMessage}</code>

<i>Lütfen bot panelini kontrol edin.</i>
`;
        await this.sendMessage(message.trim());
    }

    /**
     * Trigger a mock test message to verify Telegram setup
     */
    async sendTestMessage() {
        let message = `
<b>🧪 PolyTrader Test Bildirimi</b>
Zaman: ${new Date().toLocaleString('tr-TR')}

Eğer bu mesajı görüyorsanız, Telegram Bot Token ve Chat ID yapılandırmanız <b>başarıyla tamamlanmıştır!</b> 🚀
`;
        await this.sendMessage(message.trim());
    }
}

module.exports = NotificationService;
