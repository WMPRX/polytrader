const express = require('express');
const path = require('path');

/**
 * Dashboard Clean Router (dashboard.js)
 * Maps clean, human-readable URLs to static front-end HTML files.
 */
const router = express.Router();

// Root route redirects to index.html dashboard
router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
});

// Clean path mapping for wallets page
router.get('/wallets', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/wallets.html'));
});

// Clean path mapping for trades history
router.get('/trades', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/trades.html'));
});

// Clean path mapping for settings panel
router.get('/settings', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/settings.html'));
});

module.exports = router;
