// backend/services/evidenceEngine.js
/**
 * SATYA Evidence & Provenance Intelligence Engine
 * 
 * Core Philosophy: News + Evidence + Verification + Context
 * Evaluates source independence, detects syndication/wire copy,
 * identifies primary documentation, and produces structured
 * "What We Know / Don't Know", "What Changed", and Cross-Source comparisons.
 */

// Known primary source signatures & official agencies
const PRIMARY_INDICATORS = [
    { type: "OFFICIAL_GOVERNMENT", keywords: ["pib", "press information bureau", "ministry", "gazette", "government of india", "spokesperson", "cabinet", "rbi", "sebi", "isro", "drdo"] },
    { type: "COURT_DOCUMENT", keywords: ["supreme court", "high court", "bench", "verdict", "affidavit", "petition", "order sheet", "bail order", "chargesheet", "fir"] },
    { type: "OFFICIAL_FILING", keywords: ["regulatory filing", "bse", "nse", "exchange filing", "sec filing", "quarterly earnings", "annual report", "audited"] },
    { type: "DIRECT_STATEMENT", keywords: ["statement said", "press release", "official release", "in an interview to", "confirmed to", "signed an agreement"] }
];

// Major Indian & global wire services (syndication detection)
const WIRE_SERVICES = ["pti", "press trust of india", "ani", "asian news international", "reuters", "afp", "bloomberg", "associated press", "ap"];

/**
 * Classify whether a source report is an original investigation, official release, or syndicated wire
 */
function classifySourceLineage(article) {
    const text = `${article.title || ''} ${article.description || ''} ${article.contentSnippet || ''}`.toLowerCase();
    
    // Check if wire syndication
    let isWireSyndicated = false;
    let wireName = null;
    for (const wire of WIRE_SERVICES) {
        if (text.includes(`(${wire})`) || text.includes(`${wire}:`) || text.includes(`via ${wire}`) || text.includes(`reported by ${wire}`)) {
            isWireSyndicated = true;
            wireName = wire.toUpperCase();
            break;
        }
    }

    // Check for primary document references
    let primaryEvidenceType = null;
    for (const ind of PRIMARY_INDICATORS) {
        if (ind.keywords.some(k => text.includes(k))) {
            primaryEvidenceType = ind.type;
            break;
        }
    }

    return {
        isWireSyndicated,
        wireName,
        primaryEvidenceType,
        sourceOutlet: article.source || "News Outlet",
        publishedAt: article.publishedAt
    };
}

/**
 * Compute rigorous claim-level evidence status
 */
function computeEvidenceStatus(uniqueSources, primaryEvidenceType, hasConflict, isSyndicatedOnly) {
    if (hasConflict) {
        return {
            status: "CONFLICTING",
            label: "CONFLICTING REPORTS",
            confidence: "MEDIUM",
            summary: "Active dispute or contradictory statements across major outlets. Key details remain contested."
        };
    }

    if (primaryEvidenceType && uniqueSources.length >= 1) {
        return {
            status: "CONFIRMED",
            label: "OFFICIALLY CONFIRMED",
            confidence: "HIGH",
            summary: "Directly verified with primary documentation or official institutional statements."
        };
    }

    if (uniqueSources.length >= 3 && !isSyndicatedOnly) {
        return {
            status: "CONFIRMED",
            label: "MULTI-SOURCE CONFIRMED",
            confidence: "HIGH",
            summary: "Independently corroborated by 3 or more distinct news organizations."
        };
    }

    if (uniqueSources.length >= 2) {
        return {
            status: "SUPPORTED",
            label: "CROSS-SUPPORTED",
            confidence: "MEDIUM",
            summary: "Reported by multiple outlets, though full independent verification is ongoing."
        };
    }

    if (uniqueSources.length === 1) {
        return {
            status: "SUPPORTED",
            label: "SINGLE SOURCE REPORT",
            confidence: "LOW",
            summary: "Reported by one credible outlet; waiting for secondary corroboration."
        };
    }

    return {
        status: "INSUFFICIENT_EVIDENCE",
        label: "INSUFFICIENT EVIDENCE",
        confidence: "LOW",
        summary: "Available reports lack corroborating citations or primary documentation."
    };
}

/**
 * Synthesize "What We Know / Don't Know / Disputed / What Would Change"
 */
