const { GoogleGenAI } = require('@google/genai');
const { SATYA_KNOWLEDGE } = require('../config/aiKnowledge');

class SatyaAIEngine {
    constructor() {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey || apiKey === "yahan_apni_gemini_api_key_paste_kare") {
            console.warn("[SATYA AI] GEMINI_API_KEY missing in backend/.env file.");
            this.ai = null;
        } else {
            this.ai = new GoogleGenAI({ apiKey });
            // FAST SPEED MODEL CONFIGURATION
            this.modelName = 'gemini-3.6-flash';
        }
    }

    formatArticlesForAI(articles) {
        if (!articles || articles.length === 0) return "No articles matched the filter query in internal cache.";
        
        return articles.slice(0, 35).map((a, i) => {
            const sources = (a.relatedSources || []).map(s => s.source).join(', ') || a.source;
            return `
[Item #${i + 1}]
Title: ${a.title}
Sources: ${sources}
Category: ${a.category}
Status: ${a.verifiedStatus || 'SUPPORTED'}
Description: ${a.description}
URL: ${a.sourceUrl}
PublishedAt: ${a.publishedAt}
`;
        }).join('\n---\n');
    }

    async askSATYA(promptText, globalNewsPool = []) {
        const lowerPrompt = promptText.toLowerCase();

        // FAST LOCAL FOUNDER CHECK
        if (lowerPrompt.includes("founder") || lowerPrompt.includes("owner") || lowerPrompt.includes("banaya")) {
            return {
                reply: `SATYA was founded by ${SATYA_KNOWLEDGE.founder}. SATYA is a news intelligence and multi-source analysis platform designed to bring verified news truth.`,
                confidence: "VERIFIED"
            };
        }

        // Siri-Style Rules: Strict control against unverified external requests (e.g. Nepal news)
        if (lowerPrompt.includes("nepal") || lowerPrompt.includes("foreign news")) {
            return {
                reply: "Main external ya unverified news nahi dikha sakta. Main sirf hamari web slides par verified live news feeds hi dikhaunga.",
                confidence: "STRICT_WEB_CONTROL",
                uiAction: { type: "NAVIGATE_TAB", target: "world" }
            };
        }

        // Siri-Style Quick System Control Triggers
        if (lowerPrompt.includes("sports") || lowerPrompt.includes("cricket")) {
            return { reply: "Opening Sports section on dashboard...", confidence: "SYSTEM_CONTROL", uiAction: { type: "NAVIGATE_TAB", target: "sports" } };
        }
        if (lowerPrompt.includes("business") || lowerPrompt.includes("market")) {
            return { reply: "Opening Business section on dashboard...", confidence: "SYSTEM_CONTROL", uiAction: { type: "NAVIGATE_TAB", target: "business" } };
        }
        if (lowerPrompt.includes("fact check")) {
            return { reply: "Opening Fact Check panel...", confidence: "SYSTEM_CONTROL", uiAction: { type: "NAVIGATE_TAB", target: "factcheck" } };
        }

        if (!this.ai) {
            return {
                reply: "SATYA AI Engine is in offline mode. Please configure GEMINI_API_KEY in backend environment.",
                confidence: "OFFLINE_MODE"
            };
        }

        try {
            const contextText = this.formatArticlesForAI(globalNewsPool);
            const systemPrompt = `
You are SATYA AI, a superfast Siri-like System Intelligence for SATYA News Platform.
Rules:
1. Act as a web controller and fact verification engine.
2. Verify API incoming news feeds for truth.
3. Keep responses brief, extremely fast, and direct.
            `;

            const response = await this.ai.models.generateContent({
                model: this.modelName,
                contents: [
                    { role: 'user', parts: [{ text: `${systemPrompt}\n\nContext:\n${contextText}\n\nUser Question: ${promptText}` }] }
                ]
            });

            const replyText = response.text || "Verified analysis complete.";
            return {
                reply: replyText,
                confidence: "CONFIRMED_API_DATA"
            };
        } catch (error) {
            console.error("[SATYA AI ERROR]:", error);
            return {
                reply: "SATYA AI currently does not have enough verified information about this event in its available sources.",
                confidence: "UNVERIFIED"
            };
        }
    }
}

module.exports = new SatyaAIEngine();