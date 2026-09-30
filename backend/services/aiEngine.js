// backend/services/aiEngine.js
const { GoogleGenAI } = require('@google/genai');
const { SATYA_KNOWLEDGE } = require('../config/aiKnowledge');
const { analyzeArticleEvidence } = require('./evidenceEngine');
const { searchLiveWebNews } = require('./webSearchService');

const ALLOWED_UI_ACTIONS = new Set([
    "NAVIGATE_TAB",
    "OPEN_CATEGORY",
    "GO_HOME",
    "OPEN_SAVED",
    "OPEN_TODAY",
    "OPEN_WORLD",
    "OPEN_BUSINESS",
    "OPEN_SPORTS",
    "OPEN_FACT_CHECK",
    "SHOW_FACT_CHECK",
    "OPEN_NEWS_PLUS",
    "OPEN_EVIDENCE",
    "OPEN_RUMOR",
    "OPEN_CORRECTIONS",
    "SHOW_TRENDING",
    "SHOW_LATEST",
    "SCROLL_TO_SECTION",
    "SEARCH_NEWS",
    "OPEN_ARTICLE",
    "SAVE_ARTICLE",
    "DELETE_SAVED_ARTICLE",
    "PROMPT_SIGN_IN"
]);

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

// Word-boundary safe keyword matching
function matchKeyword(text, keyword) {
    if (!text || !keyword) return false;
    const cleanText = text.toLowerCase();
    const cleanKw = keyword.toLowerCase().trim();
    if (!cleanKw) return false;

    // Strict regex with word boundaries
    const escaped = cleanKw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?:$|[^a-zA-Z0-9])`, 'i');
    return regex.test(cleanText);
}

// Domain synonym dictionaries
const TOPIC_SYNONYMS = {
    "it": ["information technology", "tech", "software", "tcs", "infosys", "wipro", "hcl", "ai", "cloud", "cyber", "semiconductor", "digital", "developer"],
    "ai": ["artificial intelligence", "genai", "deepfake", "machine learning", "chatgpt", "gemini", "openai", "nvidia", "llm", "neural"],
    "tech": ["technology", "tech", "software", "hardware", "gadget", "cyber", "digital", "smartphone"],
    "technology": ["technology", "tech", "software", "it sector", "digital", "semiconductor", "cyber"],
    "sports": ["sports", "cricket", "ipl", "bcci", "football", "tennis", "hockey", "badminton", "tournament", "score", "match"],
    "cricket": ["cricket", "ipl", "bcci", "test", "odi", "t20", "rohit", "kohli", "dhoni"],
    "business": ["business", "market", "economy", "sensex", "nifty", "share", "stock", "rupee", "inflation", "rbi", "sebi", "gdp"],
    "market": ["market", "sensex", "nifty", "stock", "shares", "trading", "investor"],
    "world": ["world", "global", "international", "foreign", "us", "usa", "china", "russia", "israel", "iran", "ukraine", "middle east"],
    "india": ["india", "national", "bharat", "delhi", "centre", "government", "parliament", "supreme court", "election"]
};

class SatyaAIEngine {
    constructor() {
        const envModel = process.env.GEMINI_MODEL;
        const isObsolete = !envModel || envModel.includes('2.0') || envModel === 'gemini-2.5-flash' || envModel === 'gemini-2.5-flash-lite';
        this.primaryModel = isObsolete ? 'gemini-3.1-flash-lite-preview' : envModel;
        this.fallbackModels = [
            'gemini-3.1-flash-lite-preview',
            'gemini-3.1-flash-lite',
            'gemini-3.8-flash',
            'gemini-2.5-pro',
            'gemini-3-flash-preview',
            'gemini-flash-latest'
        ];
    }

    getAIClient() {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey || apiKey === "yahan_apni_gemini_api_key_paste_kare" || apiKey.trim() === "") {
            return null;
        }
        try {
            return new GoogleGenAI({ apiKey });
        } catch (err) {
            console.warn("[SATYA AI] GoogleGenAI initialization error:", err.message);
            return null;
        }
    }

    async generateWithFallback(ai, params) {
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
                console.warn(`[SATYA AI] Model ${model} request warning: ${err.message?.substring(0, 120)}`);
                if (err.status === 401 || err.message?.includes('API key not valid')) {
                    throw err;
                }
            }
        }
        throw lastError;
    }

    /**
     * Strict Token-Aware Live News Search with Category & Entity Matching
     */
    searchLiveNews(query = "", filters = {}, newsPool = []) {
        if (!Array.isArray(newsPool) || newsPool.length === 0) return [];

        const cleanQuery = (query || "").toLowerCase().trim();
        const rawTokens = cleanQuery.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
        const meaningfulTokens = rawTokens.filter(t => !STOP_WORDS.has(t));

        // Category determination
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
            if (token === "sports" || token === "cricket") targetCategory = "SPORTS";
            if (token === "business" || token === "market" || token === "sensex" || token === "economy") targetCategory = "BUSINESS";
            if (token === "world" || token === "global") targetCategory = "WORLD";
            if (token === "india" || token === "national") targetCategory = "INDIA";
            if (token === "factcheck" || token === "fact") targetCategory = "FACT CHECK";
        }

        // Expand tokens with domain synonyms
        const expandedTokens = new Set(meaningfulTokens);
        if (isITQuery) {
            TOPIC_SYNONYMS["it"].forEach(t => expandedTokens.add(t));
        }
        if (isAIQuery) {
            TOPIC_SYNONYMS["ai"].forEach(t => expandedTokens.add(t));
        }
        if (targetCategory === "BUSINESS") {
            TOPIC_SYNONYMS["business"].forEach(t => expandedTokens.add(t));
        }
        if (targetCategory === "SPORTS") {
            TOPIC_SYNONYMS["sports"].forEach(t => expandedTokens.add(t));
        }

        const scored = [];
        const now = Date.now();

        for (const article of newsPool) {
            const title = (article.title || "").toLowerCase();
            const desc = (article.description || "").toLowerCase();
            const cat = (article.category || "").toUpperCase();

            // CRITICAL RELEVANCE GUARD:
            // If the query is specifically about IT or Technology, NEVER return Crime, Murder, or Court dispute stories
            if (isITQuery || isAIQuery || targetCategory === "TECHNOLOGY") {
                const crimeWords = ["murder", "arrest", "rape", "jail", "assault", "crime", "robbery", "stolen", "killed", "police custody", "bail"];
                if (crimeWords.some(cw => matchKeyword(title, cw))) {
                    continue; // Skip entirely!
                }
            }

            let score = 0;

            // Category match bonus
            if (targetCategory && (cat === targetCategory || (targetCategory === "INDIA" && cat === "TODAY"))) {
                score += 18;
            }

            // Keyword match scoring with word-boundary safety
            for (const token of expandedTokens) {
                if (matchKeyword(title, token)) {
                    score += token.length <= 3 ? 16 : 14;
                } else if (matchKeyword(desc, token)) {
                    score += 5;
                }
            }

            if (isITQuery) {
                if (cat === "TECHNOLOGY") score += 15;
                if (matchKeyword(title, "tech") || matchKeyword(title, "software") || matchKeyword(title, "ai") || matchKeyword(title, "semiconductor")) {
                    score += 12;
                }
            }

            if (isAIQuery) {
                if (matchKeyword(title, "ai") || matchKeyword(title, "artificial intelligence") || matchKeyword(title, "genai")) {
                    score += 20;
                }
            }

            // Recency boost (up to 8 points for fresh news within 12h)
            if (article.publishedAt) {
                const pubTime = new Date(article.publishedAt).getTime();
                if (!isNaN(pubTime)) {
                    const hoursAgo = (now - pubTime) / (1000 * 60 * 60);
                    if (hoursAgo < 12) score += 8;
                    else if (hoursAgo < 24) score += 5;
                    else if (hoursAgo < 48) score += 2;
                }
            }

            // Minimum relevance threshold
            const minThreshold = (meaningfulTokens.length > 0 || targetCategory) ? 14 : 6;
            if (score >= minThreshold) {
                scored.push({ article, score, publishedAt: article.publishedAt });
            }
        }

        // Sort by relevance score, with recency weighting
        scored.sort((a, b) => b.score - a.score);

        const limit = filters.limit || 5;
        return scored.slice(0, limit).map(item => item.article);
    }

    /**
     * Main SATYA AI Intelligence Assistant
     * Supports Two Modes:
     * Mode 1: General Purpose AI (Quantum computing, AWS, science, coding, general questions)
     * Mode 2: SATYA Intelligence (Live news, Evidence, Fact checks, Platform knowledge, User session activity)
     */
    async askSATYA(promptText, globalNewsPool = [], clientContext = {}, conversationHistory = []) {
        const lowerPrompt = promptText.toLowerCase().trim();

        // Detect user language style
        const isHinglish = /bhai|kya|hai|hain|bata|batao|dikha|dikhao|chal|raha|rahi|rahe|meri|mera|mere|maine|aaj|abhi|vo|voh|isko|sach|kitni|kab|karo|kholo|dusri|doosri|pehle|kaun|kaise/.test(lowerPrompt);
        const isPureHindi = /[\u0900-\u097F]/.test(promptText);

        // Client session state
        const isAuthenticated = Boolean(clientContext.authenticated);
        const userProfile = clientContext.userProfile || null;
        const savedArticles = Array.isArray(clientContext.savedArticles) ? clientContext.savedArticles : [];
        const currentArticle = clientContext.currentArticle || null;
        const lastReferencedArticles = Array.isArray(clientContext.lastReferencedArticles) ? clientContext.lastReferencedArticles : [];
        const sessionActivity = clientContext.sessionActivity || {};

        // -------------------------------------------------------------
        // 1. FOUNDER & PLATFORM MISSION INTENT (Authoritative, Deterministic)
        // -------------------------------------------------------------
        const isFounderQuery = lowerPrompt.includes("founder") || 
                               lowerPrompt.includes("owner") || 
                               lowerPrompt.includes("banaya") || 
                               lowerPrompt.includes("who made satya") || 
                               lowerPrompt.includes("who created satya") ||
                               lowerPrompt.includes("raj ravindra deore") ||
                               lowerPrompt.includes("raj deore") ||
                               lowerPrompt.includes("who made this website") ||
                               lowerPrompt.includes("who made this app");

        const isPlatformQuery = lowerPrompt === "what is satya" || 
                                lowerPrompt.includes("what is satya?") || 
                                lowerPrompt.includes("satya kya hai") || 
                                lowerPrompt.includes("about satya") ||
                                lowerPrompt.includes("what is satya trying to solve");

        if (isFounderQuery || isPlatformQuery) {
            let reply = "";
            if (isFounderQuery) {
                reply = isHinglish || isPureHindi
                    ? `SATYA ko ${SATYA_KNOWLEDGE.founder} ne banaya hai. SATYA ek independent, multi-source news intelligence aur truth analysis platform hai jo news ko evidence, source lineage aur context ke saath present karta hai.`
                    : `SATYA was founded and built by ${SATYA_KNOWLEDGE.founder}. SATYA is an independent news intelligence platform dedicated to "News + Evidence + Verification + Context" rather than unverified headlines.`;
            } else {
                reply = isHinglish || isPureHindi
                    ? `SATYA ek next-generation news intelligence platform hai. Iska core mission hai: "News + Evidence + Verification + Context". SATYA sirf headlines aggregate nahi karta, balki reports ke piche ka actual proof, independent sources ki corroboration aur story timelines explain karta hai.`
                    : `SATYA is an evidence-first news intelligence platform founded by ${SATYA_KNOWLEDGE.founder}. Its core mission is "News + Evidence + Verification + Context" — helping people understand what is actually known about an event, where information originated, how multiple sources compare, what remains uncertain, and how stories develop over time.`;
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
        // 2. USER SATYA SESSION ACTIVITY INTENT ("Main kya padh raha tha?", "What did I read?")
        // -------------------------------------------------------------
        const isActivityQuery = lowerPrompt.includes("main abhi kya dekh") || 
                                lowerPrompt.includes("what am i looking at") || 
                                lowerPrompt.includes("which story was i reading") ||
                                lowerPrompt.includes("last story i opened") ||
                                lowerPrompt.includes("main kya padh raha tha") ||
                                lowerPrompt.includes("what did i read recently") ||
                                lowerPrompt.includes("what have i been reading") ||
                                lowerPrompt.includes("main sabse zyada kaunsi category") ||
                                lowerPrompt.includes("what category do i read most") ||
                                lowerPrompt.includes("what should i catch up on") ||
                                lowerPrompt.includes("what should i read next");

        if (isActivityQuery) {
            const currentArt = sessionActivity.currentArticle || currentArticle;
            const recentArt = sessionActivity.recentArticlesViewed || [];
            const catCounts = sessionActivity.categoryVisitCounts || {};
            const currentTab = sessionActivity.currentTab || "home";

            // Find top category
            let topCat = null;
            let maxCount = 0;
            for (const [cat, count] of Object.entries(catCounts)) {
                if (count > maxCount) {
                    maxCount = count;
                    topCat = cat;
                }
            }

            if (lowerPrompt.includes("sabse zyada") || lowerPrompt.includes("category do i read most")) {
                if (topCat && maxCount > 0) {
                    const reply = isHinglish || isPureHindi
                        ? `Is active session mein aapne sabse zyada "${topCat}" category ki stories explore ki hain (${maxCount} views).`
                        : `In this active session, you have mostly explored stories in the "${topCat}" category (${maxCount} views).`;
                    return { status: "success", reply, confidence: "CONFIRMED", uiAction: null, actions: [], referencedArticles: [] };
                } else {
                    const reply = isHinglish || isPureHindi
                        ? "Aapne is session mein abhi tak kaafi kam stories padhi hain, isliye reading pattern determine nahi hua hai."
                        : "You haven't read enough stories in this session yet to determine your top category.";
                    return { status: "success", reply, confidence: "INSUFFICIENT_EVIDENCE", uiAction: null, actions: [], referencedArticles: [] };
                }
            }

            if (currentArt) {
                const reply = isHinglish || isPureHindi
                    ? `Aap abhi story padh rahe hain: "${currentArt.title}" (${currentArt.source || 'SATYA Feed'}).`
                    : `You are currently viewing: "${currentArt.title}" (${currentArt.source || 'SATYA Feed'}).`;
                return { status: "success", reply, confidence: "CONFIRMED", uiAction: null, actions: [], referencedArticles: [currentArt] };
            }

            if (recentArt.length > 0) {
                const last = recentArt[0];
                const reply = isHinglish || isPureHindi
                    ? `Aapne recently "${last.title}" (${last.source || 'SATYA'}) open kiya tha.`
                    : `You recently opened: "${last.title}" (${last.source || 'SATYA'}).`;
                return { status: "success", reply, confidence: "CONFIRMED", uiAction: null, actions: [], referencedArticles: [last] };
            }

            const reply = isHinglish || isPureHindi
                ? `Aap abhi SATYA ke "${currentTab.toUpperCase()}" view par hain. Aapne is session mein abhi koi article open nahi kiya hai.`
                : `You are currently on the "${currentTab.toUpperCase()}" view. You haven't opened any article in this active session yet.`;
            return { status: "success", reply, confidence: "CONFIRMED", uiAction: null, actions: [], referencedArticles: [] };
        }

        // -------------------------------------------------------------
        // 3. UI NAVIGATION COMMAND INTENTS (Strict Whitelist)
        // -------------------------------------------------------------
        const isNavAction = lowerPrompt.includes("kholo") || 
                            lowerPrompt.includes("open") || 
                            lowerPrompt.includes("show") || 
                            lowerPrompt.includes("jao") || 
                            lowerPrompt.includes("dikhao") || 
                            lowerPrompt.includes("navigate");

        if (lowerPrompt.includes("sports") && (isNavAction || lowerPrompt.includes("section") || lowerPrompt.includes("page"))) {
            return {
                status: "success",
                reply: isHinglish || isPureHindi ? "Sports section khol raha hoon..." : "Navigating to Sports.",
                confidence: "CONFIRMED",
                uiAction: { type: "NAVIGATE_TAB", target: "sports" },
                actions: [{ type: "NAVIGATE_TAB", target: "sports" }],
                referencedArticles: []
            };
        }
        if (lowerPrompt.includes("business") && (isNavAction || lowerPrompt.includes("section") || lowerPrompt.includes("page"))) {
            return {
                status: "success",
                reply: isHinglish || isPureHindi ? "Business section khol raha hoon..." : "Navigating to Business.",
                confidence: "CONFIRMED",
                uiAction: { type: "NAVIGATE_TAB", target: "business" },
                actions: [{ type: "NAVIGATE_TAB", target: "business" }],
                referencedArticles: []
            };
        }
        if (lowerPrompt.includes("world") && (isNavAction || lowerPrompt.includes("section") || lowerPrompt.includes("page"))) {
            return {
                status: "success",
                reply: isHinglish || isPureHindi ? "World news open kar raha hoon..." : "Navigating to World news.",
                confidence: "CONFIRMED",
                uiAction: { type: "NAVIGATE_TAB", target: "world" },
                actions: [{ type: "NAVIGATE_TAB", target: "world" }],
                referencedArticles: []
            };
        }
        if ((lowerPrompt.includes("fact check") || lowerPrompt.includes("factcheck")) && (isNavAction || lowerPrompt.includes("page") || lowerPrompt.includes("tool"))) {
            return {
                status: "success",
                reply: isHinglish || isPureHindi ? "SATYA Fact Check tool open kar raha hoon..." : "Opening SATYA Fact Check workspace.",
                confidence: "CONFIRMED",
                uiAction: { type: "NAVIGATE_TAB", target: "factcheck" },
                actions: [{ type: "NAVIGATE_TAB", target: "factcheck" }],
                referencedArticles: []
            };
        }
        if (lowerPrompt.includes("evidence") && (isNavAction || lowerPrompt.includes("page") || lowerPrompt.includes("workspace"))) {
            return {
                status: "success",
                reply: isHinglish || isPureHindi ? "SATYA Evidence workspace open kar raha hoon..." : "Opening SATYA Evidence workspace.",
                confidence: "CONFIRMED",
                uiAction: { type: "NAVIGATE_TAB", target: "evidence" },
                actions: [{ type: "NAVIGATE_TAB", target: "evidence" }],
                referencedArticles: []
            };
        }
        if (lowerPrompt.includes("rumor") && (isNavAction || lowerPrompt.includes("firewall") || lowerPrompt.includes("page"))) {
            return {
                status: "success",
                reply: isHinglish || isPureHindi ? "Rumor Firewall tool open kar raha hoon..." : "Opening Rumor Firewall tool.",
                confidence: "CONFIRMED",
                uiAction: { type: "NAVIGATE_TAB", target: "rumor" },
                actions: [{ type: "NAVIGATE_TAB", target: "rumor" }],
                referencedArticles: []
            };
        }
        if (lowerPrompt.includes("correction") && (isNavAction || lowerPrompt.includes("ledger") || lowerPrompt.includes("page"))) {
            return {
                status: "success",
                reply: isHinglish || isPureHindi ? "Corrections Ledger open kar raha hoon..." : "Opening Corrections Ledger.",
                confidence: "CONFIRMED",
                uiAction: { type: "NAVIGATE_TAB", target: "corrections" },
                actions: [{ type: "NAVIGATE_TAB", target: "corrections" }],
                referencedArticles: []
            };
        }
        if (lowerPrompt.includes("today") && (isNavAction || lowerPrompt.includes("briefing") || lowerPrompt.includes("page"))) {
            return {
                status: "success",
                reply: isHinglish || isPureHindi ? "Today's Briefing open kar raha hoon..." : "Opening Today's Briefing.",
                confidence: "CONFIRMED",
                uiAction: { type: "NAVIGATE_TAB", target: "today" },
                actions: [{ type: "NAVIGATE_TAB", target: "today" }],
                referencedArticles: []
            };
        }
        if (lowerPrompt.includes("newsplus") || lowerPrompt.includes("event cluster") || (lowerPrompt.includes("news+") && isNavAction)) {
            return {
                status: "success",
                reply: isHinglish || isPureHindi ? "Event Clusters (News+) open kar raha hoon..." : "Opening Event Clusters.",
                confidence: "CONFIRMED",
                uiAction: { type: "NAVIGATE_TAB", target: "newsplus" },
                actions: [{ type: "NAVIGATE_TAB", target: "newsplus" }],
                referencedArticles: []
            };
        }
        if (lowerPrompt.includes("home") && (isNavAction || lowerPrompt.includes("pe jao") || lowerPrompt.includes("dashboard"))) {
            return {
                status: "success",
                reply: isHinglish || isPureHindi ? "Home dashboard par wapas le jaa raha hoon." : "Returning to Home dashboard.",
                confidence: "CONFIRMED",
                uiAction: { type: "NAVIGATE_TAB", target: "home" },
                actions: [{ type: "NAVIGATE_TAB", target: "home" }],
                referencedArticles: []
            };
        }

        // -------------------------------------------------------------
        // 4. ARTICLE CONTEXT INTENT ("Isme proof kya hai?", "Source kya hai?")
        // -------------------------------------------------------------
        const isArticleContextQuery = (lowerPrompt.includes("isme") || 
                                       lowerPrompt.includes("iska") || 
                                       lowerPrompt.includes("is story") || 
                                       lowerPrompt.includes("this article") || 
                                       lowerPrompt.includes("proof") ||
                                       lowerPrompt.includes("evidence status")) && currentArticle;

        if (isArticleContextQuery) {
            const evidence = analyzeArticleEvidence(currentArticle);
            let reply = "";
            if (evidence) {
                if (isHinglish || isPureHindi) {
                    reply = `Is story ("${currentArticle.title.substring(0, 60)}...") ka source ${currentArticle.source} hai. Evidence status: ${evidence.statusLabel}. ${evidence.statusSummary}`;
                } else {
                    reply = `This article ("${currentArticle.title.substring(0, 60)}...") was published by ${currentArticle.source}. Evidence status: ${evidence.statusLabel}. ${evidence.statusSummary}`;
                }
            } else {
                reply = `This story was reported by ${currentArticle.source} on ${new Date(currentArticle.publishedAt).toLocaleDateString()}.`;
            }

            return {
                status: "success",
                reply,
                confidence: evidence?.evidenceStatus || "SUPPORTED",
                evidence: {
                    status: evidence?.evidenceStatus || "SUPPORTED",
                    label: evidence?.statusLabel || "REPORTED",
                    whatWeKnow: evidence?.whatWeKnow || [],
                    whatWeDontKnow: evidence?.whatWeDontKnow || []
                },
                uiAction: null,
                actions: [],
                referencedArticles: [currentArticle]
            };
        }

        // -------------------------------------------------------------
        // 5. CONVERSATION REFERENCE INTENT ("second wali explain karo", "isko save kar do")
        // -------------------------------------------------------------
        const isSecondRef = lowerPrompt.includes("second") || lowerPrompt.includes("doosri") || lowerPrompt.includes("dusri") || lowerPrompt.includes("2nd");
        const isFirstRef = lowerPrompt.includes("first") || lowerPrompt.includes("pehle") || lowerPrompt.includes("1st");
        const isThirdRef = lowerPrompt.includes("third") || lowerPrompt.includes("teesri") || lowerPrompt.includes("3rd");
        const isSaveActionRef = lowerPrompt.includes("save") || lowerPrompt.includes("save kar do") || lowerPrompt.includes("bookmark");

        if ((isSecondRef || isFirstRef || isThirdRef) && lastReferencedArticles.length > 0) {
            const targetIdx = isFirstRef ? 0 : isSecondRef ? 1 : 2;
            const targetArt = lastReferencedArticles[targetIdx] || lastReferencedArticles[0];

            if (isSaveActionRef) {
                return {
                    status: "success",
                    reply: isHinglish || isPureHindi
                        ? `Main "${targetArt.title.substring(0, 50)}..." ko aapki saved briefing mein save kar raha hoon.`
                        : `Saving "${targetArt.title.substring(0, 50)}..." to your saved briefing.`,
                    confidence: "CONFIRMED",
                    uiAction: { type: "SAVE_ARTICLE", payload: targetArt },
                    actions: [{ type: "SAVE_ARTICLE", payload: targetArt }],
                    referencedArticles: [targetArt]
                };
            }

            // Explanation intent
            const evidence = analyzeArticleEvidence(targetArt);
            const reply = isHinglish || isPureHindi
                ? `Story: "${targetArt.title}" (${targetArt.source}).\n\nVivaran: ${targetArt.description || 'Verified report'}\n\nEvidence: ${evidence?.statusLabel || 'Cross-referenced'}.`
                : `Story: "${targetArt.title}" (${targetArt.source}).\n\nOverview: ${targetArt.description || 'Verified report'}\n\nEvidence status: ${evidence?.statusLabel || 'Cross-referenced'}.`;

            return {
                status: "success",
                reply,
                confidence: targetArt.verifiedStatus || "SUPPORTED",
                evidence: {
                    status: targetArt.verifiedStatus || "SUPPORTED",
                    label: evidence?.statusLabel || "SUPPORTED"
                },
                uiAction: { type: "OPEN_ARTICLE", target: targetArt.title },
                actions: [],
                referencedArticles: [targetArt]
            };
        }

        // Direct Save of current active story
        if (isSaveActionRef && (lowerPrompt.includes("isko") || lowerPrompt.includes("this") || lowerPrompt.includes("ye") || lowerPrompt.includes("yeh"))) {
            const toSave = currentArticle || (lastReferencedArticles.length > 0 ? lastReferencedArticles[0] : null);
            if (toSave) {
                return {
                    status: "success",
                    reply: isHinglish || isPureHindi
                        ? `"${toSave.title.substring(0, 50)}..." ko aapki saved briefing mein save kiya gaya hai.`
                        : `Saved "${toSave.title.substring(0, 50)}..." to your saved briefing.`,
                    confidence: "CONFIRMED",
                    uiAction: { type: "SAVE_ARTICLE", payload: toSave },
                    actions: [{ type: "SAVE_ARTICLE", payload: toSave }],
                    referencedArticles: [toSave]
                };
            }
        }

        // -------------------------------------------------------------
        // 6. USER PROFILE INTENT (Name, Email)
        // -------------------------------------------------------------
        const isNameQuery = lowerPrompt.includes("what is my name") || lowerPrompt.includes("mera naam") || lowerPrompt.includes("my name") || lowerPrompt.includes("who am i");
        const isEmailQuery = lowerPrompt.includes("what email") || lowerPrompt.includes("mera email") || lowerPrompt.includes("which email");

        if (isNameQuery || isEmailQuery) {
            if (!isAuthenticated || !userProfile) {
                return {
                    status: "success",
                    reply: isHinglish || isPureHindi
                        ? "Kripya pehle Google se sign in karein, tabhi main aapka profile access kar sakta hoon."
                        : "Please sign in with Google first so I can access your SATYA account details.",
                    confidence: "INSUFFICIENT_EVIDENCE",
                    uiAction: { type: "PROMPT_SIGN_IN" },
                    actions: [],
                    referencedArticles: []
                };
            }

            if (isNameQuery) {
                const name = userProfile.displayName || "SATYA Reader";
                return {
                    status: "success",
                    reply: isHinglish || isPureHindi ? `Aap ${name} ke roop mein signed in hain.` : `You are signed in as ${name}.`,
                    confidence: "CONFIRMED",
                    uiAction: null,
                    actions: [],
                    referencedArticles: []
                };
            }

            if (isEmailQuery) {
                const email = userProfile.email || "No email on record";
                return {
                    status: "success",
                    reply: isHinglish || isPureHindi ? `Aap ${email} ke saath logged in hain.` : `You are logged in with ${email}.`,
                    confidence: "CONFIRMED",
                    uiAction: null,
                    actions: [],
                    referencedArticles: []
                };
            }
        }

        // -------------------------------------------------------------
        // 7. SAVED STORIES INTENT (Listing, Filter, Queries)
        // -------------------------------------------------------------
        const isSavedCountQuery = lowerPrompt.includes("kitni news save") || lowerPrompt.includes("how many stories") || lowerPrompt.includes("how many saved");
        const isSavedTimeQuery = lowerPrompt.includes("kab save ki") || lowerPrompt.includes("when did i save") || lowerPrompt.includes("last article i saved");
        const isSavedListQuery = lowerPrompt.includes("meri saved") || lowerPrompt.includes("maine kya save") || lowerPrompt.includes("show my saved") || lowerPrompt.includes("mere saved");
        const isOpenSavedQuery = lowerPrompt.includes("open my saved") || lowerPrompt.includes("saved stories kholo") || lowerPrompt === "open saved" || lowerPrompt === "saved kholo";

        if (isOpenSavedQuery) {
            return {
                status: "success",
                reply: isHinglish || isPureHindi ? "Aapki Saved stories open ki jaa rahi hain..." : "Opening your saved stories.",
                confidence: "CONFIRMED",
                uiAction: { type: "NAVIGATE_TAB", target: "saved" },
                actions: [{ type: "NAVIGATE_TAB", target: "saved" }],
                referencedArticles: []
            };
        }

        if (isSavedCountQuery || isSavedTimeQuery || isSavedListQuery) {
            if (!isAuthenticated) {
                return {
                    status: "success",
                    reply: isHinglish || isPureHindi
                        ? "Kripya pehle Google se sign in karein, tabhi main aapki SATYA saved stories access kar sakta hoon."
                        : "Please sign in with Google first so I can access your saved briefing.",
                    confidence: "INSUFFICIENT_EVIDENCE",
                    uiAction: { type: "PROMPT_SIGN_IN" },
                    actions: [],
                    referencedArticles: []
                };
            }

            const count = savedArticles.length;
            if (isSavedCountQuery) {
                return {
                    status: "success",
                    reply: isHinglish || isPureHindi 
                        ? `Aapne abhi tak ${count} ${count === 1 ? 'story' : 'stories'} save ki hain.` 
                        : `You have ${count} ${count === 1 ? 'story' : 'stories'} saved in your briefing.`,
                    confidence: "CONFIRMED",
                    uiAction: { type: "NAVIGATE_TAB", target: "saved" },
                    actions: [{ type: "NAVIGATE_TAB", target: "saved" }],
                    referencedArticles: []
                };
            }

            if (count === 0) {
                return {
                    status: "success",
                    reply: isHinglish || isPureHindi ? "Aapki saved stories list abhi empty hai." : "You have not saved any stories yet.",
                    confidence: "CONFIRMED",
                    uiAction: { type: "NAVIGATE_TAB", target: "saved" },
                    actions: [{ type: "NAVIGATE_TAB", target: "saved" }],
                    referencedArticles: []
                };
            }

            const sample = savedArticles.slice(0, 3);
            const titles = sample.map((s, i) => `${i + 1}. "${s.title}" (${s.source || 'SATYA'})`).join("\n");
            return {
                status: "success",
                reply: isHinglish || isPureHindi
                    ? `Aapki saved stories (${count} total):\n\n${titles}`
                    : `Here are your saved stories (${count} total):\n\n${titles}`,
                confidence: "CONFIRMED",
                uiAction: { type: "NAVIGATE_TAB", target: "saved" },
                actions: [{ type: "NAVIGATE_TAB", target: "saved" }],
                referencedArticles: sample
            };
        }

        // -------------------------------------------------------------
        // 8. LIVE NEWS RELEVANCE SEARCH VS GENERAL AI ROUTING
        // -------------------------------------------------------------
        // Check if query is explicitly asking for news / current events
        const isNewsQuery = lowerPrompt.includes("news") || 
                            lowerPrompt.includes("khabar") || 
                            lowerPrompt.includes("headline") ||
                            lowerPrompt.includes("latest") || 
                            lowerPrompt.includes("breaking") ||
                            lowerPrompt.includes("today") || 
                            lowerPrompt.includes("aaj") || 
                            lowerPrompt.includes("abhi") ||
                            lowerPrompt.includes("update") || 
                            lowerPrompt.includes("report") ||
                            lowerPrompt.includes("match") || 
                            lowerPrompt.includes("score") ||
                            lowerPrompt.includes("sensex") || 
                            lowerPrompt.includes("nifty") ||
                            lowerPrompt.includes("ipl") || 
                            lowerPrompt.includes("bcci") ||
                            lowerPrompt.includes("isro") || 
                            lowerPrompt.includes("rbi") ||
                            lowerPrompt.includes("election") || 
                            lowerPrompt.includes("market") ||
                            lowerPrompt.includes("it ki") || 
                            lowerPrompt.includes("ai ki") ||
                            lowerPrompt.includes("india mein kya");

        const matchedArticles = this.searchLiveNews(promptText, { limit: 5 }, globalNewsPool);

        // If it's a news query AND we found matching articles in our live feeds
        if (matchedArticles.length > 0) {
            const evidenceReports = matchedArticles.map(a => analyzeArticleEvidence(a));
            const ai = this.getAIClient();

            if (!ai) {
                const headlines = matchedArticles.slice(0, 3).map((a, i) => `${i + 1}. "${a.title}" (${a.source} • ${a.verifiedStatus || 'CONFIRMED'})`).join("\n");
                const reply = isHinglish || isPureHindi
                    ? `SATYA verified feeds mein ye latest updates hain:\n\n${headlines}`
                    : `Here are the top verified reports from SATYA live feeds:\n\n${headlines}`;
                return {
                    status: "success",
                    reply,
                    confidence: matchedArticles[0].verifiedStatus || "SUPPORTED",
                    evidence: {
                        status: matchedArticles[0].verifiedStatus || "SUPPORTED",
                        label: evidenceReports[0]?.statusLabel || "CROSS-REFERENCED"
                    },
                    uiAction: null,
                    actions: [],
                    referencedArticles: matchedArticles
                };
            }

            try {
                const contextText = matchedArticles.map((a, i) => {
                    const ev = evidenceReports[i];
                    return `[#${i + 1}] Title: ${a.title} | Source: ${a.source} | Published: ${a.publishedAt} | Evidence: ${ev?.statusLabel || 'Reported'} | Snippet: ${a.description || ''}`;
                }).join('\n');

                const systemPrompt = `You are SATYA AI, the news intelligence and evidence analysis assistant for the SATYA platform.
Core Principle: "News + Evidence + Verification + Context". Founder: ${SATYA_KNOWLEDGE.founder}.
Language Instruction:
${isHinglish ? "Respond in natural, conversational Hinglish (friendly, crisp, respectful, e.g. 'SATYA ke verified feeds ke mutabik...')." : isPureHindi ? "Respond in natural Hindi." : "Respond in clean, natural English."}

Strict Rules:
1. Ground your answer strictly in the provided Live Context articles.
2. DO NOT hallucinate, guess, or bring in unrelated stories.
3. Keep it brief (under 3 sentences or bullet points). Always name the news source(s).
4. If asked about certainty, explain the evidence status honestly.`;

                const response = await this.generateWithFallback(ai, {
                    contents: [
                        { role: 'user', parts: [{ text: `${systemPrompt}\n\nLive Context Articles:\n${contextText}\n\nUser Question: ${promptText}` }] }
                    ]
                });

                const replyText = response.text ? response.text.trim() : "Verified analysis complete.";
                return {
                    status: "success",
                    reply: replyText,
                    confidence: matchedArticles[0].verifiedStatus || "SUPPORTED",
                    evidence: {
                        status: matchedArticles[0].verifiedStatus || "SUPPORTED",
                        label: evidenceReports[0]?.statusLabel || "VERIFIED"
                    },
                    uiAction: null,
                    actions: [],
                    referencedArticles: matchedArticles
                };
            } catch (error) {
                console.warn("[SATYA AI GENERATION ERROR]:", error.message);
                const headlines = matchedArticles.slice(0, 3).map((a, i) => `${i + 1}. "${a.title}" (${a.source})`).join("\n");
                return {
                    status: "success",
                    reply: isHinglish || isPureHindi
                        ? `SATYA live feeds mein ye taza reports hain:\n\n${headlines}`
                        : `Here are the top reports from SATYA feeds:\n\n${headlines}`,
                    confidence: matchedArticles[0].verifiedStatus || "SUPPORTED",
                    evidence: {
                        status: matchedArticles[0].verifiedStatus || "SUPPORTED",
                        label: evidenceReports[0]?.statusLabel || "REPORTED"
                    },
                    uiAction: null,
                    actions: [],
                    referencedArticles: matchedArticles
                };
            }
        }

        // If the query was specifically asking for live news of a specific topic, but none exists in the index
        if (isNewsQuery) {
            const rawTokens = lowerPrompt.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
            if (rawTokens.includes("it") && rawTokens.length <= 4) {
                return {
                    status: "success",
                    reply: isHinglish || isPureHindi
                        ? "Kya aap Information Technology (IT sector/tech) ki taza khabrein pooch rahe hain? Abhi SATYA feeds mein IT se judi koi nayi breaking update nahi aayi hai."
                        : "Are you inquiring about Information Technology (IT) news? SATYA's current live feeds do not have an active IT headline right now.",
                    confidence: "INSUFFICIENT_EVIDENCE",
                    uiAction: null,
                    actions: [],
                    referencedArticles: []
                };
            }

            // Optional live web news search fallback before declaring missing
            try {
                const webNews = await searchLiveWebNews(promptText);
                if (Array.isArray(webNews) && webNews.length > 0) {
                    const headlines = webNews.slice(0, 3).map((a, i) => `${i + 1}. "${a.title}" (${a.source})`).join("\n");
                    return {
                        status: "success",
                        reply: isHinglish || isPureHindi
                            ? `Live web search mein ye taza khabrein mili hain:\n\n${headlines}`
                            : `Here are recent web reports found for your query:\n\n${headlines}`,
                        confidence: "SUPPORTED",
                        uiAction: null,
                        actions: [],
                        referencedArticles: webNews.slice(0, 3)
                    };
                }
            } catch (e) {
                // Ignore web search error and proceed
            }

            return {
                status: "success",
                reply: isHinglish || isPureHindi
                    ? "Mujhe SATYA ke available live verified feeds mein isse related koi taza breaking khabar nahi mili."
                    : "I couldn't find a relevant current story matching that query in SATYA's available verified feeds.",
                confidence: "INSUFFICIENT_EVIDENCE",
                uiAction: null,
                actions: [],
                referencedArticles: []
            };
        }

        // -------------------------------------------------------------
        // 9. MODE 1 — GENERAL PURPOSE AI (Quantum computing, AWS, Science, Coding, Math, Writing)
        // -------------------------------------------------------------
        const ai = this.getAIClient();
        if (ai) {
            try {
                const generalPrompt = `You are SATYA AI, an intelligent, helpful, articulate AI assistant.
When the user asks general questions (science, technology, programming, mathematics, history, general knowledge, writing, explanations), answer naturally, clearly, and conversationally.
Language Instruction:
${isHinglish ? "Respond in natural, friendly Hinglish." : isPureHindi ? "Respond in natural Hindi." : "Respond in clean, natural English."}
Do NOT force SATYA news verification labels or evidence jargon onto general knowledge questions. Be direct, accurate, and insightful.`;

                const res = await this.generateWithFallback(ai, {
                    contents: [
                        { role: 'user', parts: [{ text: `${generalPrompt}\n\nUser Question: ${promptText}` }] }
                    ]
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
                console.warn("[GENERAL AI GENERATION ERROR]:", err.message);
            }
        }

        // Fallback for general questions if Gemini is temporarily unreachable
        return {
            status: "success",
            reply: isHinglish || isPureHindi
                ? "Main SATYA AI hoon. Main general questions ke saath-saath live verified news, evidence analysis aur fact-checking mein madad kar sakta hoon. Kripya apna prashna thoda aur vistar se poochein."
                : "I am SATYA AI. I can assist with general knowledge inquiries, live multi-source news verification, timeline tracking, and fact checks. Could you provide a bit more detail on what you'd like to explore?",
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

        // 1. Founder verification
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

        // 2. Search relevant articles using the intelligent search tool
        const matchedArticles = this.searchLiveNews(sanitizedClaim, { limit: 8 }, globalNewsPool);

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
                    `[#${i + 1}] Title: ${a.title} | Source: ${a.source} | Category: ${a.category} | Snippet: ${a.description || ''}`
                ).join('\n');

                const prompt = `You are SATYA AI Fact Checker.
Task: Cross-reference this claim strictly against the provided news context.
Claim: "${sanitizedClaim}"

Context:
${contextText}

Instructions:
Evaluate evidence strictly. Use one of these statuses:
- CONFIRMED (supported by 2+ independent reliable sources or official documents)
- SUPPORTED (supported by 1 reputable source)
- CONFLICTING (contradictory reports present)
- UNVERIFIED (rumor/unsubstantiated)
- INSUFFICIENT_EVIDENCE (not enough info)

Write a 2-sentence explanation of what is confirmed, what is uncertain, and cite the sources.`;

                const res = await this.generateWithFallback(ai, {
                    contents: [{ role: 'user', parts: [{ text: prompt }] }]
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
                console.warn("[FACT CHECK GENERATE WARN]:", err.message);
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
