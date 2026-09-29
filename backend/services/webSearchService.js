const axios = require('axios');

/**
 * Clean and resilient search integration for live news context.
 * Uses configurable Web/News API keys via .env without hallucination.
 */
async function searchLiveWebNews(query) {
    const apiKey = process.env.WEB_SEARCH_API_KEY;
    
    if (!apiKey || apiKey === "your_web_search_api_key_here") {
        console.warn("[SATYA WEB SEARCH] No external Web Search API key provided. Falling back to SATYA internal index.");
        return null;
    }

    try {
        // Example integration using NewsAPI / Web Search Service
        const response = await axios.get(`https://newsapi.org/v2/everything`, {
            params: {
                q: query,
                sortBy: 'publishedAt',
                pageSize: 10,
                apiKey: apiKey
            },
            timeout: 5000
        });

        if (response.data && response.data.articles && response.data.articles.length > 0) {
            return response.data.articles.map(a => ({
                title: a.title,
                description: a.description || "",
                source: a.source.name || "Web Source",
                sourceUrl: a.url,
                publishedAt: a.publishedAt,
                image: a.urlToImage || null
            }));
        }
    } catch (err) {
        console.warn("[SATYA WEB SEARCH ERROR]:", err.message);
    }

    return null;
}

module.exports = { searchLiveWebNews };