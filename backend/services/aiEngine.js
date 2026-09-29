const { GoogleGenAI } = require('@google/genai');
const { SATYA_KNOWLEDGE } = require('../config/aiKnowledge');
const { CATEGORY_MAP, matchKeyword } = require('./categoryEngine');

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
    "SHOW_TRENDING",
    "SHOW_LATEST",
    "SCROLL_TO_SECTION",
    "SEARCH_NEWS",
    "OPEN_ARTICLE",
    "SAVE_ARTICLE",
    "DELETE_SAVED_ARTICLE",
    "PROMPT_SIGN_IN"
]);

// Multilingual stopwords (English, Hindi, Hinglish, casual speech)
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
    // Hindi & Hinglish conversational words
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

// Domain-specific keyword expansions
const TOPIC_SYNONYMS = {
    "it": ["technology", "it sector", "tech", "software", "information technology", "ai", "semiconductor", "cyber"],
    "ai": ["ai", "artificial intelligence", "genai", "deepfake", "machine learning", "chatgpt", "openai", "gemini", "nvidia"],
    "tech": ["technology", "tech", "software", "hardware", "gadget", "cyber", "digital"],
    "technology": ["technology", "tech", "software", "hardware", "digital", "ai"],
    "sports": ["sports", "cricket", "ipl", "bcci", "football", "tennis", "hockey", "badminton", "tournament", "score", "match"],
    "cricket": ["cricket", "ipl", "bcci", "test", "odi", "t20", "rohit", "kohli", "dhoni"],
    "business": ["business", "market", "economy", "sensex", "nifty", "share", "stock", "rupee", "inflation", "rbi", "sebi", "gdp"],
    "market": ["market", "sensex", "nifty", "stock", "shares", "trading", "investor"],
    "world": ["world", "global", "international", "foreign", "us", "usa", "china", "russia", "israel", "iran", "ukraine"],
    "india": ["india", "national", "bharat", "delhi", "centre", "government", "parliament", "supreme court", "election"]
};

function formatReadableDate(dateString) {
    if (!dateString) return "unknown time";
    try {
        const d = new Date(dateString);
        if (isNaN(d.getTime())) return String(dateString);
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
        return String(dateString);
    }
}

