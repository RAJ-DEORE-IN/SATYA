/**
 * SATYA — News with truth.
 * Full-stack Client Controller with Firebase Authentication & Firestore Integration
 */

import { 
    signInWithGoogle, 
    signOutUser, 
    onAuthChange, 
    saveArticle, 
    removeArticle, 
    getUserSavedArticles 
} from "./firebase-service.js";

document.addEventListener("DOMContentLoaded", () => {
    // -------------------------------------------------------------
    // CONFIGURABLE PRODUCTION API STRATEGY
    // -------------------------------------------------------------
    const API_BASE = window.SATYA_API_BASE || '';
    const LIVE_NEWS_API = `${API_BASE}/api/live-news`;
    const AI_API = `${API_BASE}/api/ai-chat`;
    const FACT_CHECK_API = `${API_BASE}/api/fact-check`;

    // -------------------------------------------------------------
    // CENTRAL APPLICATION STATE
    // -------------------------------------------------------------
    let currentUser = null;
    const savedArticlesMap = new Map(); // articleId -> article object

    let liveNewsPool = [];
    let stories = [];
    let trendingStories = [];
    let latestStories = [];
    let currentStoryIndex = 0;
    let autoSlideTimer = null;
    let isTabTransitioning = false;

    const FALLBACK_IMG = "https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1000&q=80";

    // Stable article ID generator
    function getStableArticleId(item, indexFallback = 0) {
        if (item && item.id) return String(item.id);
        const titleStr = (item?.title || "").trim();
        const sourceStr = (item?.source || "").trim();
        if (titleStr) {
            // Slugify title + source
            const slug = `${sourceStr}-${titleStr}`.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').substring(0, 48);
            return slug || `satya-art-${indexFallback}`;
        }
        return `satya-art-${indexFallback}`;
    }

    function ensureUniqueImages(newsArray) {
        const seenImages = new Set();
        return newsArray.map((item, idx) => {
            const articleId = getStableArticleId(item, idx);
            let img = item.image && typeof item.image === 'string' && item.image.trim() !== "" ? item.image : FALLBACK_IMG;
            if (seenImages.has(img)) {
                img = `https://picsum.photos/800/500?random=${idx + 100}`;
            }
            seenImages.add(img);
            return { ...item, id: articleId, image: img };
        });
    }

    function getISTParts(dateObj) {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            weekday: 'short',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });

        const parts = formatter.formatToParts(dateObj);
        const map = {};
        parts.forEach(p => { map[p.type] = p.value; });
        return map;
    }

    function formatPublishDate(isoString) {
        if (!isoString) return "Just now";
        try {
            const pubDate = new Date(isoString);
            if (isNaN(pubDate.getTime())) return "Just now";

            const now = new Date();
            const diffSeconds = Math.floor((now.getTime() - pubDate.getTime()) / 1000);

            if (diffSeconds >= 0 && diffSeconds < 60) return "Just now";
            if (diffSeconds >= 60 && diffSeconds < 3600) {
                const mins = Math.floor(diffSeconds / 60);
                return `${mins} min ago`;
            }
            if (diffSeconds >= 3600 && diffSeconds < 86400) {
                const hours = Math.floor(diffSeconds / 3600);
                return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
            }

            const pubParts = getISTParts(pubDate);
            const nowParts = getISTParts(now);

            const isToday = (pubParts.year === nowParts.year && pubParts.month === nowParts.month && pubParts.day === nowParts.day);
            const timeStr = `${pubParts.hour}:${pubParts.minute} ${pubParts.dayPeriod || ''}`.trim();

            if (isToday) return `Today • ${timeStr}`;
            return `${pubParts.month} ${pubParts.day} • ${timeStr}`;
        } catch (e) {
            return "Just now";
        }
    }

    function formatTimeOnly(isoString) {
        if (!isoString) return "Live";
        try {
            const pubDate = new Date(isoString);
            if (isNaN(pubDate.getTime())) return "Live";
            const pubParts = getISTParts(pubDate);
            return `${pubParts.hour}:${pubParts.minute} ${pubParts.dayPeriod || ''}`.trim();
        } catch (e) {
            return "Live";
        }
    }

    function updateLiveHeaderClock() {
        const dateEl = document.getElementById("live-date");
        if (!dateEl) return;
        const now = new Date();
        const p = getISTParts(now);
        dateEl.textContent = `${p.weekday}, ${p.day} ${p.month} ${p.year} • ${p.hour}:${p.minute} ${p.dayPeriod || ''} IST`;
    }

    updateLiveHeaderClock();
    setInterval(updateLiveHeaderClock, 30000);

    function showBannerMessage(message, isError = false) {
        let banner = document.getElementById("satya-status-banner");
        if (!banner) {
            banner = document.createElement("div");
            banner.id = "satya-status-banner";
            banner.style.cssText = `
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 9999;
                padding: 10px 22px;
                border-radius: 30px;
                font-size: 13px;
                font-weight: 600;
                color: #fff;
                box-shadow: 0 10px 30px rgba(0,0,0,0.25);
                transition: opacity 0.3s ease;
                max-width: 90vw;
                text-align: center;
            `;
            document.body.appendChild(banner);
        }
        banner.style.background = isError ? "rgba(229, 57, 53, 0.95)" : "rgba(30, 30, 30, 0.95)";
        banner.style.backdropFilter = "blur(12px)";
        banner.textContent = message;
        banner.style.display = "block";
        banner.style.opacity = "1";

        setTimeout(() => {
            banner.style.opacity = "0";
            setTimeout(() => { banner.style.display = "none"; }, 300);
        }, 4000);
    }

    // -------------------------------------------------------------
    // AUTHENTICATION & USER PROFILE CONTROLLER
    // -------------------------------------------------------------
    const userProfileBtn = document.getElementById("user-profile-btn");
    const userAvatar = document.getElementById("user-avatar");
    const userDropdown = document.getElementById("user-dropdown");
    const dropdownAvatar = document.getElementById("dropdown-user-avatar");
    const dropdownUserName = document.getElementById("dropdown-user-name");
    const dropdownUserEmail = document.getElementById("dropdown-user-email");
    const dropdownAuthBtn = document.getElementById("dropdown-auth-btn");
    const dropdownSavedBtn = document.getElementById("dropdown-saved-btn");
    const googleSigninBtn = document.getElementById("google-signin-btn");
    const authStatusMsg = document.getElementById("auth-status-msg");
    const closeAuthBtn = document.getElementById("close-auth");

    const DEFAULT_AVATAR = "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&q=80";

    // Centralized Auth State Handler
    onAuthChange(async (user) => {
        currentUser = user;
        if (user) {
            console.log("[SATYA AUTH] Logged in as:", user.displayName || user.email);
            const photo = user.photoURL || DEFAULT_AVATAR;
            const name = user.displayName || "SATYA Reader";
            const email = user.email || "";

            if (userAvatar) userAvatar.src = photo;
            if (dropdownAvatar) dropdownAvatar.src = photo;
            if (dropdownUserName) dropdownUserName.textContent = name;
            if (dropdownUserEmail) dropdownUserEmail.textContent = email;
            if (dropdownAuthBtn) {
                dropdownAuthBtn.innerHTML = `<span>Sign Out</span>`;
                dropdownAuthBtn.className = "dropdown-btn secondary";
            }

            // Load saved articles from Firestore
            await syncUserSavedArticles();
        } else {
            console.log("[SATYA AUTH] Signed out / Guest session");
            if (userAvatar) userAvatar.src = DEFAULT_AVATAR;
            if (dropdownAvatar) dropdownAvatar.src = DEFAULT_AVATAR;
            if (dropdownUserName) dropdownUserName.textContent = "Guest Reader";
            if (dropdownUserEmail) dropdownUserEmail.textContent = "Sign in to sync saved articles";
            if (dropdownAuthBtn) {
                dropdownAuthBtn.innerHTML = `
                    <svg width="15" height="15" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>
                    <span>Sign In with Google</span>
                `;
                dropdownAuthBtn.className = "dropdown-btn primary";
            }

            savedArticlesMap.clear();
            updateAllBookmarkButtonStates();
            renderSavedArticlesView();
        }
    });

    async function syncUserSavedArticles() {
        if (!currentUser) return;
        try {
            const articles = await getUserSavedArticles(currentUser.uid);
            savedArticlesMap.clear();
            articles.forEach(art => {
                if (art && art.articleId) {
                    savedArticlesMap.set(String(art.articleId), art);
                }
            });
            updateAllBookmarkButtonStates();
            renderSavedArticlesView();
        } catch (err) {
            console.warn("[SATYA SAVED] Sync error:", err);
        }
    }

    userProfileBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        userDropdown?.classList.toggle("show");
        document.getElementById("notif-dropdown")?.classList.remove("show");
    });

    dropdownAuthBtn?.addEventListener("click", async () => {
        userDropdown?.classList.remove("show");
        if (currentUser) {
            try {
                await signOutUser();
                showBannerMessage("Signed out of SATYA.");
            } catch (err) {
                showBannerMessage("Sign out failed: " + err.message, true);
            }
        } else {
            openModal("auth-modal");
        }
    });

    dropdownSavedBtn?.addEventListener("click", () => {
        userDropdown?.classList.remove("show");
        switchTab("Saved");
    });

    googleSigninBtn?.addEventListener("click", async () => {
        if (authStatusMsg) authStatusMsg.textContent = "Connecting to Google Authentication...";
        try {
            const user = await signInWithGoogle();
            if (authStatusMsg) authStatusMsg.textContent = "";
            closeModal("auth-modal");
            showBannerMessage(`Namaste, ${user.displayName || 'Reader'}! Signed in.`);
        } catch (err) {
            if (err.isCancelled) {
                if (authStatusMsg) authStatusMsg.textContent = "Sign-in was cancelled.";
            } else {
                console.error("[SATYA AUTH ERROR]:", err);
                if (authStatusMsg) authStatusMsg.textContent = err.message || "Sign-in failed. Please try again.";
            }
        }
    });

    closeAuthBtn?.addEventListener("click", () => closeModal("auth-modal"));

    // -------------------------------------------------------------
    // BOOKMARK / SAVE FEATURE IMPLEMENTATION
    // -------------------------------------------------------------
    async function toggleBookmark(article) {
        if (!article) return;
        const articleId = String(article.id || getStableArticleId(article));

        if (!currentUser) {
            // Prompt login
            const authSubtitle = document.getElementById("auth-modal-subtitle");
            if (authSubtitle) {
                authSubtitle.textContent = "Sign in with Google to save this verified story to your permanent SATYA briefing list.";
            }
            openModal("auth-modal");
            return;
        }

        const isCurrentlySaved = savedArticlesMap.has(articleId);

        try {
            if (isCurrentlySaved) {
                await removeArticle(currentUser.uid, articleId);
                savedArticlesMap.delete(articleId);
                showBannerMessage("Story removed from your Saved briefing.");
            } else {
                const savedRecord = {
                    id: articleId,
                    title: article.title || "Untitled Report",
                    description: article.description || article.content || "",
                    image: article.image || FALLBACK_IMG,
                    source: article.source || "SATYA",
                    sourceUrl: article.sourceUrl || "",
                    category: article.category || "GENERAL",
                    publishedAt: article.publishedAt || new Date().toISOString(),
                    verifiedStatus: article.verifiedStatus || "SUPPORTED"
                };
                await saveArticle(currentUser.uid, savedRecord);
                savedArticlesMap.set(articleId, savedRecord);
                showBannerMessage("Story saved to your private briefing.");
            }

            updateAllBookmarkButtonStates();
            renderSavedArticlesView();
        } catch (err) {
            console.error("[SATYA BOOKMARK ERROR]:", err);
            showBannerMessage("Failed to update saved story: " + err.message, true);
        }
    }

    function isArticleSaved(articleId) {
        return savedArticlesMap.has(String(articleId));
    }

    function updateAllBookmarkButtonStates() {
        // 1. Hero bookmark button
        const activeStory = stories[currentStoryIndex];
        const heroBtn = document.getElementById("hero-bookmark-btn");
        const heroText = document.getElementById("hero-bookmark-text");
        if (heroBtn && activeStory) {
            const saved = isArticleSaved(activeStory.id);
            heroBtn.classList.toggle("saved", saved);
            if (heroText) heroText.textContent = saved ? "Saved" : "Save";
        }

        // 2. Card bookmark buttons
        document.querySelectorAll(".card-bookmark-btn").forEach(btn => {
            const artId = btn.getAttribute("data-article-id");
            if (artId) {
                btn.classList.toggle("saved", isArticleSaved(artId));
            }
        });

        // 3. Detail modal bookmark button
        const modalBtn = document.getElementById("modal-bookmark-btn");
        if (modalBtn) {
            const modalArtId = modalBtn.getAttribute("data-article-id");
            if (modalArtId) {
                const saved = isArticleSaved(modalArtId);
                modalBtn.classList.toggle("saved", saved);
                const txt = modalBtn.querySelector(".btn-text");
                if (txt) txt.textContent = saved ? "Saved in Briefing" : "Save Story";
            }
        }
    }

    const heroBookmarkBtn = document.getElementById("hero-bookmark-btn");
    heroBookmarkBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        const activeStory = stories[currentStoryIndex];
        if (activeStory) toggleBookmark(activeStory);
    });

    // -------------------------------------------------------------
    // DYNAMIC WORKING NOTIFICATIONS POPUP
    // -------------------------------------------------------------
    function renderNotificationsUI() {
        const notifList = document.getElementById("notif-list");
        const notifBadge = document.getElementById("notif-badge");
        if (!notifList) return;

        if (!liveNewsPool || liveNewsPool.length === 0) {
            notifList.innerHTML = `<div class="notif-item"><p class="notif-text" style="color:#777;">No new notifications</p></div>`;
            if (notifBadge) notifBadge.style.display = "none";
            return;
        }

        if (notifBadge) notifBadge.style.display = "block";

        const recentNotifs = liveNewsPool.slice(0, 4);
        notifList.innerHTML = "";

        recentNotifs.forEach((item, index) => {
            const notifItem = document.createElement("div");
            notifItem.className = `notif-item ${index < 2 ? 'unread' : ''}`;
            const sourceBadge = item.source || item.category || "NEWS";
            const timeAgo = formatPublishDate(item.publishedAt);

            notifItem.innerHTML = `
                ${index < 2 ? '<div class="notif-dot"></div>' : '<div></div>'}
                <div style="cursor: pointer; width: 100%;">
                    <p class="notif-text"><strong>${sourceBadge}:</strong> ${item.title || 'Breaking update'}</p>
                    <span class="notif-time">${timeAgo}</span>
                </div>
            `;

            notifItem.addEventListener("click", () => {
                openStoryModal(item);
                document.getElementById("notif-dropdown")?.classList.remove("show");
            });

            notifList.appendChild(notifItem);
        });
    }

    // -------------------------------------------------------------
    // DEFENSIBLE EVIDENCE-BASED TRUTH AUDIT (Top-Right Section)
    // -------------------------------------------------------------
    function evaluateArticleEvidence(article) {
        if (!article) {
            return {
                status: "INSUFFICIENT_EVIDENCE",
                label: "INSUFFICIENT EVIDENCE",
                cssClass: "status-insufficient",
                explanation: "Verification temporarily unavailable for this item.",
                timeline: []
            };
        }

        const related = Array.isArray(article.relatedSources) ? article.relatedSources : [];
        const sourceCount = related.length > 0 ? related.length : 1;
        const sourcesList = related.length > 0 
            ? [...new Set(related.map(r => r.source || r))]
            : [article.source || "SATYA Index"];

        let status = article.verifiedStatus || "SUPPORTED";
        let explanation = "";

        // Check for conflicting indicators
        const hasConflict = related.some(r => {
            const t = (r.title || '').toLowerCase();
            return t.includes('denies') || t.includes('refutes') || t.includes('claims otherwise') || t.includes('contradicts');
        });

        if (hasConflict) {
            status = "CONFLICTING";
            explanation = `Conflicting claims detected across independent coverage from ${sourcesList.join(', ')}.`;
        } else if (status === "CONFIRMED" || sourceCount >= 2) {
            status = "CONFIRMED";
            explanation = `Corroborated across ${sourcesList.length} independent verified outlets (${sourcesList.join(', ')}). High source consistency.`;
        } else if (article.category === "FACT CHECK") {
            status = "CONFIRMED";
            explanation = `Independently audited by verified fact-checking organization (${article.source}).`;
        } else if (status === "UNVERIFIED") {
            status = "UNVERIFIED";
            explanation = `Single unconfirmed feed. Corroborating multi-source validation in progress.`;
        } else {
            status = "SUPPORTED";
            explanation = `Reported by reputable outlet (${article.source}). Cross-source indexing active.`;
        }

        return {
            status,
            label: status,
            cssClass: `status-${status.toLowerCase()}`,
            explanation,
            sourceCount,
            sourcesList
        };
    }

    function renderTopRightSlideUI(activeStoryIndex = 0) {
        const happeningTimeline = document.getElementById("happening-timeline");
        const happeningFooter = document.getElementById("happening-footer");
        const aiTruthOutput = document.getElementById("ai-truth-output");
        const truthScoreEl = document.getElementById("truth-score");
        const aiStatusPill = document.getElementById("ai-status-pill");

        if (!happeningTimeline) return;

        const currentStory = stories[activeStoryIndex] || liveNewsPool[0];
        if (!currentStory) {
            if (truthScoreEl) truthScoreEl.textContent = "INSUFFICIENT EVIDENCE";
            if (aiTruthOutput) aiTruthOutput.textContent = "Verification temporarily unavailable.";
            return;
        }

        const evidence = evaluateArticleEvidence(currentStory);

        if (truthScoreEl) {
            truthScoreEl.textContent = evidence.label;
            truthScoreEl.className = `truth-score ${evidence.cssClass}`;
        }
        if (aiStatusPill) {
            aiStatusPill.textContent = "EVIDENCE STATUS";
        }
        if (aiTruthOutput) {
            aiTruthOutput.textContent = evidence.explanation;
        }

        happeningTimeline.innerHTML = "";
        let timelineEvents = [];

        if (Array.isArray(currentStory.relatedSources) && currentStory.relatedSources.length > 0) {
            timelineEvents = currentStory.relatedSources.slice(0, 3).map((rs, idx) => ({
                time: formatTimeOnly(rs.publishedAt || currentStory.publishedAt),
                text: `${rs.source || 'Verified Source'}: ${rs.title || currentStory.title}`,
                active: idx === 0
            }));
        } else {
            const timeStr = formatTimeOnly(currentStory.publishedAt);
            timelineEvents = [
                { time: timeStr, text: `Reported by ${currentStory.source || 'SATYA'}: ${currentStory.title}`, active: true },
                { time: "Live", text: `Category: ${currentStory.category || 'General News'} update verified.`, active: true },
                { time: "Index", text: `Cross-source indexing tracking enabled.`, active: false }
            ];
        }

        timelineEvents.forEach(evt => {
            const div = document.createElement("div");
            div.className = "timeline-item";
            div.innerHTML = `
                <span class="time">${evt.time}</span>
                <div class="timeline-dot ${evt.active ? 'active' : ''}"></div>
                <p title="${escapeHtml(evt.text)}">${escapeHtml(evt.text)}</p>
            `;
            happeningTimeline.appendChild(div);
        });

        if (happeningFooter) {
            happeningFooter.textContent = `Developing story: ${currentStory.source || 'Multi-source'} • Live index sync active.`;
        }
    }

    // -------------------------------------------------------------
    // DATA LOADING & RESILIENT POLLING
    // -------------------------------------------------------------
    async function loadNewsData(isBackgroundRefresh = false) {
        try {
            if (!isBackgroundRefresh) showBannerMessage("Syncing SATYA News Intelligence...");
            const response = await fetch(LIVE_NEWS_API);

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const jsonResult = await response.json();

            if (jsonResult && jsonResult.status === "success" && Array.isArray(jsonResult.data) && jsonResult.data.length > 0) {
                liveNewsPool = ensureUniqueImages(jsonResult.data);

                stories = liveNewsPool.slice(0, 5);
                trendingStories = liveNewsPool.slice(5, 10);
                latestStories = liveNewsPool.slice(10, 24);

                renderHeroStory(currentStoryIndex);
                renderTrendingUI();
                renderLatestUI();
                renderNotificationsUI();
                renderTopRightSlideUI(currentStoryIndex);

                if (!autoSlideTimer) startAutoSlide();
                
                const activeTab = document.querySelector(".bottom-glass-nav .nav-item.active span")?.textContent || "Home";
                renderCategoryViews(activeTab.toLowerCase());
                updateAllBookmarkButtonStates();

                if (!isBackgroundRefresh) {
                    showBannerMessage(`Updated ${liveNewsPool.length} verified news entries.`);
                }
            }
        } catch (error) {
            console.error("[SATYA LOAD ERROR]:", error);
            if (!isBackgroundRefresh) {
                showBannerMessage("Connecting to SATYA news feeds... Showing offline mode.", true);
            }
        }
    }

    setInterval(() => loadNewsData(true), 120000);

    // -------------------------------------------------------------
    // STORY DETAIL MODAL CONTROLLER
    // -------------------------------------------------------------
    function openStoryModal(article) {
        activeModalArticle = article;
        const detailBody = document.getElementById("detail-modal-body");
        if (!detailBody || !article) return;

        const safeImg = article.image || FALLBACK_IMG;
        const safeTitle = article.title || "Untitled Report";
        const safeLoc = `${article.source || 'SATYA'} • ${formatPublishDate(article.publishedAt)}`;
        const safeContent = article.description || article.content || "Full verified details for this report are currently being updated.";
        const articleId = String(article.id || getStableArticleId(article));
        const isSaved = isArticleSaved(articleId);

        let sourcesHtml = "";
        if (Array.isArray(article.relatedSources) && article.relatedSources.length > 0) {
            sourcesHtml = `
                <div class="detail-multi-sources" style="margin-top:12px; font-size:12px; color:#555;">
                    <strong>Verified Corroborating Sources:</strong> 
                    ${article.relatedSources.map(s => `<span class="source-tag" style="display:inline-block; margin-left:4px; padding:3px 8px; background:rgba(0,0,0,0.06); border-radius:12px; font-weight:600;">${escapeHtml(s.source || s)}</span>`).join(' ')}
                </div>
            `;
        }

        let confidenceHtml = "";
        const evidence = evaluateArticleEvidence(article);
        confidenceHtml = `
            <div class="confidence-pill" style="display:inline-block; margin-bottom:8px; padding:4px 10px; border-radius:12px; font-size:11px; font-weight:700; background:rgba(0,0,0,0.06);">
                Evidence Status: <span class="${evidence.cssClass}">${evidence.label}</span>
            </div>
        `;

        let safeUrl = article.sourceUrl && (article.sourceUrl.startsWith('http://') || article.sourceUrl.startsWith('https://'))
            ? article.sourceUrl
            : null;

        const readMoreBtnHtml = safeUrl 
            ? `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="read-more-btn" style="display:inline-block; padding:11px 22px; background:#e53935; color:#fff; text-decoration:none; border-radius:24px; font-weight:700; font-size:13px; transition:transform 0.2s;">Read Full Source Article &rarr;</a>` 
            : '';

        detailBody.innerHTML = `
            <img src="${safeImg}" alt="${escapeHtml(safeTitle)}" onerror="this.src='${FALLBACK_IMG}'" style="width:100%; max-height:300px; object-fit:cover; border-radius:18px; margin-bottom:16px;">
            ${confidenceHtml}
            <h2>${escapeHtml(safeTitle)}</h2>
            <div class="detail-meta" style="margin: 8px 0; font-size:12px; color:#666;"><span>${escapeHtml(safeLoc)}</span></div>
            ${sourcesHtml}
            <div class="detail-body" style="margin-top:16px; font-size:14px; line-height:1.6; color:#222;">
                <p>${escapeHtml(safeContent)}</p>
            </div>
            <div class="detail-actions-row">
                ${readMoreBtnHtml}
                <button class="modal-bookmark-btn ${isSaved ? 'saved' : ''}" id="modal-bookmark-btn" data-article-id="${articleId}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="${isSaved ? '#fff' : 'none'}" stroke="currentColor" stroke-width="2.2">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                    </svg>
                    <span class="btn-text">${isSaved ? 'Saved in Briefing' : 'Save Story'}</span>
                </button>
            </div>
        `;

        // Wire modal bookmark button
        document.getElementById("modal-bookmark-btn")?.addEventListener("click", () => {
            toggleBookmark(article);
        });

        closeModal("search-modal");
        openModal("detail-modal");
    }

    function escapeHtml(str) {
        if (!str || typeof str !== 'string') return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // -------------------------------------------------------------
    // MODAL HELPERS
    // -------------------------------------------------------------
    function openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add("active");
            document.body.style.overflow = "hidden";
        }
    }

    function closeModal(modalId) {
        if (modalId === "detail-modal") activeModalArticle = null;
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.remove("active");
        if (!document.querySelector(".modal-overlay.active")) {
            document.body.style.overflow = "";
        }
    }

    document.querySelectorAll(".modal-overlay").forEach(overlay => {
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closeModal(overlay.id);
        });
    });

    document.getElementById("close-search")?.addEventListener("click", () => closeModal("search-modal"));
    document.getElementById("close-ai")?.addEventListener("click", () => closeModal("ai-modal"));
    document.getElementById("close-detail")?.addEventListener("click", () => closeModal("detail-modal"));

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            document.querySelectorAll(".modal-overlay.active").forEach(modal => closeModal(modal.id));
            document.getElementById("notif-dropdown")?.classList.remove("show");
            document.getElementById("user-dropdown")?.classList.remove("show");
        }
    });

    // -------------------------------------------------------------
    // BOTTOM NAVIGATION & TAB VIEWS
    // -------------------------------------------------------------
    const navItems = document.querySelectorAll(".bottom-glass-nav .nav-item");
    const activePill = document.getElementById("activePill");

    const viewMap = {
        "home": "home-view",
        "today": "today-view",
        "news+": "newsplus-view",
        "newsplus": "newsplus-view",
        "world": "world-view",
        "business": "business-view",
        "sports": "sports-view",
        "fact check": "factcheck-view",
        "factcheck": "factcheck-view",
        "saved": "saved-view"
    };

    function updatePillPosition(targetItem) {
        if (!activePill || !targetItem || targetItem.classList.contains("ai-button")) {
            if (activePill) activePill.style.opacity = "0";
            return;
        }

        const parentNav = targetItem.parentElement;
        const navRect = parentNav.getBoundingClientRect();
        const itemRect = targetItem.getBoundingClientRect();

        const offsetLeft = itemRect.left - navRect.left;
        const itemWidth = itemRect.width;

        activePill.style.opacity = "1";
        activePill.style.transform = `translateX(${offsetLeft}px)`;
        activePill.style.width = `${itemWidth}px`;
    }

    function switchTab(selectedTabName) {
        const cleanName = selectedTabName.trim().toLowerCase();
        const targetViewId = viewMap[cleanName];
        if (!targetViewId || isTabTransitioning) return;

        const currentView = document.querySelector(".tab-view.active-view");
        const targetView = document.getElementById(targetViewId);

        if (!targetView || currentView === targetView) return;

        isTabTransitioning = true;

        if (currentView) {
            currentView.classList.add("view-leaving");
            currentView.classList.remove("active-view");
        }

        setTimeout(() => {
            document.querySelectorAll(".tab-view").forEach(view => {
                view.style.display = "none";
                view.classList.remove("view-leaving");
            });

            targetView.style.display = "block";
            void targetView.offsetWidth;
            targetView.classList.add("active-view");

            navItems.forEach(item => {
                const span = item.querySelector("span");
                if (span) {
                    const text = span.textContent.trim().toLowerCase();
                    if (text === cleanName || (cleanName === "newsplus" && text === "news+") || (cleanName === "factcheck" && text === "fact check")) {
                        navItems.forEach(btn => btn.classList.remove("active"));
                        item.classList.add("active");
                        updatePillPosition(item);
                    }
                }
            });

            if (cleanName === "saved") {
                renderSavedArticlesView();
            } else {
                renderCategoryViews(cleanName);
            }
            isTabTransitioning = false;
        }, 220);
    }

    // -------------------------------------------------------------
    // SAVED PAGE CONTROLLER
    // -------------------------------------------------------------
    function renderSavedArticlesView() {
        const savedGrid = document.getElementById("saved-news-grid");
        if (!savedGrid) return;

        if (!currentUser) {
            savedGrid.innerHTML = `
                <div class="empty-saved-msg">
                    <p style="font-size:15px; font-weight:700; color:#111; margin-bottom:8px;">Sign in to view your Saved Stories</p>
                    <p style="color:#666; margin-bottom:20px;">Bookmark articles across any section to read later and sync across all your devices.</p>
                    <button id="saved-page-signin-btn" class="dropdown-btn primary" style="max-width:220px; margin:0 auto;">
                        Sign In with Google
                    </button>
                </div>
            `;
            document.getElementById("saved-page-signin-btn")?.addEventListener("click", () => openModal("auth-modal"));
            return;
        }

        const savedArticles = Array.from(savedArticlesMap.values());
        if (savedArticles.length === 0) {
            savedGrid.innerHTML = `
                <div class="empty-saved-msg">
                    <p style="font-size:15px; font-weight:700; color:#111; margin-bottom:8px;">No saved stories yet</p>
                    <p style="color:#666;">Click the bookmark icon on any top headline, trending story, or category card to build your verified briefing list.</p>
                </div>
            `;
            return;
        }

        savedGrid.innerHTML = "";
        savedArticles.forEach(item => {
            const headline = item.title || "Headline Unavailable";
            const imgUrl = item.image || FALLBACK_IMG;
            const sourceBadge = item.source || item.category || "SAVED";
            const timeLoc = `${item.source || 'SATYA'} • ${formatPublishDate(item.publishedAt)}`;
            const articleId = String(item.id || item.articleId);

            const card = document.createElement("article");
            card.className = "news-card liquid-slide";
            card.innerHTML = `
                <button class="card-bookmark-btn saved" data-article-id="${articleId}" aria-label="Remove saved story" title="Remove story">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="#fff" stroke="currentColor" stroke-width="2.2">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                    </svg>
                </button>
                <img src="${imgUrl}" alt="${escapeHtml(headline)}" onerror="this.src='${FALLBACK_IMG}'">
                <div class="news-content">
                    <span class="category">${escapeHtml(sourceBadge)}</span>
                    <h3>${escapeHtml(headline)}</h3>
                    <p>${escapeHtml(timeLoc)}</p>
                </div>
            `;

            // Card click opens detail modal
            card.addEventListener("click", () => openStoryModal(item));

            // Bookmark button removes from saved
            card.querySelector(".card-bookmark-btn")?.addEventListener("click", (e) => {
                e.stopPropagation();
                toggleBookmark(item);
            });

            savedGrid.appendChild(card);
        });
    }

    // -------------------------------------------------------------
    // CATEGORY VIEWS CONTROLLER
    // -------------------------------------------------------------
    function renderCategoryViews(activeCategoryFilter = null) {
        const categories = ["today", "newsplus", "world", "business", "sports", "factcheck"];
        const featuredSlideMap = {
            "today": [0, 3],
            "newsplus": [1],
            "world": [2],
            "business": [0, 2],
            "sports": [1, 3],
            "factcheck": [0]
        };

        categories.forEach(catKey => {
            if (activeCategoryFilter && activeCategoryFilter !== catKey && activeCategoryFilter !== "home") return;

            const domId = catKey.replace("+", "plus") + "-news-grid";
            const grid = document.getElementById(domId);
            if (!grid) return;

            if (liveNewsPool.length === 0) {
                grid.innerHTML = `<p class="empty-saved-msg">No stories currently loaded in this index.</p>`;
                return;
            }

            let filtered = liveNewsPool.filter(item => {
                const c = (item.category || "").toLowerCase();
                const t = (item.title || "").toLowerCase();

                if (catKey === "today" || catKey === "newsplus") return true;
                if (catKey === "world") return c.includes("world") || t.includes("us") || t.includes("global") || t.includes("nepal") || t.includes("china");
                if (catKey === "business") return c.includes("business") || c.includes("tech") || t.includes("bank") || t.includes("stock") || t.includes("market");
                if (catKey === "sports") return c.includes("sports") || t.includes("cricket") || t.includes("match") || t.includes("kohli");
                if (catKey === "factcheck") return c.includes("fact") || t.includes("claim") || t.includes("check") || t.includes("report");
                return true;
            });

            if (filtered.length === 0) filtered = liveNewsPool.slice(0, 8);

            grid.innerHTML = "";
            const targetFeaturedIndexes = featuredSlideMap[catKey] || [0];

            filtered.forEach((s, idx) => {
                const headline = s.title || "Headline Unavailable";
                const imgUrl = s.image || FALLBACK_IMG;
                const sourceBadge = s.source || s.category || catKey.toUpperCase();
                const timeLoc = `${s.source || 'SATYA'} • ${formatPublishDate(s.publishedAt)}`;
                const articleId = String(s.id);
                const isSaved = isArticleSaved(articleId);

                const article = document.createElement("article");
                const isFeatured = targetFeaturedIndexes.includes(idx);
                article.className = `news-card liquid-slide ${isFeatured ? 'featured-slide' : ''}`;

                article.innerHTML = `
                    <button class="card-bookmark-btn ${isSaved ? 'saved' : ''}" data-article-id="${articleId}" aria-label="Save story" title="Save story">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="${isSaved ? '#fff' : 'none'}" stroke="currentColor" stroke-width="2.2">
                            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                        </svg>
                    </button>
                    <img src="${imgUrl}" alt="${escapeHtml(headline)}" onerror="this.src='${FALLBACK_IMG}'">
                    <div class="news-content">
                        <span class="category">${isFeatured ? 'FEATURED STORY' : escapeHtml(sourceBadge)}</span>
                        <h3>${escapeHtml(headline)}</h3>
                        <p>${escapeHtml(timeLoc)}</p>
                    </div>
                `;

                article.addEventListener("click", () => openStoryModal(s));
                article.querySelector(".card-bookmark-btn")?.addEventListener("click", (e) => {
                    e.stopPropagation();
                    toggleBookmark(s);
                });

                grid.appendChild(article);
            });
        });
    }

    navItems.forEach((item) => {
        item.addEventListener("click", () => {
            if (item.classList.contains("ai-button")) return;
            const labelSpan = item.querySelector("span");
            if (labelSpan) switchTab(labelSpan.textContent.trim());
        });
    });

    const initialActive = document.querySelector(".bottom-glass-nav .nav-item.active");
    if (initialActive) setTimeout(() => updatePillPosition(initialActive), 100);

    window.addEventListener("resize", () => {
        const currentActive = document.querySelector(".bottom-glass-nav .nav-item.active");
        if (currentActive) updatePillPosition(currentActive);
    });

    document.getElementById("brand-logo")?.addEventListener("click", () => switchTab("Home"));

    // -------------------------------------------------------------
    // HERO STORY CAROUSEL
    // -------------------------------------------------------------
    const mainStory = document.getElementById("hero-article-card");
    const heroImg = document.getElementById("hero-img");
    const heroTag = document.getElementById("hero-tag");
    const heroLocation = document.getElementById("hero-location");
    const heroHeadline = document.getElementById("hero-headline");
    const heroDescription = document.getElementById("hero-desc");
    const dots = document.querySelectorAll(".carousel-dots .dot");
    const heroReadBtn = document.getElementById("hero-read-btn");

    function renderHeroStory(index) {
        if (!mainStory || !heroImg || stories.length === 0) return;

        mainStory.classList.add("fade-out");

        setTimeout(() => {
            const story = stories[index];
            if (story) {
                heroImg.src = story.image || FALLBACK_IMG;
                heroImg.alt = story.title || "Top Story";
                if (heroTag) heroTag.textContent = story.source || story.category || "TOP STORY";
                if (heroLocation) heroLocation.textContent = `${story.source} • ${formatPublishDate(story.publishedAt)}`;
                if (heroHeadline) heroHeadline.textContent = story.title || "Headline Loading";
                if (heroDescription) heroDescription.textContent = story.description || story.content || "";

                // Hero bookmark sync
                const isSaved = isArticleSaved(story.id);
                const heroBtn = document.getElementById("hero-bookmark-btn");
                const heroText = document.getElementById("hero-bookmark-text");
                if (heroBtn) heroBtn.classList.toggle("saved", isSaved);
                if (heroText) heroText.textContent = isSaved ? "Saved" : "Save";
            }

            dots.forEach((dot, idx) => dot.classList.toggle("active", idx === index));
            mainStory.classList.remove("fade-out");

            renderTopRightSlideUI(index);
        }, 180);
    }

    function startAutoSlide() {
        stopAutoSlide();
        autoSlideTimer = setInterval(() => {
            if (stories.length > 0) {
                currentStoryIndex = (currentStoryIndex + 1) % stories.length;
                renderHeroStory(currentStoryIndex);
            }
        }, 25000);
    }

    function stopAutoSlide() {
        if (autoSlideTimer) {
            clearInterval(autoSlideTimer);
            autoSlideTimer = null;
        }
    }

    dots.forEach((dot, index) => {
        dot.addEventListener("click", (e) => {
            e.stopPropagation();
            if (currentStoryIndex === index || index >= stories.length) return;
            currentStoryIndex = index;
            renderHeroStory(currentStoryIndex);
            startAutoSlide();
        });
    });

    heroReadBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        const activeStory = stories[currentStoryIndex];
        if (activeStory) openStoryModal(activeStory);
    });

    mainStory?.addEventListener("click", () => {
        const activeStory = stories[currentStoryIndex];
        if (activeStory) openStoryModal(activeStory);
    });

    // -------------------------------------------------------------
    // TRENDING & LATEST NEWS GRIDS
    // -------------------------------------------------------------
    function renderTrendingUI() {
        const trendContainer = document.querySelector(".liquid-slide.trending");
        if (!trendContainer || trendingStories.length === 0) return;

        const trendItems = trendContainer.querySelectorAll(".trend-item");
        trendItems.forEach((item, index) => {
            const data = trendingStories[index];
            if (!data) return;

            const img = item.querySelector("img");
            const h4 = item.querySelector("h4");
            const p = item.querySelector("p");

            if (img) img.src = data.image || img.src;
            if (h4) h4.textContent = data.title || h4.textContent;
            if (p) p.textContent = `${data.source} • ${formatPublishDate(data.publishedAt)}`;

            item.onclick = () => openStoryModal(data);
        });
    }

    function renderLatestUI() {
        const latestGrid = document.querySelector(".latest-section .news-grid");
        if (!latestGrid || latestStories.length === 0) return;

        latestGrid.innerHTML = "";
        latestStories.slice(0, 8).forEach((data) => {
            const articleId = String(data.id);
            const isSaved = isArticleSaved(articleId);

            const card = document.createElement("article");
            card.className = "news-card liquid-slide";
            card.innerHTML = `
                <button class="card-bookmark-btn ${isSaved ? 'saved' : ''}" data-article-id="${articleId}" aria-label="Save story" title="Save story">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="${isSaved ? '#fff' : 'none'}" stroke="currentColor" stroke-width="2.2">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                    </svg>
                </button>
                <img src="${data.image || FALLBACK_IMG}" alt="${escapeHtml(data.title)}" onerror="this.src='${FALLBACK_IMG}'">
                <div class="news-content">
                    <span class="category">${escapeHtml(data.source || data.category || 'LATEST')}</span>
                    <h3>${escapeHtml(data.title || 'Headline')}</h3>
                    <p>${formatPublishDate(data.publishedAt)}</p>
                </div>
            `;

            card.addEventListener("click", () => openStoryModal(data));
            card.querySelector(".card-bookmark-btn")?.addEventListener("click", (e) => {
                e.stopPropagation();
                toggleBookmark(data);
            });

            latestGrid.appendChild(card);
        });
    }

    // -------------------------------------------------------------
    // NOTIFICATIONS & SEARCH MODAL
    // -------------------------------------------------------------
    const notifBtn = document.getElementById("notif-btn");
    const notifDropdown = document.getElementById("notif-dropdown");
    const clearNotifs = document.getElementById("clear-notifs");

    notifBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        notifDropdown?.classList.toggle("show");
        userDropdown?.classList.remove("show");
    });

    clearNotifs?.addEventListener("click", () => {
        const notifBadge = document.getElementById("notif-badge");
        if (notifBadge) notifBadge.style.display = "none";
        const notifList = document.getElementById("notif-list");
        if (notifList) {
            notifList.innerHTML = `<div class="notif-item"><p class="notif-text" style="color:#777;">No new notifications</p></div>`;
        }
    });

    document.addEventListener("click", (e) => {
        if (notifDropdown && !notifDropdown.contains(e.target) && e.target !== notifBtn) {
            notifDropdown.classList.remove("show");
        }
        if (userDropdown && !userDropdown.contains(e.target) && e.target !== userProfileBtn) {
            userDropdown.classList.remove("show");
        }
    });

    const searchBtn = document.getElementById("search-btn");
    const searchInput = document.getElementById("search-input");
    const searchResults = document.getElementById("search-results");

    function triggerSearchModalWithQuery(query = "") {
        openModal("search-modal");
        if (searchInput) {
            searchInput.value = query;
            if (query) performSearch(query);
            else searchResults.innerHTML = `<p class="search-hint">Type a query above to filter stories across SATYA indexes.</p>`;
            setTimeout(() => searchInput.focus(), 50);
        }
    }

    searchBtn?.addEventListener("click", () => triggerSearchModalWithQuery());

    function performSearch(query) {
        const cleanQuery = query.trim().toLowerCase();
        if (!cleanQuery) {
            searchResults.innerHTML = `<p class="search-hint">Type a query above to filter stories across SATYA indexes.</p>`;
            return;
        }

        const filtered = liveNewsPool.filter(item => {
            const titleStr = (item.title || "").toLowerCase();
            const descStr = (item.description || "").toLowerCase();
            const sourceStr = (item.source || "").toLowerCase();
            return titleStr.includes(cleanQuery) || descStr.includes(cleanQuery) || sourceStr.includes(cleanQuery);
        });

        if (!filtered || filtered.length === 0) {
            searchResults.innerHTML = `<p class="search-hint">No verified reports matching "${escapeHtml(query)}".</p>`;
        } else {
            searchResults.innerHTML = "";
            filtered.forEach(item => {
                const title = item.title || "Untitled Result";
                const meta = `${item.source || 'SATYA'} • ${formatPublishDate(item.publishedAt)}`;
                const resDiv = document.createElement("div");
                resDiv.className = "search-result-item";
                resDiv.innerHTML = `
                    <h4>${escapeHtml(title)}</h4>
                    <p>${escapeHtml(meta)}</p>
                `;
                resDiv.addEventListener("click", () => openStoryModal(item));
                searchResults.appendChild(resDiv);
            });
        }
    }

    let searchTimeout = null;
    searchInput?.addEventListener("input", (e) => {
        const query = e.target.value;
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => performSearch(query), 200);
    });

    // -------------------------------------------------------------
    // SIRI-STYLE SATYA SYSTEM INTELLIGENCE CONTROLLER
    // -------------------------------------------------------------
    let lastReferencedArticles = [];
    let conversationHistory = [];

    const ALLOWED_ACTIONS = new Set([
        "NAVIGATE_TAB",
        "OPEN_CATEGORY",
        "GO_HOME",
        "OPEN_SAVED",
        "OPEN_TODAY",
        "OPEN_WORLD",
        "OPEN_BUSINESS",
        "OPEN_SPORTS",
        "OPEN_FACT_CHECK",
        "SHOW_FACT_CHECK",
        "OPEN_NEWS_PLUS",
        "SHOW_TRENDING",
        "SHOW_LATEST",
        "SCROLL_TO_SECTION",
        "SEARCH_NEWS",
        "OPEN_ARTICLE",
        "SAVE_ARTICLE",
        "DELETE_SAVED_ARTICLE",
        "PROMPT_SIGN_IN"
    ]);

    function executeAIAction(action) {
        if (!action || typeof action !== "object" || !action.type) return;
        const type = String(action.type).toUpperCase().trim();
        if (!ALLOWED_ACTIONS.has(type)) {
            console.warn("[SATYA AI] Ignored non-whitelisted action:", type);
            return;
        }

        const target = action.target ? String(action.target).toLowerCase().trim() : "";

        switch (type) {
            case "NAVIGATE_TAB":
            case "OPEN_CATEGORY":
                if (target) switchTab(target);
                break;
            case "GO_HOME":
                switchTab("Home");
                break;
            case "OPEN_SAVED":
                switchTab("Saved");
                break;
            case "OPEN_TODAY":
                switchTab("Today");
                break;
            case "OPEN_WORLD":
                switchTab("World");
                break;
            case "OPEN_BUSINESS":
                switchTab("Business");
                break;
            case "OPEN_SPORTS":
                switchTab("Sports");
                break;
            case "OPEN_NEWS_PLUS":
                switchTab("News+");
                break;
            case "OPEN_FACT_CHECK":
            case "SHOW_FACT_CHECK":
                switchTab("Fact Check");
                if (action.query || action.target) {
                    setTimeout(() => handleLiveClaimVerification(action.query || action.target), 300);
                }
                break;
            case "SHOW_TRENDING":
                switchTab("Home");
                document.querySelector(".liquid-slide.trending")?.scrollIntoView({ behavior: "smooth" });
                break;
            case "SHOW_LATEST":
                switchTab("Home");
                document.querySelector(".latest-section")?.scrollIntoView({ behavior: "smooth" });
                break;
            case "SCROLL_TO_SECTION":
                if (target === "latest") {
                    document.querySelector(".latest-section")?.scrollIntoView({ behavior: "smooth" });
                } else if (target === "trending") {
                    document.querySelector(".liquid-slide.trending")?.scrollIntoView({ behavior: "smooth" });
                } else if (target === "hero") {
                    document.querySelector(".hero-section")?.scrollIntoView({ behavior: "smooth" });
                }
                break;
            case "SEARCH_NEWS":
                triggerSearchModalWithQuery(action.query || target || "");
                break;
            case "OPEN_ARTICLE":
                const targetArticle = liveNewsPool.find(a => (a.title || "").toLowerCase().includes(target)) || stories[0];
                if (targetArticle) openStoryModal(targetArticle);
                break;
            case "SAVE_ARTICLE":
                if (action.payload) {
                    const artId = String(action.payload.id || action.payload.articleId);
                    if (!savedArticlesMap.has(artId)) {
                        toggleBookmark(action.payload);
                    }
                }
                break;
            case "DELETE_SAVED_ARTICLE":
                if (action.payload) {
                    const artId = String(action.payload.id || action.payload.articleId);
                    if (savedArticlesMap.has(artId)) {
                        toggleBookmark(action.payload);
                    }
                }
                break;
            case "PROMPT_SIGN_IN":
                openModal("auth-modal");
                break;
            default:
                break;
        }
    }

    const aiBtn = document.getElementById("ai-trigger-btn");
    const aiInput = document.getElementById("ai-input");
    const aiChatBody = document.getElementById("ai-chat-body");
    const aiSendBtn = document.getElementById("ai-send-btn");

    aiBtn?.addEventListener("click", () => openModal("ai-modal"));

    async function handleAiSubmit() {
        if (!aiInput || !aiChatBody) return;
        const text = aiInput.value.trim();
        if (!text) return;

        const userMsg = document.createElement("div");
        userMsg.className = "ai-msg user";
        userMsg.innerHTML = `<p>${escapeHtml(text)}</p>`;
        aiChatBody.appendChild(userMsg);

        aiInput.value = "";
        aiChatBody.scrollTop = aiChatBody.scrollHeight;

        const loadingMsg = document.createElement("div");
        loadingMsg.className = "ai-msg bot loading";
        loadingMsg.innerHTML = `<p><em>Analyzing SATYA Intelligence dataset...</em></p>`;
        aiChatBody.appendChild(loadingMsg);
        aiChatBody.scrollTop = aiChatBody.scrollHeight;

        const activeTabName = document.querySelector(".bottom-glass-nav .nav-item.active span")?.textContent?.trim() || "Home";
        const clientContext = {
            currentTab: activeTabName,
            currentArticle: activeModalArticle,
            authenticated: !!currentUser,
            userProfile: currentUser ? {
                displayName: currentUser.displayName || "SATYA Reader",
                email: currentUser.email || ""
            } : null,
            savedArticles: currentUser ? Array.from(savedArticlesMap.values()).map(a => ({
                articleId: a.articleId || a.id,
                title: a.title,
                source: a.source,
                category: a.category,
                savedAt: a.savedAt,
                publishedAt: a.publishedAt,
                verifiedStatus: a.verifiedStatus
            })) : [],
            lastReferencedArticles: lastReferencedArticles
        };

        try {
            const response = await fetch(AI_API, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    prompt: text,
                    clientContext: clientContext,
                    conversationHistory: conversationHistory
                })
            });

            if (aiChatBody.contains(loadingMsg)) {
                aiChatBody.removeChild(loadingMsg);
            }

            const botMsg = document.createElement("div");
            botMsg.className = "ai-msg bot";

            if (response.status === 429) {
                botMsg.innerHTML = `<p style="color:#e53935;">SATYA AI is receiving too many requests. Please try again shortly.</p>`;
            } else if (response.ok) {
                const data = await response.json();
                const aiReply = data.reply || data.response || "Verified analysis complete.";
                
                // Natural response presentation without exposing internal technical labels
                botMsg.innerHTML = `<p>${escapeHtml(aiReply).replace(/\n/g, '<br>')}</p>`;

                if (Array.isArray(data.referencedArticles) && data.referencedArticles.length > 0) {
                    lastReferencedArticles = data.referencedArticles;
                }

                conversationHistory.push({ role: "user", content: text });
                conversationHistory.push({ role: "assistant", content: aiReply });
                if (conversationHistory.length > 10) conversationHistory = conversationHistory.slice(-10);

                if (data.uiAction) {
                    executeAIAction(data.uiAction);
                } else if (Array.isArray(data.actions)) {
                    data.actions.forEach(act => executeAIAction(act));
                }
            } else {
                botMsg.innerHTML = `<p>SATYA AI currently does not have enough verified information about this event in its available sources.</p>`;
            }

            aiChatBody.appendChild(botMsg);
        } catch (err) {
            console.error("AI Error:", err);
            if (aiChatBody.contains(loadingMsg)) {
                aiChatBody.removeChild(loadingMsg);
            }
            const botMsg = document.createElement("div");
            botMsg.className = "ai-msg bot";
            botMsg.innerHTML = `<p>SATYA AI currently does not have enough verified information about this event in its available sources.</p>`;
            aiChatBody.appendChild(botMsg);
        }

        aiChatBody.scrollTop = aiChatBody.scrollHeight;
    }

    aiSendBtn?.addEventListener("click", handleAiSubmit);
    aiInput?.addEventListener("keypress", (e) => {
        if (e.key === "Enter") handleAiSubmit();
    });

    document.getElementById("view-timeline-btn")?.addEventListener("click", () => {
        const detailBody = document.getElementById("detail-modal-body");
        if (!detailBody) return;

        detailBody.innerHTML = `
            <h2>Live Development Timeline</h2>
            <div class="detail-meta"><span>Multi-Source Tracker</span></div>
            <div class="timeline" style="margin-top: 20px;">
                <div class="timeline-item"><span class="time">Live</span><div class="timeline-dot active"></div><p>NDTV, TOI, BBC India feeds synced successfully.</p></div>
                <div class="timeline-item"><span class="time">Live</span><div class="timeline-dot active"></div><p>${liveNewsPool.length} articles indexed into SATYA Engine.</p></div>
            </div>
        `;
        openModal("detail-modal");
    });

    document.getElementById("view-trending-all")?.addEventListener("click", () => switchTab("News+"));
    document.getElementById("view-latest-all")?.addEventListener("click", () => switchTab("Today"));

    // -------------------------------------------------------------
    // INTERACTIVE FACT CHECK CLAIM VERIFICATION
    // -------------------------------------------------------------
    const liveClaimInput = document.getElementById("live-claim-input");
    const verifyClaimBtn = document.getElementById("verify-claim-btn");
    const liveClaimResult = document.getElementById("live-claim-result");

    async function handleLiveClaimVerification(queryClaim = null) {
        const claim = queryClaim || (liveClaimInput ? liveClaimInput.value.trim() : "");
        if (!claim || !liveClaimResult) return;

        if (liveClaimInput) liveClaimInput.value = claim;
        liveClaimResult.style.display = "block";
        liveClaimResult.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px; color:#555;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin-icon"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                <span>Auditing claim against live multi-source SATYA feeds with Gemini engine...</span>
            </div>
        `;

        try {
            const response = await fetch(FACT_CHECK_API, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ claim })
            });

            if (response.status === 429) {
                liveClaimResult.innerHTML = `
                    <div style="color:#e53935; font-weight:600;">
                        SATYA AI is receiving too many requests. Please try again shortly.
                    </div>
                `;
                return;
            }

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const result = await response.json();
            const status = result.verificationStatus || "SUPPORTED";
            const explanation = result.explanation || "Verification analysis completed.";
            const sources = Array.isArray(result.verifiedSources) ? result.verifiedSources : [];

            let statusColor = "#1b5e20";
            if (status === "CONFLICTING") statusColor = "#b71c1c";
            else if (status === "SUPPORTED") statusColor = "#0d47a1";
            else if (status === "UNVERIFIED" || status === "INSUFFICIENT_EVIDENCE") statusColor = "#616161";

            liveClaimResult.innerHTML = `
                <div style="border-left: 4px solid ${statusColor}; padding-left: 14px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px;">
                        <span style="font-size: 11px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; color: ${statusColor}; background: rgba(0,0,0,0.05); padding: 4px 10px; border-radius: 12px;">
                            ${escapeHtml(status)}
                        </span>
                        <span style="font-size: 11px; color: #777;">Confidence: ${escapeHtml(result.confidence || 'MEDIUM')}</span>
                    </div>
                    <h4 style="font-size: 14px; font-weight: 700; color: #111; margin-bottom: 6px;">Claim: "${escapeHtml(claim)}"</h4>
                    <p style="font-size: 13px; color: #333; line-height: 1.5; margin-bottom: 8px;">${escapeHtml(explanation)}</p>
                    ${sources.length > 0 ? `
                        <div style="font-size: 11.5px; color: #666;">
                            <strong>Cross-Referenced Outlets:</strong> ${sources.map(s => `<span style="display:inline-block; margin-left:4px; padding:2px 8px; background:rgba(0,0,0,0.06); border-radius:10px; font-weight:600;">${escapeHtml(s)}</span>`).join(' ')}
                        </div>
                    ` : ''}
                </div>
            `;
        } catch (err) {
            console.warn("[SATYA CLAIM CHECK WARN]:", err);
            liveClaimResult.innerHTML = `
                <p style="color:#666; font-size:13px;">Verification service temporarily unavailable. Please try again shortly.</p>
            `;
        }
    }

    verifyClaimBtn?.addEventListener("click", () => handleLiveClaimVerification());
    liveClaimInput?.addEventListener("keypress", (e) => {
        if (e.key === "Enter") handleLiveClaimVerification();
    });

    // Initial Load
    loadNewsData();
});
