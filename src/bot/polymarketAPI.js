const axios = require('axios');
const { ethers } = require('ethers');

// Constants for Polygon Mainnet
const POLYGON_RPCS = [
    'https://polygon.llamarpc.com',
    'https://rpc.ankr.com/polygon',
    'https://1rpc.io/matic',
    'https://polygon-mainnet.public.blastapi.io'
];
const CTF_EXCHANGE_ADDRESS = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';

/**
 * Returns a working Polygon RPC Provider using automatic fallback nodes
 */
async function getProvider() {
    for (const rpc of POLYGON_RPCS) {
        try {
            const provider = new ethers.JsonRpcProvider(rpc, 137, { staticNetwork: true });
            // Quick test call to verify node responsiveness
            await provider.getBlockNumber();
            return provider;
        } catch (e) {
            console.warn(`[RPC Warning] ${rpc} bağlantısı başarısız, sıradaki deneniyor... Hata: ${e.message}`);
        }
    }
    throw new Error('Hiçbir Polygon RPC sunucusuna bağlanılamadı. İnternet bağlantınızı kontrol edin.');
}

// Minimal ERC20 ABI for USDC operations
const ERC20_ABI = [
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function allowance(address owner, address spender) external view returns (uint256)',
    'function balanceOf(address account) external view returns (uint256)',
    'function decimals() external view returns (uint8)'
];

// Minimal CTF Exchange ABI
const CTF_EXCHANGE_ABI = [
    'function getDescriptor() external view returns (string)'
];

/**
 * Fetch transaction activity for a specific wallet address from Polymarket Data API.
 * Uses public endpoint which does not require API keys.
 * 
 * @param {string} address - Ethereum wallet address
 * @param {number} limit - Maximum number of activities to retrieve (default: 20)
 * @returns {Promise<Array>} Normalized trade records
 */
async function getWalletTrades(address, limit = 20) {
    try {
        const url = `https://data-api.polymarket.com/activity?user=${address}&limit=${limit}`;
        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!response.data || !Array.isArray(response.data)) {
            return [];
        }

        // Normalize activities into standardized trade objects
        return response.data.map(activity => {
            // Polymarket Data API fields mapping:
            // - transactionHash / txHash
            // - conditionId / marketId
            // - title / question
            // - outcome (the selection e.g. "Yes", "No", "Donald Trump")
            // - side (BUY / SELL)
            // - size (quantity of shares)
            // - price (USDC per share e.g. 0.54)
            // - timestamp (unix timestamp)
            const txHash = activity.transactionHash || activity.txHash || `0xmock_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
            const marketId = activity.conditionId || activity.marketId || '';
            const question = activity.title || activity.question || 'Bilinmeyen Market Sorusu';
            const outcome = activity.outcome || '';
            const side = (activity.side || 'BUY').toUpperCase();
            const amount = parseFloat(activity.size || activity.amount || 0);
            const price = parseFloat(activity.price || 0);
            const timestamp = activity.timestamp ? new Date(activity.timestamp * 1000).toISOString() : new Date().toISOString();

            return {
                txHash,
                marketId,
                question,
                outcome,
                side,
                amount,
                price,
                timestamp
            };
        });
    } catch (error) {
        console.error(`getWalletTrades error for address ${address}:`, error.message);
        throw error;
    }
}

/**
 * Fetch detailed market specifications from Polymarket CLOB API
 * 
 * @param {string} conditionId - Market condition identifier
 * @returns {Promise<Object>} Market details
 */
async function getMarketInfo(conditionId) {
    try {
        const url = `https://clob.polymarket.com/markets/${conditionId}`;
        const response = await axios.get(url, { timeout: 8000 });
        
        if (!response.data) {
            throw new Error(`Condition ${conditionId} not found on CLOB`);
        }

        return {
            conditionId: response.data.condition_id,
            question: response.data.question,
            description: response.data.description,
            active: response.data.active,
            tokens: response.data.tokens || [], // Array containing outcome tokens e.g. [{outcome: "Yes", token_id: "..."}]
            minSize: parseFloat(response.data.minimum_order_size || 0.1),
            category: response.data.category,
            endDate: response.data.end_date_iso
        };
    } catch (error) {
        console.error(`getMarketInfo error for condition ${conditionId}:`, error.message);
        throw error;
    }
}

/**
 * Fetch current order book for a specific outcome token ID
 * 
 * @param {string} tokenId - Specific token ID for an outcome
 * @returns {Promise<Object>} Order book containing bids and asks
 */
async function getOrderBook(tokenId) {
    try {
        const url = `https://clob.polymarket.com/book?token_id=${tokenId}`;
        const response = await axios.get(url, { timeout: 8000 });
        
        return {
            bids: response.data.bids || [],
            asks: response.data.asks || [],
            timestamp: response.data.timestamp
        };
    } catch (error) {
        console.error(`getOrderBook error for token ${tokenId}:`, error.message);
        throw error;
    }
}

/**
 * Perform token approval for CTF Exchange spending USDC on Polygon network.
 * 
 * @param {string} privateKey - Ethereum private key
 * @param {string} amount - Spending allowance amount in USDC (decimals: 6). If omitted, sets a large allowance.
 * @returns {Promise<string>} Transaction Hash of approval
 */
async function approveUSDC(privateKey, amount = '1000000') {
    try {
        const provider = await getProvider();
        const wallet = new ethers.Wallet(privateKey, provider);
        const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, wallet);

        // Standard USDC has 6 decimals on Polygon
        const decimals = await usdcContract.decimals();
        const parsedAmount = ethers.parseUnits(amount, decimals);

        console.log(`Approving ${amount} USDC for CTF Exchange (${CTF_EXCHANGE_ADDRESS})...`);
        const tx = await usdcContract.approve(CTF_EXCHANGE_ADDRESS, parsedAmount);
        await tx.wait(1);
        
        console.log(`USDC Approved successfully! Tx Hash: ${tx.hash}`);
        return tx.hash;
    } catch (error) {
        console.error('approveUSDC error:', error.message);
        throw error;
    }
}

