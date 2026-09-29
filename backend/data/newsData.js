const fallbackArticles = [
    {
        id: "satya-static-01",
        title: "ISRO successfully launches SSLV-D3, places satellites into orbit",
        description: "The launch took place from Satish Dhawan Space Centre, Sriharikota.",
        contentSnippet: "India's Small Satellite Launch Vehicle achieved complete mission success today carrying primary payloads flawlessly.",
        image: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=1200&q=80",
        source: "SATYA Desk",
        sourceUrl: "https://isro.gov.in",
        category: "TODAY",
        language: "en",
        country: "IN",
        publishedAt: new Date().toISOString(),
        fetchedAt: new Date().toISOString(),
        verifiedStatus: "VERIFIED BY MULTIPLE SOURCES",
        relatedSources: [
            { source: "Times of India", title: "ISRO SSLV-D3 launch successful", sourceUrl: "https://timesofindia.indiatimes.com", publishedAt: new Date().toISOString() }
        ]
    }
];

module.exports = {
    stories: fallbackArticles,
    trendingStories: fallbackArticles,
    latestStories: fallbackArticles
};