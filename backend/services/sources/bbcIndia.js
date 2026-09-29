module.exports = {
    name: "BBC News",
    language: "en",
    country: "GB",
    feeds: [
        { categoryHint: "WORLD", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
        { categoryHint: "BUSINESS", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
        { categoryHint: "TECHNOLOGY", url: "https://feeds.bbci.co.uk/news/technology/rss.xml" },
        { categoryHint: "SCIENCE", url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml" }
    ]
};