/**
 * Query current USDC balance for a private key's associated wallet
 * 
 * @param {string} privateKey - Ethereum private key
 * @returns {Promise<string>} Current USDC balance as string
 */
async function getUSDCBalance(privateKey) {
    try {
        if (!privateKey) return '0.00';
        const provider = await getProvider();
        const wallet = new ethers.Wallet(privateKey, provider);
        const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);

        const balance = await usdcContract.balanceOf(wallet.address);
        const decimals = await usdcContract.decimals();
        return ethers.formatUnits(balance, decimals);
    } catch (error) {
        console.error('getUSDCBalance error:', error.message);
        return '0.00';
    }
}

/**
 * Submits an order to the Polymarket CLOB.
 * Uses EIP-712 structured data signing.
 * If testMode is true, mimics trading without spending real crypto.
 * 
 * @param {string} privateKey - Wallet private key
 * @param {string} marketId - Polymarket condition ID
 * @param {string} tokenId - Token ID representing outcome (Yes/No token)
 * @param {string} side - "BUY" or "SELL"
 * @param {number} amount - Quantity of shares to buy/sell
 * @param {number} price - Maximum price in USDC cents per share (e.g. 0.52)
 * @param {boolean} testMode - Simulation flag
 * @returns {Promise<Object>} Execution result (success indicator and txHash/orderId)
 */
