// backend/services/crossSourceEngine.js
const { analyzeArticleEvidence, buildCoverageComparison } = require('./evidenceEngine');

function evaluateEventEvidence(groupedArticle) {
    const analysis = analyzeArticleEvidence(groupedArticle);
    if (!analysis) {
        return {
            eventId: groupedArticle?.id || "unknown",
            title: groupedArticle?.title || "",
            sources: [groupedArticle?.source || "SATYA"],
            sourceCount: 1,
            agreementScore: 50,
            conflictScore: 0,
            verificationStatus: "UNVERIFIED",
            confidence: "LOW",
            publishedAt: groupedArticle?.publishedAt || new Date().toISOString()
        };
    }

    const agreementScore = analysis.evidenceStatus === "CONFIRMED" ? 92 
        : analysis.evidenceStatus === "SUPPORTED" ? 75 
        : analysis.evidenceStatus === "CONFLICTING" ? 40 : 50;

    const conflictScore = analysis.hasConflict ? 70 : 0;

    return {
        eventId: analysis.articleId,
        title: analysis.title,
        sources: analysis.independentSources,
        sourceCount: analysis.sourcesCount,
        agreementScore,
        conflictScore,
        verificationStatus: analysis.evidenceStatus,
        statusLabel: analysis.statusLabel,
        confidence: analysis.confidence,
        summary: analysis.statusSummary,
        isSyndicatedOnly: analysis.isSyndicatedOnly,
        syndicatedWire: analysis.syndicatedWire,
        primaryEvidenceType: analysis.primaryEvidenceType,
        whatWeKnow: analysis.whatWeKnow,
        whatWeDontKnow: analysis.whatWeDontKnow,
        whatIsDisputed: analysis.whatIsDisputed,
        whatWouldChangeThis: analysis.whatWouldChangeThis,
        timeline: analysis.timeline,
        whatChanged: analysis.whatChanged,
        publishedAt: analysis.publishedAt
    };
}

function analyzeDatasetEvidence(groupedArticles) {
    return (groupedArticles || []).map(article => evaluateEventEvidence(article));
}

module.exports = {
    evaluateEventEvidence,
    analyzeDatasetEvidence,
    buildCoverageComparison
};
