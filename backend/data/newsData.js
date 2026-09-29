const nowIso = new Date().toISOString();

const fallbackArticles = [
    {
        id: "satya-01",
        title: "ISRO prepares for next-gen reusable launch vehicle orbital test flight",
        description: "Indian Space Research Organisation advances its RLV development with automated landing trajectory simulations at Sriharikota.",
        contentSnippet: "India's space agency ISRO has completed ground benchmarks for its autonomous orbital landing vehicle, setting new milestones in low-cost space transport.",
        image: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=1200&q=80",
        source: "ISRO Desk",
        sourceUrl: "https://isro.gov.in",
        category: "TODAY",
        language: "en",
        country: "IN",
        publishedAt: nowIso,
        fetchedAt: nowIso,
        verifiedStatus: "CONFIRMED",
        relatedSources: [
            { source: "Times of India", title: "ISRO advances reusable space plane project", sourceUrl: "https://timesofindia.indiatimes.com", publishedAt: nowIso },
            { source: "The Hindu", title: "Key milestones achieved in ISRO autonomous landing flight", sourceUrl: "https://thehindu.com", publishedAt: nowIso }
        ]
    },
    {
        id: "satya-02",
        title: "Sensex and Nifty register sharp rally led by technology and banking stocks",
        description: "Benchmark indices scaled positive territory as domestic institutional inflows and foreign liquidity remained supportive.",
        contentSnippet: "Indian equity markets concluded higher today with strong buying in large-cap banking, digital infrastructure, and consumer finance counters.",
        image: "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1200&q=80",
        source: "LiveMint",
        sourceUrl: "https://www.livemint.com",
        category: "BUSINESS",
        language: "en",
        country: "IN",
        publishedAt: nowIso,
        fetchedAt: nowIso,
        verifiedStatus: "CONFIRMED",
        relatedSources: [
            { source: "NDTV Profit", title: "Markets rebound: Sensex gains 450 points", sourceUrl: "https://ndtv.com", publishedAt: nowIso },
            { source: "Indian Express", title: "IT and banking indices power market momentum", sourceUrl: "https://indianexpress.com", publishedAt: nowIso }
        ]
    },
    {
        id: "satya-03",
        title: "India national cricket squad gears up for upcoming championship test series",
        description: "The selection committee announced the 16-member team following rigorous fitness assessments and regional league performances.",
        contentSnippet: "Top batsmen and pace spearheads reported to the National Cricket Academy ahead of the multi-format bilateral series starting next week.",
        image: "https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=1200&q=80",
        source: "NDTV Sports",
        sourceUrl: "https://sports.ndtv.com",
        category: "SPORTS",
        language: "en",
        country: "IN",
        publishedAt: nowIso,
        fetchedAt: nowIso,
        verifiedStatus: "CONFIRMED",
        relatedSources: [
            { source: "Times of India", title: "BCCI announces squad updates for test campaign", sourceUrl: "https://timesofindia.indiatimes.com", publishedAt: nowIso }
        ]
    },
    {
        id: "satya-04",
        title: "Global climate summit adopts new renewable transition finance guidelines",
        description: "Representatives from 140 nations agreed to establish multilateral funding pools for green energy transition in developing economies.",
        contentSnippet: "The international council concluded high-level talks in Geneva, pledging enhanced resource distribution to bolster clean solar and wind manufacturing.",
        image: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80",
        source: "BBC India",
        sourceUrl: "https://www.bbc.com",
        category: "WORLD",
        language: "en",
        country: "IN",
        publishedAt: nowIso,
        fetchedAt: nowIso,
        verifiedStatus: "CONFIRMED",
        relatedSources: [
            { source: "The Hindu", title: "Global climate accords emphasize green investments", sourceUrl: "https://thehindu.com", publishedAt: nowIso }
        ]
    },
    {
        id: "satya-05",
        title: "BOOM Fact Check: Viral video claiming free smartphone scheme debunked as phishing hoax",
        description: "Circulated WhatsApp forwards claiming a central government smartphone giveaway have been proven completely fraudulent.",
        contentSnippet: "Independent fact-checkers verified that the links shared on social networks lead to deceptive credential-harvesting websites and have no government affiliation.",
        image: "https://images.unsplash.com/photo-1589994965851-a8f479c573a9?auto=format&fit=crop&w=1200&q=80",
        source: "BOOM Live",
        sourceUrl: "https://www.boomlive.in",
        category: "FACT CHECK",
        language: "en",
        country: "IN",
        publishedAt: nowIso,
        fetchedAt: nowIso,
        verifiedStatus: "CONFIRMED",
        relatedSources: [
            { source: "PIB Fact Check", title: "Fake scheme alert: Beware of fraudulent giveaway claims", sourceUrl: "https://pib.gov.in", publishedAt: nowIso }
        ]
    },
    {
        id: "satya-06",
        title: "Next-generation semiconductor fab construction begins in Gujarat corridor",
        description: "The cutting-edge fabrication plant will manufacture high-density silicon chips for automotive, IoT, and AI edge devices.",
        contentSnippet: "With global technology partnerships, the semiconductor manufacturing ecosystem in India takes a major leap forward to strengthen local supply resilience.",
        image: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80",
        source: "Indian Express",
        sourceUrl: "https://indianexpress.com",
        category: "TECHNOLOGY",
        language: "en",
        country: "IN",
        publishedAt: nowIso,
        fetchedAt: nowIso,
        verifiedStatus: "CONFIRMED",
        relatedSources: [
            { source: "Times of India", title: "Semiconductor corridor construction on track", sourceUrl: "https://timesofindia.indiatimes.com", publishedAt: nowIso }
        ]
    },
    {
        id: "satya-07",
        title: "High-speed rail corridor completes extensive river bridge engineering milestone",
        description: "Engineers successfully placed continuous steel girders across the major river basin on schedule.",
        contentSnippet: "The high-speed rail authority announced completion of 12 river crossings, bringing commercial trials one step closer.",
        image: "https://images.unsplash.com/photo-1534274988757-a28bf1a57c17?auto=format&fit=crop&w=1200&q=80",
        source: "Times of India",
        sourceUrl: "https://timesofindia.indiatimes.com",
        category: "TODAY",
        language: "en",
        country: "IN",
        publishedAt: nowIso,
        fetchedAt: nowIso,
        verifiedStatus: "SUPPORTED",
        relatedSources: []
    },
    {
        id: "satya-08",
        title: "RBI maintains flexible liquidity stance amidst balanced inflation figures",
        description: "Monetary policy observers note stable consumer price indices and resilient economic indicators.",
        contentSnippet: "The Reserve Bank stated that liquidity conditions in the interbank market remain sound with robust domestic demand supporting GDP expansion.",
        image: "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=1200&q=80",
        source: "LiveMint",
        sourceUrl: "https://www.livemint.com",
        category: "BUSINESS",
        language: "en",
        country: "IN",
        publishedAt: nowIso,
        fetchedAt: nowIso,
        verifiedStatus: "CONFIRMED",
        relatedSources: [
            { source: "The Hindu", title: "Central bank statement highlights steady macro fundamentals", sourceUrl: "https://thehindu.com", publishedAt: nowIso }
        ]
    },
    {
        id: "satya-09",
        title: "National Athletics Championship: New national 100m sprint record established",
        description: "Sensational speed exhibited in the men's sprint finals as the stopwatch recorded a historic sub-10.20s timing.",
        contentSnippet: "Athletes delivered historic performances in the opening days of the interstate athletics championship, thrilling thousands in the stadium.",
        image: "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=1200&q=80",
        source: "NDTV Sports",
        sourceUrl: "https://sports.ndtv.com",
        category: "SPORTS",
        language: "en",
        country: "IN",
        publishedAt: nowIso,
        fetchedAt: nowIso,
        verifiedStatus: "SUPPORTED",
        relatedSources: []
    },
    {
        id: "satya-10",
        title: "Fact Check: Misleading satellite radar photos falsely linked to coastal cyclonic alert",
        description: "Archived weather satellite photos from 2021 were repurposed on social media to claim an imminent severe storm.",
        contentSnippet: "Meteorological departments confirmed normal seasonal weather patterns with no emergency cyclone alert issued for the coastal states.",
        image: "https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1200&q=80",
        source: "BOOM Live",
        sourceUrl: "https://www.boomlive.in",
        category: "FACT CHECK",
        language: "en",
        country: "IN",
        publishedAt: nowIso,
        fetchedAt: nowIso,
        verifiedStatus: "CONFIRMED",
        relatedSources: [
            { source: "NDTV News", title: "Met department refutes viral cyclone panic rumors", sourceUrl: "https://ndtv.com", publishedAt: nowIso }
        ]
    }
];

module.exports = {
    stories: fallbackArticles,
    trendingStories: fallbackArticles.slice(1, 5),
    latestStories: fallbackArticles
};
