/**
 * Trades Page Controller (trades.js)
 * Manages search filters, date selectors, CSV exporters, dynamic tables, paginations, and detailed report modals.
 */

// Pagination state
let currentPage = 1;
const limitPerPage = 10;
let totalPages = 1;

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialise search dropdowns and filters
    loadWalletsSelector();
    loadTrades(1);
    loadTradesSummary();

    // 2. Event Listeners
    document.getElementById('filter-form').addEventListener('submit', handleFilterSubmit);
    document.getElementById('btn-reset-filters').addEventListener('click', resetFilters);
    document.getElementById('btn-export-csv').addEventListener('click', exportToCSV);

    // Prev / Next Page triggers
    document.getElementById('btn-prev-page').addEventListener('click', () => {
        if (currentPage > 1) loadTrades(currentPage - 1);
    });
    document.getElementById('btn-next-page').addEventListener('click', () => {
        if (currentPage < totalPages) loadTrades(currentPage + 1);
    });

    // Close Modals listeners
    const closeModal = () => document.getElementById('trade-modal').classList.add('hidden');
    document.getElementById('btn-close-trade-modal').addEventListener('click', closeModal);
    document.getElementById('btn-close-trade-modal-footer').addEventListener('click', closeModal);
});

/**
 * Populates target wallet select elements
 */
async function loadWalletsSelector() {
    const selector = document.getElementById('filter-wallet');
    try {
        const res = await fetch('/api/wallets');
        const wallets = await res.json();
        
        wallets.forEach(wallet => {
            const opt = document.createElement('option');
            opt.value = wallet.id;
            opt.innerText = wallet.label;
            selector.appendChild(opt);
        });
    } catch (e) {
        console.error('loadWalletsSelector error:', e);
    }
}

/**
 * Query trades list using filters and pagination
 */