class SatyaAIEngine {
    constructor() {
        this.primaryModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
        this.fallbackModels = ['gemini-3.5-flash-lite', 'gemini-3.8-flash'];
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
     * Tool: searchLiveNews(query, filters, newsPool)
     * Performs intelligent relevance ranking across the current in-memory SATYA news pool.
     */
    searchLiveNews(query = "", filters = {}, newsPool = []) {
        if (!Array.isArray(newsPool) || newsPool.length === 0) return [];

        const cleanQuery = (query || "").toLowerCase().trim();
        const rawTokens = cleanQuery.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
        const meaningfulTokens = rawTokens.filter(t => !STOP_WORDS.has(t));

        // Detect if query is requesting specific category
        let targetCategory = filters.category ? filters.category.toUpperCase() : null;
        let isITQuery = false;
        let isAIQuery = false;

        for (const token of rawTokens) {
            if (token === "it" && (cleanQuery.includes("it ki") || cleanQuery.includes("it news") || cleanQuery.includes("it me") || cleanQuery === "it")) {
                isITQuery = true;
                targetCategory = "TECHNOLOGY";
            }
            if (token === "ai") {
                isAIQuery = true;
                targetCategory = "TECHNOLOGY";
            }
            if (token === "sports" || token === "cricket") targetCategory = "SPORTS";
            if (token === "business" || token === "market" || token === "sensex") targetCategory = "BUSINESS";
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

        // Check if user specifically requested latest/recent
        const wantsLatest = filters.isLatest || 
            rawTokens.some(t => ["latest", "recent", "today", "now", "abhi", "aaj", "breaking", "taza"].includes(t));

        // Score each article in pool
        const scored = [];
        const now = Date.now();

        for (const article of newsPool) {
            const title = (article.title || "").toLowerCase();
            const desc = (article.description || "").toLowerCase();
            const cat = (article.category || "").toUpperCase();

            let score = 0;

            // Category match bonus
            if (targetCategory && cat === targetCategory) {
                score += 15;
            }

            // Keyword match scoring
            for (const token of expandedTokens) {
                if (matchKeyword(title, token)) {
                    score += 12;
                } else if (matchKeyword(desc, token)) {
                    score += 4;
                }
            }

            // For IT query, give extra points to tech titles
            if (isITQuery) {
                if (cat === "TECHNOLOGY") score += 10;
                if (title.includes("tech") || title.includes("software") || title.includes("ai ") || title.includes("digital") || title.includes("semiconductor")) {
                    score += 8;
                }
            }

            // Recency boost (up to 5 points for articles within last 24h)
            if (article.publishedAt) {
                const pubTime = new Date(article.publishedAt).getTime();
                if (!isNaN(pubTime)) {
                    const hoursAgo = (now - pubTime) / (1000 * 60 * 60);
                    if (hoursAgo < 12) score += 5;
                    else if (hoursAgo < 24) score += 3;
                    else if (hoursAgo < 48) score += 1;
                }
            }

            // Threshold: require at least meaningful score
            const minThreshold = (meaningfulTokens.length > 0 || targetCategory) ? 12 : 5;
            if (score >= minThreshold) {
                scored.push({ article, score, publishedAt: article.publishedAt });
            }
        }

        // If user wants latest, sort primarily by publication time among high-relevance matches
        if (wantsLatest) {
            scored.sort((a, b) => {
                const timeDiff = new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
                if (Math.abs(timeDiff) > 1000 * 60 * 60 * 12) {
                    return timeDiff;
                }
                return b.score - a.score;
            });
        } else {
            scored.sort((a, b) => b.score - a.score);
        }

        const limit = filters.limit || 5;
        return scored.slice(0, limit).map(item => item.article);
    }

    /**
     * Main SATYA AI Assistant entry point
     */
    async askSATYA(promptText, globalNewsPool = [], clientContext = {}, conversationHistory = []) {
        const lowerPrompt = promptText.toLowerCase().trim();

        // Detect user language style
        const isHinglish = /bhai|kya|hai|hain|bata|batao|dikha|dikhao|chal|raha|rahi|meri|mera|mere|maine|aaj|abhi|vo|voh|isko|sach|kitni|kab|karo|kholo/.test(lowerPrompt);
        const isPureHindi = /[\u0900-\u097F]/.test(promptText);

        // Extract client session state
        const isAuthenticated = Boolean(clientContext.authenticated);
        const userProfile = clientContext.userProfile || null;
        const savedArticles = Array.isArray(clientContext.savedArticles) ? clientContext.savedArticles : [];
        const currentArticle = clientContext.currentArticle || null;
        const lastReferencedArticles = Array.isArray(clientContext.lastReferencedArticles) ? clientContext.lastReferencedArticles : [];

        // -------------------------------------------------------------
        // 1. FOUNDER INTENT
        // -------------------------------------------------------------
        if (lowerPrompt.includes("founder") || lowerPrompt.includes("owner") || lowerPrompt.includes("banaya") || lowerPrompt.includes("who made satya")) {
            const reply = isHinglish || isPureHindi
                ? `SATYA ko ${SATYA_KNOWLEDGE.founder} ne banaya hai. SATYA ek independent, multi-source news verification aur truth intelligence platform hai.`
                : `SATYA was founded by ${SATYA_KNOWLEDGE.founder}. SATYA is an independent multi-source news intelligence and truth analysis platform.`;
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
        // 2. USER PROFILE INTENT (Name, Email) - STRICT AUTH VERIFICATION
        // -------------------------------------------------------------
        const isNameQuery = lowerPrompt.includes("what is my name") || lowerPrompt.includes("mera naam") || lowerPrompt.includes("my name") || lowerPrompt.includes("who am i");
        const isEmailQuery = lowerPrompt.includes("what email") || lowerPrompt.includes("mera email") || lowerPrompt.includes("which email");

        if (isNameQuery || isEmailQuery) {
            if (!isAuthenticated || !userProfile) {
                const reply = isHinglish || isPureHindi
                    ? "Kripya pehle Google se sign in karein, tabhi main aapka profile access kar sakta hoon."
                    : "Please sign in with Google first, then I can access your SATYA account details.";
                return {
                    status: "success",
                    reply,
                    confidence: "AUTH_REQUIRED",
                    uiAction: { type: "PROMPT_SIGN_IN" },
                    actions: [],
                    referencedArticles: []
                };
            }

            if (isNameQuery) {
                const name = userProfile.displayName || "SATYA Reader";
                const reply = isHinglish || isPureHindi
                    ? `Aap ${name} ke roop mein signed in hain.`
                    : `You are signed in as ${name}.`;
                return {
                    status: "success",
                    reply,
                    confidence: "CONFIRMED",
                    uiAction: null,
                    actions: [],
                    referencedArticles: []
                };
            }

            if (isEmailQuery) {
                const email = userProfile.email || "No email on record";
                const reply = isHinglish || isPureHindi
                    ? `Aap ${email} ke saath logged in hain.`
                    : `You are logged in with ${email}.`;
                return {
                    status: "success",
                    reply,
                    confidence: "CONFIRMED",
                    uiAction: null,
                    actions: [],
                    referencedArticles: []
                };
            }
        }

        // -------------------------------------------------------------
        // 3. SAVED STORIES INTENT (Count, History, Listing, Category-Filter)
        // -------------------------------------------------------------
        const isSavedCountQuery = lowerPrompt.includes("kitni news save") || lowerPrompt.includes("how many stories") || lowerPrompt.includes("how many saved");
        const isSavedTimeQuery = lowerPrompt.includes("kab save ki") || lowerPrompt.includes("when did i save") || lowerPrompt.includes("last article i saved");
        const isSavedBusinessQuery = lowerPrompt.includes("saved business") || (lowerPrompt.includes("saved") && lowerPrompt.includes("business"));
        const isSavedListQuery = lowerPrompt.includes("meri saved") || lowerPrompt.includes("maine kya save") || lowerPrompt.includes("what have i saved") || lowerPrompt.includes("show my saved");
        const isOpenSavedQuery = lowerPrompt.includes("open my saved") || lowerPrompt.includes("saved stories kholo") || lowerPrompt === "open saved";

        if (isOpenSavedQuery) {
            return {
                status: "success",
                reply: isHinglish || isPureHindi ? "Aapki Saved stories open ki jaa rahi hain..." : "Sure — opening your saved stories.",
                confidence: "CONFIRMED",
                uiAction: { type: "NAVIGATE_TAB", target: "saved" },
                actions: [],
                referencedArticles: []
            };
        }

        if (isSavedCountQuery || isSavedTimeQuery || isSavedBusinessQuery || isSavedListQuery) {
            if (!isAuthenticated) {
                const reply = isHinglish || isPureHindi
                    ? "Kripya pehle Google se sign in karein, tabhi main aapki SATYA saved stories access kar sakta hoon."
                    : "Please sign in with Google first, then I can access your SATYA saved stories.";
                return {
                    status: "success",
                    reply,
                    confidence: "AUTH_REQUIRED",
                    uiAction: { type: "PROMPT_SIGN_IN" },
                    actions: [],
                    referencedArticles: []
                };
            }

            // A. Saved Count
            if (isSavedCountQuery) {
                const count = savedArticles.length;
                const reply = isHinglish || isPureHindi
                    ? `Aapne SATYA par abhi tak ${count} news ${count === 1 ? 'story' : 'stories'} save ki hain.`
                    : `You have ${count} saved ${count === 1 ? 'story' : 'stories'} in your SATYA reading list.`;
                return {
                    status: "success",
                    reply,
                    confidence: "CONFIRMED",
                    uiAction: null,
                    actions: [],
                    referencedArticles: []
                };
            }

            // B. Latest Saved Timestamp
            if (isSavedTimeQuery) {
                if (savedArticles.length === 0) {
                    const reply = isHinglish || isPureHindi
                        ? "Aapne abhi tak koi story save nahi ki hai."
                        : "You haven't saved any stories yet.";
                    return { status: "success", reply, confidence: "CONFIRMED", uiAction: null, actions: [], referencedArticles: [] };
                }
                const latest = savedArticles[0];
                const saveTime = formatReadableDate(latest.savedAt);
                const reply = isHinglish || isPureHindi
                    ? `Aapne apni aakhri story "${latest.title}" ko ${saveTime} par save kiya tha.`
                    : `You saved your latest story "${latest.title}" on ${saveTime}.`;
                return {
                    status: "success",
                    reply,
                    confidence: "CONFIRMED",
                    uiAction: null,
                    actions: [],
                    referencedArticles: [latest]
                };
            }

            // C. Saved Business stories
            if (isSavedBusinessQuery) {
                const biz = savedArticles.filter(a => (a.category || "").toUpperCase() === "BUSINESS");
                if (biz.length === 0) {
                    const reply = isHinglish || isPureHindi
                        ? "Aapki saved stories mein abhi koi Business category ki khabar nahi hai."
                        : "You don't have any saved stories under the Business category.";
                    return { status: "success", reply, confidence: "CONFIRMED", uiAction: null, actions: [], referencedArticles: [] };
                }
                const titles = biz.slice(0, 3).map((a, i) => `${i + 1}. "${a.title}" (${a.source})`).join("\n");
                const reply = isHinglish || isPureHindi
                    ? `Aapki saved Business stories ye hain:\n${titles}`
                    : `Here are your saved Business stories:\n${titles}`;
                return {
                    status: "success",
                    reply,
                    confidence: "CONFIRMED",
                    uiAction: null,
                    actions: [],
                    referencedArticles: biz
                };
            }

            // D. General Saved List
            if (isSavedListQuery) {
                if (savedArticles.length === 0) {
                    const reply = isHinglish || isPureHindi
                        ? "Aapke paas abhi koi saved stories nahi hain. Kisi bhi card par bookmark icon click karke save kar sakte hain."
                        : "You have no saved stories yet. Click the bookmark icon on any headline to save it for later.";
                    return { status: "success", reply, confidence: "CONFIRMED", uiAction: null, actions: [], referencedArticles: [] };
                }
                const count = savedArticles.length;
                const titles = savedArticles.slice(0, 4).map((a, i) => `${i + 1}. "${a.title}" (${a.source})`).join("\n");
                const reply = isHinglish || isPureHindi
                    ? `Aapke paas kul ${count} saved ${count === 1 ? 'story' : 'stories'} hain:\n${titles}`
                    : `You have ${count} saved ${count === 1 ? 'story' : 'stories'}:\n${titles}`;
                return {
                    status: "success",
                    reply,
                    confidence: "CONFIRMED",
                    uiAction: null,
                    actions: [],
                    referencedArticles: savedArticles.slice(0, 4)
                };
            }
        }

        // -------------------------------------------------------------
        // 4. SAVE / UNSAVE THROUGH AI ("isko save karo", "bookmark this")
        // -------------------------------------------------------------
        if (lowerPrompt.includes("isko save") || lowerPrompt.includes("save karo") || lowerPrompt.includes("save this") || lowerPrompt.includes("bookmark this")) {
            const targetArticle = currentArticle || (lastReferencedArticles.length > 0 ? lastReferencedArticles[0] : null);
            if (!targetArticle) {
                const reply = isHinglish || isPureHindi
                    ? "Aap kaun si story save karna chahte hain? Pehle koi news kholiye ya topic batayein."
                    : "Which story would you like to save? Please open an article or specify the headline.";
                return { status: "success", reply, confidence: "CONFIRMED", uiAction: null, actions: [], referencedArticles: [] };
            }

            if (!isAuthenticated) {
                const reply = isHinglish || isPureHindi
                    ? "Story save karne ke liye kripya pehle Google se sign in karein."
                    : "Please sign in with Google first to save this story.";
                return {
                    status: "success",
                    reply,
                    confidence: "AUTH_REQUIRED",
                    uiAction: { type: "PROMPT_SIGN_IN" },
                    actions: [],
                    referencedArticles: []
                };
            }

            const reply = isHinglish || isPureHindi
                ? `"${targetArticle.title}" ko aapki Saved stories mein jod diya gaya hai.`
                : `Saved "${targetArticle.title}" to your reading list.`;
            return {
                status: "success",
                reply,
                confidence: "CONFIRMED",
                uiAction: { type: "SAVE_ARTICLE", payload: targetArticle },
                actions: [{ type: "SAVE_ARTICLE", payload: targetArticle }],
                referencedArticles: [targetArticle]
            };
        }

        // -------------------------------------------------------------
        // 5. CURRENT ARTICLE / PREVIOUS REFERENCE INQUIRY
        // ("ye news sach hai?", "isko fact check karo", "first wali news ka summary bata")
        // -------------------------------------------------------------
        const isFactCheckThis = lowerPrompt.includes("ye news sach") || lowerPrompt.includes("kya ye sach") || lowerPrompt.includes("is this true") || lowerPrompt.includes("fact check karo") || lowerPrompt.includes("fact check this");
        const isFirstOneSummary = lowerPrompt.includes("first one") || lowerPrompt.includes("first wali") || lowerPrompt.includes("pehle wali");

        if (isFirstOneSummary) {
            if (lastReferencedArticles.length > 0) {
                const art = lastReferencedArticles[0];
                const reply = isHinglish || isPureHindi
                    ? `Pehli story "${art.title}" hai:\n\n${art.description || 'Is report ke baare mein vishesh vivaran jald uplabdh hoga.'}\n\nSource: ${art.source}`
                    : `The first story is "${art.title}":\n\n${art.description || 'Further details are developing.'}\n\nReported by: ${art.source}`;
                return {
                    status: "success",
                    reply,
                    confidence: art.verifiedStatus || "SUPPORTED",
                    uiAction: { type: "OPEN_ARTICLE", target: art.title },
                    actions: [],
                    referencedArticles: [art]
                };
            } else {
                const reply = isHinglish || isPureHindi
                    ? "Aap pichhli kis news ki baat kar rahe hain? Kripya headline ya topic batayein."
                    : "Which previous story do you mean? Please mention the topic or headline.";
                return { status: "success", reply, confidence: "CONFIRMED", uiAction: null, actions: [], referencedArticles: [] };
            }
        }

        if (isFactCheckThis) {
            const targetArticle = currentArticle || (lastReferencedArticles.length > 0 ? lastReferencedArticles[0] : null);
            if (targetArticle) {
                const checkRes = await this.factCheck(targetArticle.title, globalNewsPool);
                const reply = isHinglish || isPureHindi
                    ? `"${targetArticle.title}" ka verification status: ${checkRes.verificationStatus}.\n\n${checkRes.explanation}\nVerified Outlets: ${(checkRes.verifiedSources || []).join(', ') || targetArticle.source}`
                    : `Verification status for "${targetArticle.title}": ${checkRes.verificationStatus}.\n\n${checkRes.explanation}\nSources: ${(checkRes.verifiedSources || []).join(', ') || targetArticle.source}`;
                return {
                    status: "success",
                    reply,
                    confidence: checkRes.confidence || "HIGH",
                    uiAction: { type: "OPEN_FACT_CHECK", query: targetArticle.title },
                    actions: [],
                    referencedArticles: [targetArticle]
                };
            }
        }

        // -------------------------------------------------------------
        // 6. SIRI-STYLE DASHBOARD CONTROL (Natural conversational tone)
        // -------------------------------------------------------------
        if (lowerPrompt === "show sports news" || lowerPrompt === "sports news dikha" || lowerPrompt === "open sports") {
            return {
                status: "success",
                reply: isHinglish || isPureHindi ? "Sports section khola jaa raha hai..." : "Sure — opening the Sports section.",
                confidence: "CONFIRMED",
                uiAction: { type: "NAVIGATE_TAB", target: "sports" },
                actions: [],
                referencedArticles: []
            };
        }
        if (lowerPrompt === "show business news" || lowerPrompt === "business news dikha" || lowerPrompt === "open business") {
            return {
                status: "success",
                reply: isHinglish || isPureHindi ? "Business aur Market section khola jaa raha hai..." : "Sure — opening Business & Economy.",
                confidence: "CONFIRMED",
                uiAction: { type: "NAVIGATE_TAB", target: "business" },
                actions: [],
                referencedArticles: []
            };
        }
        if (lowerPrompt === "open fact check" || lowerPrompt === "show fact check" || lowerPrompt === "fact check panel kholo") {
            return {
                status: "success",
                reply: isHinglish || isPureHindi ? "SATYA Fact Check panel open kiya jaa raha hai..." : "Sure — opening the Fact Check panel.",
                confidence: "CONFIRMED",
                uiAction: { type: "NAVIGATE_TAB", target: "factcheck" },
                actions: [],
                referencedArticles: []
            };
        }
        if (lowerPrompt === "show world news" || lowerPrompt === "world news dikha") {
            return {
                status: "success",
                reply: isHinglish || isPureHindi ? "World News section khola jaa raha hai..." : "Sure — opening World News.",
                confidence: "CONFIRMED",
                uiAction: { type: "NAVIGATE_TAB", target: "world" },
                actions: [],
                referencedArticles: []
            };
        }
        if (lowerPrompt === "show today briefing" || lowerPrompt === "aaj ki briefing dikha") {
            return {
                status: "success",
                reply: isHinglish || isPureHindi ? "Today's Briefing kholi jaa rahi hai..." : "Sure — opening Today's Briefing.",
                confidence: "CONFIRMED",
                uiAction: { type: "NAVIGATE_TAB", target: "today" },
                actions: [],
                referencedArticles: []
            };
        }

        // -------------------------------------------------------------
        // 7. SPECIFIC TEST: "it ki jo news chal rahi hai vo batao bhai mujhe"
        // Disambiguate "IT" cleanly and fetch ONLY genuine tech/IT articles!
        // -------------------------------------------------------------
        const isITQuery = (lowerPrompt.includes("it ki") || lowerPrompt.includes("it news") || lowerPrompt.includes("it me") || lowerPrompt.includes("it sector")) && !lowerPrompt.includes("income tax");

        if (isITQuery) {
            const itMatches = this.searchLiveNews("technology software tech it ai", { category: "TECHNOLOGY", isLatest: true, limit: 3 }, globalNewsPool);
            if (itMatches.length > 0) {
                const headlines = itMatches.map((a, i) => `${i + 1}. "${a.title}" — reported by ${a.source}`).join("\n");
                const reply = isHinglish || isPureHindi
                    ? `Agar aap IT (Information Technology / Tech Sector) ki news pooch rahe hain, toh ye live updates hain:\n\n${headlines}\n\n(Agar aap Income Tax ya kisi specific topic ki baat kar rahe hain, toh batayein.)`
                    : `Here are the latest updates from the Information Technology (IT) and Tech sector:\n\n${headlines}\n\n(If you meant Income Tax or another specific topic, please clarify.)`;
                return {
                    status: "success",
                    reply,
                    confidence: "SUPPORTED",
                    uiAction: null,
                    actions: [],
                    referencedArticles: itMatches
                };
            }
        }

        // -------------------------------------------------------------
        // 8. LIVE NEWS RELEVANCE SEARCH & GEMINI SYNTHESIS
        // -------------------------------------------------------------
        const matchedArticles = this.searchLiveNews(promptText, { isLatest: true, limit: 5 }, globalNewsPool);

        // If no relevant articles exist in SATYA live feeds, NEVER hallucinate or return random articles!
        if (matchedArticles.length === 0) {
            const reply = isHinglish || isPureHindi
                ? "Mujhe SATYA ke available live feeds mein isse related koi taza khabar nahi mili."
                : "I couldn't find a relevant current story in SATYA's available feeds.";
            return {
                status: "success",
                reply,
                confidence: "INSUFFICIENT_EVIDENCE",
                uiAction: null,
                actions: [],
                referencedArticles: []
            };
        }

        const ai = this.getAIClient();
        if (!ai) {
            // High quality local deterministic formatting when Gemini is not configured
            const headlines = matchedArticles.slice(0, 3).map((a, i) => `${i + 1}. "${a.title}" (${a.source})`).join("\n");
            const reply = isHinglish || isPureHindi
                ? `SATYA verified feeds mein ye latest updates mil rahe hain:\n\n${headlines}`
                : `Here are the top verified reports from SATYA live feeds:\n\n${headlines}`;
            return {
                status: "success",
                reply,
                confidence: matchedArticles[0].verifiedStatus || "SUPPORTED",
                uiAction: null,
                actions: [],
                referencedArticles: matchedArticles
            };
        }

        try {
            const contextText = matchedArticles.map((a, i) => 
                `[#${i + 1}] Title: ${a.title} | Source: ${a.source} | Category: ${a.category} | Published: ${a.publishedAt} | Snippet: ${a.description || ''}`
            ).join('\n');

            const systemPrompt = `You are SATYA AI, the conversational news intelligence assistant for SATYA platform.
Founder: ${SATYA_KNOWLEDGE.founder}.
Language Instruction:
${isHinglish ? "Respond in natural, conversational Hinglish (friendly, crisp, respectful, e.g. 'Abhi SATYA ke live feeds mein ye updates mil rahe hain...')." : isPureHindi ? "Respond in natural Hindi." : "Respond in clean, natural English."}

Strict Rules:
1. Ground your answer strictly in the provided Live Context articles.
2. DO NOT use technical robotic labels like "SYSTEM_CONTROL", "SUPPORTED:", "UNAVAILABLE" in your response text.
3. Keep it brief (under 3 sentences or bullet points). Mention the news source(s).
4. If the context does not contain enough info, clearly state it without guessing.`;

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
                uiAction: null,
                actions: [],
                referencedArticles: matchedArticles
            };
        } catch (error) {
            console.warn("[SATYA AI GENERATION ERROR]:", error.message);
            // Graceful fallback using matched articles
            const headlines = matchedArticles.slice(0, 3).map((a, i) => `${i + 1}. "${a.title}" (${a.source})`).join("\n");
            const reply = isHinglish || isPureHindi
                ? `SATYA live feeds mein ye taza reports hain:\n\n${headlines}`
                : `Here are the top reports from SATYA feeds:\n\n${headlines}`;
            return {
                status: "success",
                reply,
                confidence: matchedArticles[0].verifiedStatus || "SUPPORTED",
                uiAction: null,
                actions: [],
                referencedArticles: matchedArticles
            };
        }
    }

    /**
     * Fact-check claim against live news pool
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
        if (lowerClaim.includes("founder") || lowerClaim.includes("owner") || lowerClaim.includes("banaya")) {
            return {
                status: "success",
                claim: sanitizedClaim,
                verificationStatus: "CONFIRMED",
                confidence: "HIGH",
                explanation: `Verified: SATYA was founded by ${SATYA_KNOWLEDGE.founder}. SATYA is an independent news intelligence platform.`,
                verifiedSources: ["SATYA Knowledge Base"]
            };
        }

        // 2. Search relevant articles using the intelligent search tool
        const matchedArticles = this.searchLiveNews(sanitizedClaim, { limit: 10 }, globalNewsPool);

        if (matchedArticles.length === 0) {
            return {
                status: "success",
                claim: sanitizedClaim,
                verificationStatus: "INSUFFICIENT_EVIDENCE",
                confidence: "LOW",
                explanation: "No corroborating or debunking reports found in active verified news streams.",
                verifiedSources: []
            };
        }

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
- CONFIRMED (supported by 2+ independent reliable sources)
- SUPPORTED (supported by 1 reputable source)
- CONFLICTING (contradictory reports present)
- UNVERIFIED (unconfirmed report or rumors)
- INSUFFICIENT_EVIDENCE (not enough evidence in context)

Return a single JSON object strictly matching:
{
  "status": "CONFIRMED" | "SUPPORTED" | "CONFLICTING" | "UNVERIFIED" | "INSUFFICIENT_EVIDENCE",
  "explanation": "Concise 1-2 sentence reason.",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "verifiedSources": ["Source 1", "Source 2"]
}`;

                const response = await this.generateWithFallback(ai, {
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    config: { responseMimeType: "application/json" }
                });

                if (response.text) {
                    try {
                        const parsed = JSON.parse(response.text);
                        return {
                            status: "success",
                            claim: sanitizedClaim,
                            verificationStatus: parsed.status || "SUPPORTED",
                            confidence: parsed.confidence || "MEDIUM",
                            explanation: parsed.explanation || "Analysis completed against live feeds.",
                            verifiedSources: Array.isArray(parsed.verifiedSources) ? parsed.verifiedSources : []
                        };
                    } catch (e) {
                        // ignore JSON parse fallback
                    }
                }
            } catch (err) {
                console.warn("[SATYA FACT CHECK AI ERROR]:", err.message);
            }
        }

        // Heuristic fallback
        const sources = [...new Set(matchedArticles.map(a => a.source))];
        const status = sources.length >= 2 ? "CONFIRMED" : "SUPPORTED";
        return {
            status: "success",
            claim: sanitizedClaim,
            verificationStatus: status,
            confidence: sources.length >= 2 ? "HIGH" : "MEDIUM",
            explanation: `Found ${matchedArticles.length} relevant report(s) across ${sources.join(', ')}.`,
            verifiedSources: sources
        };
    }
}

module.exports = new SatyaAIEngine();
