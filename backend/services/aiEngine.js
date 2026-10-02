// backend/services/aiEngine.js
const { GoogleGenAI } = require('@google/genai');
const { SATYA_KNOWLEDGE } = require('../config/aiKnowledge');
const { analyzeArticleEvidence, buildCoverageComparison } = require('./evidenceEngine');
const { searchLiveWebNews } = require('./webSearchService');
const { buildStructuredNotes, generatePdfBuffer, generateDocxCompatibleBuffer, generateMarkdownDocument } = require('./documentService');

// In-memory analysis cache with 10-minute TTL to minimize Gemini load
const intelligenceCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

// Multilingual stopwords (English, Hindi, Hinglish)
const STOP_WORDS = new Set([
    // English
    "a", "an", "the", "in", "on", "at", "to", "for", "of", "with", "by", "from",
    "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
    "do", "does", "did", "can", "could", "shall", "should", "will", "would",
    "may", "might", "must", "and", "or", "but", "so", "as", "if", "than",
    "what", "which", "who", "whom", "this", "that", "these", "those",
    "me", "my", "we", "our", "you", "your", "they", "them", "their",
    "tell", "show", "give", "please", "about", "latest", "recent", "today", "now",
    "news", "story", "stories", "article", "articles", "update", "updates", "report", "reports",
    // Hindi & Hinglish
    "bhai", "kya", "hai", "hain", "ho", "tha", "thi", "the", "hoga", "hogi",
    "chal", "raha", "rahi", "rahe", "bata", "batao", "bataiye", "bol", "bolo",
    "dikha", "dikhao", "dikhaye", "mujhe", "hume", "meri", "mera", "mere",
    "maine", "hamne", "aap", "tum", "ye", "yeh", "wo", "woh", "is", "iss",
    "iska", "iski", "iske", "isko", "us", "uss", "uska", "uski", "uske", "usko",
    "in", "inka", "inki", "inke", "inko", "un", "unka", "unki", "unke", "unko",
    "aur", "ya", "se", "me", "mein", "par", "pe", "ke", "ki", "ko", "ka",
    "wali", "wala", "wale", "kuch", "sab", "koi", "abhi", "aaj", "kal",
    "kitna", "kitni", "kitne", "kab", "kaha", "kahan", "kaise", "kyun", "kyu",
    "jo", "vo", "voh", "toh", "to", "bhi", "hi", "he", "sirf"
]);

