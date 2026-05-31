/**
 * Settings Controller (settings.js)
 * Coordinates CRUD operations for configs, wallet connection tests, Telegram tests, spend approvals, and emergency locks.
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Fetch current database settings
    loadSettings();

    // 2. Hide/Show key trigger
    document.getElementById('btn-toggle-key-visibility').addEventListener('click', toggleKeyVisibility);

    // 3. Test handlers
    document.getElementById('btn-test-connection').addEventListener('click', testWalletConnection);
    document.getElementById('btn-test-telegram').addEventListener('click', testTelegramConnection);

    // 4. Save updates
    document.getElementById('btn-save-settings').addEventListener('click', saveAllSettings);

    // 5. Danger Zone actions
    document.getElementById('btn-approve-usdc').addEventListener('click', sendUSDCApproval);
    document.getElementById('btn-clear-history').addEventListener('click', clearTradeHistory);
    document.getElementById('btn-emergency-stop').addEventListener('click', triggerEmergencyStop);
});

/**
 * Loads current system settings from API
 */
async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        const settings = await res.json();

        // Bind form values
        if (settings.private_key) {
            document.getElementById('set-private-key').value = settings.private_key;
        }

        document.getElementById('set-test-mode').checked = parseInt(settings.test_mode || '1') === 1;
        document.getElementById('set-copy-existing').checked = parseInt(settings.copy_existing_trades || '0') === 1;
        document.getElementById('set-daily-loss').value = settings.daily_loss_limit || '500';
        document.getElementById('set-max-single-trade').value = settings.max_single_trade_usdc || '250';
        document.getElementById('set-max-positions').value = settings.max_open_positions || '10';
        document.getElementById('set-slippage').value = settings.slippage_tolerance || '5';
        document.getElementById('set-scan-interval').value = settings.scan_interval || '30';
        document.getElementById('set-default-tp').value = settings.default_tp || '0';
        document.getElementById('set-default-sl').value = settings.default_sl || '0';

        document.getElementById('set-tg-token').value = settings.telegram_bot_token || '';
        document.getElementById('set-tg-chat-id').value = settings.telegram_chat_id || '';

        document.getElementById('notify-success').checked = parseInt(settings.notification_success || '1') === 1;
        document.getElementById('notify-fail').checked = parseInt(settings.notification_fail || '1') === 1;
        document.getElementById('notify-error').checked = parseInt(settings.notification_error || '1') === 1;

        // Fetch emergency status to update button
        const statusRes = await fetch('/api/bot/status');
        const status = await statusRes.json();
        updateEmergencyButtonUI(status.emergencyStop);

    } catch (e) {
        console.error('loadSettings error:', e);
    }
}

/**
 * Handle save updates
 */
async function saveAllSettings() {
    const btn = document.getElementById('btn-save-settings');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Kaydediliyor...`;

    const private_key = document.getElementById('set-private-key').value.trim();
    const test_mode = document.getElementById('set-test-mode').checked ? '1' : '0';
    const copy_existing_trades = document.getElementById('set-copy-existing').checked ? '1' : '0';
    const daily_loss_limit = document.getElementById('set-daily-loss').value.trim();
    const max_single_trade_usdc = document.getElementById('set-max-single-trade').value.trim();
    const max_open_positions = document.getElementById('set-max-positions').value.trim();
    const slippage_tolerance = document.getElementById('set-slippage').value.trim();
    const scan_interval = document.getElementById('set-scan-interval').value.trim();
    const default_tp = document.getElementById('set-default-tp').value.trim();
    const default_sl = document.getElementById('set-default-sl').value.trim();

    // Scan interval validation (minimum 0.01 seconds / 10ms)
    const scanIntervalNum = parseFloat(scan_interval);
    if (isNaN(scanIntervalNum) || scanIntervalNum < 0.01) {
        alert('Tarama aralığı en az 0.01 saniye (10 milisaniye) olmalıdır.');
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Ayarları Kaydet`;
        return;
    }


    const telegram_bot_token = document.getElementById('set-tg-token').value.trim();
    const telegram_chat_id = document.getElementById('set-tg-chat-id').value.trim();

    const notification_success = document.getElementById('notify-success').checked ? '1' : '0';
    const notification_fail = document.getElementById('notify-fail').checked ? '1' : '0';
    const notification_error = document.getElementById('notify-error').checked ? '1' : '0';

    const payload = {
        private_key,
        test_mode,
        copy_existing_trades,
        daily_loss_limit,
        max_single_trade_usdc,
        max_open_positions,
        slippage_tolerance,
        scan_interval,
        default_tp,
        default_sl,
        telegram_bot_token,
        telegram_chat_id,
        notification_success,
        notification_fail,
        notification_error
    };

    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (res.ok) {
            alert('Ayarlar başarıyla kaydedildi!');
            loadSettings(); // Reload to refresh masked key
        } else {
            alert('Hata: ' + data.error);
        }
    } catch (err) {
        console.error('saveSettings error:', err);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Ayarları Kaydet`;
    }
}

/**
 * Handle private key visibility toggles
 */
function toggleKeyVisibility() {
    const input = document.getElementById('set-private-key');
    const icon = document.querySelector('#btn-toggle-key-visibility i');

    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fa-regular fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fa-regular fa-eye';
    }
}

/**
 * Test RPC wallet connections
 */
async function testWalletConnection() {
    const resultDiv = document.getElementById('connection-test-result');
    resultDiv.classList.remove('hidden');
    resultDiv.className = 'text-xs text-slate-400 flex items-center gap-1.5';
    resultDiv.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Bağlantı test ediliyor...`;

    const privateKey = document.getElementById('set-private-key').value.trim();

    try {
        const res = await fetch('/api/settings/test-privatekey', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ private_key: privateKey })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            const shortAddr = data.address.substring(0, 6) + '...' + data.address.substring(data.address.length - 4);
            const approvalBadge = data.approved 
                ? '<span class="text-success font-bold"><i class="fa-solid fa-circle-check"></i> USDC Approved</span>' 
                : '<span class="text-danger font-bold"><i class="fa-solid fa-circle-xmark"></i> USDC Not Approved</span>';

            resultDiv.className = 'text-xs text-success font-semibold space-y-1 block mt-2';
            resultDiv.innerHTML = `
                <div>🟢 Bağlantı Başarılı!</div>
                <div><b>Cüzdan:</b> ${data.address}</div>
                <div><b>Bakiye:</b> ${parseFloat(data.balance).toFixed(2)} USDC</div>
                <div><b>Kontrat Onayı:</b> ${approvalBadge}</div>
            `;
        } else {
            resultDiv.className = 'text-xs text-danger font-semibold block mt-2';
            resultDiv.innerHTML = `🔴 Bağlantı Başarısız: ${data.error}`;
        }
    } catch (err) {
        resultDiv.className = 'text-xs text-danger font-semibold block mt-2';
        resultDiv.innerHTML = `🔴 Sistem hatası: Bağlantı kurulamadı.`;
    }
}

