// backend/services/crossSourceEngine.js

function evaluateEventEvidence(groupedArticle) {
    const sources = (groupedArticle.relatedSources || []).map(s => s.source);
    const uniqueSources = [...newSet(sources)];
    const sourceCount = uniqueSources.length;

    let agreementScore = 50;
    let conflictScore = 0;
    let confidence = "LOW";
    let verificationStatus = "UNVERIFIED";

    if (sourceCount >= 3) {
        agreementScore = 90;
        confidence = "HIGH";
        verificationStatus = "CONFIRMED";
    } else if (sourceCount === 2) {
        agreementScore = 75;
        confidence = "MEDIUM";
        verificationStatus = "SUPPORTED";
    } else {
        agreementScore = 50;
        confidence = "LOW";
        verificationStatus = "UNVERIFIED";
    }

    // Detect conflicting claims (e.g. key figures disagreeing across headlines)
    const titleTokens = groupedArticle.relatedSources.map(s => s.title.toLowerCase());
    const hasDiscrepancy = titleTokens.some(t => t.includes('denies') || t.includes('refutes') || t.includes('claims otherwise'));
    
    if (hasDiscrepancy) {
        conflictScore = 65;
        verificationStatus = "CONFLICTING";
    }

    return {
        eventId: groupedArticle.id,
        title: groupedArticle.title,
        sources: uniqueSources,
        sourceCount,
        agreementScore,
        conflictScore,
        verificationStatus,
        confidence,
        publishedAt: groupedArticle.publishedAt
    };
}

function analyzeDatasetEvidence(groupedArticles) {
    return groupedArticles.map(article => evaluateEventEvidence(article));
}

module.exports = {
    evaluateEventEvidence,
    analyzeDatasetEvidence
};