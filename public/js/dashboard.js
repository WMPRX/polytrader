/**
 * Dashboard Logic (dashboard.js)
 * Coordinates WebSocket connections, live telemetry subscriptions, UI binding, and Chart.js animations.
 */

// Global state
let socket;
let pnlChart = null;
let currentTimeframe = 'all';
let isAutoScrollEnabled = true;
let isBotRunning = false;

// Format numbers
function formatCurrency(val) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

document.addEventListener('DOMContentLoaded', () => {
    // 1. Establish Socket Connection
    setupSocket();

    // 2. Fetch Initial API Data
    fetchBotStatus();
    fetchKPIs();
    fetchPnLChart();
    fetchRecentActivity();

    // 3. Setup Button Event Handlers
    document.getElementById('btn-toggle-bot').addEventListener('click', toggleBotStatus);
    document.getElementById('btn-pause-scroll').addEventListener('click', toggleLogScroll);
});

/**
 * Socket.io setup and telemetry handlers
 */
function setupSocket() {
    socket = io();

    // Handle bot status change
    socket.on('bot_status_changed', (data) => {
        console.log('[Socket] Bot status changed:', data);
        updateStatusUI(data.status === 'running');
    });

    // Handle incoming live logs
    socket.on('log_entry', (log) => {
        appendLogItem(log);
    });

    // Handle new trade detections
    socket.on('new_trade_detected', (data) => {
        console.log('[Socket] New trade detected:', data);
        // Refresh KPIs and recent list shortly
        setTimeout(() => {
            fetchKPIs();
            fetchRecentActivity();
        }, 1000);
    });

    // Handle trade completion
    socket.on('trade_executed', (data) => {
        console.log('[Socket] Trade executed:', data);
        fetchKPIs();
        fetchRecentActivity();
        fetchPnLChart(); // Reload chart
    });

    // Handle balance updates
    socket.on('balance_update', (data) => {
        document.getElementById('header-balance').innerText = parseFloat(data.usdc).toFixed(2) + ' USDC';
    });
}

/**
 * Pull bot state and cüzdan details
 */
async function fetchBotStatus() {
    try {
        const res = await fetch('/api/bot/status');
        const data = await res.json();
        
        isBotRunning = data.isRunning;
        updateStatusUI(data.isRunning);
        
        // Show test banner if in simulation mode
        if (data.testMode) {
            document.getElementById('sim-banner').classList.remove('hidden');
        } else {
            document.getElementById('sim-banner').classList.add('hidden');
        }

        // Show wallet address and balance
        const headerWallet = document.getElementById('header-wallet');
        if (data.walletAddress && data.walletAddress !== 'Mevcut Değil') {
            headerWallet.innerText = data.walletAddress.substring(0, 6) + '...' + data.walletAddress.substring(data.walletAddress.length - 4);
            headerWallet.title = data.walletAddress;
        } else {
            headerWallet.innerText = 'Cüzdan Bağlı Değil';
        }

        document.getElementById('header-balance').innerText = parseFloat(data.usdcBalance).toFixed(2) + ' USDC';
        
        if (data.emergencyStop) {
            triggerEmergencyUI();
        }
    } catch (e) {
        console.error('fetchBotStatus error:', e);
    }
}

/**
 * Update UI reflecting bot status (Live/Stopped)
 */
function updateStatusUI(isRunning) {
    isBotRunning = isRunning;
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    const btn = document.getElementById('btn-toggle-bot');

    if (isRunning) {
        dot.className = 'w-2.5 h-2.5 rounded-full pulse-green';
        text.innerText = 'CANLI';
        text.className = 'text-xs font-bold text-success uppercase mr-1';
        btn.innerText = 'Durdur';
        btn.className = 'p-1 px-3 text-xs font-semibold rounded bg-danger/20 hover:bg-danger/30 text-danger border border-danger/30 transition';
    } else {
        dot.className = 'w-2.5 h-2.5 rounded-full pulse-red';
        text.innerText = 'DURDURULDU';
        text.className = 'text-xs font-bold text-danger uppercase mr-1';
        btn.innerText = 'Başlat';
        btn.className = 'p-1 px-3 text-xs font-semibold rounded bg-accent/20 hover:bg-accent/30 text-accent border border-accent/30 transition';
    }
}

function triggerEmergencyUI() {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    dot.className = 'w-2.5 h-2.5 rounded-full pulse-red';
    text.innerText = 'ACİL DURDURULDU';
    text.className = 'text-xs font-bold text-danger uppercase mr-1';
}

/**
 * Handle Start / Stop requests
 */
async function toggleBotStatus() {
    const apiPath = isBotRunning ? '/api/bot/stop' : '/api/bot/start';
    try {
        const res = await fetch(apiPath, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            updateStatusUI(data.isRunning);
        } else {
            alert('Hata: ' + data.error);
        }
    } catch (e) {
        console.error('toggleBotStatus error:', e);
    }
}

