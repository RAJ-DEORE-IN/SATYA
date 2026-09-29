const Parser = require('rss-parser');
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const https = require('https');
const sourcesModule = require('../sources');
const { classifyArticle } = require('./categoryEngine');
// Line 8 fixed: './duplicator' -> './deduplicator'
const { deduplicateAndGroup } = require('./deduplicator');

const axiosInstance = axios.create({
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    timeout: 8000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
});

const parser = new Parser({
    customFields: {
        item: [
            ['media:content', 'mediaContent', { keepArray: true }],
            ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
            ['enclosure', 'enclosure']
        ]
    }
});

function extractImage(item) {
    if (item.enclosure && item.enclosure.url && item.enclosure.type && item.enclosure.type.startsWith('image/')) {
        return item.enclosure.url;
    }
    if (item.mediaContent && item.mediaContent.length > 0) {
        const primary = item.mediaContent[0];
        if (primary.$ && primary.$.url) return primary.$.url;
    }
    if (item.mediaThumbnail && item.mediaThumbnail.length > 0) {
        const primary = item.mediaThumbnail[0];
        if (primary.$ && primary.$.url) return primary.$.url;
    }
    if (item.content || item['content:encoded'] || item.description) {
        const rawHtml = item['content:encoded'] || item.content || item.description;
        try {
            const $ = cheerio.load(rawHtml);
            const imgSrc = $('img').first().attr('src');
            if (imgSrc && (imgSrc.startsWith('http://') || imgSrc.startsWith('https://'))) {
                return imgSrc;
            }
        } catch (err) {}
    }
    return null;
}

function generateArticleId(sourceName, title, publishedAt) {
    const rawString = `${sourceName}-${title}-${publishedAt}`;
    return crypto.createHash('md5').update(rawString).digest('hex').substring(0, 16);
}

// Open Public News API Backup (100% Real Live Articles guarantee)
async function fetchOpenPublicNews() {
    try {
        const res = await axiosInstance.get('https://saurav.tech/NewsAPI/top-headlines/category/general/in.json');
        if (res.data && res.data.articles) {
            return res.data.articles.map(item => ({
                id: generateArticleId(item.source.name || "Live News", item.title, item.publishedAt),
                title: item.title,
                description: item.description || item.content || "",
                contentSnippet: item.content || item.description || "",
                image: item.urlToImage || null,
                source: item.source.name || "Live News Desk",
                sourceUrl: item.url,
                category: classifyArticle(item.title, item.description || "", "INDIA"),
                language: "en",
                country: "IN",
                publishedAt: item.publishedAt || new Date().toISOString(),
                fetchedAt: new Date().toISOString()
            }));
        }
    } catch (e) {
        console.warn("[PUBLIC API WARN] Open API fetch failed:", e.message);
    }
    return [];
}

async function fetchLiveNews() {
    const rawArticles = [];
    const newsSources = sourcesModule.newsSources || [];

    const fetchPromises = newsSources.flatMap(sourceObj => {
        if (!sourceObj || !sourceObj.feeds) return [];

        return sourceObj.feeds.map(async (feedObj) => {
            try {
                const response = await axiosInstance.get(feedObj.url);
                const feedData = await parser.parseString(response.data);
                
                (feedData.items || []).forEach(item => {
                    const title = item.title ? item.title.trim() : null;
                    if (!title) return;

                    const description = item.contentSnippet || item.summary || item.description || "";
                    const cleanedDescription = description.replace(/<[^>]*>?/gm, '').trim();
                    const publishedAt = item.isoDate || item.pubDate || new Date().toISOString();
                    const image = extractImage(item);
                    const category = classifyArticle(title, cleanedDescription, feedObj.categoryHint);
                    const id = generateArticleId(sourceObj.name, title, publishedAt);

                    rawArticles.push({
                        id,
                        title,
                        description: cleanedDescription.substring(0, 280),
                        contentSnippet: cleanedDescription.substring(0, 500),
                        image,
                        source: sourceObj.name,
                        sourceUrl: item.link || item.guid || feedObj.url,
                        category,
                        language: sourceObj.language || "en",
                        country: sourceObj.country || "IN",
                        publishedAt,
                        fetchedAt: new Date().toISOString()
                    });
                });
            } catch (error) {
                console.warn(`[RSS FETCH WARN] ${sourceObj.name} (${feedObj.url}): ${error.message}`);
            }
        });
    });

    await Promise.allSettled(fetchPromises);

    if (rawArticles.length === 0) {
        console.log("[SATYA SYSTEM] Dynamic Fallback: Pulling live public feeds...");
        const apiArticles = await fetchOpenPublicNews();
        if (apiArticles && apiArticles.length > 0) {
            return deduplicateAndGroup(apiArticles);
        }
        const fallback = require('../data/newsData');
        return deduplicateAndGroup(fallback.stories || []);
    }

    return deduplicateAndGroup(rawArticles);
}

module.exports = { fetchLiveNews };