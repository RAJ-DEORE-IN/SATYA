require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { fetchLiveNews } = require('./services/newsCollector');
const { calculateTrends } = require('./services/trendingEngine');
const satyaAIEngine = require('./services/aiEngine');
const initialNewsData = require('./data/newsData');

const app = express();
const PORT = process.env.PORT || 3000;
const rootDir = path.join(__dirname, '..');

// ---------------------------------------------------------
// PRODUCTION CORS & SECURITY
// ---------------------------------------------------------
const rawAllowed = process.env.ALLOWED_ORIGINS;
const allowedOrigins = rawAllowed
    ? rawAllowed.split(',').map(s => s.trim().toLowerCase())
    : ['*'];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin.toLowerCase())) {
            return callback(null, true);
        }
        return callback(new Error('Origin not allowed by SATYA CORS policy'));
    },
    credentials: true
}));

app.use(express.json({ limit: '100kb' }));
app.use(express.static(rootDir));

// ---------------------------------------------------------
// IN-MEMORY CONCURRENT RATE LIMITER (Abuse Protection)
// ---------------------------------------------------------
const aiRateLimiter = (maxRequests = 25, windowMs = 60 * 1000) => {
    const clients = new Map();

    // Clean up stale client records every 5 minutes to avoid memory leaks
    setInterval(() => {
        const now = Date.now();
        for (const [key, record] of clients.entries()) {
            if (now - record.startTime > windowMs * 2) {
                clients.delete(key);
            }
        }
    }, 5 * 60 * 1000);

    return (req, res, next) => {
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'client';
        const now = Date.now();
        let record = clients.get(clientIp);

        if (!record || now - record.startTime > windowMs) {
            record = { count: 1, startTime: now };
            clients.set(clientIp, record);
            return next();
        }

        if (record.count >= maxRequests) {
            return res.status(429).json({
                status: "error",
                errorCode: "RATE_LIMIT_EXCEEDED",
                reply: "SATYA AI is receiving too many requests. Please try again shortly.",
                message: "SATYA AI is receiving too many requests. Please try again shortly."
            });
        }

        record.count++;
        next();
    };
};

// ---------------------------------------------------------
// RESILIENT CACHE STORE WITH STALE-FALLBACK & LOCKING
// ---------------------------------------------------------
let globalNewsCache = Array.isArray(initialNewsData.stories) ? [...initialNewsData.stories] : [];
let globalTrendsCache = [];
let lastFetchedTime = new Date().toISOString();
let isRefreshing = false;

// Initial trends calculation
(async () => {
    try {
        globalTrendsCache = await calculateTrends(globalNewsCache);
    } catch (err) {
        console.warn("[SATYA SERVER] Initial trends fallback:", err.message);
    }
})();

// Automatic Periodic News Sync (Every 3 minutes) with overlap lock
async function syncSATYAFeeds() {
    if (isRefreshing) {
        console.log("[SATYA ENGINE] Sync already in progress, skipping overlapping run.");
        return;
    }

    isRefreshing = true;
    try {
        console.log("[SATYA ENGINE] Fetching latest live news from multi-source index...");
        const freshArticles = await fetchLiveNews();
        if (Array.isArray(freshArticles) && freshArticles.length > 0) {
            globalNewsCache = freshArticles;
            globalTrendsCache = await calculateTrends(globalNewsCache);
            lastFetchedTime = new Date().toISOString();
            console.log(`[SATYA ENGINE] Cache successfully updated with ${globalNewsCache.length} articles.`);
        } else {
            console.log("[SATYA ENGINE] Feeds returned no new articles; retaining cached news.");
        }
    } catch (error) {
        console.error("[SATYA ENGINE FETCH ERROR]:", error.message);
    } finally {
        isRefreshing = false;
    }
}

// Initial Sync & Interval
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

// 3. SATYA AI Chat & Dashboard Siri-Style Control Route
app.post('/api/ai-chat', aiRateLimiter(25, 60 * 1000), async (req, res) => {
    try {
        const { prompt, clientContext, conversationHistory } = req.body || {};
        if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
            return res.status(400).json({
                status: "error",
                errorCode: "INVALID_REQUEST",
                message: "Prompt text is required."
            });
        }

        const sanitizedPrompt = prompt.trim().substring(0, 500);
        const aiResponse = await satyaAIEngine.askSATYA(
            sanitizedPrompt, 
            globalNewsCache, 
            clientContext || {}, 
            Array.isArray(conversationHistory) ? conversationHistory : []
        );
        res.json(aiResponse);
    } catch (err) {
        console.error("[SATYA AI CHAT ROUTE ERROR]:", err.message);
        res.status(500).json({
            status: "error",
            errorCode: "AI_PROCESSING_ERROR",
            reply: "SATYA AI currently does not have enough verified information about this event in its available sources.",
            confidence: "UNAVAILABLE"
        });
    }
});

// 4. SATYA AI Fact Check Endpoint
app.post('/api/fact-check', aiRateLimiter(25, 60 * 1000), async (req, res) => {
    try {
        const { claim } = req.body || {};
        if (!claim || typeof claim !== 'string' || claim.trim() === '') {
            return res.status(400).json({
                status: "error",
                errorCode: "INVALID_REQUEST",
                message: "Claim text is required for fact-check verification."
            });
        }

        const sanitizedClaim = claim.trim().substring(0, 500);
        const verificationResult = await satyaAIEngine.factCheck(sanitizedClaim, globalNewsCache);
        res.json(verificationResult);
    } catch (err) {
        console.error("[SATYA FACT CHECK ROUTE ERROR]:", err.message);
        res.status(500).json({
            status: "error",
            errorCode: "FACT_CHECK_ERROR",
            claim: req.body?.claim || "",
            status: "INSUFFICIENT_EVIDENCE",
            confidence: "LOW",
            explanation: "Verification service temporarily unavailable."
        });
    }
});

// 5. Config Endpoint (public config for frontend)
app.get('/api/config', (req, res) => {
    res.json({
        status: "success",
        environment: process.env.NODE_ENV || "production",
        features: {
            auth: true,
            firestore: true,
            ai: Boolean(process.env.GEMINI_API_KEY)
        }
    });
});

// SPA Fallback Handler
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({
            status: "error",
            errorCode: "NOT_FOUND",
            message: "API endpoint not found."
        });
    }
    res.sendFile(path.join(rootDir, 'index.html'));
});

// Centralized Error Handler
app.use((err, req, res, next) => {
    console.error("[SATYA SERVER UNHANDLED ERROR]:", err.message);
    if (res.headersSent) return next(err);
    res.status(500).json({
        status: "error",
        errorCode: "SERVER_ERROR",
        message: "An internal server error occurred."
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`===============================================`);
    console.log(` SATYA News Intelligence Server Running`);
    console.log(` Port: ${PORT} | Host: 0.0.0.0`);
    console.log(`===============================================`);
});
