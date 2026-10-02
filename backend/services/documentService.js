// backend/services/documentService.js
const PDFDocument = require('pdfkit');

/**
 * Builds structured note data from article & evidence
 */
function buildStructuredNotes(article, evidence = null) {
    if (!article) return null;

    const title = article.title || "Untitled Intelligence Brief";
    const source = article.source || "SATYA Verified Network";
    const publishedAt = article.publishedAt ? new Date(article.publishedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + " IST" : "Recent";
    const verifiedStatus = article.verifiedStatus || evidence?.evidenceStatus || "SUPPORTED";
    const summary = article.description || article.contentSnippet || "Verified news summary from SATYA intelligence network.";

    const whatWeKnow = (evidence && Array.isArray(evidence.whatWeKnow) && evidence.whatWeKnow.length > 0)
        ? evidence.whatWeKnow
        : [
            `Published by ${source} on ${publishedAt}.`,
            summary
        ];

    const whatWeDontKnow = (evidence && Array.isArray(evidence.whatWeDontKnow) && evidence.whatWeDontKnow.length > 0)
        ? evidence.whatWeDontKnow
        : [
            "Secondary localized aftermath and ground confirmations emerging.",
            "Awaiting subsequent official gazette or regulatory releases."
        ];

    const timeline = (evidence && Array.isArray(evidence.timeline) && evidence.timeline.length > 0)
        ? evidence.timeline
        : [
            { time: "Initial", label: `First reported by ${source}` },
            { time: "Recent", label: `Indexed in SATYA verified news database` }
        ];

    const sources = (evidence && Array.isArray(evidence.independentSources) && evidence.independentSources.length > 0)
        ? evidence.independentSources
        : [source];

    return {
        title,
        source,
        publishedAt,
        verifiedStatus,
        summary,
        whatWeKnow,
        whatWeDontKnow,
        timeline,
        sources,
        generatedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + " IST"
    };
}

/**
 * Generate PDF buffer using PDFKit
 */
function generatePdfBuffer(notes) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 48, size: 'A4' });
            const buffers = [];

            doc.on('data', chunk => buffers.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', err => reject(err));

            // Header Banner
            doc.fillColor('#e53935')
               .fontSize(22)
               .font('Helvetica-Bold')
               .text('SATYA', { continued: true });
            
            doc.fillColor('#111111')
               .fontSize(10)
               .font('Helvetica')
               .text('  |  News + Evidence + Verification + Context', { align: 'right' });

            doc.moveDown(0.5);
            doc.strokeColor('#e5e5ea').lineWidth(1).moveTo(48, doc.y).lineTo(547, doc.y).stroke();
            doc.moveDown(1);

            // Title
            doc.fillColor('#111111')
               .fontSize(16)
               .font('Helvetica-Bold')
               .text(notes.title);

            doc.moveDown(0.4);

            // Metadata row
            doc.fillColor('#666666')
               .fontSize(9)
               .font('Helvetica')
               .text(`Source: ${notes.source}   •   Published: ${notes.publishedAt}   •   Status: [${notes.verifiedStatus}]`);

            doc.moveDown(1);

            // Executive Summary
            doc.fillColor('#e53935')
               .fontSize(11)
               .font('Helvetica-Bold')
               .text('EXECUTIVE BRIEF');

            doc.moveDown(0.3);
            doc.fillColor('#222222')
               .fontSize(10)
               .font('Helvetica')
               .text(notes.summary, { lineGap: 3 });

            doc.moveDown(1);

            // What We Know
            doc.fillColor('#15803d')
               .fontSize(11)
               .font('Helvetica-Bold')
               .text('WHAT IS CONFIRMED / KNOWN');

            doc.moveDown(0.3);
            notes.whatWeKnow.forEach(point => {
                doc.fillColor('#222222')
                   .fontSize(9.5)
                   .font('Helvetica')
                   .text(`• ${point}`, { indent: 10, lineGap: 2 });
            });

            doc.moveDown(1);

            // What Remains Unclear
            doc.fillColor('#c2410c')
               .fontSize(11)
               .font('Helvetica-Bold')
               .text('WHAT REMAINS UNCLEAR / DEVELOPING');

            doc.moveDown(0.3);
            notes.whatWeDontKnow.forEach(point => {
                doc.fillColor('#222222')
                   .fontSize(9.5)
                   .font('Helvetica')
                   .text(`• ${point}`, { indent: 10, lineGap: 2 });
            });

            doc.moveDown(1);

            // Timeline
            doc.fillColor('#4338ca')
               .fontSize(11)
               .font('Helvetica-Bold')
               .text('REPORTING TIMELINE');

            doc.moveDown(0.3);
            notes.timeline.forEach(item => {
                const timeStr = item.time || "Update";
                const labelStr = item.label || item.headline || item.text || "Event update";
                doc.fillColor('#333333')
                   .fontSize(9.5)
                   .font('Helvetica')
                   .text(`[${timeStr}]  ${labelStr}`, { indent: 10, lineGap: 2 });
            });

            doc.moveDown(1);

            // Sources
            doc.fillColor('#666666')
               .fontSize(9)
               .font('Helvetica-Bold')
               .text('INDEPENDENT CORROBORATING OUTLETS:');
            
            doc.font('Helvetica')
               .text(notes.sources.join('   •   '), { indent: 10 });

            // Footer
            doc.moveDown(2);
            doc.strokeColor('#f0f0f2').lineWidth(0.5).moveTo(48, doc.y).lineTo(547, doc.y).stroke();
            doc.moveDown(0.5);
            doc.fontSize(8)
               .fillColor('#999999')
               .text(`Generated by SATYA Intelligence Engine on ${notes.generatedAt}   •   Founder: Raj Ravindra Deore`, { align: 'center' });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Generate Markdown text
 */
function generateMarkdownDocument(notes) {
    return `# ${notes.title}
**SATYA Intelligence Briefing**
- **Source:** ${notes.source}
- **Published:** ${notes.publishedAt}
- **Evidence Status:** ${notes.verifiedStatus}
- **Generated:** ${notes.generatedAt}

---

## Executive Summary
${notes.summary}

## What We Know (Confirmed Facts)
${notes.whatWeKnow.map(k => `- ${k}`).join('\n')}

## What Remains Unclear
${notes.whatWeDontKnow.map(u => `- ${u}`).join('\n')}

## Reporting Timeline
${notes.timeline.map(t => `- **${t.time || 'Live'}**: ${t.label || t.headline || t.text}`).join('\n')}

## Sources & Provenance
${notes.sources.map(s => `- ${s}`).join('\n')}

---
*Generated by SATYA (News + Evidence + Verification + Context) — Founder: Raj Ravindra Deore*
`;
}

/**
 * Generate standard Word-compatible document (Rich HTML (.doc) that Microsoft Word / Google Docs opens natively)
 */
function generateDocxCompatibleBuffer(notes) {
    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>${notes.title}</title>
        <style>
            body { font-family: Calibri, Arial, sans-serif; margin: 40px; color: #111; line-height: 1.5; }
            h1 { color: #111; font-size: 20pt; border-bottom: 2px solid #e53935; padding-bottom: 8px; }
            h2 { color: #e53935; font-size: 14pt; margin-top: 18px; }
            .meta { color: #666; font-size: 10pt; margin-bottom: 18px; }
            .status { background: #fee2e2; color: #991b1b; padding: 3px 8px; border-radius: 4px; font-weight: bold; }
            ul { margin-top: 6px; }
            li { margin-bottom: 4px; }
            .footer { margin-top: 30px; font-size: 9pt; color: #888; border-top: 1px solid #ddd; padding-top: 10px; }
        </style>
    </head>
    <body>
        <div style="font-size: 14pt; font-weight: bold; color: #e53935;">SATYA <span style="font-size: 9pt; color: #555; font-weight: normal;">| News + Evidence + Verification + Context</span></div>
        <h1>${notes.title}</h1>
        <div class="meta">
            <strong>Source:</strong> ${notes.source} &nbsp;|&nbsp;
            <strong>Published:</strong> ${notes.publishedAt} &nbsp;|&nbsp;
            <strong>Status:</strong> <span class="status">${notes.verifiedStatus}</span>
        </div>

        <h2>Executive Brief</h2>
        <p>${notes.summary}</p>

        <h2>What We Know (Confirmed Facts)</h2>
        <ul>
            ${notes.whatWeKnow.map(k => `<li>${k}</li>`).join('')}
        </ul>

        <h2>What Remains Unclear / Developing</h2>
        <ul>
            ${notes.whatWeDontKnow.map(u => `<li>${u}</li>`).join('')}
        </ul>

        <h2>Reporting Timeline</h2>
        <ul>
            ${notes.timeline.map(t => `<li><strong>${t.time || 'Update'}:</strong> ${t.label || t.headline || t.text}</li>`).join('')}
        </ul>

        <h2>Independent Corroborating Sources</h2>
        <p>${notes.sources.join(', ')}</p>

        <div class="footer">
            Generated by SATYA Intelligence Engine on ${notes.generatedAt} | Founder: Raj Ravindra Deore
        </div>
    </body>
    </html>
    `;

    return Buffer.from(htmlContent, 'utf-8');
}

module.exports = {
    buildStructuredNotes,
    generatePdfBuffer,
    generateMarkdownDocument,
    generateDocxCompatibleBuffer
};
