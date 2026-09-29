const { socialTrends } = require('../sources');

async function calculateTrends(groupedArticles) {
    const scoredTrends = [];

    // Analyze news articles coverage velocity & source count
    for (const group of groupedArticles) {
        const sourceCount = (group.relatedSources || []).length;
        const pubDate = new Date(group.publishedAt).getTime();
        const hoursAgo = Math.max(1, (Date.now() - pubDate) / (1000 * 60 * 60));
        
        const recencyScore = Math.max(10, Math.round(100 / hoursAgo));
        const trendScore = Math.min(100, (sourceCount * 25) + recencyScore);

        if (trendScore >= 35) {
            scoredTrends.push({
                topic: group.title,
                trendScore,
                velocity: hoursAgo < 4 ? "HIGH" : "MODERATE",
                sourceCount,
                socialSignal: "NEWS_VERIFIED",
                recencyScore,
                reason: `Reported by ${sourceCount} independent news outlet(s) in the last ${Math.round(hoursAgo)} hours.`
            });
        }
    }

    // Include legal social signals as trend metadata
    try {
        const rawSocial = await socialTrends.fetchTrends();
        rawSocial.forEach(st => {
            scoredTrends.push({
                topic: st.topic,
                trendScore: st.trendScore,
                velocity: "HIGH",
                sourceCount: 1,
                socialSignal: st.platform,
                recencyScore: 80,
                reason: `Public signal trend on ${st.platform} (${st.engagement})`
            });
        });
    } catch (e) {
        console.warn("[TREND ENGINE] Social signals bypassed:", e.message);
    }

    return scoredTrends.sort((a, b) => b.trendScore - a.trendScore);
}

module.exports = { calculateTrends };