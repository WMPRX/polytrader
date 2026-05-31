/**
 * Wallets View Controller (wallets.js)
 * Manages tracking list rendering, modal dialog states, form validations, and asynchronous CRUD requests.
 */

// Global state
let walletsList = [];

document.addEventListener('DOMContentLoaded', () => {
    // 1. Load tracked wallets
    loadWallets();

    // 2. Setup slider listener
    const range = document.getElementById('form-percentage');
    const rangeVal = document.getElementById('slider-value');
    range.addEventListener('input', () => {
        rangeVal.innerText = range.value + '%';
    });

    // 3. Setup Modal triggers
    document.getElementById('btn-open-add-modal').addEventListener('click', openAddModal);
    document.getElementById('btn-close-modal').addEventListener('click', closeModal);
    document.getElementById('btn-cancel').addEventListener('click', closeModal);
    
    // 4. Form Submit
    document.getElementById('wallet-form').addEventListener('submit', saveWallet);
});

/**
 * Fetch and render cüzdan card list
 */
async function loadWallets() {
    const grid = document.getElementById('wallets-grid');
    grid.innerHTML = `
        <div class="col-span-full text-center py-12 text-slate-500">
            <i class="fa-solid fa-spinner animate-spin text-2xl mb-2 text-accent"></i>
            <p>Cüzdan listesi yükleniyor...</p>
        </div>
    `;

    try {
        const res = await fetch('/api/wallets');
        const wallets = await res.json();
        
        // Save to global list for inline lookups
        walletsList = wallets;

        grid.innerHTML = '';

        if (wallets.length === 0) {
            grid.innerHTML = `
                <div class="col-span-full text-center py-16 bg-cardbg rounded-2xl border border-white/5 p-8">
                    <i class="fa-solid fa-users-slash text-4xl text-slate-600 mb-4"></i>
                    <h3 class="text-lg font-bold text-white mb-2">Takip Edilen Cüzdan Yok</h3>
                    <p class="text-sm text-slate-400 max-w-md mx-auto mb-6">Polymarket'ta başarılı traderları izlemek için sağ üstteki "Cüzdan Ekle" butonuyla takip listesine ekleyin.</p>
                    <button onclick="openAddModal()" class="btn-accent px-4 py-2 text-xs rounded-lg inline-flex items-center gap-1.5">
                        <i class="fa-solid fa-plus"></i> Cüzdan Ekle
                    </button>
                </div>
            `;
            return;
        }

        wallets.forEach(wallet => {
            const card = document.createElement('div');
            card.className = 'glass-card p-6 flex flex-col justify-between';

            // Short address format
            const shortAddr = wallet.address.substring(0, 6) + '...' + wallet.address.substring(wallet.address.length - 4);
            const statusBadge = wallet.is_active === 1 
                ? '<span class="badge-success text-[10px] font-bold px-2 py-0.5 rounded">AKTİF</span>'
                : '<span class="badge-muted text-[10px] font-bold px-2 py-0.5 rounded">PASİF</span>';

            // Profit / Loss display
            const pnlVal = parseFloat(wallet.total_profit_loss || 0);
            let pnlClass = 'text-slate-300';
            if (pnlVal > 0) pnlClass = 'text-success font-bold';
            else if (pnlVal < 0) pnlClass = 'text-danger font-bold';

            card.innerHTML = `
                <div>
                    <!-- Card Header: Title & Toggle -->
                    <div class="flex items-start justify-between gap-4 mb-3">
                        <div>
                            <h3 class="font-bold text-white text-base truncate max-w-[160px]" title="${wallet.label}">${wallet.label}</h3>
                            <div class="flex items-center gap-1.5 mt-1">
                                <span class="text-xs font-mono text-slate-400" title="${wallet.address}">${shortAddr}</span>
                                <button class="btn-copy text-slate-500 hover:text-white text-[10px] transition" title="Kopyala">
                                    <i class="fa-regular fa-copy"></i>
                                </button>
                                <a href="https://polygonscan.com/address/${wallet.address}" target="_blank" class="text-slate-500 hover:text-white text-[10px] transition" title="Polygonscan'de Gör">
                                    <i class="fa-solid fa-external-link"></i>
                                </a>
                            </div>
                        </div>
                        ${statusBadge}
                    </div>

                    <!-- Performance Stats Grid -->
                    <div class="grid grid-cols-3 gap-2 bg-black/20 p-3 rounded-xl border border-white/5 my-4 text-center">
                        <div>
                            <span class="block text-[10px] text-slate-400 uppercase">Toplam</span>
                            <span class="text-sm font-extrabold text-white">${wallet.total_trades}</span>
                        </div>
                        <div>
                            <span class="block text-[10px] text-slate-400 uppercase">Kazanma %</span>
                            <span class="text-sm font-extrabold text-white">${parseFloat(wallet.win_rate || 0).toFixed(0)}%</span>
                        </div>
                        <div>
                            <span class="block text-[10px] text-slate-400 uppercase">P&L (USDC)</span>
                            <span class="text-sm ${pnlClass}">${pnlVal >= 0 ? '+' : ''}${pnlVal.toFixed(1)}</span>
                        </div>
                    </div>

                    <!-- Config Summary -->
                    <div class="space-y-1.5 text-xs border-b border-white/5 pb-4 mb-4 text-slate-400">
                        <div class="flex justify-between">
                            <span>Kopyalama Yüzdesi:</span>
                            <span class="text-white font-semibold">${wallet.copy_percentage}%</span>
                        </div>
                        <div class="flex justify-between">
                            <span>Min İşlem Limiti:</span>
                            <span class="text-white font-semibold">$${wallet.min_trade_amount} USDC</span>
                        </div>
                        <div class="flex justify-between">
                            <span>Maks Kopya Limiti:</span>
                            <span class="text-white font-semibold">$${wallet.max_copy_amount} USDC</span>
                        </div>
                        <div class="flex justify-between">
                            <span>Kar Alma (TP):</span>
                            <span class="text-white font-semibold">${wallet.take_profit_percentage > 0 ? '%' + wallet.take_profit_percentage : 'Pasif'}</span>
                        </div>
                        <div class="flex justify-between">
                            <span>Zarar Durdurma (SL):</span>
                            <span class="text-white font-semibold">${wallet.stop_loss_percentage > 0 ? '%' + wallet.stop_loss_percentage : 'Pasif'}</span>
                        </div>
                    </div>
                </div>

                <!-- Footer Operations Buttons -->
                <div class="flex items-center justify-between gap-3 pt-2">
                    <button class="btn-toggle text-xs p-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold flex-grow transition">
                        ${wallet.is_active === 1 ? '<i class="fa-solid fa-ban mr-1"></i> Duraklat' : '<i class="fa-solid fa-play mr-1"></i> Aktif Et'}
                    </button>
                    <button class="btn-edit text-xs p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition" title="Düzenle">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-delete text-xs p-2 rounded-lg bg-danger/10 hover:bg-danger/20 text-danger border border-danger/20 transition" title="Sil">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            `;

            // Attach dynamic DOM listeners
            card.querySelector('.btn-copy').addEventListener('click', (e) => {
                e.stopPropagation();
                copyToClipboard(wallet.address);
            });

            card.querySelector('.btn-toggle').addEventListener('click', (e) => {
                e.stopPropagation();
                toggleActive(wallet.id);
            });

            card.querySelector('.btn-edit').addEventListener('click', (e) => {
                e.stopPropagation();
                openEditModal(wallet.id);
            });

            card.querySelector('.btn-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                deleteWallet(wallet.id);
            });

            grid.appendChild(card);
        });
    } catch (e) {
        console.error('loadWallets error:', e);
    }
}