/**
 * Fetch KPI statistics from Express summary route
 */
async function fetchKPIs() {
    try {
        const res = await fetch('/api/dashboard/summary');
        const data = await res.json();

        // 1. Total P&L
        const pnlEl = document.getElementById('kpi-pnl');
        const pnlIcon = document.getElementById('kpi-pnl-icon');
        const pnlSub = document.getElementById('kpi-pnl-sub');
        
        pnlEl.innerText = (data.total_pnl >= 0 ? '+' : '') + formatCurrency(data.total_pnl);
        
        if (data.total_pnl > 0) {
            pnlEl.className = 'text-3xl font-extrabold text-success';
            pnlIcon.className = 'fa-solid fa-arrow-up-right-dots text-success';
            pnlSub.innerText = 'Pozitif kar birikimi';
        } else if (data.total_pnl < 0) {
            pnlEl.className = 'text-3xl font-extrabold text-danger';
            pnlIcon.className = 'fa-solid fa-arrow-down-right-dots text-danger';
            pnlSub.innerText = 'Net zarar oluşumu';
        } else {
            pnlEl.className = 'text-3xl font-extrabold text-white';
            pnlIcon.className = 'fa-solid fa-circle-nodes text-slate-400';
            pnlSub.innerText = 'İşlemler dengede';
        }

        // 2. Win Rate
        document.getElementById('kpi-winrate').innerText = data.win_rate.toFixed(1) + '%';
        document.getElementById('kpi-trades-count').innerText = `${data.successful_trades} / ${data.total_trades}`;

        // 3. Tracked Wallets
        document.getElementById('kpi-wallets').innerText = `${data.active_wallets} / ${data.total_wallets}`;

        // 4. Volume
        document.getElementById('kpi-volume').innerText = parseFloat(data.today_volume).toFixed(2) + ' USDC';

    } catch (e) {
        console.error('fetchKPIs error:', e);
    }
}

/**
 * Fetch logs and recent trades list
 */
async function fetchRecentActivity() {
    try {
        const res = await fetch('/api/dashboard/activity');
        const data = await res.json();

        // 1. Render recent trades table
        const tbody = document.getElementById('recent-trades-tbody');
        tbody.innerHTML = '';

        if (data.recentTrades.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="py-8 text-center text-slate-500">Kopyalanan işlem bulunmuyor.</td></tr>`;
        } else {
            data.recentTrades.forEach(trade => {
                const tr = document.createElement('tr');
                tr.className = 'hover:bg-white/[0.02] transition';
                
                const time = new Date(trade.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const date = new Date(trade.created_at).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });

                // Status formatting
                let statusBadge = '';
                if (trade.status === 'SUCCESS') statusBadge = '<span class="badge-success text-xs font-semibold px-2 py-0.5 rounded">SUCCESS</span>';
                else if (trade.status === 'FAILED') statusBadge = `<span class="badge-danger text-xs font-semibold px-2 py-0.5 rounded" title="${trade.error_message || ''}">FAILED</span>`;
                else if (trade.status === 'PENDING') statusBadge = '<span class="badge-warning text-xs font-semibold px-2 py-0.5 rounded animate-pulse">PENDING</span>';
                else statusBadge = '<span class="badge-muted text-xs font-semibold px-2 py-0.5 rounded">SKIPPED</span>';

                // P&L formatting
                let pnlCell = `<span class="text-slate-400">-</span>`;
                if (trade.status === 'SUCCESS') {
                    const pnlVal = parseFloat(trade.profit_loss || 0);
                    if (pnlVal > 0) pnlCell = `<span class="text-success font-semibold">+${pnlVal.toFixed(2)}</span>`;
                    else if (pnlVal < 0) pnlCell = `<span class="text-danger font-semibold">${pnlVal.toFixed(2)}</span>`;
                    else pnlCell = `<span class="text-slate-300">0.00</span>`;
                }

                // Shorten market question
                const shortQ = trade.market_question.length > 50 ? trade.market_question.substring(0, 50) + '...' : trade.market_question;

                tr.innerHTML = `
                    <td class="py-3.5 px-4 font-medium text-slate-300">
                        <span class="block">${time}</span>
                        <span class="block text-[10px] text-slate-500">${date}</span>
                    </td>
                    <td class="py-3.5 px-4 text-white font-semibold">${trade.wallet_label}</td>
                    <td class="py-3.5 px-4 text-slate-300" title="${trade.market_question}">${shortQ}</td>
                    <td class="py-3.5 px-4 text-center">
                        <span class="px-2 py-0.5 rounded text-xs font-bold ${trade.side === 'BUY' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}">${trade.side}</span>
                    </td>
                    <td class="py-3.5 px-4 font-medium text-slate-200">${trade.outcome}</td>
                    <td class="py-3.5 px-4 text-slate-300">${parseFloat(trade.copied_amount).toFixed(1)}</td>
                    <td class="py-3.5 px-4 text-slate-400">$${parseFloat(trade.price).toFixed(2)}</td>
                    <td class="py-3.5 px-4 text-center">${statusBadge}</td>
                    <td class="py-3.5 px-4 text-right">${pnlCell}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        // 2. Render logs
        const logBox = document.getElementById('log-container');
        logBox.innerHTML = '';
        const reversedLogs = [...data.recentLogs].reverse();
        reversedLogs.forEach(log => {
            appendLogItem(log, false);
        });
        scrollLogsToBottom();

    } catch (e) {
        console.error('fetchRecentActivity error:', e);
    }
}

/**
 * Fetch and construct Chart.js timeline
 */
async function fetchPnLChart() {
    try {
        const res = await fetch(`/api/dashboard/pnl?timeframe=${currentTimeframe}`);
        const series = await res.json();

        const labels = series.map(p => {
            const d = new Date(p.timestamp);
            if (currentTimeframe === '24S') {
                return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
            }
            return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
        });

        const dataPoints = series.map(p => p.cumulativePnL);
        const descriptions = series.map(p => p.label);

        // Standard Chart.js configuration
        if (pnlChart) {
            pnlChart.destroy();
        }

        const ctx = document.getElementById('pnlChart').getContext('2d');

        // Linear gradient background
        const gradient = ctx.createLinearGradient(0, 0, 0, 300);
        gradient.addColorStop(0, 'rgba(0, 212, 170, 0.25)');
        gradient.addColorStop(1, 'rgba(0, 212, 170, 0.00)');

        pnlChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Toplam P&L (USDC)',
                    data: dataPoints,
                    borderColor: '#00d4aa',
                    borderWidth: 3,
                    backgroundColor: gradient,
                    fill: true,
                    tension: 0.35,
                    pointBackgroundColor: '#00d4aa',
                    pointBorderColor: '#1a1d27',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#1a1d27',
                        titleColor: '#94a3b8',
                        bodyColor: '#f8fafc',
                        borderColor: 'rgba(255,255,255,0.08)',
                        borderWidth: 1,
                        padding: 10,
                        callbacks: {
                            label: function(context) {
                                const index = context.dataIndex;
                                return `Net P&L: $${context.parsed.y.toFixed(2)} (${descriptions[index]})`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.02)' },
                        ticks: { color: '#64748b', font: { family: 'Inter', size: 10 } }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.02)' },
                        ticks: { color: '#64748b', font: { family: 'Inter', size: 10 } }
                    }
                }
            }
        });
    } catch (e) {
        console.error('fetchPnLChart error:', e);
    }
}

