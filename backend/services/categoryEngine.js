// Robust News Categorization Engine with Word-Boundary Match & Scoring

const CATEGORY_MAP = {
    "FACT CHECK": [
        "fact check", "factcheck", "fake news", "fake claim", "busted", 
        "false report", "debunked", "boom live", "factly", "alt news", "misleading claim", "hoax"
    ],
    "TECHNOLOGY": [
        "artificial intelligence", "technology", "tech", "smartphone", "computer", 
        "software", "hardware", "semiconductor", "cybersecurity", "deepfake",
        "chatgpt", "openai", "gemini", "google cloud", "microsoft", "apple",
        "nvidia", "isro", "nasa", "satellite", "it industry", "it sector", 
        "information technology", "tech startup", "gadget", "android", "ios",
        "cyber crime", "microchip", "quantum computing", "telecom", "5g", "ai", "chip"
    ],
    "BUSINESS": [
        "stock", "market", "sensex", "nifty", "rbi", "economy", "finance", 
        "banking", "rupee", "inflation", "gdp", "earnings", "quarterly profit",
        "fiscal", "bse", "nse", "ipo", "sebi", "investor", "mutual fund", 
        "commerce", "shares", "export", "import", "trade", "tax"
    ],
    "SPORTS": [
        "cricket", "football", "olympics", "athletics", "tournament", "ipl", 
        "bcci", "trophy", "medal", "stadium", "score", "wicket", "batsman", 
        "bowler", "fifa", "premier league", "tennis", "wimbledon", "hockey", 
        "badminton", "kohli", "rohit sharma", "dhoni"
    ],
    "WORLD": [
        "international", "global", "united nations", "white house", "pentagon",
        "middle east", "russia", "ukraine", "israel", "gaza", "china", "beijing",
        "washington", "london", "europe", "iran", "taiwan", "diplomacy", "nato",
        "us", "usa", "uk"
    ],
    "INDIA": [
        "parliament", "lok sabha", "rajya sabha", "supreme court", "high court",
        "delhi", "mumbai", "modi", "bjp", "congress", "election", "cabinet", 
        "prime minister", "chief minister", "constitution", "central government",
        "monsoon", "isro", "state government"
    ],
    "ENTERTAINMENT": [
        "bollywood", "hollywood", "cinema", "box office", "trailer", "ott", 
        "movie", "film", "actor", "actress", "celebrity", "director", "song", "music"
    ],
    "HEALTH": [
        "health", "medical", "disease", "vaccine", "hospital", "doctor", 
        "virus", "cancer", "pharma", "medicine", "who", "epidemic", "clinic"
    ]
};

function matchKeyword(text, keyword) {
    if (keyword.length <= 5) {
        // Enforce word boundaries for short terms to avoid matching inside words
        // e.g. "ai" won't match "campaign" or "jail"; "india" won't match "indian"
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?:$|[^a-zA-Z0-9])`, 'i');
        return regex.test(text);
    }
    return text.includes(keyword.toLowerCase());
}

function classifyArticle(title = "", description = "", metadataCategory = "") {
    const cleanTitle = (title || "").toLowerCase();
    const cleanDesc = (description || "").toLowerCase();
    const fullText = `${cleanTitle} ${cleanDesc}`;

    // 1. If metadataCategory explicitly marks FACT CHECK, trust it
    const upperMeta = (metadataCategory || "").toUpperCase().trim();
    if (upperMeta === "FACT CHECK" || upperMeta === "FACTCHECK") {
        return "FACT CHECK";
    }

    // 2. Score categories based on title (3x) and description (1x)
    let bestCategory = null;
    let maxScore = 0;

    for (const [category, keywords] of Object.entries(CATEGORY_MAP)) {
        let score = 0;
        for (const kw of keywords) {
            if (matchKeyword(cleanTitle, kw)) {
                score += 3;
            } else if (matchKeyword(cleanDesc, kw)) {
                score += 1;
            }
        }

        // If metadataCategory matches, grant a modest baseline bonus
        if (upperMeta && upperMeta.includes(category)) {
            score += 1.5;
        }

        if (score > maxScore) {
            maxScore = score;
            bestCategory = category;
        }
    }

    // 3. If a strong category was detected with at least 2 points
    if (bestCategory && maxScore >= 2) {
        return bestCategory;
    }

    // 4. Default to feed metadata category if valid
    if (upperMeta && upperMeta !== "TODAY" && upperMeta !== "NEWS+" && upperMeta !== "GENERAL") {
        return upperMeta;
    }

    return "INDIA";
}

module.exports = { classifyArticle, CATEGORY_MAP, matchKeyword };