/**
 * Handle Add/Edit modal displays
 */
function openAddModal() {
    document.getElementById('wallet-id').value = '';
    document.getElementById('form-address').value = '';
    document.getElementById('form-address').disabled = false;
    document.getElementById('form-label').value = '';
    document.getElementById('form-min-trade').value = '10';
    document.getElementById('form-max-copy').value = '100';
    document.getElementById('form-percentage').value = '100';
    document.getElementById('slider-value').innerText = '100%';
    document.getElementById('form-active').checked = true;
    document.getElementById('form-take-profit').value = '0';
    document.getElementById('form-stop-loss').value = '0';

    document.getElementById('modal-title').innerText = 'Takip Cüzdanı Ekle';
    document.getElementById('wallet-modal').classList.remove('hidden');
}

function openEditModal(id) {
    const wallet = walletsList.find(w => w.id === id);
    if (!wallet) return;
    
    document.getElementById('wallet-id').value = wallet.id;
    document.getElementById('form-address').value = wallet.address;
    document.getElementById('form-address').disabled = true; // Address cannot be edited once saved
    document.getElementById('form-label').value = wallet.label;
    document.getElementById('form-min-trade').value = wallet.min_trade_amount;
    document.getElementById('form-max-copy').value = wallet.max_copy_amount;
    document.getElementById('form-percentage').value = wallet.copy_percentage;
    document.getElementById('slider-value').innerText = wallet.copy_percentage + '%';
    document.getElementById('form-active').checked = wallet.is_active === 1;
    document.getElementById('form-take-profit').value = wallet.take_profit_percentage || '0';
    document.getElementById('form-stop-loss').value = wallet.stop_loss_percentage || '0';

    document.getElementById('modal-title').innerText = 'Cüzdan Ayarlarını Düzenle';
    document.getElementById('wallet-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('wallet-modal').classList.add('hidden');
}

/**
 * Save action (Both POST and PUT)
 */
async function saveWallet(e) {
    e.preventDefault();

    const id = document.getElementById('wallet-id').value;
    const address = document.getElementById('form-address').value.trim();
    const label = document.getElementById('form-label').value.trim();
    const min_trade_amount = document.getElementById('form-min-trade').value;
    const max_copy_amount = document.getElementById('form-max-copy').value;
    const copy_percentage = document.getElementById('form-percentage').value;
    const is_active = document.getElementById('form-active').checked;
    const take_profit_percentage = document.getElementById('form-take-profit').value;
    const stop_loss_percentage = document.getElementById('form-stop-loss').value;

    // Validate address format (only for addition)
    if (!id && !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        alert('Geçersiz Ethereum cüzdan adresi! 0x ile başlayan 42 karakterli hex adresi girin.');
        return;
    }

    const payload = {
        address,
        label,
        min_trade_amount,
        max_copy_amount,
        copy_percentage,
        is_active,
        take_profit_percentage,
        stop_loss_percentage
    };

    const method = id ? 'PUT' : 'POST';
    const path = id ? `/api/wallets/${id}` : '/api/wallets';

    try {
        const res = await fetch(path, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        
        if (res.ok) {
            closeModal();
            loadWallets();
        } else {
            alert('Hata: ' + data.error);
        }
    } catch (err) {
        console.error('saveWallet error:', err);
    }
}

/**
 * Toggle active status
 */
async function toggleActive(id) {
    try {
        const res = await fetch(`/api/wallets/${id}/toggle`, { method: 'POST' });
        if (res.ok) {
            loadWallets();
        } else {
            const data = await res.json();
            alert('Hata: ' + data.error);
        }
    } catch (err) {
        console.error('toggleActive error:', err);
    }
}

/**
 * Delete a wallet
 */
async function deleteWallet(id) {
    if (!confirm('Bu cüzdanı takip listesinden tamamen silmek istediğinize emin misiniz? Bu işlem geçmiş kopyalanan verilerini korur ancak yeni kopyalama yapmaz.')) {
        return;
    }

    try {
        const res = await fetch(`/api/wallets/${id}`, { method: 'DELETE' });
        if (res.ok) {
            loadWallets();
        } else {
            const data = await res.json();
            alert('Hata: ' + data.error);
        }
    } catch (err) {
        console.error('deleteWallet error:', err);
    }
}

/**
 * Clipboard utility
 */
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        alert('Cüzdan adresi panoya kopyalandı.');
    }).catch(err => {
        console.error('Panoya kopyalama hatası:', err);
    });
}