async function loadTrades(page = 1) {
    currentPage = page;

    // Gather filter parameters
    const wallet_id = document.getElementById('filter-wallet').value;
    const status = document.getElementById('filter-status').value;
    const startDateRaw = document.getElementById('filter-start-date').value;
    const endDateRaw = document.getElementById('filter-end-date').value;

    let queryParams = new URLSearchParams({
        page: currentPage,
        limit: limitPerPage
    });

    if (wallet_id) queryParams.append('wallet_id', wallet_id);
    if (status) queryParams.append('status', status);
    
    // Add time boundary formatting
    if (startDateRaw) {
        const startDate = new Date(startDateRaw);
        startDate.setHours(0,0,0,0);
        queryParams.append('startDate', startDate.toISOString());
    }
    if (endDateRaw) {
        const endDate = new Date(endDateRaw);
        endDate.setHours(23,59,59,999);
        queryParams.append('endDate', endDate.toISOString());
    }

    const tbody = document.getElementById('trades-tbody');
    tbody.innerHTML = `
        <tr>
            <td colspan="10" class="py-12 text-center text-slate-500">
                <i class="fa-solid fa-spinner animate-spin text-xl mb-2 text-accent"></i>
                <p>İşlem kayıtları yükleniyor...</p>
            </td>
        </tr>
    `;

    try {
        const res = await fetch(`/api/trades?${queryParams.toString()}`);
        const data = await res.json();

        tbody.innerHTML = '';
        totalPages = data.totalPages || 1;

        if (data.trades.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="py-12 text-center text-slate-500 font-semibold">Filtrelere uygun kopyalanmış işlem bulunamadı.</td></tr>`;
            updatePaginationUI(0, 0, 0);
            return;
        }

        // Render rows
        data.trades.forEach((trade, idx) => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-white/[0.02] transition border-b border-white/5';
            
            // Set row click handler
            tr.addEventListener('click', () => openTradeDetailModal(trade.id));

            const globalIndex = (currentPage - 1) * limitPerPage + idx + 1;
            const time = new Date(trade.created_at).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

            // Status formatting
            let statusBadge = '';
            if (trade.status === 'SUCCESS') statusBadge = '<span class="badge-success text-[10px] font-bold px-1.5 py-0.5 rounded">SUCCESS</span>';
            else if (trade.status === 'FAILED') statusBadge = '<span class="badge-danger text-[10px] font-bold px-1.5 py-0.5 rounded">FAILED</span>';
            else if (trade.status === 'PENDING') statusBadge = '<span class="badge-warning text-[10px] font-bold px-1.5 py-0.5 rounded animate-pulse">PENDING</span>';
            else statusBadge = '<span class="badge-muted text-[10px] font-bold px-1.5 py-0.5 rounded">SKIPPED</span>';

            // PnL formatting
            let pnlCell = `<span class="text-slate-400">-</span>`;
            if (trade.status === 'SUCCESS') {
                const pnlVal = parseFloat(trade.profit_loss || 0);
                if (pnlVal > 0) pnlCell = `<span class="text-success font-bold">+${pnlVal.toFixed(2)}</span>`;
                else if (pnlVal < 0) pnlCell = `<span class="text-danger font-bold">${pnlVal.toFixed(2)}</span>`;
                else pnlCell = `<span class="text-slate-300">0.00</span>`;
            }

            const shortQ = trade.market_question.length > 50 ? trade.market_question.substring(0, 50) + '...' : trade.market_question;

            tr.innerHTML = `
                <td class="py-3.5 px-4 text-slate-500 font-mono text-xs">${globalIndex}</td>
                <td class="py-3.5 px-4 text-slate-300 font-medium whitespace-nowrap">${time}</td>
                <td class="py-3.5 px-4 text-white font-bold whitespace-nowrap">${trade.wallet_label}</td>
                <td class="py-3.5 px-4 text-slate-300 max-w-[240px] truncate" title="${trade.market_question}">${shortQ}</td>
                <td class="py-3.5 px-4 text-center">
                    <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${trade.side === 'BUY' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}">${trade.side}</span>
                </td>
                <td class="py-3.5 px-4 font-bold text-slate-200">${trade.outcome}</td>
                <td class="py-3.5 px-4 text-slate-300 text-xs">${parseFloat(trade.copied_amount).toFixed(0)} <span class="text-slate-500 text-[10px]">/ ${parseFloat(trade.original_amount).toFixed(0)}</span></td>
                <td class="py-3.5 px-4 font-mono text-slate-400">$${parseFloat(trade.price).toFixed(2)}</td>
                <td class="py-3.5 px-4 text-center">${statusBadge}</td>
                <td class="py-3.5 px-4 text-right">${pnlCell}</td>
            `;
            tbody.appendChild(tr);
        });

        // Compute pagination ranges
        const startItem = (currentPage - 1) * limitPerPage + 1;
        const endItem = Math.min(currentPage * limitPerPage, data.total);
        updatePaginationUI(startItem, endItem, data.total);

    } catch (e) {
        console.error('loadTrades error:', e);
    }
}

/**
 * Handle form filter submits
 */
function handleFilterSubmit(e) {
    e.preventDefault();
    loadTrades(1);
}

/**
 * Reset search parameters
 */
function resetFilters() {
    document.getElementById('filter-wallet').value = '';
    document.getElementById('filter-status').value = '';
    document.getElementById('filter-start-date').value = '';
    document.getElementById('filter-end-date').value = '';
    loadTrades(1);
}

/**
 * Adjust pagination buttons state
 */
function updatePaginationUI(start, end, total) {
    document.getElementById('pagination-text').innerText = `Gösterilen: ${start} - ${end} / Toplam: ${total} işlem`;
    
    document.getElementById('btn-prev-page').disabled = currentPage <= 1;
    document.getElementById('btn-next-page').disabled = currentPage >= totalPages;

    // Render numbered page list buttons
    const numContainer = document.getElementById('page-numbers');
    numContainer.innerHTML = '';

    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);

    if (endPage - startPage + 1 < maxVisible) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement('button');
        btn.className = `p-1.5 px-3 rounded-lg text-xs font-bold transition ${i === currentPage ? 'bg-accent text-darkbg' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`;
        btn.innerText = i;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            loadTrades(i);
        });
        numContainer.appendChild(btn);
    }
}

/**
 * Retrieve global KPI values for footer summaries
 */
async function loadTradesSummary() {
    try {
        const res = await fetch('/api/trades/stats/summary');
        const data = await res.json();

        // Profit formatting
        const pnlEl = document.getElementById('summary-pnl');
        pnlEl.innerText = (data.total_pnl >= 0 ? '+' : '') + new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(data.total_pnl);
        pnlEl.className = `text-2xl font-extrabold ${data.total_pnl > 0 ? 'text-success' : (data.total_pnl < 0 ? 'text-danger' : 'text-white')}`;

        document.getElementById('summary-winrate').innerText = data.win_rate.toFixed(1) + '%';
        document.getElementById('summary-count').innerText = data.total_trades + ' İşlem';
    } catch (e) {
        console.error('loadTradesSummary error:', e);
    }
}

/**
 * Open details report modal on trade select
 */
async function openTradeDetailModal(tradeId) {
    try {
        const res = await fetch(`/api/trades/${tradeId}`);
        const trade = await res.json();

        document.getElementById('modal-market-question').innerText = trade.market_question;
        document.getElementById('modal-wallet-label').innerText = `${trade.wallet_label} (${trade.wallet_address.substring(0, 6)}...${trade.wallet_address.substring(trade.wallet_address.length-4)})`;
        document.getElementById('modal-side-outcome').innerText = `${trade.side.toUpperCase()} - (${trade.outcome})`;
        
        // Status formatting
        const statusEl = document.getElementById('modal-status');
        statusEl.innerText = trade.status;
        if (trade.status === 'SUCCESS') statusEl.className = 'font-bold text-success';
        else if (trade.status === 'FAILED') statusEl.className = 'font-bold text-danger';
        else if (trade.status === 'PENDING') statusEl.className = 'font-bold text-warning animate-pulse';
        else statusEl.className = 'font-bold text-slate-400';

        document.getElementById('modal-original-amount').innerText = parseFloat(trade.original_amount).toFixed(1) + ' Shares';
        document.getElementById('modal-copied-amount').innerText = parseFloat(trade.copied_amount).toFixed(1) + ' Shares';
        document.getElementById('modal-price').innerText = `$${parseFloat(trade.price).toFixed(2)}`;
        
        document.getElementById('modal-created-at').innerText = new Date(trade.created_at).toLocaleString('tr-TR');
        document.getElementById('modal-executed-at').innerText = trade.executed_at ? new Date(trade.executed_at).toLocaleString('tr-TR') : 'Beklemede';

        // Profit
        const pnlEl = document.getElementById('modal-pnl');
        if (trade.status === 'SUCCESS') {
            const pnl = parseFloat(trade.profit_loss || 0);
            pnlEl.innerText = (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + ' USDC';
            pnlEl.className = `font-bold ${pnl > 0 ? 'text-success' : (pnl < 0 ? 'text-danger' : 'text-white')}`;
        } else {
            pnlEl.innerText = '-';
            pnlEl.className = 'font-bold text-slate-500';
        }

        // Links and hashes
        document.getElementById('modal-orig-hash').innerText = trade.original_tx_hash;
        document.getElementById('modal-orig-link').href = `https://polygonscan.com/tx/${trade.original_tx_hash}`;

        const copyHashEl = document.getElementById('modal-copy-hash');
        const copyLinkBtn = document.getElementById('modal-copy-link');

        if (trade.copy_tx_hash) {
            copyHashEl.innerText = trade.copy_tx_hash;
            
            // Check if simulated tx or real order
            if (trade.copy_tx_hash.startsWith('0xsim_')) {
                copyHashEl.innerText = `${trade.copy_tx_hash} (Simülasyon Modu)`;
                copyLinkBtn.classList.add('hidden');
            } else {
                copyLinkBtn.classList.remove('hidden');
                // If it's a CLOB order entry ID, it might not be a direct blockchain Tx yet, but let's link it to Polymarket or keep it copyable
                copyLinkBtn.href = `https://polygonscan.com/tx/${trade.copy_tx_hash}`;
            }
        } else {
            copyHashEl.innerText = 'Mevcut Değil';
            copyLinkBtn.classList.add('hidden');
        }

        // Error message visibility
        const errContainer = document.getElementById('modal-error-container');
        if (trade.status === 'FAILED' && trade.error_message) {
            document.getElementById('modal-error-message').innerText = trade.error_message;
            errContainer.classList.remove('hidden');
        } else {
            errContainer.classList.add('hidden');
        }

        // Show Modal
        document.getElementById('trade-modal').classList.remove('hidden');

    } catch (e) {
        console.error('openTradeDetailModal error:', e);
    }
}

/**
 * Exports currently filtered trades list as a local CSV download file
 */
async function exportToCSV() {
    const wallet_id = document.getElementById('filter-wallet').value;
    const status = document.getElementById('filter-status').value;
    const startDateRaw = document.getElementById('filter-start-date').value;
    const endDateRaw = document.getElementById('filter-end-date').value;

    let queryParams = new URLSearchParams({
        page: 1,
        limit: 10000 // Get all records for export
    });

    if (wallet_id) queryParams.append('wallet_id', wallet_id);
    if (status) queryParams.append('status', status);
    if (startDateRaw) queryParams.append('startDate', new Date(startDateRaw).toISOString());
    if (endDateRaw) queryParams.append('endDate', new Date(endDateRaw).toISOString());

    try {
        const res = await fetch(`/api/trades?${queryParams.toString()}`);
        const data = await res.json();

        if (data.trades.length === 0) {
            alert('Dışa aktarılacak işlem kaydı bulunamadı.');
            return;
        }

        // CSV Headers definition
        let csvContent = '\uFEFF'; // UTF-8 BOM
        csvContent += 'Tarih,Izlenen Cuzdan,Cuzdan Adresi,Market Sorusu,Yon,Tercih,Orijinal Miktar,Kopyalanan Miktar,Fiyat,Durum,PnL (USDC),Original Tx,Copy Tx\n';

        data.trades.forEach(t => {
            // Escape double quotes in text fields
            const label = `"${t.wallet_label.replace(/"/g, '""')}"`;
            const question = `"${t.market_question.replace(/"/g, '""')}"`;
            const dateStr = new Date(t.created_at).toLocaleString('tr-TR');

            const row = [
                dateStr,
                label,
                t.wallet_address,
                question,
                t.side,
                t.outcome,
                t.original_amount,
                t.copied_amount,
                t.price,
                t.status,
                t.profit_loss || 0,
                t.original_tx_hash,
                t.copy_tx_hash || ''
            ];

            csvContent += row.join(',') + '\n';
        });

        // Trigger local file download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `PolyTrader_Islem_Gecmisi_${new Date().toISOString().substring(0,10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

    } catch (e) {
        console.error('CSV export failed:', e);
        alert('CSV dışa aktarım hatası: ' + e.message);
    }
}
