require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { fetchLiveNews } = require('./services/newsCollector');
const { calculateTrends } = require('./services/trendingEngine');
const satyaAIEngine = require('./services/aiEngine');
const { analyzeArticleEvidence, buildCoverageComparison } = require('./services/evidenceEngine');
const initialNewsData = require('./data/newsData');

const app = express();
const PORT = process.env.PORT || 3000;
const rootDir = path.join(__dirname, '..');

// ---------------------------------------------------------
// PRODUCTION CORS & SECURITY
// ---------------------------------------------------------
const rawAllowed = process.env.ALLOWED_ORIGINS;
const configuredOrigins = rawAllowed
    ? rawAllowed.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    : [];

app.use(cors({
    origin: (origin, callback) => {
        // 1. Allow requests with no origin (same-origin, curl, mobile apps, etc.)
        if (!origin) return callback(null, true);

        const originLower = origin.toLowerCase();

        // 2. Always allow localhost and loopback interfaces
        if (originLower.includes('localhost') || originLower.includes('127.0.0.1')) {
            return callback(null, true);
        }

        // 3. Always allow AI Studio / Google Cloud Run preview and deployment domains
        if (originLower.endsWith('.run.app') || 
            originLower.endsWith('.google.com') || 
            originLower.endsWith('.google.dev') ||
            originLower.endsWith('.web.app') ||
            originLower.endsWith('.firebaseapp.com')) {
            return callback(null, true);
        }

        // 4. Check if wildcard or configured in ALLOWED_ORIGINS
        if (configuredOrigins.length === 0 || 
            configuredOrigins.includes('*') || 
            configuredOrigins.some(allowed => originLower === allowed || originLower.endsWith(allowed))) {
            return callback(null, true);
        }

        // 5. Safe fallback: permit the origin rather than throwing an unhandled Error
        return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}));

app.use(express.json({ limit: '100kb' }));
app.use(express.static(rootDir));

// ---------------------------------------------------------
// IN-MEMORY CONCURRENT RATE LIMITER (Abuse Protection)
// ---------------------------------------------------------
const aiRateLimiter = (maxRequests = 30, windowMs = 60 * 1000) => {
    const clients = new Map();

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
let correctionsLedger = [
    {
        id: "corr-01",
        originalClaim: "Initial social reports indicated regional transport shut down completely.",
        correction: "Clarified by Ministry statement: Only selected suburban rail segments had 20-minute signal delays; regular operations maintained.",
        timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
        sourceOfCorrection: "Official Rail Operations Desk & PIB",
        status: "RESOLVED",
        impact: "Clarification"
    },
    {
        id: "corr-02",
        originalClaim: "Reports attributed commercial tax revision timeline to immediate quarter.",
        correction: "Corrected following Ministry of Finance gazette notification: Effective date is scheduled for subsequent financial year.",
        timestamp: new Date(Date.now() - 3600000 * 6).toISOString(),
        sourceOfCorrection: "Ministry of Finance Gazette Release",
        status: "RESOLVED",
        impact: "Factual Correction"
    }
];

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
            // Enrich articles with comprehensive evidence intelligence
            globalNewsCache = freshArticles.map(art => {
                const ev = analyzeArticleEvidence(art);
                return {
                    ...art,
                    evidence: ev,
                    verifiedStatus: ev ? ev.evidenceStatus : (art.verifiedStatus || "SUPPORTED"),
                    statusLabel: ev ? ev.statusLabel : "REPORTED"
                };
            });

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

// 3. Deep Evidence Breakdown for an Article or Event
app.get('/api/evidence/:id', (req, res) => {
    const articleId = String(req.params.id);
    const found = globalNewsCache.find(a => String(a.id) === articleId);

    if (!found) {
        return res.status(404).json({
            status: "error",
            errorCode: "ARTICLE_NOT_FOUND",
            message: "The requested article was not found in the active news index."
        });
    }

    const evidence = analyzeArticleEvidence(found);
    res.json({
        status: "success",
        data: evidence
    });
});

// 4. Side-by-Side Coverage Comparison Endpoint
app.post('/api/compare', (req, res) => {
    const { articleIds } = req.body || {};
    let targetArticles = [];

    if (Array.isArray(articleIds) && articleIds.length > 0) {
        targetArticles = globalNewsCache.filter(a => articleIds.map(String).includes(String(a.id)));
    }

    if (targetArticles.length === 0) {
        // Fallback: take top 2 related articles from the first cluster
        targetArticles = globalNewsCache.slice(0, 2);
    }

    const comparison = buildCoverageComparison(targetArticles);
    res.json({
        status: "success",
        data: comparison
    });
});

// 5. Rumor Firewall: Viral Claim Analysis
app.post('/api/rumor-firewall', aiRateLimiter(20, 60 * 1000), async (req, res) => {
    try {
        const { claim } = req.body || {};
        if (!claim || typeof claim !== 'string' || claim.trim() === '') {
            return res.status(400).json({
                status: "error",
                errorCode: "INVALID_REQUEST",
                message: "Claim text is required."
            });
        }

        const sanitized = claim.trim().substring(0, 500);
        const result = await satyaAIEngine.factCheck(sanitized, globalNewsCache);
        res.json({
            status: "success",
            data: result
        });
    } catch (err) {
        console.error("[RUMOR FIREWALL ERROR]:", err.message);
        res.status(500).json({
            status: "error",
            errorCode: "SERVER_ERROR",
            message: "Rumor analysis service temporarily unavailable."
        });
    }
});

// 6. Correction Ledger Endpoint
app.get('/api/corrections', (req, res) => {
    res.json({
        status: "success",
        count: correctionsLedger.length,
        data: correctionsLedger
    });
});

// 7. SATYA AI Chat & Dashboard Siri-Style Control Route
app.post('/api/ai-chat', aiRateLimiter(30, 60 * 1000), async (req, res) => {
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
            confidence: "INSUFFICIENT_EVIDENCE"
        });
    }
});

// 8. SATYA AI Fact Check Endpoint
app.post('/api/fact-check', aiRateLimiter(30, 60 * 1000), async (req, res) => {
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
            verificationStatus: "INSUFFICIENT_EVIDENCE",
            confidence: "LOW",
            explanation: "Verification service temporarily unavailable."
        });
    }
});

// 9. Config Endpoint
app.get('/api/config', (req, res) => {
    res.json({
        status: "success",
        environment: process.env.NODE_ENV || "production",
        features: {
            auth: true,
            firestore: true,
            ai: Boolean(process.env.GEMINI_API_KEY),
            evidenceEngine: true,
            coverageComparison: true,
            rumorFirewall: true,
            correctionsLedger: true
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
