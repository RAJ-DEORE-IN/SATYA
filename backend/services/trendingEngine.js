// backend/services/trendingEngine.js
const { socialTrends } = require('../sources');
const { analyzeArticleEvidence } = require('./evidenceEngine');

async function calculateTrends(groupedArticles = []) {
    const scoredTrends = [];

    // 1. Analyze news articles into Event-Based Clusters
    for (const group of groupedArticles) {
        const related = Array.isArray(group.relatedSources) ? group.relatedSources : [];
        const sourceCount = Math.max(1, related.length);
        const uniqueSources = [...new Set(related.map(r => r.source || r))];
        const pubDate = new Date(group.publishedAt || Date.now()).getTime();
        const hoursAgo = Math.max(0.5, (Date.now() - pubDate) / (1000 * 60 * 60));
        
        // Recency + velocity scoring
        const recencyScore = Math.max(10, Math.round(100 / hoursAgo));
        const trendScore = Math.min(100, (uniqueSources.length * 20) + recencyScore);

        const evidence = analyzeArticleEvidence(group);

        if (trendScore >= 25 || uniqueSources.length >= 2) {
            scoredTrends.push({
                id: group.id || `trend-${scoredTrends.length}`,
                eventId: group.id,
                title: group.title,
                topic: group.title,
                category: group.category || "GENERAL",
                image: group.image,
                trendScore,
                velocity: hoursAgo < 3 ? "VERY HIGH" : hoursAgo < 8 ? "HIGH" : "STEADY",
                sourceCount: uniqueSources.length,
                sources: uniqueSources,
                lastUpdated: group.publishedAt || new Date().toISOString(),
                verificationStatus: evidence ? evidence.evidenceStatus : (group.verifiedStatus || "SUPPORTED"),
                statusLabel: evidence ? evidence.statusLabel : "REPORTED",
                summary: group.description || "Multi-source coverage active.",
                majorDevelopments: evidence?.timeline?.slice(0, 3)?.map(t => `${t.source}: ${t.label}`) || [],
                reason: `${uniqueSources.length} independent outlet(s) reported in the last ${Math.round(hoursAgo)}h.`
            });
        }
    }

    // 2. Include legal social signals as trend metadata
    try {
        const rawSocial = await socialTrends.fetchTrends();
        rawSocial.forEach(st => {
            scoredTrends.push({
                id: `social-${st.topic.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`,
                eventId: null,
                title: st.topic,
                topic: st.topic,
                category: "TRENDING",
                image: null,
                trendScore: st.trendScore,
                velocity: "HIGH",
                sourceCount: 1,
                sources: [st.platform],
                lastUpdated: new Date().toISOString(),
                verificationStatus: "UNVERIFIED",
                statusLabel: "SOCIAL SIGNAL",
                summary: `High public interest trending on ${st.platform}`,
                majorDevelopments: [`Signal registered from public discussions (${st.engagement})`],
                reason: `Public signal trend on ${st.platform} (${st.engagement})`
            });
        });
    } catch (e) {
        console.warn("[TREND ENGINE] Social signals bypassed:", e.message);
    }

    return scoredTrends.sort((a, b) => b.trendScore - a.trendScore);
}

module.exports = { calculateTrends };