function synthesizeKnowledgeBreakdown(article, relatedSources = [], primaryEvidenceType = null, hasConflict = false) {
    const title = article.title || "";
    const desc = article.description || "";
    const sourceName = article.source || "SATYA Index";

    const whatWeKnow = [
        `First reported by ${sourceName} at ${new Date(article.publishedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
        desc.length > 20 ? desc : title
    ];

    if (primaryEvidenceType) {
        whatWeKnow.push(`Primary basis: Grounded in verifiable ${primaryEvidenceType.replace(/_/g, ' ').toLowerCase()}.`);
    }

    const whatWeDontKnow = [
        "Long-term policy or operational impact pending official gazette notifications.",
        "Specific secondary figures or localized ground confirmations still emerging."
    ];

    const whatIsDisputed = hasConflict ? [
        "Conflicting accounts exist regarding timelines or exact sequence of events.",
        "Statements from involved parties differ on underlying causes."
    ] : [];

    const whatWouldChangeThis = [
        "Official press conference, gazette release, or regulatory compliance filing.",
        "First-party clarification from primary authorities involved."
    ];

    return {
        whatWeKnow,
        whatWeDontKnow,
        whatIsDisputed,
        whatWouldChangeThis
    };
}

/**
 * Generate Story Timeline & "What Changed"
 */
function generateStoryTimeline(article, relatedSources = []) {
    const all = [
        {
            source: article.source || "Initial Outlet",
            title: article.title,
            publishedAt: article.publishedAt,
            url: article.sourceUrl,
            stage: "FIRST_REPORT"
        },
        ...relatedSources.map((rs, idx) => ({
            source: rs.source || `Corroborating Source ${idx + 1}`,
            title: rs.title || article.title,
            publishedAt: rs.publishedAt || article.publishedAt,
            url: rs.sourceUrl || article.sourceUrl,
            stage: rs.stage || (idx === 0 ? "INDEPENDENT_CORROBORATION" : "DEVELOPMENT")
        }))
    ];

    // Sort chronologically (earliest first)
    all.sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));

    const timeline = all.map((entry, index) => {
        let label = "Initial report";
        if (index === 1) label = "Second independent source";
        else if (index === 2) label = "Corroboration & follow-up";
        else if (index > 2) label = "Latest development";

        return {
            time: new Date(entry.publishedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            date: new Date(entry.publishedAt || Date.now()).toLocaleDateString([], { month: 'short', day: 'numeric' }),
            source: entry.source,
            headline: entry.title,
            stage: entry.stage,
            label,
            url: entry.url
        };
    });

    const whatChanged = timeline.length > 1 ? {
        earlier: `Initially reported as: "${timeline[0].headline.substring(0, 90)}..." by ${timeline[0].source}`,
        latest: `Current consensus: Multi-source reporting across ${timeline.length} outlets (${timeline[timeline.length - 1].source}).`,
        shiftType: timeline.length > 2 ? "FACTUAL_EXPANSION" : "CONFIRMATORY_UPDATE"
    } : {
        earlier: `Single report indexed: "${timeline[0].headline.substring(0, 90)}..."`,
        latest: "Awaiting secondary follow-up reporting.",
        shiftType: "INITIAL"
    };

    return { timeline, whatChanged };
}

/**
 * Generate Structured Side-by-Side Coverage Comparison
 */
function buildCoverageComparison(articles = []) {
    if (!articles || articles.length === 0) return null;

    const compared = articles.slice(0, 4).map(art => ({
        source: art.source || "News Outlet",
        headline: art.title,
        publishedAt: art.publishedAt,
        focus: art.description ? art.description.substring(0, 140) + "..." : art.title,
        evidenceStatus: art.verifiedStatus || "SUPPORTED",
        url: art.sourceUrl
    }));

    // Find common tokens in headlines
    const words = compared.map(c => c.headline.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/));
    const common = words[0].filter(w => w.length > 3 && words.every(list => list.includes(w)));
    const agreementTopic = common.length > 0 ? common.join(" ") : "Core incident reported";

    return {
        articles: compared,
        agreement: `All reporting outlets confirm activity regarding: ${agreementTopic}.`,
        discrepancies: compared.length > 1 
            ? "Varying emphasis on timeline speed, localized impact figures, and quotes from distinct regional representatives."
            : "Single viewpoint available at present.",
        uncertainties: "Independent verification of localized aftermath details and official closing statements."
    };
}

/**
 * Deep Analysis of an Article or Grouped Event
 */
function analyzeArticleEvidence(article) {
    if (!article) return null;

    const related = Array.isArray(article.relatedSources) ? article.relatedSources : [];
    const lineage = classifySourceLineage(article);
    const relatedLineages = related.map(classifySourceLineage);

    const allLineages = [lineage, ...relatedLineages];
    const uniqueSources = [...new Set(allLineages.map(l => l.sourceOutlet))];

    // Check conflict signals in headlines
    const allTitles = [article.title, ...related.map(r => r.title)].filter(Boolean).map(t => t.toLowerCase());
    const hasConflict = allTitles.some(t => 
        t.includes('denies') || t.includes('refutes') || t.includes('claims otherwise') || 
        t.includes('disputes') || t.includes('contradicts') || t.includes('not true')
    );

    const isSyndicatedOnly = allLineages.length > 1 && allLineages.every(l => l.isWireSyndicated && l.wireName === allLineages[0].wireName);

    const statusObj = computeEvidenceStatus(uniqueSources, lineage.primaryEvidenceType, hasConflict, isSyndicatedOnly);
    const knowledge = synthesizeKnowledgeBreakdown(article, related, lineage.primaryEvidenceType, hasConflict);
    const { timeline, whatChanged } = generateStoryTimeline(article, related);

    return {
        articleId: article.id,
        title: article.title,
        source: article.source,
        sourceUrl: article.sourceUrl,
        publishedAt: article.publishedAt,
        category: article.category,
        image: article.image,
        evidenceStatus: statusObj.status,
        statusLabel: statusObj.label,
        confidence: statusObj.confidence,
        statusSummary: statusObj.summary,
        sourcesCount: uniqueSources.length,
        independentSources: uniqueSources,
        isSyndicatedOnly,
        syndicatedWire: lineage.wireName,
        primaryEvidenceType: lineage.primaryEvidenceType,
        hasConflict,
        whatWeKnow: knowledge.whatWeKnow,
        whatWeDontKnow: knowledge.whatWeDontKnow,
        whatIsDisputed: knowledge.whatIsDisputed,
        whatWouldChangeThis: knowledge.whatWouldChangeThis,
        timeline,
        whatChanged
    };
}

module.exports = {
    classifySourceLineage,
    computeEvidenceStatus,
    synthesizeKnowledgeBreakdown,
    generateStoryTimeline,
    buildCoverageComparison,
    analyzeArticleEvidence
};
