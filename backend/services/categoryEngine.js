const CATEGORY_MAP = {
    "FACT CHECK": ["fact check", "factcheck", "fake news", "fake claim", "busted", "false report", "debunked", "boom live", "claim"],
    "TECHNOLOGY": ["ai", "artificial intelligence", "technology", "tech", "smartphone", "computer", "software", "semiconductor", "space", "isro", "nasa", "apple", "google", "microsoft", "cybersecurity", "chip"],
    "BUSINESS": ["stock", "market", "sensex", "nifty", "rbi", "economy", "company", "finance", "banking", "rupee", "inflation", "gdp", "tax", "startup"],
    "SPORTS": ["cricket", "football", "olympics", "athletics", "match", "tournament", "ipl", "bcci", "trophy", "medal", "stadium", "score", "kohli"],
    "ENTERTAINMENT": ["movie", "cinema", "ott", "music", "celebrity", "actor", "actress", "bollywood", "hollywood", "box office", "film", "series"],
    "SCIENCE": ["research", "physics", "astronomy", "biology", "scientist", "discovery", "satellite", "galaxy", "laboratory", "quantum"],
    "HEALTH": ["health", "medical", "disease", "vaccine", "hospital", "doctor", "virus", "cancer", "pharma", "medicine", "who"],
    "WORLD": ["international", "us", "usa", "china", "europe", "uk", "middle east", "russia", "ukraine", "global", "united nations", "president", "nepal"],
    "INDIA": ["india", "delhi", "mumbai", "modi", "parliament", "government", "state", "supreme court", "high court", "police"]
};

function classifyArticle(title = "", description = "", metadataCategory = "") {
    const textToScan = `${title} ${description} ${metadataCategory}`.toLowerCase();

    for (const [category, keywords] of Object.entries(CATEGORY_MAP)) {
        if (keywords.some(keyword => textToScan.includes(keyword))) {
            return category;
        }
    }

    if (metadataCategory && metadataCategory !== "TODAY" && metadataCategory !== "NEWS+") {
        return metadataCategory.toUpperCase();
    }

    return "NEWS+";
}

module.exports = { classifyArticle };