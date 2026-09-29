// Supported Legitimate Multi-Source Indian & International Outlets + Fact Check Feeds

const newsSources = [
    {
        name: "Times of India",
        language: "en",
        country: "IN",
        feeds: [
            { categoryHint: "INDIA", url: "https://timesofindia.indiatimes.com/rssfeedstopstories.cms" },
            { categoryHint: "WORLD", url: "https://timesofindia.indiatimes.com/rssfeeds/296589292.cms" },
            { categoryHint: "BUSINESS", url: "https://timesofindia.indiatimes.com/rssfeeds/1898055.cms" },
            { categoryHint: "SPORTS", url: "https://timesofindia.indiatimes.com/rssfeeds/4719148.cms" }
        ]
    },
    {
        name: "NDTV News",
        language: "en",
        country: "IN",
        feeds: [
            { categoryHint: "INDIA", url: "https://feeds.feedburner.com/ndtvnews-top-stories" },
            { categoryHint: "WORLD", url: "https://feeds.feedburner.com/ndtvnews-world-news" },
            { categoryHint: "BUSINESS", url: "https://feeds.feedburner.com/ndtvprofit-latest" },
            { categoryHint: "SPORTS", url: "https://feeds.feedburner.com/ndtvsports-latest" }
        ]
    },
    {
        name: "BBC India",
        language: "en",
        country: "IN",
        feeds: [
            { categoryHint: "WORLD", url: "http://feeds.bbci.co.uk/news/world/asia/india/rss.xml" },
            { categoryHint: "WORLD", url: "http://feeds.bbci.co.uk/news/world/rss.xml" }
        ]
    },
    {
        name: "The Hindu",
        language: "en",
        country: "IN",
        feeds: [
            { categoryHint: "INDIA", url: "https://www.thehindu.com/news/national/feeder/default.rss" },
            { categoryHint: "BUSINESS", url: "https://www.thehindu.com/business/feeder/default.rss" }
        ]
    },
    {
        name: "Indian Express",
        language: "en",
        country: "IN",
        feeds: [
            { categoryHint: "INDIA", url: "https://indianexpress.com/section/india/feed/" },
            { categoryHint: "WORLD", url: "https://indianexpress.com/section/world/feed/" }
        ]
    },
    {
        name: "LiveMint",
        language: "en",
        country: "IN",
        feeds: [
            { categoryHint: "BUSINESS", url: "https://www.livemint.com/rss/news" },
            { categoryHint: "BUSINESS", url: "https://www.livemint.com/rss/markets" }
        ]
    },
    {
        name: "BOOM Fact Check",
        language: "en",
        country: "IN",
        feeds: [
            { categoryHint: "FACT CHECK", url: "https://www.boomlive.in/feeder/default.rss" }
        ]
    },
    {
        name: "Aaj Tak (Hindi)",
        language: "hi",
        country: "IN",
        feeds: [
            { categoryHint: "INDIA", url: "https://www.aajtak.in/rss/detailnews.xml" }
        ]
    }
];

// Public Social Trend Signal Tracker (Legal Stub Integrator)
const socialTrends = {
    async fetchTrends() {
        return [
            { topic: "#ISRO", platform: "X/Twitter Signal", trendScore: 92, engagement: "High Discussion" },
            { topic: "#Sensex", platform: "Public Signal", trendScore: 84, engagement: "Market Discussion" },
            { topic: "#MonsoonUpdate", platform: "Social Signal", trendScore: 78, engagement: "Regional Alert" }
        ];
    }
};

module.exports = { newsSources, socialTrends };