/**
 * Sends a validation telegram message
 */
async function testTelegramConnection() {
    const btn = document.getElementById('btn-test-telegram');
    btn.disabled = true;
    btn.innerText = 'Test Gönderiliyor...';

    // First save settings to ensure current token is stored
    const token = document.getElementById('set-tg-token').value.trim();
    const chatId = document.getElementById('set-tg-chat-id').value.trim();

    if (!token || !chatId) {
        alert('Lütfen önce Telegram Bot Token ve Chat ID bilgilerini doldurun.');
        btn.disabled = false;
        btn.innerText = 'Telegram Bağlantısını Test Et';
        return;
    }

    try {
        const res = await fetch('/api/settings/test-telegram', { method: 'POST' });
        const data = await res.json();

        if (res.ok && data.success) {
            alert('Test mesajı Telegram adresinize başarıyla gönderildi! Lütfen sohbet kutunuzu kontrol edin.');
        } else {
            alert('Hata: ' + data.error);
        }
    } catch (e) {
        alert('Test mesajı gönderme hatası. Bilgilerinizi kontrol edin.');
    } finally {
        btn.disabled = false;
        btn.innerText = 'Telegram Bağlantısını Test Et';
    }
}

/**
 * Request spender contract approval for CTF
 */
async function sendUSDCApproval() {
    if (!confirm('CTF Exchange kontratı için USDC approve işlemi gönderilsin mi? Bu işlem Polygon mainnet üzerinde yürütülür ve MATIC gas ücreti gerektirir.')) {
        return;
    }

    const btn = document.getElementById('btn-approve-usdc');
    btn.disabled = true;
    btn.innerText = 'Approve İşlemi Gönderiliyor...';

    try {
        const res = await fetch('/api/settings/approve-usdc', { method: 'POST' });
        const data = await res.json();

        if (res.ok && data.success) {
            alert(`USDC Approve işlemi başarıyla gönderildi! Tx Hash: ${data.txHash}`);
        } else {
            alert('Approve Hatası: ' + data.error);
        }
    } catch (e) {
        alert('Kritik Hata: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerText = 'Spender Onayı Gönder (Approve)';
    }
}

/**
 * Reset trade histories
 */
async function clearTradeHistory() {
    if (!confirm('İşlem geçmişini ve cüzdan istatistiklerini temizlemek istediğinize emin misiniz? Bu işlem geri ALINAMAZ.')) {
        return;
    }

    try {
        const res = await fetch('/api/settings/clear-history', { method: 'POST' });
        const data = await res.json();

        if (res.ok && data.success) {
            alert('Tüm işlem geçmişi ve kopyalama istatistikleri başarıyla sıfırlandı.');
        } else {
            alert('Hata: ' + data.error);
        }
    } catch (e) {
        alert('Hata oluştu: ' + e.message);
    }
}

/**
 * Toggle emergency lock override
 */
async function triggerEmergencyStop() {
    try {
        const res = await fetch('/api/bot/emergency-stop', { method: 'POST' });
        const data = await res.json();

        if (res.ok && data.success) {
            updateEmergencyButtonUI(data.emergencyStop);
            alert(data.message);
        } else {
            alert('Hata: ' + data.error);
        }
    } catch (e) {
        alert('Hata oluştu: ' + e.message);
    }
}

function updateEmergencyButtonUI(isStopped) {
    const btn = document.getElementById('btn-emergency-stop');
    if (isStopped) {
        btn.innerHTML = `<i class="fa-solid fa-play"></i> ACİL DURUMU KALDIR`;
        btn.className = 'w-full sm:w-auto p-3.5 px-6 font-bold text-sm rounded-xl text-darkbg bg-accent hover:bg-accenthover transition flex items-center justify-center gap-2';
    } else {
        btn.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ACİL BOTU DURDUR`;
        btn.className = 'w-full sm:w-auto p-3.5 px-6 font-bold text-sm rounded-xl text-white pulse-red transition flex items-center justify-center gap-2';
    }
}