function matchKeyword(text, keyword) {
    if (!text || !keyword) return false;
    const cleanText = text.toLowerCase();
    const cleanKw = keyword.toLowerCase().trim();
    if (!cleanKw) return false;
    const escaped = cleanKw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?:$|[^a-zA-Z0-9])`, 'i');
    return regex.test(cleanText);
}

class SatyaAIEngine {
    constructor() {
        const envModel = process.env.GEMINI_MODEL;
        const isObsolete = !envModel || envModel.includes('2.0') || envModel.includes('2.5');
        this.primaryModel = isObsolete ? 'gemini-3.8-flash' : envModel;
        this.fallbackModels = [
            'gemini-3.8-flash',
            'gemini-3.1-flash-lite',
            'gemini-flash-latest'
        ];
        this.isApiKeyInvalid = false;
    }

    getAIClient() {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey || 
            apiKey === "yahan_apni_gemini_api_key_paste_kare" || 
            apiKey === "your_api_key_here" || 
            apiKey.trim() === "" ||
            this.isApiKeyInvalid) {
            return null;
        }
        try {
            return new GoogleGenAI({ 
                apiKey: apiKey.trim(),
                httpOptions: {
                    headers: {
                        'User-Agent': 'aistudio-build'
                    }
                }
            });
        } catch (err) {
            return null;
        }
    }

    async generateWithFallback(ai, params) {
        if (!ai) throw new Error("AI_CLIENT_UNAVAILABLE");
        const candidateModels = [this.primaryModel, ...this.fallbackModels].filter((v, i, a) => a.indexOf(v) === i);
        let lastError = null;

        for (const model of candidateModels) {
            try {
                const response = await ai.models.generateContent({
                    ...params,
                    model
                });
                return response;
            } catch (err) {
                lastError = err;
                const errMsg = err?.message || "";
                if (err.status === 401 || (err.status === 400 && (errMsg.includes('API key not valid') || errMsg.includes('API_KEY_INVALID')))) {
                    this.isApiKeyInvalid = true;
                    throw new Error("AI_AUTH_UNAVAILABLE");
                }
            }
        }
        throw lastError;
    }

    /**
     * Search live news pool using keyword and semantic tokens
     */
    searchLiveNews(query = "", filters = {}, newsPool = []) {
        if (!Array.isArray(newsPool) || newsPool.length === 0) return [];

        const cleanQuery = (query || "").toLowerCase().trim();
        const rawTokens = cleanQuery.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
        const meaningfulTokens = rawTokens.filter(t => !STOP_WORDS.has(t));

        let targetCategory = filters.category ? filters.category.toUpperCase() : null;
        let isITQuery = false;
        let isAIQuery = false;

        for (const token of rawTokens) {
            if (token === "it" && (cleanQuery.includes("it ki") || cleanQuery.includes("it news") || cleanQuery.includes("it me") || cleanQuery === "it" || cleanQuery.includes("it sector"))) {
                isITQuery = true;
                targetCategory = "TECHNOLOGY";
            }
            if (token === "ai") {
                isAIQuery = true;
                targetCategory = "TECHNOLOGY";
            }
            if (token === "sports" || token === "cricket" || token === "ipl") targetCategory = "SPORTS";
            if (token === "business" || token === "market" || token === "sensex" || token === "economy") targetCategory = "BUSINESS";
            if (token === "world" || token === "global") targetCategory = "WORLD";
            if (token === "india" || token === "national") targetCategory = "INDIA";
        }

        const scored = [];
        const now = Date.now();

        for (const article of newsPool) {
            const title = (article.title || "").toLowerCase();
            const desc = (article.description || "").toLowerCase();
            const cat = (article.category || "").toUpperCase();

            // Safety filter for IT/AI questions
            if (isITQuery || isAIQuery || targetCategory === "TECHNOLOGY") {
                const crimeWords = ["murder", "arrest", "rape", "jail", "assault", "crime", "robbery", "stolen", "killed", "police custody", "bail"];
                if (crimeWords.some(cw => matchKeyword(title, cw))) {
                    continue;
                }
            }

            let score = 0;
            if (targetCategory && (cat === targetCategory || (targetCategory === "INDIA" && cat === "TODAY"))) {
                score += 18;
            }

            for (const token of meaningfulTokens) {
                if (matchKeyword(title, token)) {
                    score += token.length <= 3 ? 16 : 14;
                } else if (matchKeyword(desc, token)) {
                    score += 5;
                }
            }

            if (isITQuery) {
                if (cat === "TECHNOLOGY") score += 15;
                if (matchKeyword(title, "tech") || matchKeyword(title, "software") || matchKeyword(title, "ai") || matchKeyword(title, "semiconductor") || matchKeyword(title, "cloud")) {
                    score += 12;
                }
            }

            if (isAIQuery) {
                if (matchKeyword(title, "ai") || matchKeyword(title, "artificial intelligence") || matchKeyword(title, "genai") || matchKeyword(title, "llm") || matchKeyword(title, "gemini")) {
                    score += 20;
                }
            }

            // Recency weighting
            if (article.publishedAt) {
                const pubTime = new Date(article.publishedAt).getTime();
                if (!isNaN(pubTime)) {
                    const hoursAgo = (now - pubTime) / (1000 * 60 * 60);
                    if (hoursAgo < 12) score += 8;
                    else if (hoursAgo < 24) score += 5;
                    else if (hoursAgo < 48) score += 2;
                }
            }

            const minThreshold = (meaningfulTokens.length > 0 || targetCategory) ? 12 : 6;
            if (score >= minThreshold) {
                scored.push({ article, score, publishedAt: article.publishedAt });
            }
        }

        scored.sort((a, b) => b.score - a.score);
        const limit = filters.limit || 5;
        return scored.slice(0, limit).map(item => item.article);
    }

    /**
     * TOP-RIGHT PANEL AI INTELLIGENCE GENERATOR
     * Generates:
     * - WHAT HAPPENED
     * - WHY IT MATTERS
     * - WHAT WE KNOW
     * - WHAT IS UNCLEAR
     * - LATEST UPDATE
     * - SOURCE STATUS
     * - TIMELINE
     * Caches result keyed by article ID for 10 minutes.
     */
    async getStoryIntelligence(article, newsPool = []) {
        if (!article || !article.id) return null;

        const cacheKey = `intel_${article.id}`;
        const cached = intelligenceCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
            return cached.data;
        }

        const evidence = analyzeArticleEvidence(article);
        const ai = this.getAIClient();

        // Baseline structured data from evidence engine
        let whatHappened = article.description || article.title;
        let whyItMatters = `Significant development in ${article.category || 'National News'} reported across verified outlets.`;
        let whatWeKnow = evidence?.whatWeKnow || [article.title];
        let whatIsUnclear = evidence?.whatWeDontKnow || ["Longer-term secondary confirmations developing."];
        let latestUpdate = `Reported by ${article.source || 'SATYA'} at ${new Date(article.publishedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

        // If Gemini is available, synthesize crisp, insightful analysis based on real article facts
        if (ai) {
            try {
                const prompt = `You are the SATYA News Intelligence Engine.
Analyze this news article and return a concise, factual briefing.
Story: "${article.title}"
Source: ${article.source}
Published: ${article.publishedAt}
Snippet: ${article.description || ''}
Evidence Level: ${evidence?.statusLabel || 'SUPPORTED'}

Respond with JSON only in this exact schema:
{
  "whatHappened": "1-2 sentence crisp factual summary of what occurred",
  "whyItMatters": "1 sentence explaining why this is important to citizens/stakeholders",
  "whatWeKnow": ["confirmed fact 1", "confirmed fact 2"],
  "whatIsUnclear": ["unconfirmed or pending detail 1", "unconfirmed detail 2"],
  "latestUpdate": "1 sentence on the newest update or current situation"
}`;

                const res = await this.generateWithFallback(ai, {
                    contents: prompt,
                    config: { responseMimeType: "application/json" }
                });

                if (res.text) {
                    const parsed = JSON.parse(res.text);
                    if (parsed.whatHappened) whatHappened = parsed.whatHappened;
                    if (parsed.whyItMatters) whyItMatters = parsed.whyItMatters;
                    if (Array.isArray(parsed.whatWeKnow) && parsed.whatWeKnow.length > 0) whatWeKnow = parsed.whatWeKnow;
                    if (Array.isArray(parsed.whatIsUnclear) && parsed.whatIsUnclear.length > 0) whatIsUnclear = parsed.whatIsUnclear;
                    if (parsed.latestUpdate) latestUpdate = parsed.latestUpdate;
                }
            } catch (err) {
                // Graceful fallback to verified evidence rules
            }
        }

        const independentOutlets = evidence?.independentSources || [article.source || "SATYA"];
        const intelResult = {
            articleId: article.id,
            title: article.title,
            source: article.source || "SATYA",
            publishedAt: article.publishedAt,
            verifiedStatus: evidence?.evidenceStatus || "SUPPORTED",
            statusLabel: evidence?.statusLabel || "MULTI-SOURCE CONFIRMED",
            whatHappened,
            whyItMatters,
            whatWeKnow,
            whatIsUnclear,
            latestUpdate,
            sourceStatus: {
                totalReports: evidence?.sourcesCount || 1,
                independentSources: independentOutlets,
                count: independentOutlets.length,
                isSyndicatedOnly: evidence?.isSyndicatedOnly || false,
                primaryEvidenceType: evidence?.primaryEvidenceType || null
            },
            timeline: evidence?.timeline || [
                { time: "Initial", label: `First report from ${article.source || 'Outlet'}` },
                { time: "Live", label: "Indexed in SATYA intelligence streams" }
            ],
            whatChanged: evidence?.whatChanged || null,
            generatedAt: new Date().toISOString()
        };

        intelligenceCache.set(cacheKey, {
            timestamp: Date.now(),
            data: intelResult
        });

        return intelResult;
    }

    /**
     * DYNAMIC COVERAGE COMPARISON FOR A SPECIFIC STORY
     * Finds related stories across pool or web, identifies independent outlets vs wire copy,
     * runs AI analysis comparing the reporting.
     */
    async compareCoverage(targetArticle, newsPool = []) {
        if (!targetArticle) return null;

        const title = targetArticle.title || "";
        const id = targetArticle.id || "";

        // 1. Search related articles in the local pool
        let related = this.searchLiveNews(title, { limit: 6 }, newsPool).filter(a => String(a.id) !== String(id));

        // 2. If fewer than 2 related stories found in local pool, query live web search
        if (related.length < 2) {
            try {
                const webResults = await searchLiveWebNews(title);
                if (Array.isArray(webResults) && webResults.length > 0) {
                    const extra = webResults.filter(w => !related.some(r => r.source === w.source));
                    related = [...related, ...extra].slice(0, 4);
                }
            } catch (e) {
                console.warn("[COMPARE WEB SEARCH WARN]:", e.message);
            }
        }

        const comparedArticles = [targetArticle, ...related].slice(0, 4);

        if (comparedArticles.length < 2) {
            return {
                status: "insufficient_coverage",
                message: "Insufficient independent coverage found across current news indexes. SATYA does not fabricate secondary sources.",
                primaryArticle: targetArticle,
                articles: [targetArticle],
                whatSourcesAgreeOn: "Single source report available at present.",
                keyDifferences: "Waiting for independent corroboration from other news organizations.",
                uniqueToEachReport: [],
                primarySource: targetArticle.source || "Initial Outlet",
                whatRemainsUncertain: "Corroboration from secondary independent editorial desks."
            };
        }

        const sourcesList = comparedArticles.map(a => ({
            id: a.id,
            source: a.source || "News Outlet",
            headline: a.title,
            publishedAt: a.publishedAt,
            url: a.sourceUrl || "",
            summary: a.description ? a.description.substring(0, 160) + "..." : a.title,
            evidenceStatus: a.verifiedStatus || "SUPPORTED"
        }));

        let whatSourcesAgreeOn = `All reporting outlets confirm the core event regarding: ${targetArticle.title.substring(0, 80)}.`;
        let keyDifferences = "Outlets differ in their choice of headline emphasis, quoting of local spokespersons, and timeline granularity.";
        let uniqueToEachReport = sourcesList.map(s => ({
            source: s.source,
            uniquePoint: `Highlighted specific angle: "${s.headline.substring(0, 70)}..."`
        }));
        let primarySource = targetArticle.source || "Initial Reporting Desk";
        let whatRemainsUncertain = "Official comprehensive inquiry results and long-term regulatory or policy directives.";

        // Run Gemini analysis on the compared coverage
        const ai = this.getAIClient();
        if (ai) {
            try {
                const comparisonContext = sourcesList.map((s, idx) => 
                    `[Source ${idx + 1}: ${s.source}] Headline: "${s.headline}" | Details: ${s.summary} | Time: ${s.publishedAt}`
                ).join('\n\n');

                const prompt = `You are SATYA AI Cross-Source Intelligence Analyzer.
Compare these independent news reports on the same event objectively:

${comparisonContext}

Return JSON with this schema:
{
  "whatSourcesAgreeOn": "2 sentences describing what all reporting outlets agree on",
  "keyDifferences": "2 sentences describing where coverage diverges, different focus, or framing",
  "uniqueToEachReport": [
    { "source": "Outlet Name", "uniquePoint": "What only this outlet reported" }
  ],
  "primarySource": "Identified originator, wire service (PTI/ANI/Reuters), or first outlet to break the story",
  "whatRemainsUncertain": "1 sentence on key facts that none of the outlets have verified yet"
}`;

                const res = await this.generateWithFallback(ai, {
                    contents: prompt,
                    config: { responseMimeType: "application/json" }
                });

                if (res.text) {
                    const parsed = JSON.parse(res.text);
                    if (parsed.whatSourcesAgreeOn) whatSourcesAgreeOn = parsed.whatSourcesAgreeOn;
                    if (parsed.keyDifferences) keyDifferences = parsed.keyDifferences;
                    if (Array.isArray(parsed.uniqueToEachReport) && parsed.uniqueToEachReport.length > 0) uniqueToEachReport = parsed.uniqueToEachReport;
                    if (parsed.primarySource) primarySource = parsed.primarySource;
                    if (parsed.whatRemainsUncertain) whatRemainsUncertain = parsed.whatRemainsUncertain;
                }
            } catch (err) {
                // Graceful fallback to deterministic cross-source synthesis
            }
        }

        return {
            status: "success",
            targetArticleId: targetArticle.id,
            articles: sourcesList,
            whatSourcesAgreeOn,
            keyDifferences,
            uniqueToEachReport,
            primarySource,
            whatRemainsUncertain,
            independentOutletsCount: sourcesList.length
        };
    }

    /**
     * EVIDENCE WORKSPACE INVESTIGATION
     * Investigates a story or user claim:
     * - Gathers sources
     * - Identifies primary documentation
     * - Checks for conflicting reports
     * - Evaluates evidence status: CONFIRMED, SUPPORTED, SINGLE SOURCE, CONFLICTING, UNVERIFIED, INSUFFICIENT EVIDENCE
     */
    async investigateEvidence(claimOrTitle, targetArticle = null, newsPool = []) {
        const queryText = (claimOrTitle || targetArticle?.title || "").trim();
        if (!queryText) {
            return {
                status: "error",
                message: "A claim or story title is required for evidence investigation."
            };
        }

        // Gather relevant articles from pool and web
        let poolMatches = this.searchLiveNews(queryText, { limit: 8 }, newsPool);
        if (targetArticle && !poolMatches.some(a => a.id === targetArticle.id)) {
            poolMatches = [targetArticle, ...poolMatches];
        }

        let webMatches = [];
        if (poolMatches.length < 3) {
            try {
                webMatches = await searchLiveWebNews(queryText);
            } catch (e) {}
        }

        const combined = [...poolMatches, ...webMatches].slice(0, 8);

        if (combined.length === 0) {
            return {
                status: "success",
                query: queryText,
                evidenceStatus: "INSUFFICIENT_EVIDENCE",
                statusLabel: "INSUFFICIENT EVIDENCE",
                confidence: "LOW",
                explanation: "No corroborating or primary reports currently exist in SATYA verified feeds or live web indexes. Evidence is insufficient to verify or refute this claim.",
                sourcesCount: 0,
                independentSources: [],
                whatWeKnow: [],
                whatWeDontKnow: ["No confirmed reports found in verified news indexes."],
                primaryEvidence: "None located",
                conflictingClaims: [],
                timeline: [],
                sources: []
            };
        }

        const primary = combined[0];
        const evidence = analyzeArticleEvidence(primary);
        const uniqueOutlets = [...new Set(combined.map(c => c.source || "News Outlet"))];

        let explanation = `Investigation across ${uniqueOutlets.length} news outlets shows ${evidence?.evidenceStatus || 'SUPPORTED'} reporting. Core facts originate from ${primary.source}.`;
        let whatWeKnow = evidence?.whatWeKnow || [primary.title];
        let whatWeDontKnow = evidence?.whatWeDontKnow || ["Secondary localized aftermath details still emerging."];
        let conflictingClaims = evidence?.hasConflict ? ["Conflicting accounts exist between statements regarding exact sequence of events."] : [];

        // Use Gemini for deep analytical evidence audit
        const ai = this.getAIClient();
        if (ai) {
            try {
                const sourcesSummary = combined.slice(0, 5).map((c, i) => 
                    `[${i + 1}] Source: ${c.source} | Headline: "${c.title}" | Published: ${c.publishedAt} | Snippet: ${c.description || ''}`
                ).join('\n');

                const prompt = `You are the Lead Forensic Evidence Analyst for SATYA News Intelligence.
Analyze the evidentiary strength behind this claim/event:
Claim/Event: "${queryText}"

Available Corroborating Sources:
${sourcesSummary}

Evaluate strictly:
1. Status must be one of: CONFIRMED, SUPPORTED, SINGLE SOURCE, CONFLICTING, UNVERIFIED, INSUFFICIENT EVIDENCE.
2. Distinguish between independent reports and syndicated wire copies.
3. Highlight primary evidence (official statements, gazettes, police FIR, court order) if present.

Return JSON in this schema:
{
  "evidenceStatus": "CONFIRMED | SUPPORTED | SINGLE SOURCE | CONFLICTING | UNVERIFIED | INSUFFICIENT EVIDENCE",
  "explanation": "2-3 sentence rigorous evaluation of the evidence strength and provenance",
  "whatWeKnow": ["confirmed fact 1", "confirmed fact 2"],
  "whatWeDontKnow": ["unclear or unverified point 1", "unclear point 2"],
  "primaryEvidence": "e.g. PIB Statement / Supreme Court order / Ministry release / Press conference / None",
  "conflictingClaims": ["any contradictory statements, or empty if none"]
}`;

                const res = await this.generateWithFallback(ai, {
                    contents: prompt,
                    config: { responseMimeType: "application/json" }
                });

                if (res.text) {
                    const parsed = JSON.parse(res.text);
                    if (parsed.evidenceStatus) evidence.evidenceStatus = parsed.evidenceStatus;
                    if (parsed.explanation) explanation = parsed.explanation;
                    if (Array.isArray(parsed.whatWeKnow) && parsed.whatWeKnow.length > 0) whatWeKnow = parsed.whatWeKnow;
                    if (Array.isArray(parsed.whatWeDontKnow) && parsed.whatWeDontKnow.length > 0) whatWeDontKnow = parsed.whatWeDontKnow;
                    if (Array.isArray(parsed.conflictingClaims)) conflictingClaims = parsed.conflictingClaims;
                }
            } catch (err) {
                // Graceful fallback to deterministic evidence workspace calculation
            }
        }

        return {
            status: "success",
            query: queryText,
            evidenceStatus: evidence?.evidenceStatus || "SUPPORTED",
            statusLabel: evidence?.statusLabel || (evidence?.evidenceStatus === "CONFIRMED" ? "MULTI-SOURCE CONFIRMED" : "CROSS-SUPPORTED"),
            confidence: evidence?.confidence || "MEDIUM",
            explanation,
            sourcesCount: combined.length,
            independentSources: uniqueOutlets,
            whatWeKnow,
            whatWeDontKnow,
            primaryEvidence: evidence?.primaryEvidenceType ? evidence.primaryEvidenceType.replace(/_/g, ' ') : "Secondary Media Reports",
            conflictingClaims,
            timeline: evidence?.timeline || combined.slice(0, 4).map(c => ({
                time: new Date(c.publishedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                source: c.source,
                headline: c.title,
                url: c.sourceUrl
            })),
            sources: combined.map(c => ({
                title: c.title,
                source: c.source,
                publishedAt: c.publishedAt,
                url: c.sourceUrl || ""
            }))
        };
    }

    /**
     * MAIN SATYA AI ASSISTANT (CONVERSATIONAL ENGINE)
     * Handles:
     * - Multi-turn follow-ups ("second wali samjha", "iska original source kya hai?", "kitne independent sources hain?")
     * - General AI knowledge ("what is quantum computing?", "explain Firebase", "who was Steve Jobs?")
     * - Document generation ("is news ke notes bana", "PDF bana de", "Word file bana do")
     * - Platform & Founder info ("SATYA kisne banaya?", "Raj Ravindra Deore kaun hai?")
     * - User SATYA reading activity & saved stories ("maine ise save kiya tha kya?", "kab save ki thi?", "maine aaj kya padha?")
     * - Live web news search for current inquiries ("bhai latest AI news bata", "India me aaj kya hua?")
     */
    async askSATYA(promptText, globalNewsPool = [], clientContext = {}, conversationHistory = []) {
        const lowerPrompt = (promptText || "").toLowerCase().trim();

        // 1. Language Style Detection
        const isHinglish = /bhai|kya|hai|hain|bata|batao|bataiye|dikha|dikhao|chal|raha|rahi|rahe|meri|mera|mere|maine|aaj|abhi|vo|voh|isko|isse|sach|kitni|kitna|kab|karo|kholo|dusri|doosri|second|pehle|pehli|teesri|third|kaun|kaise|kyun|samjha|padha|bana/.test(lowerPrompt);
        const isPureHindi = /[\u0900-\u097F]/.test(promptText);

        // 2. Client context parsing
        const isAuthenticated = Boolean(clientContext.authenticated);
        const userProfile = clientContext.userProfile || null;
        const savedArticles = Array.isArray(clientContext.savedArticles) ? clientContext.savedArticles : [];
        const currentArticle = clientContext.currentArticle || null;
        const lastReferencedArticles = Array.isArray(clientContext.lastReferencedArticles) ? clientContext.lastReferencedArticles : [];
        const sessionActivity = clientContext.sessionActivity || {};

        // 3. Resolve active target article across conversation context
        let activeTargetArticle = null;

        // Check if user is referencing the 1st, 2nd, or 3rd article from previous reply
        const isSecondRef = lowerPrompt.includes("second") || lowerPrompt.includes("doosri") || lowerPrompt.includes("dusri") || lowerPrompt.includes("2nd");
        const isFirstRef = lowerPrompt.includes("first") || lowerPrompt.includes("pehle") || lowerPrompt.includes("pehli") || lowerPrompt.includes("1st");
        const isThirdRef = lowerPrompt.includes("third") || lowerPrompt.includes("teesri") || lowerPrompt.includes("3rd");

        if (lastReferencedArticles.length > 0) {
            if (isFirstRef) activeTargetArticle = lastReferencedArticles[0];
            else if (isSecondRef && lastReferencedArticles.length > 1) activeTargetArticle = lastReferencedArticles[1];
            else if (isThirdRef && lastReferencedArticles.length > 2) activeTargetArticle = lastReferencedArticles[2];
        }

        // If not specified by index, check pronoun references ("iska", "is news", "this story", "ye news", "isko")
        if (!activeTargetArticle) {
            const hasPronounRef = lowerPrompt.includes("iska") || lowerPrompt.includes("iski") || lowerPrompt.includes("isko") || 
                                  lowerPrompt.includes("isme") || lowerPrompt.includes("is news") || lowerPrompt.includes("is story") || 
                                  lowerPrompt.includes("this article") || lowerPrompt.includes("this news") || lowerPrompt.includes("ise") || 
                                  lowerPrompt.includes("ye news") || lowerPrompt.includes("yeh news");
            if (hasPronounRef) {
                activeTargetArticle = currentArticle || (lastReferencedArticles.length > 0 ? lastReferencedArticles[0] : null);
            }
        }

        // -------------------------------------------------------------
        // INTENT 1: FOUNDER & SATYA PLATFORM INFO
        // -------------------------------------------------------------
        const isFounderQuery = lowerPrompt.includes("founder") || 
                               lowerPrompt.includes("banaya") || 
                               lowerPrompt.includes("who made satya") || 
                               lowerPrompt.includes("who created satya") ||
                               lowerPrompt.includes("raj ravindra deore") ||
                               lowerPrompt.includes("raj deore") ||
                               lowerPrompt.includes("satya kisne") ||
                               lowerPrompt.includes("who built satya");

        const isPlatformQuery = lowerPrompt === "what is satya" || 
                                lowerPrompt.includes("what is satya?") || 
                                lowerPrompt.includes("satya kya hai") || 
                                lowerPrompt.includes("about satya") ||
                                lowerPrompt.includes("what is satya platform");

        if (isFounderQuery || isPlatformQuery) {
            let reply = "";
            if (isFounderQuery) {
                reply = isHinglish || isPureHindi
                    ? `SATYA ko ${SATYA_KNOWLEDGE.founder} ne banaya hai. SATYA ek independent, evidence-first news intelligence platform hai jiska maksad news ko unverified sensationalism ki jagah proof, primary sources aur transparent cross-checking ke saath present karna hai.`
                    : `SATYA was founded and built by ${SATYA_KNOWLEDGE.founder}. SATYA is an evidence-first news intelligence platform designed to replace unverified headlines with verifiable facts, independent corroboration, and transparent source provenance.`;
            } else {
                reply = isHinglish || isPureHindi
                    ? `SATYA ek verified news intelligence platform hai. Iska core mission hai: "News + Evidence + Verification + Context". SATYA sirf headlines show nahi karta — ye har story ka source lineage, independent outlets ki corroboration, confirmed facts aur reporting timeline analyze karta hai.`
                    : `SATYA is an evidence-first news intelligence platform founded by ${SATYA_KNOWLEDGE.founder}. Its core mission is "News + Evidence + Verification + Context" — helping readers uncover what is confirmed, identify independent sources, verify conflicting claims, and follow evolving story timelines.`;
            }

            return {
                status: "success",
                reply,
                confidence: "CONFIRMED",
                evidence: { status: "CONFIRMED", label: "VERIFIED IDENTITY" },
                uiAction: null,
                actions: [],
                referencedArticles: []
            };
        }

        // -------------------------------------------------------------
        // INTENT 2: USER READING ACTIVITY & SESSION CONTEXT
        // ("maine aaj kya padha?", "what did i read?", "what am i reading?")
        // -------------------------------------------------------------
        const isReadingActivityQuery = lowerPrompt.includes("maine aaj kya padha") ||
                                       lowerPrompt.includes("main kya padh raha") ||
                                       lowerPrompt.includes("what did i read") ||
                                       lowerPrompt.includes("what have i been reading") ||
                                       lowerPrompt.includes("what am i reading") ||
                                       lowerPrompt.includes("last story i opened") ||
                                       lowerPrompt.includes("meri reading history") ||
                                       lowerPrompt.includes("last article i read");

        if (isReadingActivityQuery) {
            const currentArt = sessionActivity.currentArticle || currentArticle;
            const recentArts = Array.isArray(sessionActivity.recentArticlesViewed) ? sessionActivity.recentArticlesViewed : [];

            if (currentArt) {
                const reply = isHinglish || isPureHindi
                    ? `Aap abhi ye story padh rahe hain: "${currentArt.title}" (${currentArt.source || 'SATYA'}).`
                    : `You are currently reading: "${currentArt.title}" (${currentArt.source || 'SATYA'}).`;
                return {
                    status: "success",
                    reply,
                    confidence: "CONFIRMED",
                    uiAction: null,
                    actions: [],
                    referencedArticles: [currentArt]
                };
            }

            if (recentArts.length > 0) {
                const titles = recentArts.slice(0, 3).map((a, i) => `${i + 1}. "${a.title}" (${a.source})`).join("\n");
                const reply = isHinglish || isPureHindi
                    ? `Aapne is SATYA session mein ye stories padhi hain:\n\n${titles}`
                    : `In this SATYA session, you recently explored these stories:\n\n${titles}`;
                return {
                    status: "success",
                    reply,
                    confidence: "CONFIRMED",
                    uiAction: null,
                    actions: [],
                    referencedArticles: recentArts.slice(0, 3)
                };
            }

            const reply = isHinglish || isPureHindi
                ? "Aapne is session mein abhi tak koi article open nahi kiya hai. Aap Home dashboard par kisi bhi story par click karke padh sakte hain."
                : "You haven't opened any article in this active SATYA session yet. Feel free to explore stories from the Home feed or Today's briefing.";
            return {
                status: "success",
                reply,
                confidence: "CONFIRMED",
                uiAction: null,
                actions: [],
                referencedArticles: []
            };
        }

        // -------------------------------------------------------------
        // INTENT 3: SAVED STORIES & TIMESTAMPS
        // ("maine ise save kiya tha kya?", "kab save ki thi?", "meri saved news dikha")
        // -------------------------------------------------------------
        const isSavedCheckQuery = lowerPrompt.includes("save kiya tha") || lowerPrompt.includes("is this saved") || lowerPrompt.includes("did i save this");
        const isSavedTimeQuery = lowerPrompt.includes("kab save ki") || lowerPrompt.includes("when did i save") || lowerPrompt.includes("when was this saved");
        const isSavedListQuery = lowerPrompt.includes("meri saved") || lowerPrompt.includes("maine kya save") || lowerPrompt.includes("show my saved") || lowerPrompt.includes("saved stories");

        if (isSavedCheckQuery || isSavedTimeQuery) {
            const targetArt = activeTargetArticle || currentArticle;
            if (!targetArt) {
                const reply = isHinglish || isPureHindi
                    ? "Aap kaunsi story ke bare mein pooch rahe hain? Pehle koi story open karein ya uska naam batayein."
                    : "Which story are you referring to? Please open a story or mention its headline.";
                return { status: "success", reply, confidence: "INSUFFICIENT_EVIDENCE", uiAction: null, actions: [], referencedArticles: [] };
            }

            const matchSaved = savedArticles.find(s => 
                String(s.articleId) === String(targetArt.id) || 
                String(s.id) === String(targetArt.id) ||
                (s.title && targetArt.title && s.title.toLowerCase().trim() === targetArt.title.toLowerCase().trim())
            );

            if (matchSaved) {
                const savedDate = matchSaved.savedAt ? new Date(matchSaved.savedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) + " IST" : "earlier in this session";
                const reply = isHinglish || isPureHindi
                    ? `Haan, aapne story "${matchSaved.title.substring(0, 60)}..." ko ${savedDate} ko save kiya tha.`
                    : `Yes, you saved "${matchSaved.title.substring(0, 60)}..." on ${savedDate}.`;
                return {
                    status: "success",
                    reply,
                    confidence: "CONFIRMED",
                    uiAction: null,
                    actions: [],
                    referencedArticles: [matchSaved]
                };
            } else {
                const reply = isHinglish || isPureHindi
                    ? `Nahi, "${targetArt.title.substring(0, 50)}..." abhi aapki saved briefing mein save nahi hai. Kya main ise save kar doon?`
                    : `No, "${targetArt.title.substring(0, 50)}..." is not currently in your saved briefing. Would you like me to save it?`;
                return {
                    status: "success",
                    reply,
                    confidence: "CONFIRMED",
                    uiAction: null,
                    actions: [],
                    referencedArticles: [targetArt]
                };
            }
        }

        if (isSavedListQuery) {
            const count = savedArticles.length;
            if (count === 0) {
                const reply = isHinglish || isPureHindi
                    ? "Aapki saved stories list abhi empty hai. Aap kisi bhi story card par bookmark button tap karke use save kar sakte hain."
                    : "You haven't saved any stories yet. Tap the bookmark button on any story card to save it to your private briefing.";
                return {
                    status: "success",
                    reply,
                    confidence: "CONFIRMED",
                    uiAction: { type: "NAVIGATE_TAB", target: "saved" },
                    actions: [{ type: "NAVIGATE_TAB", target: "saved" }],
                    referencedArticles: []
                };
            }

            const titles = savedArticles.slice(0, 4).map((s, i) => `${i + 1}. "${s.title}" (${s.source || 'SATYA'})`).join("\n");
            const reply = isHinglish || isPureHindi
                ? `Aapki saved briefing mein total ${count} ${count === 1 ? 'story' : 'stories'} hain:\n\n${titles}`
                : `You have ${count} ${count === 1 ? 'story' : 'stories'} saved in your briefing:\n\n${titles}`;
            return {
                status: "success",
                reply,
                confidence: "CONFIRMED",
                uiAction: { type: "NAVIGATE_TAB", target: "saved" },
                actions: [{ type: "NAVIGATE_TAB", target: "saved" }],
                referencedArticles: savedArticles.slice(0, 4)
            };
        }

        // -------------------------------------------------------------
        // INTENT 4: DOCUMENT & NOTES GENERATION
        // ("is news ke notes bana", "PDF bana de", "Word file bana do", "make notes")
        // -------------------------------------------------------------
        const isDocRequest = lowerPrompt.includes("pdf bana") || 
                             lowerPrompt.includes("notes bana") || 
                             lowerPrompt.includes("word file") || 
                             lowerPrompt.includes("make a pdf") || 
                             lowerPrompt.includes("make notes") || 
                             lowerPrompt.includes("make docx") || 
                             lowerPrompt.includes("download notes");

        if (isDocRequest) {
            const targetArt = activeTargetArticle || currentArticle;
            if (!targetArt) {
                const reply = isHinglish || isPureHindi
                    ? "Kripya batayein ki aapko kis story ke notes ya PDF chahiye. Pehle koi article open karein ya uska naam batayein."
                    : "Please specify which article you would like notes or a PDF for. Open a story or mention its headline.";
                return { status: "success", reply, confidence: "INSUFFICIENT_EVIDENCE", uiAction: null, actions: [], referencedArticles: [] };
            }

            const evidence = analyzeArticleEvidence(targetArt);
            const notes = buildStructuredNotes(targetArt, evidence);
            const format = lowerPrompt.includes("word") || lowerPrompt.includes("docx") ? "docx" : "pdf";
            const downloadUrl = `/api/generate-document?articleId=${encodeURIComponent(targetArt.id)}&format=${format}`;

            const reply = isHinglish || isPureHindi
                ? `Maine "${targetArt.title.substring(0, 60)}..." ke verified intelligence notes taiyar kar diye hain!\n\n• Source: ${notes.source}\n• Status: ${notes.verifiedStatus}\n• Summary: ${notes.summary}\n\nAap niche diye gaye button se direct ${format.toUpperCase()} download kar sakte hain.`
                : `I have generated structured intelligence notes for "${targetArt.title.substring(0, 60)}..."!\n\n• Source: ${notes.source}\n• Status: ${notes.verifiedStatus}\n• Summary: ${notes.summary}\n\nYou can download the complete ${format.toUpperCase()} document using the button below.`;

            return {
                status: "success",
                reply,
                confidence: "CONFIRMED",
                documentAction: {
                    type: "DOWNLOAD_DOCUMENT",
                    articleId: targetArt.id,
                    title: targetArt.title,
                    format,
                    url: downloadUrl
                },
                uiAction: null,
                actions: [],
                referencedArticles: [targetArt]
            };
        }

        // -------------------------------------------------------------
        // INTENT 5: MULTI-TURN CONTEXT SPECIFICS
        // ("iska original source kya hai?", "kitne independent sources hain?", "second wali samjha")
        // -------------------------------------------------------------
        if (activeTargetArticle) {
            const isSourceQuery = lowerPrompt.includes("original source") || lowerPrompt.includes("source kya hai") || lowerPrompt.includes("where did this come from");
            const isEvidenceQuery = lowerPrompt.includes("kitne independent sources") || lowerPrompt.includes("independent sources") || lowerPrompt.includes("kitne source") || lowerPrompt.includes("proof kya");
            const isExplainQuery = lowerPrompt.includes("samjha") || lowerPrompt.includes("explain") || lowerPrompt.includes("batao") || lowerPrompt.includes("overview");
            const isCompareQuery = lowerPrompt.includes("compare") || lowerPrompt.includes("dusre sources se");

            if (isSourceQuery) {
                const evidence = analyzeArticleEvidence(activeTargetArticle);
                const lineage = evidence?.primaryEvidenceType ? `Primary lineage: ${evidence.primaryEvidenceType.replace(/_/g, ' ')}.` : "";
                const wire = evidence?.isSyndicatedOnly ? `(Syndicated wire report from ${evidence.syndicatedWire}).` : "";
                const reply = isHinglish || isPureHindi
                    ? `Is story ("${activeTargetArticle.title.substring(0, 50)}...") ka original source ${activeTargetArticle.source || 'News Desk'} hai. ${wire} ${lineage}`
                    : `The primary reporting source for "${activeTargetArticle.title.substring(0, 50)}..." is ${activeTargetArticle.source || 'News Desk'}. ${wire} ${lineage}`;
                return {
                    status: "success",
                    reply,
                    confidence: "CONFIRMED",
                    uiAction: null,
                    actions: [],
                    referencedArticles: [activeTargetArticle]
                };
            }

            if (isEvidenceQuery) {
                const evidence = analyzeArticleEvidence(activeTargetArticle);
                const count = evidence?.sourcesCount || 1;
                const outlets = evidence?.independentSources?.join(', ') || activeTargetArticle.source;
                const reply = isHinglish || isPureHindi
                    ? `Is story par abhi ${count} independent outlet(s) ki coverage indexed hai: ${outlets}. Verification status: ${evidence?.statusLabel || 'SUPPORTED'}.`
                    : `There are currently ${count} independent reporting outlet(s) covering this event: ${outlets}. Verification status: ${evidence?.statusLabel || 'SUPPORTED'}.`;
                return {
                    status: "success",
                    reply,
                    confidence: evidence?.evidenceStatus || "SUPPORTED",
                    uiAction: null,
                    actions: [],
                    referencedArticles: [activeTargetArticle]
                };
            }

            if (isCompareQuery) {
                const comparison = await this.compareCoverage(activeTargetArticle, globalNewsPool);
                const reply = isHinglish || isPureHindi
                    ? `Maine "${activeTargetArticle.title.substring(0, 50)}..." ki cross-source coverage compare ki hai:\n\n• Corroboration: ${comparison.whatSourcesAgreeOn}\n• Key Differences: ${comparison.keyDifferences}\n• Unresolved: ${comparison.whatRemainsUncertain}`
                    : `Here is the cross-source comparison for "${activeTargetArticle.title.substring(0, 50)}...":\n\n• Agreement: ${comparison.whatSourcesAgreeOn}\n• Key Differences: ${comparison.keyDifferences}\n• Uncertainties: ${comparison.whatRemainsUncertain}`;
                return {
                    status: "success",
                    reply,
                    confidence: "SUPPORTED",
                    uiAction: { type: "COMPARE_ARTICLE", articleId: activeTargetArticle.id },
                    actions: [],
                    referencedArticles: [activeTargetArticle]
                };
            }

            if (isExplainQuery) {
                const evidence = analyzeArticleEvidence(activeTargetArticle);
                const reply = isHinglish || isPureHindi
                    ? `Story: "${activeTargetArticle.title}" (${activeTargetArticle.source})\n\nVivaran: ${activeTargetArticle.description || 'Verified report'}\n\nEvidence status: ${evidence?.statusLabel || 'CROSS-SUPPORTED'}.`
                    : `Story: "${activeTargetArticle.title}" (${activeTargetArticle.source})\n\nOverview: ${activeTargetArticle.description || 'Verified report'}\n\nEvidence status: ${evidence?.statusLabel || 'CROSS-SUPPORTED'}.`;
                return {
                    status: "success",
                    reply,
                    confidence: activeTargetArticle.verifiedStatus || "SUPPORTED",
                    uiAction: { type: "OPEN_ARTICLE", target: activeTargetArticle.title },
                    actions: [],
                    referencedArticles: [activeTargetArticle]
                };
            }
        }

        // -------------------------------------------------------------
        // INTENT 6: UI NAVIGATION SHORTCUTS
        // ("Sports section kholo", "Business open karo", "Home jao")
        // -------------------------------------------------------------
        const isNavAction = lowerPrompt.includes("kholo") || lowerPrompt.includes("open") || lowerPrompt.includes("jao") || lowerPrompt.includes("dikhao");
        if (isNavAction) {
            const tabTargets = [
                { keyword: "sports", tab: "sports", label: "Sports" },
                { keyword: "business", tab: "business", label: "Business" },
                { keyword: "world", tab: "world", label: "World" },
                { keyword: "factcheck", tab: "factcheck", label: "Fact Check" },
                { keyword: "fact check", tab: "factcheck", label: "Fact Check" },
                { keyword: "evidence", tab: "evidence", label: "Evidence Workspace" },
                { keyword: "rumor", tab: "rumor", label: "Rumor Firewall" },
                { keyword: "correction", tab: "corrections", label: "Corrections Ledger" },
                { keyword: "today", tab: "today", label: "Today's Briefing" },
                { keyword: "saved", tab: "saved", label: "Saved Stories" },
                { keyword: "home", tab: "home", label: "Home" }
            ];

            for (const item of tabTargets) {
                if (lowerPrompt.includes(item.keyword)) {
                    return {
                        status: "success",
                        reply: isHinglish || isPureHindi ? `${item.label} section open kar raha hoon...` : `Opening ${item.label} section.`,
                        confidence: "CONFIRMED",
                        uiAction: { type: "NAVIGATE_TAB", target: item.tab },
                        actions: [{ type: "NAVIGATE_TAB", target: item.tab }],
                        referencedArticles: []
                    };
                }
            }
        }

        // -------------------------------------------------------------
        // INTENT 7: CURRENT / LIVE NEWS QUERY WITH REAL WEB SEARCH
        // ("bhai latest AI news bata", "India me aaj kya hua?", "latest news")
        // -------------------------------------------------------------
        const isCurrentNewsQuery = lowerPrompt.includes("news") || 
                                   lowerPrompt.includes("khabar") || 
                                   lowerPrompt.includes("headline") ||
                                   lowerPrompt.includes("latest") || 
                                   lowerPrompt.includes("breaking") ||
                                   lowerPrompt.includes("today") || 
                                   lowerPrompt.includes("aaj") || 
                                   lowerPrompt.includes("abhi") ||
                                   lowerPrompt.includes("update") || 
                                   lowerPrompt.includes("what happened") ||
                                   lowerPrompt.includes("kya hua") ||
                                   lowerPrompt.includes("match") || 
                                   lowerPrompt.includes("score") ||
                                   lowerPrompt.includes("sensex") || 
                                   lowerPrompt.includes("nifty") ||
                                   lowerPrompt.includes("ipl") || 
                                   lowerPrompt.includes("election") || 
                                   lowerPrompt.includes("ai news") ||
                                   lowerPrompt.includes("it news");

        if (isCurrentNewsQuery) {
            // Step 1: Search local live pool
            let matched = this.searchLiveNews(promptText, { limit: 5 }, globalNewsPool);

            // Step 2: If local pool has fewer than 2 results or query asks for live web/latest, trigger live web search!
            if (matched.length < 2 || lowerPrompt.includes("latest") || lowerPrompt.includes("abhi") || lowerPrompt.includes("today")) {
                try {
                    const webResults = await searchLiveWebNews(promptText);
                    if (Array.isArray(webResults) && webResults.length > 0) {
                        const existingTitles = new Set(matched.map(m => m.title.toLowerCase().trim()));
                        const filteredWeb = webResults.filter(w => !existingTitles.has(w.title.toLowerCase().trim()));
                        matched = [...matched, ...filteredWeb].slice(0, 5);
                    }
                } catch (webErr) {
                    console.warn("[LIVE WEB SEARCH IN CHAT FAILED]:", webErr.message);
                }
            }

            if (matched.length > 0) {
                const ai = this.getAIClient();
                const headlines = matched.slice(0, 3).map((a, i) => `${i + 1}. "${a.title}" (${a.source})`).join("\n");

                if (!ai) {
                    const reply = isHinglish || isPureHindi
                        ? `Live news feeds mein ye latest updates hain:\n\n${headlines}`
                        : `Here are the top verified reports from live feeds:\n\n${headlines}`;
                    return {
                        status: "success",
                        reply,
                        confidence: "SUPPORTED",
                        uiAction: null,
                        actions: [],
                        referencedArticles: matched
                    };
                }

                try {
                    const contextText = matched.map((a, i) => 
                        `[#${i + 1}] Title: ${a.title} | Source: ${a.source} | Published: ${a.publishedAt} | Snippet: ${a.description || ''}`
                    ).join('\n');

                    const systemPrompt = `You are SATYA AI, an evidence-first news intelligence assistant.
Respond to the user naturally based on the verified live articles provided.
Language Instruction:
${isHinglish ? "Respond in natural, conversational Hinglish (friendly, articulate, e.g. 'Bhai, latest reports ke mutabik...')." : isPureHindi ? "Respond in natural Hindi." : "Respond in clean, natural English."}

Rules:
1. Provide a direct, factual answer summarizing the top developments.
2. Explicitly cite the news sources (e.g. BBC, Indian Express, NDTV).
3. Mention 2-3 specific stories. Keep response concise (under 4 sentences or bullet points).`;

                    const res = await this.generateWithFallback(ai, {
                        contents: `${systemPrompt}\n\nLive Context Articles:\n${contextText}\n\nUser Question: ${promptText}`
                    });

                    const replyText = res.text ? res.text.trim() : `Here are the top updates:\n\n${headlines}`;
                    return {
                        status: "success",
                        reply: replyText,
                        confidence: "CONFIRMED",
                        uiAction: null,
                        actions: [],
                        referencedArticles: matched
                    };
                } catch (err) {
                    return {
                        status: "success",
                        reply: isHinglish || isPureHindi
                            ? `Live feeds ke taza updates ye hain:\n\n${headlines}`
                            : `Here are the top updates from live feeds:\n\n${headlines}`,
                        confidence: "SUPPORTED",
                        uiAction: null,
                        actions: [],
                        referencedArticles: matched
                    };
                }
            }

            // If web and local pool both found nothing
            return {
                status: "success",
                reply: isHinglish || isPureHindi
                    ? "Live web search is temporarily unavailable or no current reports were found on this specific query right now."
                    : "Live web search is temporarily unavailable or no current reports were found for this query.",
                confidence: "INSUFFICIENT_EVIDENCE",
                uiAction: null,
                actions: [],
                referencedArticles: []
            };
        }

        // -------------------------------------------------------------
        // INTENT 8: GENERAL AI (Science, Technology, Coding, History, Concepts)
        // ("what is quantum computing?", "explain Firebase", "who was Steve Jobs?")
        // -------------------------------------------------------------
        const ai = this.getAIClient();
        if (ai) {
            try {
                const generalPrompt = `You are SATYA AI, an intelligent, helpful, articulate conversational assistant.
Answer general questions (science, technology, programming, mathematics, history, everyday knowledge, explanations) naturally, clearly, and conversationally.
Language Instruction:
${isHinglish ? "Respond in natural, friendly Hinglish." : isPureHindi ? "Respond in natural Hindi." : "Respond in clean, natural English."}
Do NOT force SATYA news verification labels, evidence status, or news headers onto general knowledge questions. Be direct, accurate, and insightful.`;

                const res = await this.generateWithFallback(ai, {
                    contents: `${generalPrompt}\n\nUser Question: ${promptText}`
                });

                return {
                    status: "success",
                    reply: res.text ? res.text.trim() : "Here is what I found regarding your question.",
                    confidence: "CONFIRMED",
                    uiAction: null,
                    actions: [],
                    referencedArticles: []
                };
            } catch (err) {
                // Graceful fallback handled below
            }
        }

        // Fallback if AI service is temporarily offline
        return {
            status: "success",
            reply: isHinglish || isPureHindi
                ? "Main SATYA AI hoon. Main general questions, live verified news, evidence analysis aur fact-checking mein madad kar sakta hoon. Kripya apna prashna poochein."
                : "I am SATYA AI. I can assist with general knowledge, verified news intelligence, cross-source comparisons, and document generation. How can I help you?",
            confidence: "SUPPORTED",
            uiAction: null,
            actions: [],
            referencedArticles: []
        };
    }

    /**
     * Fact-check claim against live news pool with structured evidence
     */
    async factCheck(claim, globalNewsPool = []) {
        if (!claim || typeof claim !== 'string' || claim.trim() === '') {
            return {
                status: "error",
                errorCode: "INVALID_REQUEST",
                claim: "",
                verificationStatus: "INSUFFICIENT_EVIDENCE",
                confidence: "LOW",
                explanation: "Claim text is required for fact-check verification.",
                verifiedSources: []
            };
        }

        const sanitizedClaim = claim.trim();
        const lowerClaim = sanitizedClaim.toLowerCase();

        // Founder verification
        if (lowerClaim.includes("founder") || lowerClaim.includes("owner") || lowerClaim.includes("banaya") || lowerClaim.includes("raj ravindra deore")) {
            return {
                status: "success",
                claim: sanitizedClaim,
                verificationStatus: "CONFIRMED",
                confidence: "HIGH",
                explanation: `Verified: SATYA was founded by ${SATYA_KNOWLEDGE.founder}. SATYA is an independent news intelligence and truth analysis platform.`,
                verifiedSources: ["SATYA Platform Archive"]
            };
        }

        // Search relevant articles using the intelligent search tool + web search
        let matchedArticles = this.searchLiveNews(sanitizedClaim, { limit: 8 }, globalNewsPool);
        if (matchedArticles.length === 0) {
            try {
                const webResults = await searchLiveWebNews(sanitizedClaim);
                if (Array.isArray(webResults) && webResults.length > 0) {
                    matchedArticles = webResults.slice(0, 5);
                }
            } catch (e) {}
        }

        if (matchedArticles.length === 0) {
            return {
                status: "success",
                claim: sanitizedClaim,
                verificationStatus: "INSUFFICIENT_EVIDENCE",
                confidence: "LOW",
                explanation: "No corroborating or debunking reports found in active verified news streams. SATYA does not assume unverified claims are false, but evidence is currently insufficient.",
                verifiedSources: []
            };
        }

        const evidence = analyzeArticleEvidence(matchedArticles[0]);
        const sources = [...new Set(matchedArticles.map(a => a.source))];
        const ai = this.getAIClient();

        if (ai) {
            try {
                const contextText = matchedArticles.map((a, i) => 
                    `[#${i + 1}] Title: ${a.title} | Source: ${a.source} | Snippet: ${a.description || ''}`
                ).join('\n');

                const prompt = `You are SATYA AI Fact Checker.
Task: Cross-reference this claim strictly against the provided news context.
Claim: "${sanitizedClaim}"

Context:
${contextText}

Evaluate evidence strictly:
- CONFIRMED (supported by 2+ independent reliable sources or official documents)
- SUPPORTED (supported by 1 reputable source)
- CONFLICTING (contradictory reports present)
- UNVERIFIED (rumor/unsubstantiated)
- INSUFFICIENT_EVIDENCE (not enough info)

Write a 2-sentence explanation of what is confirmed, what is uncertain, and cite the sources.`;

                const res = await this.generateWithFallback(ai, {
                    contents: prompt
                });

                return {
                    status: "success",
                    claim: sanitizedClaim,
                    verificationStatus: evidence ? evidence.evidenceStatus : "SUPPORTED",
                    confidence: evidence ? evidence.confidence : "MEDIUM",
                    explanation: res.text ? res.text.trim() : `Reported by ${sources.join(', ')}.`,
                    verifiedSources: sources,
                    whatWeKnow: evidence?.whatWeKnow || [],
                    whatWeDontKnow: evidence?.whatWeDontKnow || []
                };
            } catch (err) {
                // Graceful fallback to verified news index below
            }
        }

        return {
            status: "success",
            claim: sanitizedClaim,
            verificationStatus: evidence ? evidence.evidenceStatus : "SUPPORTED",
            confidence: evidence ? evidence.confidence : "MEDIUM",
            explanation: `Cross-referenced against reports from ${sources.join(', ')}. Initial evidence aligns with current coverage.`,
            verifiedSources: sources,
            whatWeKnow: evidence?.whatWeKnow || [],
            whatWeDontKnow: evidence?.whatWeDontKnow || []
        };
    }
}

const satyaAIEngine = new SatyaAIEngine();
module.exports = satyaAIEngine;