async function executeTrade(privateKey, marketId, tokenId, side, amount, price, testMode = true) {
    if (testMode) {
        // Simulation mode: immediately generate a simulated success receipt
        const simulatedTxHash = `0xsim_${Date.now()}_${Math.floor(Math.random() * 900000 + 100000)}`;
        return {
            success: true,
            txHash: simulatedTxHash,
            price: price,
            amount: amount,
            status: 'SUCCESS',
            isSimulated: true
        };
    }

    try {
        if (!privateKey) {
            throw new Error('Canlı işlem için cüzdan özel anahtarı (Private Key) ayarlar sayfasından girilmelidir.');
        }

        const provider = await getProvider();
        const wallet = new ethers.Wallet(privateKey, provider);
        
        // EIP-712 Domain Separator definition for Polymarket CTF Exchange
        const domain = {
            name: 'CTFExchange',
            version: '1',
            chainId: 137,
            verifyingContract: CTF_EXCHANGE_ADDRESS
        };

        // EIP-712 Types definition
        const types = {
            Order: [
                { name: 'signer', type: 'address' },
                { name: 'maker', type: 'address' },
                { name: 'taker', type: 'address' },
                { name: 'tokenId', type: 'uint256' },
                { name: 'price', type: 'uint256' },
                { name: 'side', type: 'uint8' }, // 0 = BUY, 1 = SELL
                { name: 'size', type: 'uint256' },
                { name: 'feeRateBps', type: 'uint256' },
                { name: 'nonce', type: 'uint256' },
                { name: 'expiration', type: 'uint256' }
            ]
        };

        // Format order details for EIP-712 struct
        // Side in contract: 0 = Buy, 1 = Sell
        const sideInt = side.toUpperCase() === 'BUY' ? 0 : 1;
        const nonce = Math.floor(Math.random() * 1000000000);
        const expiration = Math.floor(Date.now() / 1000) + 3600; // 1 hour validity
        
        // Convert prices/sizes into contract units (USDC has 6 decimals, size has 6 decimals)
        const scaleDecimals = 6;
        const priceParsed = Math.floor(price * 1000000); // price in USDC cents scaled to 1e6
        const sizeParsed = Math.floor(amount * 1000000); 

        const orderValue = {
            signer: wallet.address,
            maker: wallet.address,
            taker: ethers.ZeroAddress,
            tokenId: tokenId,
            price: priceParsed.toString(),
            side: sideInt,
            size: sizeParsed.toString(),
            feeRateBps: '0',
            nonce: nonce.toString(),
            expiration: expiration.toString()
        };

        // Sign the EIP-712 structure
        console.log(`Signing Polymarket CLOB order for ${side} ${amount} shares at $${price}...`);
        const signature = await wallet.signTypedData(domain, types, orderValue);

        // Build request payload for Polymarket CLOB API
        const payload = {
            order: {
                signer: wallet.address,
                maker: wallet.address,
                taker: ethers.ZeroAddress,
                tokenId: tokenId,
                price: price.toFixed(2), // API expects decimal format string e.g. "0.55"
                side: side.toUpperCase(),
                size: amount.toFixed(1), // Decimal format string for shares
                feeRateBps: 0,
                nonce: nonce,
                expiration: expiration,
                signature: signature
            },
            owner: wallet.address
        };

        // Submit Signed Order to Polymarket CLOB Order Entry API
        const clobUrl = 'https://clob.polymarket.com/order';
        console.log(`Posting signed order to CLOB at ${clobUrl}...`);
        const response = await axios.post(clobUrl, payload, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        if (response.data && response.data.success) {
            console.log(`Polymarket Order successfully submitted! Order ID: ${response.data.orderID}`);
            return {
                success: true,
                txHash: response.data.orderID || `0xclob_${Date.now()}`,
                price: price,
                amount: amount,
                status: 'SUCCESS',
                isSimulated: false
            };
        } else {
            throw new Error(response.data.error || 'Polymarket CLOB API order rejection');
        }
    } catch (error) {
        console.error('executeTrade real execution error:', error.response ? JSON.stringify(error.response.data) : error.message);
        throw error;
    }
}

module.exports = {
    getWalletTrades,
    getMarketInfo,
    getOrderBook,
    approveUSDC,
    getUSDCBalance,
    executeTrade,
    getProvider,
    POLYGON_RPC: POLYGON_RPCS[0],
    CTF_EXCHANGE_ADDRESS,
    USDC_ADDRESS
};
