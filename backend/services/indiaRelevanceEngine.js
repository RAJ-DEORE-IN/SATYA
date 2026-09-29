// backend/services/indiaRelevanceEngine.js

const INDIA_KEYWORDS = [
    'india', 'delhi', 'mumbai', 'bengaluru', 'hyderabad', 'chennai', 'kolkata',
    'modi', 'parliament', 'rbi', 'isro', 'bcci', 'supreme court', 'rupee',
    'lok sabha', 'rajya sabha', 'indian', 'government'
];

function calculateRelevanceScores(article) {
    const text = `${article.title} ${article.description || ''}`.toLowerCase();
    
    // 1. India Relevance Calculation
    let indiaHits = 0;
    INDIA_KEYWORDS.forEach(kw => {
        if (text.includes(kw)) indiaHits += 1;
    });
    
    let indiaRelevanceScore = Math.min(100, 30 + (indiaHits * 20));
    if (article.country === 'IN' || article.category === 'INDIA') {
        indiaRelevanceScore = Math.max(indiaRelevanceScore, 80);
    }

    // 2. Importance Score Calculation
    const sourceCount = (article.relatedSources || []).length;
    let importanceScore = 40 + (sourceCount * 15);
    if (article.category === 'BUSINESS' || article.category === 'INDIA' || article.category === 'FACT CHECK') {
        importanceScore += 15;
    }
    importanceScore = Math.min(100, importanceScore);

    // 3. Confidence Score Calculation
    let confidenceScore = sourceCount > 1 ? 85 : 60;

    return {
        ...article,
        satyaScores: {
            indiaRelevanceScore,
            importanceScore,
            confidenceScore
        }
    };
}

function scoreDataset(articles) {
    return articles.map(calculateRelevanceScores);
}

module.exports = {
    calculateRelevanceScores,
    scoreDataset
};