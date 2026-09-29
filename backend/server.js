require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { fetchLiveNews } = require('./services/newsCollector');
const { calculateTrends } = require('./services/trendingEngine');
const satyaAIEngine = require('./services/aiEngine');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// In-Memory Cached News Store
let globalNewsCache = [];
let globalTrendsCache = [];
let lastFetchedTime = null;

// Periodic Automatic News Fetching Loop (Every 3 minutes)
async function syncSATYAFeeds() {
    console.log("[SATYA ENGINE] Fetching latest live news from multi-source index...");
    try {
        const freshArticles = await fetchLiveNews();
        if (freshArticles && freshArticles.length > 0) {
            globalNewsCache = freshArticles;

            globalTrendsCache = await calculateTrends(globalNewsCache);
            lastFetchedTime = new Date().toISOString();
            console.log(`[SATYA ENGINE] Cache successfully updated with ${globalNewsCache.length} articles.`);
        }
    } catch (error) {
        console.error("[SATYA ENGINE FETCH ERROR]:", error.message);
    }
}

// Initial Sync & Interval Setup
syncSATYAFeeds();
setInterval(syncSATYAFeeds, 3 * 60 * 1000);

// ---------------------------------------------------------
// REST API ENDPOINTS
// ---------------------------------------------------------

// 1. Get Live Multi-Source News
app.get('/api/live-news', (req, res) => {
    res.json({
        status: "success",
        count: globalNewsCache.length,
        lastUpdated: lastFetchedTime,
        data: globalNewsCache
    });
});

// 2. Get Calculated Trends & Signals
app.get('/api/trending', (req, res) => {
    res.json({
        status: "success",
        count: globalTrendsCache.length,
        data: globalTrendsCache
    });
});

// 3. SATYA AI Chat & Dashboard Control Route (Accesses full dataset)
app.post('/api/ai-chat', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) {
        return res.status(400).json({ status: "error", message: "Prompt required." });
    }

    // Passes full dataset for intelligent backend filtering
    const aiResponse = await satyaAIEngine.askSATYA(prompt, globalNewsCache);
    res.json(aiResponse);
});

// 4. SATYA AI Fact Check Endpoint
app.post('/api/fact-check', async (req, res) => {
    const { claim } = req.body;
    if (!claim) {
        return res.status(400).json({ status: "error", message: "Claim text required for verification." });
    }

    const verificationResult = await satyaAIEngine.factCheck(claim, globalNewsCache);
    res.json(verificationResult);
});

// Serve Frontend Fallback
app.get('/*path', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(` SATYA News Intelligence Server Running`);
    console.log(` URL: http://localhost:${PORT}`);
    console.log(`===============================================`);
});