// backend/services/webSearchService.js
const axios = require('axios');
const Parser = require('rss-parser');
const crypto = require('crypto');

const rssParser = new Parser({
    timeout: 8000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
    }
});

// 5-minute memory cache to prevent duplicate queries
const searchCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Clean & resilient live web news search.
 * Searches real-time web news feeds across hundreds of Indian and international publishers.
 * Returns normalized, deduplicated articles with real URLs, published times, and sources.
 */
async function searchLiveWebNews(query, options = {}) {
    if (!query || typeof query !== 'string' || query.trim() === '') {
        return [];
    }

    const cleanQuery = query.trim().replace(/[^\w\s-]/g, ' ').substring(0, 150).trim();
    const cacheKey = cleanQuery.toLowerCase();
    const cached = searchCache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
        return cached.results;
    }

    let results = [];

    // Method 1: If user supplied an explicit external NewsAPI key in env
    const apiKey = process.env.WEB_SEARCH_API_KEY;
    if (apiKey && apiKey !== "your_web_search_api_key_here" && apiKey.trim() !== "") {
        try {
            const response = await axios.get('https://newsapi.org/v2/everything', {
                params: {
                    q: cleanQuery,
                    sortBy: 'publishedAt',
                    pageSize: 10,
                    apiKey
                },
                timeout: 5000
            });

            if (response.data && Array.isArray(response.data.articles)) {
                results = response.data.articles.map(a => ({
                    id: crypto.createHash('md5').update(`${a.source?.name}-${a.title}-${a.publishedAt}`).digest('hex').substring(0, 16),
                    title: a.title,
                    description: a.description || "",
                    source: a.source?.name || "Web Source",
                    sourceUrl: a.url,
                    publishedAt: a.publishedAt || new Date().toISOString(),
                    image: a.urlToImage || null,
                    isLiveWebResult: true
                }));
            }
        } catch (apiErr) {
            console.warn("[SATYA WEB SEARCH API ERROR]:", apiErr.message);
        }
    }

    // Method 2: Live Global & Indian News RSS Real-time Index (Reliable, Live, Free, No API key)
    if (results.length === 0) {
        try {
            const encodedQuery = encodeURIComponent(cleanQuery);
            const feedUrl = `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-IN&gl=IN&ceid=IN:en`;
            const feed = await rssParser.parseURL(feedUrl);

            if (feed && Array.isArray(feed.items) && feed.items.length > 0) {
                results = feed.items.slice(0, 12).map(item => {
                    // Extract publisher name from title ("Headline - Publisher")
                    let title = (item.title || "").trim();
                    let source = "Verified Source";
                    const lastDashIdx = title.lastIndexOf(" - ");
                    if (lastDashIdx > 0) {
                        source = title.substring(lastDashIdx + 3).trim();
                        title = title.substring(0, lastDashIdx).trim();
                    }

                    const publishedAt = item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString();
                    const id = crypto.createHash('md5').update(`${source}-${title}-${publishedAt}`).digest('hex').substring(0, 16);

                    // Clean snippet HTML
                    let snippet = item.contentSnippet || item.content || "";
                    snippet = snippet.replace(/<[^>]+>/g, '').trim();

                    return {
                        id,
                        title,
                        description: snippet,
                        source,
                        sourceUrl: item.link || "",
                        publishedAt,
                        image: null,
                        category: "LIVE WEB",
                        isLiveWebResult: true
                    };
                });
            }
        } catch (rssErr) {
            console.warn("[SATYA LIVE RSS SEARCH ERROR]:", rssErr.message);
        }
    }

    // Cache the results
    searchCache.set(cacheKey, {
        timestamp: Date.now(),
        results
    });

    return results;
}

module.exports = { searchLiveWebNews };