/**
 * Handle Timeframe filters for chart
 */
function changeTimeframe(timeframe) {
    currentTimeframe = timeframe;
    
    // Toggle active filter button style
    document.querySelectorAll('.chart-filter').forEach(btn => {
        btn.classList.remove('active', 'bg-accent', 'text-darkbg');
        btn.classList.add('text-slate-400');
    });

    const activeBtn = event.currentTarget;
    activeBtn.classList.add('active', 'bg-accent', 'text-darkbg');
    activeBtn.classList.remove('text-slate-400');

    fetchPnLChart();
}

/**
 * Append a single log message dynamically to the log box
 */
function appendLogItem(log, shouldScroll = true) {
    const logBox = document.getElementById('log-container');
    const div = document.createElement('div');
    
    const time = new Date(log.created_at || log.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    let lvlClass = 'log-info';
    
    if (log.level === 'WARN') lvlClass = 'log-warn';
    else if (log.level === 'ERROR') lvlClass = 'log-error';

    div.className = `log-item ${lvlClass}`;
    div.innerHTML = `[${time}] [${log.level}] ${log.message}`;
    logBox.appendChild(div);

    // Limit visible logs in DOM to 100 entries for memory
    while (logBox.children.length > 100) {
        logBox.removeChild(logBox.firstChild);
    }

    if (shouldScroll && isAutoScrollEnabled) {
        scrollLogsToBottom();
    }
}

function scrollLogsToBottom() {
    const logBox = document.getElementById('log-container');
    logBox.scrollTop = logBox.scrollHeight;
}

function toggleLogScroll() {
    isAutoScrollEnabled = !isAutoScrollEnabled;
    const btn = document.getElementById('btn-pause-scroll');
    if (isAutoScrollEnabled) {
        btn.innerHTML = `<i class="fa-solid fa-pause mr-1"></i> Duraklat`;
        btn.className = 'text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 p-1 px-2.5 rounded transition';
        scrollLogsToBottom();
    } else {
        btn.innerHTML = `<i class="fa-solid fa-play mr-1"></i> Sürdür`;
        btn.className = 'text-xs text-accent hover:text-accenthover bg-accent/10 border border-accent/20 p-1 px-2.5 rounded transition';
    }
}
