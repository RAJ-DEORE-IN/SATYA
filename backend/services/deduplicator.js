// backend/services/deduplicator.js
const { classifySourceLineage, computeEvidenceStatus } = require('./evidenceEngine');

function getTitleTokens(title) {
    if (!title) return [];
    return title
        .toLowerCase()
        .replace(/[^\w\s]/gi, ' ')
        .split(/\s+/)
        .filter(token => token.length > 3);
}

function computeSimilarity(tokensA, tokensB) {
    if (!tokensA.length || !tokensB.length) return 0;
    const setB = new Set(tokensB);
    const intersection = tokensA.filter(token => setB.has(token));
    return (2.0 * intersection.length) / (tokensA.length + tokensB.length);
}

function deduplicateAndGroup(articles) {
    if (!Array.isArray(articles) || articles.length === 0) return [];

    const grouped = [];

    for (const article of articles) {
        if (!article || !article.title) continue;

        const tokens = getTitleTokens(article.title);
        const articleLineage = classifySourceLineage(article);
        let matchFound = false;

        for (const existingGroup of grouped) {
            const existingTokens = getTitleTokens(existingGroup.title);
            const similarity = computeSimilarity(tokens, existingTokens);

            // Group articles that describe the same story/event
            if (similarity >= 0.45) {
                matchFound = true;
                
                existingGroup.relatedSources.push({
                    source: article.source,
                    title: article.title,
                    sourceUrl: article.sourceUrl,
                    publishedAt: article.publishedAt,
                    isWireSyndicated: articleLineage.isWireSyndicated,
                    wireName: articleLineage.wireName,
                    primaryEvidenceType: articleLineage.primaryEvidenceType
                });

                // Re-evaluate verification status
                const uniqueSources = [...new Set(existingGroup.relatedSources.map(s => s.source))];
                const hasPrimary = existingGroup.primaryEvidenceType || articleLineage.primaryEvidenceType;
                
                // Detect if conflict keywords are present
                const conflictKeywords = ['denies', 'refutes', 'claims otherwise', 'disputes', 'contradicts'];
                const titleLower = article.title.toLowerCase();
                const existingTitleLower = existingGroup.title.toLowerCase();
                const hasConflict = conflictKeywords.some(k => titleLower.includes(k) || existingTitleLower.includes(k));

                const isSyndicatedOnly = existingGroup.relatedSources.length > 1 && 
                    existingGroup.relatedSources.every(s => s.isWireSyndicated && s.wireName === existingGroup.relatedSources[0].wireName);

                const statusResult = computeEvidenceStatus(uniqueSources, hasPrimary, hasConflict, isSyndicatedOnly);
                existingGroup.verifiedStatus = statusResult.status;
                existingGroup.statusLabel = statusResult.label;

                if (!existingGroup.image && article.image) {
                    existingGroup.image = article.image;
                }
                break;
            }
        }

        if (!matchFound) {
            const initialStatus = articleLineage.primaryEvidenceType ? "CONFIRMED" : "SUPPORTED";
            grouped.push({
                ...article,
                verifiedStatus: initialStatus,
                statusLabel: initialStatus === "CONFIRMED" ? "OFFICIALLY CONFIRMED" : "REPORTED",
                primaryEvidenceType: articleLineage.primaryEvidenceType,
                isWireSyndicated: articleLineage.isWireSyndicated,
                wireName: articleLineage.wireName,
                relatedSources: [
                    {
                        source: article.source,
                        title: article.title,
                        sourceUrl: article.sourceUrl,
                        publishedAt: article.publishedAt,
                        isWireSyndicated: articleLineage.isWireSyndicated,
                        wireName: articleLineage.wireName,
                        primaryEvidenceType: articleLineage.primaryEvidenceType
                    }
                ]
            });
        }
    }

    return grouped.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
}

module.exports = { 
    deduplicateAndGroup,
    getTitleTokens,
    computeSimilarity
};
