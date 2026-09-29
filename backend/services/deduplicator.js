function getTitleTokens(title) {
    return title
        .toLowerCase()
        .replace(/[^\w\s]/gi, '')
        .split(/\s+/)
        .filter(token => token.length > 3);
}

function computeSimilarity(tokensA, tokensB) {
    if (!tokensA.length || !tokensB.length) return 0;
    const intersection = tokensA.filter(token => tokensB.includes(token));
    return (2.0 * intersection.length) / (tokensA.length + tokensB.length);
}

function deduplicateAndGroup(articles) {
    const grouped = [];

    for (const article of articles) {
        const tokens = getTitleTokens(article.title);
        let matchFound = false;

        for (const existingGroup of grouped) {
            const existingTokens = getTitleTokens(existingGroup.title);
            const similarity = computeSimilarity(tokens, existingTokens);

            if (similarity >= 0.45) {
                matchFound = true;
                
                existingGroup.relatedSources.push({
                    source: article.source,
                    title: article.title,
                    sourceUrl: article.sourceUrl,
                    publishedAt: article.publishedAt
                });

                if (existingGroup.relatedSources.length > 1) {
                    existingGroup.verifiedStatus = "CONFIRMED";
                }

                if (!existingGroup.image && article.image) {
                    existingGroup.image = article.image;
                }
                break;
            }
        }

        if (!matchFound) {
            grouped.push({
                ...article,
                verifiedStatus: "SUPPORTED",
                relatedSources: [
                    {
                        source: article.source,
                        title: article.title,
                        sourceUrl: article.sourceUrl,
                        publishedAt: article.publishedAt
                    }
                ]
            });
        }
    }

    return grouped.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

module.exports = { deduplicateAndGroup };