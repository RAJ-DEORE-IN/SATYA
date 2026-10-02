/**
 * SATYA — News with truth.
 * Full-stack Client Controller with Evidence Intelligence & Firebase Authentication
 * 
 * Philosophy: News + Evidence + Verification + Context
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
    const TRENDING_API = `${API_BASE}/api/trending`;
    const AI_API = `${API_BASE}/api/ai-chat`;
    const FACT_CHECK_API = `${API_BASE}/api/fact-check`;
    const RUMOR_API = `${API_BASE}/api/rumor-firewall`;
    const COMPARE_API = `${API_BASE}/api/compare`;
    const CORRECTIONS_API = `${API_BASE}/api/corrections`;

    // -------------------------------------------------------------
    // CENTRAL APPLICATION STATE
    // -------------------------------------------------------------
    const appState = {
        currentTab: "home",
        previousTab: "home",
        activeModalArticle: null,
        isTransitioning: false,
        currentUser: null,
        savedFilterCategory: "ALL",
        savedSearchQuery: "",
        savedSortMode: "recent-saved",
        recentArticlesViewed: [],
        categoryVisitCounts: {}
    };

    const savedArticlesMap = new Map(); // articleId -> article record
    let liveNewsPool = [];
    let stories = [];
    let trendingStories = [];
    let latestStories = [];
    let currentStoryIndex = 0;
    let autoSlideTimer = null;
    let lastReferencedArticles = [];
    let conversationHistory = [];

    const FALLBACK_IMG = "https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1000&q=80";

    // -------------------------------------------------------------
    // UTILITY HELPERS
    // -------------------------------------------------------------
    function escapeHtml(str) {
        if (!str || typeof str !== 'string') return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getStableArticleId(item, indexFallback = 0) {
        if (item && item.id) return String(item.id);
        const titleStr = (item?.title || "").trim();
        const sourceStr = (item?.source || "").trim();
        if (titleStr) {
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
            } else {
                seenImages.add(img);
            }
            return {
                ...item,
                id: articleId,
                image: img
            };
        });
    }

    function formatPublishDate(isoString) {
        if (!isoString) return "Just now";
        try {
            const pubDate = new Date(isoString);
            if (isNaN(pubDate.getTime())) return "Live";
            const now = new Date();
            const diffMs = now - pubDate;
            const minutes = Math.floor(diffMs / (1000 * 60));
            const hours = Math.floor(diffMs / (1000 * 60 * 60));

            if (minutes < 2) return "Just now";
            if (minutes < 60) return `${minutes}m ago`;
            if (hours < 24) return `${hours}h ago`;

            return pubDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        } catch (e) {
            return "Just now";
        }
    }

    function formatTimeOnly(isoString) {
        if (!isoString) return "Live";
        try {
            const pubDate = new Date(isoString);
            if (isNaN(pubDate.getTime())) return "Live";
            return pubDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return "Live";
        }
    }

    function updateLiveHeaderClock() {
        const dateEl = document.getElementById("live-date");
        if (!dateEl) return;
        const now = new Date();
        const options = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' };
        dateEl.textContent = `${now.toLocaleDateString('en-IN', options)} IST`;
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
                transition: opacity 0.3s ease, transform 0.3s ease;
                max-width: 90vw;
                text-align: center;
                pointer-events: none;
            `;
            document.body.appendChild(banner);
        }
        banner.style.background = isError ? "rgba(229, 57, 53, 0.95)" : "rgba(28, 28, 30, 0.95)";
        banner.style.backdropFilter = "blur(14px)";
        banner.textContent = message;
        banner.style.display = "block";
        banner.style.opacity = "1";

        setTimeout(() => {
            banner.style.opacity = "0";
            setTimeout(() => { banner.style.display = "none"; }, 300);
        }, 3800);
    }

    // -------------------------------------------------------------
    // CENTRAL ROUTER & NAVIGATION SYSTEM
    // -------------------------------------------------------------
    const navItems = document.querySelectorAll(".bottom-glass-nav .nav-item");
    const activePill = document.getElementById("activePill");
    const stripItems = document.querySelectorAll(".sub-nav-strip .strip-item");

    const viewMap = {
        "home": "home-view",
        "today": "today-view",
        "newsplus": "newsplus-view",
        "news+": "newsplus-view",
        "evidence": "evidence-view",
        "world": "world-view",
        "business": "business-view",
        "sports": "sports-view",
        "factcheck": "factcheck-view",
        "fact check": "factcheck-view",
        "rumor": "rumor-view",
        "rumor firewall": "rumor-view",
        "corrections": "corrections-view",
        "saved": "saved-view"
    };

    function updatePillPosition(targetItem) {
        if (!activePill || !targetItem || targetItem.classList.contains("ai-button")) {
            if (activePill) activePill.style.opacity = "0";
            return;
        }

        const parentNav = targetItem.parentElement;
        if (!parentNav) return;
        const navRect = parentNav.getBoundingClientRect();
        const itemRect = targetItem.getBoundingClientRect();

        const offsetLeft = itemRect.left - navRect.left;
        const itemWidth = itemRect.width;

        activePill.style.opacity = "1";
        activePill.style.transform = `translateX(${offsetLeft}px)`;
        activePill.style.width = `${itemWidth}px`;
    }

    function switchTab(selectedTabName, updateHistory = true) {
        if (!selectedTabName) return;
        const cleanName = selectedTabName.trim().toLowerCase();
        const targetViewId = viewMap[cleanName];

        if (!targetViewId) {
            console.warn("[SATYA ROUTER] Unknown tab route:", cleanName);
            return;
        }

        if (appState.isTransitioning) return;
        if (appState.currentTab === cleanName) return;

        const currentViewId = viewMap[appState.currentTab] || "home-view";
        const currentView = document.getElementById(currentViewId);
        const targetView = document.getElementById(targetViewId);

        if (!targetView) return;

        appState.isTransitioning = true;
        appState.previousTab = appState.currentTab;
        appState.currentTab = cleanName;

        if (updateHistory) {
            history.pushState({ tab: cleanName }, `SATYA — ${cleanName.toUpperCase()}`, `#${cleanName}`);
        }

        // Close any open modals when navigating
        closeAllModals();

        // Animate transition
        if (currentView) {
            currentView.classList.add("view-leaving");
            currentView.classList.remove("active-view");
        }

        setTimeout(() => {
            document.querySelectorAll(".tab-view").forEach(v => {
                v.style.display = "none";
                v.classList.remove("view-leaving");
                v.classList.remove("active-view");
            });

            targetView.style.display = "block";
            void targetView.offsetWidth; // trigger reflow
            targetView.classList.add("active-view");

            // Synchronize bottom glass nav
            let activeNavItem = null;
            navItems.forEach(item => {
                const tabAttr = (item.getAttribute("data-tab") || "").toLowerCase();
                const spanText = (item.querySelector("span")?.textContent || "").toLowerCase();
                if (tabAttr === cleanName || spanText === cleanName || (cleanName === "newsplus" && spanText === "news+")) {
                    item.classList.add("active");
                    activeNavItem = item;
                } else {
                    item.classList.remove("active");
                }
            });

            if (activeNavItem) {
                updatePillPosition(activeNavItem);
            } else if (activePill) {
                activePill.style.opacity = "0";
            }

            // Synchronize sub-nav strip
            stripItems.forEach(stripBtn => {
                const tab = (stripBtn.getAttribute("data-tab") || "").toLowerCase();
                if (tab === cleanName || (cleanName === "newsplus" && tab === "news+")) {
                    stripBtn.classList.add("active");
                    stripBtn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
                } else {
                    stripBtn.classList.remove("active");
                }
            });

            // Trigger specific tab renderers
            triggerViewLifecycle(cleanName);

            // Scroll window to top
            window.scrollTo({ top: 0, behavior: "smooth" });

            appState.isTransitioning = false;
        }, 180);
    }

    function triggerViewLifecycle(tabName) {
        switch (tabName) {
            case "home":
                renderTrendingUI();
                renderLatestUI();
                break;
            case "today":
                renderTodayBriefing();
                break;
            case "newsplus":
                renderEventClusters();
                break;
            case "evidence":
                renderEvidenceWorkspace();
                break;
            case "factcheck":
                renderFactCheckView();
                break;
            case "rumor":
                // Ready for user input
                break;
            case "corrections":
                loadAndRenderCorrections();
                break;
            case "saved":
                renderSavedArticlesView();
                break;
            default:
                renderCategoryView(tabName);
                break;
        }
    }

    // Window back/forward navigation handler
    window.addEventListener("popstate", (e) => {
        const hash = window.location.hash.replace("#", "") || "home";
        switchTab(hash, false);
    });

    // Wire brand logo to Return Home
    document.getElementById("brand-logo")?.addEventListener("click", () => switchTab("home"));
    document.getElementById("brand-logo-area")?.addEventListener("click", () => switchTab("home"));

    // Wire sub-nav strip items
    stripItems.forEach(btn => {
        btn.addEventListener("click", () => {
            const tab = btn.getAttribute("data-tab");
            if (tab) switchTab(tab);
        });
    });

    // Wire bottom glass nav items
    navItems.forEach(item => {
        if (item.classList.contains("ai-button")) return;
        item.addEventListener("click", () => {
            const tab = item.getAttribute("data-tab");
            if (tab) switchTab(tab);
        });
    });

    // Scroll reactive minimization of floating bottom navigation
    let lastScrollY = window.scrollY;
    const glassNav = document.getElementById("glassNav");

    window.addEventListener("scroll", () => {
        const currentY = window.scrollY;
        if (!glassNav) return;

        if (currentY > lastScrollY && currentY > 120) {
            // Scrolling down -> gently minimize
            glassNav.classList.add("nav-minimized");
        } else {
            // Scrolling up -> restore
            glassNav.classList.remove("nav-minimized");
        }
        lastScrollY = currentY;
    }, { passive: true });

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

    function updateAuthUI(user) {
        if (user) {
            const photo = user.photoURL || DEFAULT_AVATAR;
            const name = user.displayName || (user.isGuest ? "Verified Reader (Guest)" : "SATYA Reader");
            const email = user.email || (user.isGuest ? "Guest Session Active" : "");

            if (userAvatar) userAvatar.src = photo;
            if (dropdownAvatar) dropdownAvatar.src = photo;
            if (dropdownUserName) dropdownUserName.textContent = name;
            if (dropdownUserEmail) dropdownUserEmail.textContent = email;
            if (dropdownAuthBtn) {
                dropdownAuthBtn.innerHTML = `<span>Sign Out</span>`;
                dropdownAuthBtn.className = "dropdown-btn secondary";
            }
        } else {
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
        }
        updateAllBookmarkButtonStates();
        if (appState.currentTab === "saved") {
            renderSavedArticlesView();
        }
    }

    onAuthChange(async (user) => {
        if (user) {
            console.log("[SATYA AUTH] Logged in as:", user.displayName || user.email);
            appState.currentUser = user;
            updateAuthUI(user);
            await syncUserSavedArticles();
        } else if (!appState.currentUser || !appState.currentUser.isGuest) {
            console.log("[SATYA AUTH] Signed out / Guest session");
            appState.currentUser = null;
            savedArticlesMap.clear();
            updateAuthUI(null);
        }
    });

    async function syncUserSavedArticles() {
        if (!appState.currentUser || appState.currentUser.isGuest) return;
        try {
            const articles = await getUserSavedArticles(appState.currentUser.uid);
            savedArticlesMap.clear();
            articles.forEach(art => {
                if (art && art.articleId) {
                    savedArticlesMap.set(String(art.articleId), art);
                }
            });
            updateAllBookmarkButtonStates();
            if (appState.currentTab === "saved") {
                renderSavedArticlesView();
            }
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
        if (appState.currentUser) {
            try {
                if (appState.currentUser.isGuest) {
                    appState.currentUser = null;
                    localStorage.removeItem("satya_guest_user");
                    savedArticlesMap.clear();
                    updateAuthUI(null);
                    showBannerMessage("Signed out of Guest session.");
                } else {
                    await signOutUser();
                    showBannerMessage("Signed out of SATYA.");
                }
            } catch (err) {
                showBannerMessage("Sign out error: " + err.message, true);
            }
        } else {
            openModal("auth-modal");
        }
    });

    dropdownSavedBtn?.addEventListener("click", () => {
        userDropdown?.classList.remove("show");
        switchTab("saved");
    });

    googleSigninBtn?.addEventListener("click", async () => {
        if (authStatusMsg) authStatusMsg.textContent = "Connecting with Google...";
        const domainNotice = document.getElementById("domain-whitelist-notice");
        const domainCode = document.getElementById("current-domain-code");
        if (domainNotice) domainNotice.style.display = "none";

        try {
            const user = await signInWithGoogle();
            if (user) {
                closeModal("auth-modal");
                showBannerMessage(`Signed in as ${user.displayName || user.email}`);
            }
        } catch (err) {
            console.error("[SATYA AUTH SIGNIN ERROR]:", err);
            if (err.code === "auth/unauthorized-domain") {
                if (authStatusMsg) {
                    authStatusMsg.textContent = "Domain authorization required in Firebase Console.";
                }
                if (domainNotice && domainCode) {
                    domainCode.textContent = window.location.hostname;
                    domainNotice.style.display = "block";
                }
            } else if (err.code === "auth/popup-closed-by-user") {
                if (authStatusMsg) authStatusMsg.textContent = "Sign-in cancelled.";
            } else {
                if (authStatusMsg) authStatusMsg.textContent = err.message || "Failed to sign in.";
            }
        }
    });

    document.getElementById("guest-signin-btn")?.addEventListener("click", () => {
        const guestUser = {
            uid: "guest-reader-" + Math.random().toString(36).substring(2, 9),
            displayName: "Verified Reader (Guest)",
            email: "reader@satya.local",
            isGuest: true
        };
        appState.currentUser = guestUser;
        localStorage.setItem("satya_guest_user", JSON.stringify(guestUser));
        updateAuthUI(guestUser);
        closeModal("auth-modal");
        showBannerMessage("Signed in as Verified Reader (Guest Mode). Bookmarks & AI active.");
    });

    document.getElementById("copy-domain-btn")?.addEventListener("click", () => {
        navigator.clipboard.writeText(window.location.hostname).then(() => {
            const btn = document.getElementById("copy-domain-btn");
            if (btn) btn.textContent = "Copied!";
            setTimeout(() => { if (btn) btn.textContent = "Copy"; }, 2000);
        });
    });

    closeAuthBtn?.addEventListener("click", () => closeModal("auth-modal"));

    // Check for saved guest session on boot
    try {
        const storedGuest = localStorage.getItem("satya_guest_user");
        if (storedGuest) {
            const parsedGuest = JSON.parse(storedGuest);
            appState.currentUser = parsedGuest;
            const storedBookmarks = localStorage.getItem("satya_guest_bookmarks");
            if (storedBookmarks) {
                const entries = JSON.parse(storedBookmarks);
                savedArticlesMap.clear();
                entries.forEach(([id, rec]) => savedArticlesMap.set(id, rec));
            }
            updateAuthUI(parsedGuest);
        }
    } catch (e) {}

    // -------------------------------------------------------------
    // BOOKMARK / SAVED ARTICLES SYSTEM
    // -------------------------------------------------------------
    async function toggleBookmark(article) {
        if (!article) return;
        if (!appState.currentUser) {
            openModal("auth-modal");
            if (authStatusMsg) {
                authStatusMsg.textContent = "Please sign in to save stories to your personal briefing.";
            }
            return;
        }

        const articleId = String(article.id || getStableArticleId(article));
        const isSaved = savedArticlesMap.has(articleId);

        try {
            if (appState.currentUser.isGuest) {
                if (isSaved) {
                    savedArticlesMap.delete(articleId);
                    showBannerMessage("Story removed from your briefing.");
                } else {
                    const savedRecord = {
                        articleId,
                        title: article.title || "Untitled",
                        description: article.description || article.contentSnippet || "",
                        image: article.image || FALLBACK_IMG,
                        source: article.source || "SATYA",
                        sourceUrl: article.sourceUrl || "",
                        category: article.category || "GENERAL",
                        publishedAt: article.publishedAt || new Date().toISOString(),
                        savedAt: new Date().toISOString(),
                        verifiedStatus: article.verifiedStatus || "SUPPORTED"
                    };
                    savedArticlesMap.set(articleId, savedRecord);
                    showBannerMessage("Story saved to your private briefing.");
                }
                localStorage.setItem("satya_guest_bookmarks", JSON.stringify(Array.from(savedArticlesMap.entries())));
            } else {
                if (isSaved) {
                    await removeArticle(appState.currentUser.uid, articleId);
                    savedArticlesMap.delete(articleId);
                    showBannerMessage("Story removed from your briefing.");
                } else {
                    const savedRecord = {
                        articleId,
                        title: article.title || "Untitled",
                        description: article.description || article.contentSnippet || "",
                        image: article.image || FALLBACK_IMG,
                        source: article.source || "SATYA",
                        sourceUrl: article.sourceUrl || "",
                        category: article.category || "GENERAL",
                        publishedAt: article.publishedAt || new Date().toISOString(),
                        savedAt: new Date().toISOString(),
                        verifiedStatus: article.verifiedStatus || "SUPPORTED"
                    };
                    await saveArticle(appState.currentUser.uid, savedRecord);
                    savedArticlesMap.set(articleId, savedRecord);
                    showBannerMessage("Story saved to your private briefing.");
                }
            }

            updateAllBookmarkButtonStates();
            if (appState.currentTab === "saved") {
                renderSavedArticlesView();
            }
        } catch (err) {
            console.error("[SATYA BOOKMARK ERROR]:", err);
            showBannerMessage("Failed to update saved story: " + err.message, true);
        }
    }

    function isArticleSaved(articleId) {
        return savedArticlesMap.has(String(articleId));
    }

    function updateAllBookmarkButtonStates() {
        // Hero bookmark
        const activeStory = stories[currentStoryIndex];
        const heroBtn = document.getElementById("hero-bookmark-btn");
        const heroText = document.getElementById("hero-bookmark-text");
        if (heroBtn && activeStory) {
            const saved = isArticleSaved(activeStory.id);
            heroBtn.classList.toggle("saved", saved);
            if (heroText) heroText.textContent = saved ? "Saved" : "Save";
        }

        // Card bookmarks
        document.querySelectorAll(".card-bookmark-btn").forEach(btn => {
            const artId = btn.getAttribute("data-article-id");
            if (artId) {
                btn.classList.toggle("saved", isArticleSaved(artId));
            }
        });

        // Detail modal bookmark
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

    document.getElementById("hero-bookmark-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        const activeStory = stories[currentStoryIndex];
        if (activeStory) toggleBookmark(activeStory);
    });

    // -------------------------------------------------------------
    // SAVED PAGE CONTROLLER
    // -------------------------------------------------------------
    function renderSavedArticlesView() {
        const savedGrid = document.getElementById("saved-news-grid");
        const savedControlsRow = document.getElementById("saved-controls-row");
        const savedStatsBar = document.getElementById("saved-stats-bar");
        const savedCountLabel = document.getElementById("saved-count-label");
        if (!savedGrid) return;

        if (!appState.currentUser) {
            if (savedControlsRow) savedControlsRow.style.display = "none";
            if (savedStatsBar) savedStatsBar.style.display = "none";
            savedGrid.innerHTML = `
                <div class="empty-saved-msg">
                    <h3>Sign in with Google</h3>
                    <p style="margin: 8px 0 16px;">Sign in to save articles, sync your verified briefing across devices, and ask SATYA AI about your reading list.</p>
                    <button class="liquid-glass-btn verify-btn" id="saved-page-signin-btn">Continue with Google</button>
                </div>
            `;
            document.getElementById("saved-page-signin-btn")?.addEventListener("click", () => openModal("auth-modal"));
            return;
        }

        const allSaved = Array.from(savedArticlesMap.values());
        if (allSaved.length === 0) {
            if (savedControlsRow) savedControlsRow.style.display = "none";
            if (savedStatsBar) savedStatsBar.style.display = "none";
            savedGrid.innerHTML = `
                <div class="empty-saved-msg">
                    <p>No bookmarked stories in your briefing yet.</p>
                    <span style="font-size:12px; color:#777; display:block; margin-top:4px;">Tap the "Save" bookmark button on any story card to save it here.</span>
                </div>
            `;
            return;
        }

        if (savedControlsRow) savedControlsRow.style.display = "flex";
        if (savedStatsBar) savedStatsBar.style.display = "flex";
        if (savedCountLabel) savedCountLabel.textContent = `${allSaved.length} ${allSaved.length === 1 ? 'story' : 'stories'} saved`;

        // Apply search & sort
        let filtered = allSaved;
        if (appState.savedSearchQuery) {
            const q = appState.savedSearchQuery.toLowerCase();
            filtered = filtered.filter(s => (s.title || "").toLowerCase().includes(q) || (s.source || "").toLowerCase().includes(q));
        }

        if (appState.savedSortMode === "recent-published") {
            filtered.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
        } else {
            filtered.sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
        }

        savedGrid.innerHTML = "";
        filtered.forEach(art => {
            const card = createArticleCardElement(art);
            savedGrid.appendChild(card);
        });
    }

    document.getElementById("saved-search-input")?.addEventListener("input", (e) => {
        appState.savedSearchQuery = e.target.value.trim();
        renderSavedArticlesView();
    });

    document.getElementById("saved-sort-select")?.addEventListener("change", (e) => {
        appState.savedSortMode = e.target.value;
        renderSavedArticlesView();
    });

    document.getElementById("ask-ai-saved-btn")?.addEventListener("click", () => {
        openModal("ai-modal");
        const aiInput = document.getElementById("ai-input");
        if (aiInput) {
            aiInput.value = "Mere saved stories ke key takeaways explain karo.";
        }
    });

    // -------------------------------------------------------------
    // DATA LOADING & LIVE STREAM POLLING
    // -------------------------------------------------------------
    async function loadNewsData(isBackground = false) {
        try {
            if (!isBackground) showBannerMessage("Connecting to SATYA Verified News streams...");
            const response = await fetch(LIVE_NEWS_API);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const json = await response.json();
            if (json && json.status === "success" && Array.isArray(json.data) && json.data.length > 0) {
                liveNewsPool = ensureUniqueImages(json.data);
                stories = liveNewsPool.slice(0, 5);
                trendingStories = liveNewsPool.slice(5, 10);
                latestStories = liveNewsPool.slice(10, 24);

                renderHeroStory(currentStoryIndex);
                renderTrendingUI();
                renderLatestUI();
                renderNotificationsUI();
                renderTopRightEvidenceBox(currentStoryIndex);

                if (!autoSlideTimer) startAutoSlide();
                updateAllBookmarkButtonStates();

                if (!isBackground) {
                    showBannerMessage(`Indexed ${liveNewsPool.length} verified news reports.`);
                }
            }
        } catch (err) {
            console.warn("[SATYA LOAD WARN]:", err.message);
            if (!isBackground) {
                showBannerMessage("Connecting to SATYA news feeds... Showing offline mode.", true);
            }
        }
    }

    setInterval(() => loadNewsData(true), 120000);

    // -------------------------------------------------------------
    // HERO STORY & CAROUSEL
    // -------------------------------------------------------------
    const heroImg = document.getElementById("hero-img");
    const heroHeadline = document.getElementById("hero-headline");
    const heroDesc = document.getElementById("hero-desc");
    const heroLocation = document.getElementById("hero-location");
    const heroTag = document.getElementById("hero-tag");
    const heroEvidenceBadge = document.getElementById("hero-evidence-badge");
    const heroReadBtn = document.getElementById("hero-read-btn");
    const heroCompareBtn = document.getElementById("hero-compare-btn");
    const heroCard = document.getElementById("hero-article-card");
    const dots = document.querySelectorAll(".carousel-dots .dot");

    function renderHeroStory(index) {
        if (!stories || stories.length === 0) return;
        const story = stories[index % stories.length];
        if (!story) return;

        if (heroImg) {
            heroImg.src = story.image || FALLBACK_IMG;
            heroImg.alt = escapeHtml(story.title || "News Cover");
        }
        if (heroHeadline) heroHeadline.textContent = story.title || "Headline";
        if (heroDesc) heroDesc.textContent = story.description || "Verified news summary.";
        if (heroLocation) heroLocation.textContent = `${story.source || 'SATYA'} • ${formatPublishDate(story.publishedAt)}`;
        if (heroTag) heroTag.textContent = (story.category || "TOP STORY").toUpperCase();

        if (heroEvidenceBadge) {
            const status = story.verifiedStatus || "SUPPORTED";
            heroEvidenceBadge.textContent = story.statusLabel || (status === "CONFIRMED" ? "MULTI-SOURCE CONFIRMED" : "CROSS-SUPPORTED");
            heroEvidenceBadge.className = `hero-evidence-badge badge-${status.toLowerCase()}`;
        }

        dots.forEach((dot, idx) => {
            dot.classList.toggle("active", idx === index);
        });

        renderTopRightEvidenceBox(index);
        updateAllBookmarkButtonStates();
    }

    function startAutoSlide() {
        stopAutoSlide();
        autoSlideTimer = setInterval(() => {
            if (stories.length > 0) {
                currentStoryIndex = (currentStoryIndex + 1) % stories.length;
                renderHeroStory(currentStoryIndex);
            }
        }, 22000);
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

    heroCompareBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        const activeStory = stories[currentStoryIndex];
        if (activeStory) openCoverageComparison([activeStory.id]);
    });

    heroCard?.addEventListener("click", () => {
        const activeStory = stories[currentStoryIndex];
        if (activeStory) openStoryModal(activeStory);
    });

    // -------------------------------------------------------------
    // TOP RIGHT EVIDENCE BOX (SIDE COLUMN)
    // -------------------------------------------------------------
    function renderTopRightEvidenceBox(index) {
        const currentStory = stories[index % stories.length];
        if (!currentStory) return;

        const truthScoreEl = document.getElementById("truth-score");
        const aiTruthOutput = document.getElementById("ai-truth-output");
        const glanceKnowText = document.getElementById("glance-know-text");
        const happeningTimeline = document.getElementById("happening-timeline");
        const happeningFooter = document.getElementById("happening-footer");

        const evidence = currentStory.evidence || {};
        const status = currentStory.verifiedStatus || "SUPPORTED";
        const label = currentStory.statusLabel || (status === "CONFIRMED" ? "MULTI-SOURCE CONFIRMED" : "CROSS-SUPPORTED");

        if (truthScoreEl) {
            truthScoreEl.textContent = label;
            truthScoreEl.className = `truth-score status-${status.toLowerCase()}`;
        }

        if (aiTruthOutput) {
            aiTruthOutput.textContent = evidence.statusSummary || `Reported by ${currentStory.source}. Multi-source corroboration active.`;
        }

        if (glanceKnowText) {
            const knowItem = Array.isArray(evidence.whatWeKnow) && evidence.whatWeKnow.length > 0
                ? evidence.whatWeKnow[0]
                : `Published by ${currentStory.source} at ${formatTimeOnly(currentStory.publishedAt)}.`;
            glanceKnowText.textContent = knowItem;
        }

        if (happeningTimeline) {
            happeningTimeline.innerHTML = "";
            let timelineEvents = [];

            if (Array.isArray(evidence.timeline) && evidence.timeline.length > 0) {
                timelineEvents = evidence.timeline.slice(0, 3).map((t, idx) => ({
                    time: t.time || "Live",
                    text: `${t.source}: ${t.label || t.headline}`,
                    active: idx === 0
                }));
            } else if (Array.isArray(currentStory.relatedSources) && currentStory.relatedSources.length > 0) {
                timelineEvents = currentStory.relatedSources.slice(0, 3).map((rs, idx) => ({
                    time: formatTimeOnly(rs.publishedAt || currentStory.publishedAt),
                    text: `${rs.source}: ${rs.title}`,
                    active: idx === 0
                }));
            } else {
                timelineEvents = [
                    { time: formatTimeOnly(currentStory.publishedAt), text: `Initial report: ${currentStory.source}`, active: true },
                    { time: "Live", text: `Category: ${currentStory.category || 'General'} verified.`, active: false }
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
        }

        if (happeningFooter) {
            happeningFooter.textContent = `Developing story: ${currentStory.source || 'Multi-source'} • Live index sync active.`;
        }
    }

    // -------------------------------------------------------------
    // TRENDING & LATEST NEWS GRIDS
    // -------------------------------------------------------------
    function renderTrendingUI() {
        const list = document.getElementById("trending-events-list");
        if (!list || trendingStories.length === 0) return;

        list.innerHTML = "";
        trendingStories.slice(0, 4).forEach((item, index) => {
            const div = document.createElement("div");
            div.className = "trend-item";
            div.setAttribute("data-index", String(index));
            div.innerHTML = `
                <span class="trend-number">0${index + 1}</span>
                <img src="${item.image || FALLBACK_IMG}" alt="${escapeHtml(item.title)}" referrerpolicy="no-referrer">
                <div>
                    <h4>${escapeHtml(item.title)}</h4>
                    <p>${escapeHtml(item.source)} • ${formatPublishDate(item.publishedAt)}</p>
                </div>
            `;
            div.addEventListener("click", () => openStoryModal(item));
            list.appendChild(div);
        });
    }

    function createArticleCardElement(data) {
        const articleId = String(data.id || getStableArticleId(data));
        const isSaved = isArticleSaved(articleId);
        const status = data.verifiedStatus || "SUPPORTED";

        const card = document.createElement("article");
        card.className = "news-card liquid-slide";
        card.innerHTML = `
            <button class="card-bookmark-btn ${isSaved ? 'saved' : ''}" data-article-id="${articleId}" aria-label="Save story" title="Save story">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="${isSaved ? '#fff' : 'none'}" stroke="currentColor" stroke-width="2.2">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                </svg>
            </button>
            <img src="${data.image || FALLBACK_IMG}" alt="${escapeHtml(data.title)}" onerror="this.src='${FALLBACK_IMG}'" referrerpolicy="no-referrer">
            <div class="news-content">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <span class="category">${escapeHtml(data.source || data.category || 'NEWS')}</span>
                    <span class="status-indicator badge-${status.toLowerCase()}" style="font-size:9px; font-weight:800; padding:2px 6px; border-radius:6px;">${escapeHtml(status)}</span>
                </div>
                <h3>${escapeHtml(data.title || 'Headline')}</h3>
                <p>${formatPublishDate(data.publishedAt)}</p>
            </div>
        `;

        card.addEventListener("click", () => openStoryModal(data));
        card.querySelector(".card-bookmark-btn")?.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleBookmark(data);
        });

        return card;
    }

    function renderLatestUI() {
        const latestGrid = document.getElementById("latest-news-grid");
        if (!latestGrid || latestStories.length === 0) return;

        latestGrid.innerHTML = "";
        latestStories.slice(0, 8).forEach(data => {
            const card = createArticleCardElement(data);
            latestGrid.appendChild(card);
        });
    }

    document.getElementById("view-trending-all")?.addEventListener("click", () => switchTab("newsplus"));
    document.getElementById("view-latest-all")?.addEventListener("click", () => switchTab("today"));
    document.getElementById("view-timeline-btn")?.addEventListener("click", () => {
        const activeStory = stories[currentStoryIndex];
        if (activeStory) openStoryModal(activeStory);
    });

    // -------------------------------------------------------------
    // TODAY'S BRIEFING VIEW
    // -------------------------------------------------------------
    function renderTodayBriefing(filterCategory = "ALL") {
        const grid = document.getElementById("today-news-grid");
        if (!grid || liveNewsPool.length === 0) return;

        let pool = liveNewsPool;
        if (filterCategory !== "ALL") {
            pool = pool.filter(a => (a.category || "").toUpperCase() === filterCategory);
        }

        grid.innerHTML = "";
        if (pool.length === 0) {
            grid.innerHTML = `<p class="empty-saved-msg">No current stories found under category: ${filterCategory}.</p>`;
            return;
        }

        pool.slice(0, 12).forEach((data, index) => {
            const card = createArticleCardElement(data);
            if (index === 0 && pool.length > 2) {
                card.classList.add("featured-slide");
            }
            grid.appendChild(card);
        });
    }

    document.querySelectorAll("#today-filter-row .briefing-filter-pill").forEach(pill => {
        pill.addEventListener("click", () => {
            document.querySelectorAll("#today-filter-row .briefing-filter-pill").forEach(p => p.classList.remove("active"));
            pill.classList.add("active");
            const cat = pill.getAttribute("data-category") || "ALL";
            renderTodayBriefing(cat);
        });
    });

    // -------------------------------------------------------------
    // EVENT CLUSTERS VIEW (NEWS+)
    // -------------------------------------------------------------
    async function renderEventClusters() {
        const container = document.getElementById("event-clusters-container");
        if (!container) return;

        try {
            const res = await fetch(TRENDING_API);
            const json = await res.json();
            const events = json.data || [];

            container.innerHTML = "";
            if (events.length === 0) {
                container.innerHTML = `<p class="empty-saved-msg">Event clusters are being grouped by SATYA engine...</p>`;
                return;
            }

            events.forEach(evt => {
                const card = document.createElement("div");
                card.className = "event-cluster-card";
                const status = evt.verificationStatus || "SUPPORTED";

                card.innerHTML = `
                    <div class="event-cluster-header">
                        <h3 class="event-cluster-title">${escapeHtml(evt.title || evt.topic)}</h3>
                        <span class="event-meta-pill badge-${status.toLowerCase()}">${escapeHtml(evt.statusLabel || status)}</span>
                    </div>
                    <p class="event-summary">${escapeHtml(evt.summary)}</p>
                    <div class="event-sources-row">
                        <strong>Reporting Outlets (${evt.sourceCount || 1}):</strong>
                        ${(evt.sources || []).map(s => `<span class="event-source-tag">${escapeHtml(s)}</span>`).join(' ')}
                        <span style="margin-left:auto; font-size:11px; color:#777;">Velocity: ${escapeHtml(evt.velocity || 'HIGH')}</span>
                    </div>
                    ${Array.isArray(evt.majorDevelopments) && evt.majorDevelopments.length > 0 ? `
                        <div style="font-size:12px; color:#444; margin-bottom:14px; background:rgba(255,255,255,0.4); padding:10px 14px; border-radius:12px;">
                            <strong>Latest Developments:</strong> ${evt.majorDevelopments.join(' • ')}
                        </div>
                    ` : ''}
                    <div class="event-actions-row">
                        <button class="liquid-glass-btn inspect-event-btn" data-event-id="${evt.eventId || ''}">Explore Lineage & Timeline →</button>
                        <button class="liquid-glass-btn compare-event-btn" data-event-id="${evt.eventId || ''}">Compare Coverage</button>
                    </div>
                `;

                card.querySelector(".inspect-event-btn")?.addEventListener("click", () => {
                    const found = liveNewsPool.find(a => String(a.id) === String(evt.eventId)) || stories[0];
                    if (found) openStoryModal(found);
                });

                card.querySelector(".compare-event-btn")?.addEventListener("click", () => {
                    openCoverageComparison([evt.eventId]);
                });

                container.appendChild(card);
            });
        } catch (err) {
            console.warn("[EVENT CLUSTERS WARN]:", err);
            container.innerHTML = `<p class="empty-saved-msg">Live event clusters updating. Please wait...</p>`;
        }
    }

    // -------------------------------------------------------------
    // EVIDENCE WORKSPACE VIEW
    // -------------------------------------------------------------
    function renderEvidenceWorkspace(searchQuery = "") {
        const body = document.getElementById("evidence-workspace-body");
        if (!body) return;

        const pool = liveNewsPool.length > 0 ? liveNewsPool : stories;
        let target = pool[0];

        if (searchQuery) {
            const found = pool.find(a => a.title.toLowerCase().includes(searchQuery.toLowerCase()));
            if (found) target = found;
        }

        if (!target) {
            body.innerHTML = `<p class="empty-saved-msg">No evidence records available.</p>`;
            return;
        }

        const ev = target.evidence || {};
        const status = target.verifiedStatus || "SUPPORTED";
        const sources = Array.isArray(ev.independentSources) ? ev.independentSources : [target.source];

        body.innerHTML = `
            <div class="evidence-dossier">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap;">
                    <div>
                        <span class="hero-evidence-badge badge-${status.toLowerCase()}">${escapeHtml(target.statusLabel || status)}</span>
                        <h3 style="font-size:20px; font-weight:800; color:#111; margin-top:8px;">${escapeHtml(target.title)}</h3>
                        <p style="font-size:13px; color:#555; margin-top:4px;">First recorded: ${formatPublishDate(target.publishedAt)} by ${target.source}</p>
                    </div>
                    <div style="text-align:right;">
                        <button class="liquid-glass-btn" id="dossier-full-modal-btn">Read Full Article & Sources →</button>
                    </div>
                </div>

                <div class="dossier-grid">
                    <div class="dossier-section">
                        <h4>WHAT WE KNOW</h4>
                        <ul class="dossier-list">
                            ${(ev.whatWeKnow || [`Confirmed reported by ${target.source}`, target.description || 'Verified news record']).map(item => `<li>${escapeHtml(item)}</li>`).join('')}
                        </ul>
                    </div>

                    <div class="dossier-section">
                        <h4>WHAT REMAINS UNKNOWN</h4>
                        <ul class="dossier-list">
                            ${(ev.whatWeDontKnow || ['Localized operational aftermath confirmations.', 'Closing official gazette releases.']).map(item => `<li>${escapeHtml(item)}</li>`).join('')}
                        </ul>
                    </div>

                    <div class="dossier-section">
                        <h4>SOURCE LINEAGE (${sources.length} OUTLETS)</h4>
                        <p style="font-size:12px; color:#444; margin-bottom:8px;">${ev.isSyndicatedOnly ? 'Syndicated wire copies detected. Do not count as independent.' : 'Independent outlets cross-corroborating.'}</p>
                        <div style="display:flex; gap:6px; flex-wrap:wrap;">
                            ${sources.map(s => `<span class="event-source-tag">${escapeHtml(s)}</span>`).join('')}
                        </div>
                    </div>

                    <div class="dossier-section">
                        <h4>WHAT CHANGED?</h4>
                        <p style="font-size:12px; color:#333; line-height:1.4;">
                            ${escapeHtml(ev.whatChanged?.latest || 'Current consensus active across live streams.')}
                        </p>
                    </div>
                </div>
            </div>
        `;

        document.getElementById("dossier-full-modal-btn")?.addEventListener("click", () => openStoryModal(target));
    }

    document.getElementById("evidence-search-btn")?.addEventListener("click", () => {
        const query = document.getElementById("evidence-search-input")?.value.trim() || "";
        renderEvidenceWorkspace(query);
    });

    document.getElementById("evidence-search-input")?.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            const query = e.target.value.trim();
            renderEvidenceWorkspace(query);
        }
    });

    // -------------------------------------------------------------
    // RUMOR FIREWALL CONTROLLER
    // -------------------------------------------------------------
    const rumorInput = document.getElementById("rumor-text-input");
    const rumorAnalyzeBtn = document.getElementById("rumor-analyze-btn");
    const rumorResult = document.getElementById("rumor-analysis-result");

    rumorAnalyzeBtn?.addEventListener("click", async () => {
        const text = rumorInput ? rumorInput.value.trim() : "";
        if (!text || !rumorResult) return;

        rumorResult.style.display = "block";
        rumorResult.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px; color:#555; padding:18px;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin-icon"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                <span>Scanning live news archives, press bureaus, and multi-source evidence...</span>
            </div>
        `;

        try {
            const response = await fetch(RUMOR_API, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ claim: text })
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const res = data.data || {};
            const status = res.verificationStatus || "INSUFFICIENT_EVIDENCE";

            rumorResult.innerHTML = `
                <div class="event-cluster-card" style="margin-top:16px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <span class="event-meta-pill badge-${status.toLowerCase()}">${escapeHtml(status)}</span>
                        <span style="font-size:11px; color:#777;">Confidence: ${escapeHtml(res.confidence || 'MEDIUM')}</span>
                    </div>
                    <h4 style="font-size:15px; font-weight:700; color:#111; margin-bottom:8px;">Claim Analysis: "${escapeHtml(text)}"</h4>
                    <p style="font-size:13.5px; line-height:1.5; color:#333; margin-bottom:12px;">${escapeHtml(res.explanation || 'Verified.')}</p>
                    ${Array.isArray(res.verifiedSources) && res.verifiedSources.length > 0 ? `
                        <div style="font-size:11.5px; color:#666;">
                            <strong>Checked Against:</strong> ${res.verifiedSources.map(s => `<span class="event-source-tag">${escapeHtml(s)}</span>`).join(' ')}
                        </div>
                    ` : ''}
                </div>
            `;
        } catch (err) {
            console.warn("[RUMOR FIREWALL ERROR]:", err);
            rumorResult.innerHTML = `<p style="padding:14px; color:#666;">Analysis service temporarily unavailable. Please try again shortly.</p>`;
        }
    });

    // -------------------------------------------------------------
    // CORRECTIONS LEDGER CONTROLLER
    // -------------------------------------------------------------
    async function loadAndRenderCorrections() {
        const container = document.getElementById("corrections-container");
        if (!container) return;

        try {
            const res = await fetch(CORRECTIONS_API);
            const json = await res.json();
            const corrections = json.data || [];

            container.innerHTML = "";
            if (corrections.length === 0) {
                container.innerHTML = `<p class="empty-saved-msg">No active story corrections on record.</p>`;
                return;
            }

            corrections.forEach(corr => {
                const div = document.createElement("div");
                div.className = "correction-card";
                div.innerHTML = `
                    <div class="correction-meta-row">
                        <span class="correction-badge">${escapeHtml(corr.impact || 'Correction')}</span>
                        <span>${formatPublishDate(corr.timestamp)} • ${escapeHtml(corr.sourceOfCorrection || 'SATYA Desk')}</span>
                    </div>
                    <div class="correction-comparison-box">
                        <div class="correction-col before">
                            <strong>Original Reporting:</strong>
                            <p style="margin-top:4px;">${escapeHtml(corr.originalClaim)}</p>
                        </div>
                        <div class="correction-col after">
                            <strong>Clarified / Corrected Consensus:</strong>
                            <p style="margin-top:4px;">${escapeHtml(corr.correction)}</p>
                        </div>
                    </div>
                `;
                container.appendChild(div);
            });
        } catch (err) {
            console.warn("[CORRECTIONS WARN]:", err);
            container.innerHTML = `<p class="empty-saved-msg">Corrections ledger currently syncing...</p>`;
        }
    }

    // -------------------------------------------------------------
    // CATEGORY VIEWS (WORLD, BUSINESS, SPORTS)
    // -------------------------------------------------------------
    function renderCategoryView(categoryName) {
        const gridId = `${categoryName}-news-grid`;
        const grid = document.getElementById(gridId);
        if (!grid || liveNewsPool.length === 0) return;

        const targetCat = categoryName.toUpperCase();
        const filtered = liveNewsPool.filter(a => (a.category || "").toUpperCase() === targetCat);

        grid.innerHTML = "";
        if (filtered.length === 0) {
            grid.innerHTML = `<p class="empty-saved-msg">No current live stories found for ${categoryName}.</p>`;
            return;
        }

        filtered.slice(0, 12).forEach((data, index) => {
            const card = createArticleCardElement(data);
            if (index === 0 && filtered.length > 2) {
                card.classList.add("featured-slide");
            }
            grid.appendChild(card);
        });
    }

    // -------------------------------------------------------------
    // STORY DETAIL & EVIDENCE MODAL
    // -------------------------------------------------------------
    function openStoryModal(article) {
        if (!article) return;
        appState.activeModalArticle = article;
        const detailBody = document.getElementById("detail-modal-body");
        if (!detailBody) return;

        const safeImg = article.image || FALLBACK_IMG;
        const safeTitle = article.title || "Untitled Report";
        const safeLoc = `${article.source || 'SATYA'} • ${formatPublishDate(article.publishedAt)}`;
        const safeContent = article.description || article.contentSnippet || "Verified details are actively syncing.";
        const articleId = String(article.id || getStableArticleId(article));
        const isSaved = isArticleSaved(articleId);

        const ev = article.evidence || {};
        const status = article.verifiedStatus || "SUPPORTED";
        const statusLabel = article.statusLabel || (status === "CONFIRMED" ? "MULTI-SOURCE CONFIRMED" : "CROSS-SUPPORTED");

        let safeUrl = article.sourceUrl && (article.sourceUrl.startsWith('http://') || article.sourceUrl.startsWith('https://'))
            ? article.sourceUrl
            : null;

        const readMoreBtnHtml = safeUrl 
            ? `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="read-more-btn" style="display:inline-block; padding:10px 20px; background:#e53935; color:#fff; text-decoration:none; border-radius:24px; font-weight:700; font-size:13px;">Read Original Source Article &rarr;</a>` 
            : '';

        detailBody.innerHTML = `
            <img src="${safeImg}" alt="${escapeHtml(safeTitle)}" onerror="this.src='${FALLBACK_IMG}'" referrerpolicy="no-referrer" style="width:100%; max-height:280px; object-fit:cover; border-radius:18px; margin-bottom:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
                <span class="hero-evidence-badge badge-${status.toLowerCase()}">${escapeHtml(statusLabel)}</span>
                <span style="font-size:12px; color:#666;">${escapeHtml(safeLoc)}</span>
            </div>
            <h2 style="font-size:22px; font-weight:800; line-height:1.25; color:#111;">${escapeHtml(safeTitle)}</h2>
            
            <div style="margin-top:14px; font-size:14px; line-height:1.6; color:#222;">
                <p>${escapeHtml(safeContent)}</p>
            </div>

            <!-- EVIDENCE DOSSIER CARD IN MODAL -->
            <div style="margin-top:20px; padding:16px; border-radius:16px; background:rgba(0,0,0,0.03); border:1px solid rgba(0,0,0,0.06);">
                <h4 style="font-size:12.5px; font-weight:800; letter-spacing:0.5px; text-transform:uppercase; color:#333; margin-bottom:10px;">EVIDENCE ANALYSIS & REASONING</h4>
                <p style="font-size:13px; color:#444; line-height:1.45; margin-bottom:10px;">${escapeHtml(ev.statusSummary || `Reported by ${article.source}. Corroboration verification active.`)}</p>
                
                ${Array.isArray(ev.whatWeKnow) && ev.whatWeKnow.length > 0 ? `
                    <div style="margin-top:10px;">
                        <strong style="font-size:12px; color:#111;">What We Know:</strong>
                        <ul style="padding-left:18px; font-size:12px; color:#444; margin-top:4px;">
                            ${ev.whatWeKnow.map(k => `<li>${escapeHtml(k)}</li>`).join('')}
                        </ul>
                    </div>
                ` : ''}

                ${Array.isArray(article.relatedSources) && article.relatedSources.length > 0 ? `
                    <div style="margin-top:12px; font-size:12px; color:#555;">
                        <strong>Cross-Referenced Outlets (${article.relatedSources.length}):</strong>
                        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:4px;">
                            ${article.relatedSources.map(s => `<span class="event-source-tag">${escapeHtml(s.source || s)}</span>`).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>

            <div class="detail-actions-row">
                ${readMoreBtnHtml}
                <button class="modal-bookmark-btn ${isSaved ? 'saved' : ''}" id="modal-bookmark-btn" data-article-id="${articleId}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="${isSaved ? '#fff' : 'none'}" stroke="currentColor" stroke-width="2.2">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                    </svg>
                    <span class="btn-text">${isSaved ? 'Saved in Briefing' : 'Save Story'}</span>
                </button>
                <button class="liquid-glass-btn" id="modal-compare-btn">Compare Coverage</button>
                <button class="liquid-glass-btn" id="modal-ask-ai-btn">Ask SATYA AI</button>
            </div>
        `;

        document.getElementById("modal-bookmark-btn")?.addEventListener("click", () => {
            toggleBookmark(article);
        });

        document.getElementById("modal-compare-btn")?.addEventListener("click", () => {
            openCoverageComparison([article.id]);
        });

        document.getElementById("modal-ask-ai-btn")?.addEventListener("click", () => {
            closeModal("detail-modal");
            openModal("ai-modal");
            const aiInput = document.getElementById("ai-input");
            if (aiInput) aiInput.value = `Is story ("${article.title.substring(0, 40)}...") mein actual proof kya hai?`;
        });

        // Update active context in AI modal
        const contextIndicator = document.getElementById("ai-active-context");
        if (contextIndicator) {
            contextIndicator.textContent = `Active Context: ${article.title.substring(0, 36)}...`;
        }

        closeModal("search-modal");
        openModal("detail-modal");
    }

    // -------------------------------------------------------------
    // COVERAGE COMPARISON MODAL
    // -------------------------------------------------------------
    async function openCoverageComparison(articleIds = []) {
        const body = document.getElementById("compare-modal-body");
        if (!body) return;

        openModal("compare-modal");
        body.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px; color:#555; padding:20px;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin-icon"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                <span>Comparing multi-source coverage, agreements, and differences...</span>
            </div>
        `;

        try {
            const res = await fetch(COMPARE_API, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ articleIds })
            });
            const json = await res.json();
            const comp = json.data || {};
            const articles = comp.articles || [];

            body.innerHTML = `
                <div style="margin-bottom:14px;">
                    <span style="font-size:11px; font-weight:800; color:#e53935; letter-spacing:0.8px; text-transform:uppercase;">CROSS-SOURCE COVERAGE COMPARISON</span>
                    <h3 style="font-size:20px; font-weight:800; color:#111; margin-top:4px;">Side-by-Side Fact & Narrative Analysis</h3>
                </div>

                <div class="compare-columns">
                    ${articles.map(art => `
                        <div class="compare-col">
                            <div class="compare-col-header">${escapeHtml(art.source)}</div>
                            <h4>${escapeHtml(art.headline)}</h4>
                            <p>${escapeHtml(art.focus)}</p>
                            <span style="display:inline-block; margin-top:8px; font-size:11px; color:#777;">Published: ${formatPublishDate(art.publishedAt)}</span>
                        </div>
                    `).join('')}
                </div>

                <div class="compare-analysis-card">
                    <h4>SATYA Factual Synthesis</h4>
                    <p style="font-size:13px; color:#222; margin-bottom:8px;"><strong>What All Sources Agree On:</strong> ${escapeHtml(comp.agreement || 'Incident confirmed.')}</p>
                    <p style="font-size:13px; color:#222; margin-bottom:8px;"><strong>Notable Discrepancies:</strong> ${escapeHtml(comp.discrepancies || 'Minor variations in narrative timing.')}</p>
                    <p style="font-size:13px; color:#666;"><strong>Remaining Uncertainties:</strong> ${escapeHtml(comp.uncertainties || 'Awaiting formal release.')}</p>
                </div>
            `;
        } catch (err) {
            console.warn("[COMPARE ERROR]:", err);
            body.innerHTML = `<p style="padding:20px; color:#666;">Coverage comparison temporarily unavailable.</p>`;
        }
    }

    document.getElementById("compare-quick-btn")?.addEventListener("click", () => {
        const topIds = stories.slice(0, 2).map(s => s.id);
        openCoverageComparison(topIds);
    });

    document.getElementById("close-compare")?.addEventListener("click", () => closeModal("compare-modal"));

    // -------------------------------------------------------------
    // MODAL WINDOW CONTROLLER
    // -------------------------------------------------------------
    function openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add("active");
            document.body.style.overflow = "hidden";
        }
    }

    function closeModal(modalId) {
        if (modalId === "detail-modal") appState.activeModalArticle = null;
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.remove("active");
        if (!document.querySelector(".modal-overlay.active")) {
            document.body.style.overflow = "";
        }
    }

    function closeAllModals() {
        document.querySelectorAll(".modal-overlay.active").forEach(m => {
            m.classList.remove("active");
        });
        document.body.style.overflow = "";
        appState.activeModalArticle = null;
        document.getElementById("notif-dropdown")?.classList.remove("show");
        document.getElementById("user-dropdown")?.classList.remove("show");
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
        if (e.key === "Escape") closeAllModals();
    });

    // -------------------------------------------------------------
    // SEARCH EXPERIENCE
    // -------------------------------------------------------------
    const searchBtn = document.getElementById("search-btn");
    const searchInput = document.getElementById("search-input");
    const searchResults = document.getElementById("search-results");
    let activeSearchFilter = "all";

    searchBtn?.addEventListener("click", () => {
        openModal("search-modal");
        if (searchInput) {
            searchInput.value = "";
            searchResults.innerHTML = `<p class="search-hint">Type a query above to filter stories and evidence across SATYA indexes.</p>`;
            setTimeout(() => searchInput.focus(), 60);
        }
    });

    document.querySelectorAll("#search-filter-pills .search-filter-pill").forEach(pill => {
        pill.addEventListener("click", () => {
            document.querySelectorAll("#search-filter-pills .search-filter-pill").forEach(p => p.classList.remove("active"));
            pill.classList.add("active");
            activeSearchFilter = pill.getAttribute("data-filter") || "all";
            performSearch(searchInput?.value || "");
        });
    });

    function performSearch(query) {
        const cleanQuery = query.trim().toLowerCase();
        if (!cleanQuery) {
            searchResults.innerHTML = `<p class="search-hint">Type a query above to filter stories across SATYA indexes.</p>`;
            return;
        }

        let pool = liveNewsPool;
        if (activeSearchFilter === "saved") {
            pool = Array.from(savedArticlesMap.values());
        } else if (activeSearchFilter === "evidence") {
            pool = pool.filter(a => a.verifiedStatus === "CONFIRMED");
        }

        const filtered = pool.filter(item => {
            const titleStr = (item.title || "").toLowerCase();
            const descStr = (item.description || "").toLowerCase();
            const sourceStr = (item.source || "").toLowerCase();
            return titleStr.includes(cleanQuery) || descStr.includes(cleanQuery) || sourceStr.includes(cleanQuery);
        });

        if (filtered.length === 0) {
            searchResults.innerHTML = `<p class="search-hint">No verified reports matching "${escapeHtml(query)}".</p>`;
            return;
        }

        searchResults.innerHTML = "";
        filtered.slice(0, 8).forEach(item => {
            const title = item.title || "Untitled Result";
            const meta = `${item.source || 'SATYA'} • ${formatPublishDate(item.publishedAt)}`;
            const resDiv = document.createElement("div");
            resDiv.className = "search-result-item";
            resDiv.innerHTML = `
                <h4>${escapeHtml(title)}</h4>
                <p>${escapeHtml(meta)} • <span class="status-indicator">${item.verifiedStatus || 'SUPPORTED'}</span></p>
            `;
            resDiv.addEventListener("click", () => {
                closeModal("search-modal");
                openStoryModal(item);
            });
            searchResults.appendChild(resDiv);
        });
    }

    let searchTimeout = null;
    searchInput?.addEventListener("input", (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => performSearch(e.target.value), 180);
    });

    // -------------------------------------------------------------
    // NOTIFICATIONS
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
        if (notifList) notifList.innerHTML = `<div class="notif-item"><p class="notif-text" style="color:#777;">No new notifications</p></div>`;
    });

    function renderNotificationsUI() {
        const notifList = document.getElementById("notif-list");
        const notifBadge = document.getElementById("notif-badge");
        if (!notifList || liveNewsPool.length === 0) return;

        if (notifBadge) notifBadge.style.display = "block";
        notifList.innerHTML = "";

        const recent = liveNewsPool.slice(0, 4);
        recent.forEach((item, idx) => {
            const div = document.createElement("div");
            div.className = `notif-item ${idx < 2 ? 'unread' : ''}`;
            div.innerHTML = `
                ${idx < 2 ? '<div class="notif-dot"></div>' : '<div></div>'}
                <div style="cursor: pointer; width: 100%;">
                    <p class="notif-text"><strong>${escapeHtml(item.source)}:</strong> ${escapeHtml(item.title)}</p>
                    <span class="notif-time">${formatPublishDate(item.publishedAt)} • Status: ${escapeHtml(item.verifiedStatus || 'SUPPORTED')}</span>
                </div>
            `;
            div.addEventListener("click", () => {
                notifDropdown?.classList.remove("show");
                openStoryModal(item);
            });
            notifList.appendChild(div);
        });
    }

    document.addEventListener("click", (e) => {
        if (notifDropdown && !notifDropdown.contains(e.target) && e.target !== notifBtn) {
            notifDropdown.classList.remove("show");
        }
        if (userDropdown && !userDropdown.contains(e.target) && e.target !== userProfileBtn) {
            userDropdown.classList.remove("show");
        }
    });

    // -------------------------------------------------------------
    // SATYA AI ASSISTANT CONTROLLER
    // -------------------------------------------------------------
    const aiBtn = document.getElementById("ai-trigger-btn");
    const aiInput = document.getElementById("ai-input");
    const aiChatBody = document.getElementById("ai-chat-body");
    const aiSendBtn = document.getElementById("ai-send-btn");

    aiBtn?.addEventListener("click", () => {
        openModal("ai-modal");
        const contextIndicator = document.getElementById("ai-active-context");
        if (contextIndicator) {
            contextIndicator.textContent = appState.activeModalArticle 
                ? `Active Context: ${appState.activeModalArticle.title.substring(0, 36)}...` 
                : `Active Context: ${appState.currentTab.toUpperCase()} View`;
        }
    });

    document.querySelectorAll("#ai-suggestion-chips .ai-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            const prompt = chip.getAttribute("data-prompt");
            if (aiInput && prompt) {
                aiInput.value = prompt;
                handleAiSubmit();
            }
        });
    });

    function executeAIAction(action) {
        if (!action || typeof action !== "object" || !action.type) return;
        const type = String(action.type).toUpperCase().trim();
        const target = action.target ? String(action.target).toLowerCase().trim() : "";

        switch (type) {
            case "NAVIGATE_TAB":
            case "OPEN_CATEGORY":
                if (target) switchTab(target);
                break;
            case "GO_HOME":
                switchTab("home");
                break;
            case "OPEN_SAVED":
                switchTab("saved");
                break;
            case "OPEN_TODAY":
                switchTab("today");
                break;
            case "OPEN_WORLD":
                switchTab("world");
                break;
            case "OPEN_BUSINESS":
                switchTab("business");
                break;
            case "OPEN_SPORTS":
                switchTab("sports");
                break;
            case "OPEN_NEWS_PLUS":
                switchTab("newsplus");
                break;
            case "OPEN_EVIDENCE":
                switchTab("evidence");
                break;
            case "OPEN_FACT_CHECK":
            case "SHOW_FACT_CHECK":
                switchTab("factcheck");
                break;
            case "OPEN_RUMOR":
                switchTab("rumor");
                break;
            case "OPEN_CORRECTIONS":
                switchTab("corrections");
                break;
            case "SHOW_TRENDING":
                switchTab("home");
                document.querySelector(".liquid-slide.trending")?.scrollIntoView({ behavior: "smooth" });
                break;
            case "SHOW_LATEST":
                switchTab("home");
                document.querySelector(".latest-section")?.scrollIntoView({ behavior: "smooth" });
                break;
            case "OPEN_ARTICLE":
                const targetArticle = liveNewsPool.find(a => (a.title || "").toLowerCase().includes(target)) || stories[0];
                if (targetArticle) openStoryModal(targetArticle);
                break;
            case "SAVE_ARTICLE":
                if (action.payload) toggleBookmark(action.payload);
                break;
            case "DELETE_SAVED_ARTICLE":
                if (action.payload) toggleBookmark(action.payload);
                break;
            case "PROMPT_SIGN_IN":
                openModal("auth-modal");
                break;
            default:
                break;
        }
    }

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
        loadingMsg.innerHTML = `<p><em>Checking verified SATYA sources & comparing evidence...</em></p>`;
        aiChatBody.appendChild(loadingMsg);
        aiChatBody.scrollTop = aiChatBody.scrollHeight;

        const clientContext = {
            currentTab: appState.currentTab,
            currentArticle: appState.activeModalArticle,
            authenticated: !!appState.currentUser,
            userProfile: appState.currentUser ? {
                displayName: appState.currentUser.displayName || "SATYA Reader",
                email: appState.currentUser.email || ""
            } : null,
            savedArticles: appState.currentUser ? Array.from(savedArticlesMap.values()).map(a => ({
                articleId: a.articleId || a.id,
                title: a.title,
                source: a.source,
                category: a.category,
                savedAt: a.savedAt,
                publishedAt: a.publishedAt,
                verifiedStatus: a.verifiedStatus
            })) : [],
            lastReferencedArticles
        };

        try {
            const response = await fetch(AI_API, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    prompt: text,
                    clientContext,
                    conversationHistory
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
                const aiReply = data.reply || "Verified analysis complete.";
                
                botMsg.innerHTML = `<p>${escapeHtml(aiReply).replace(/\n/g, '<br>')}</p>`;

                if (Array.isArray(data.referencedArticles) && data.referencedArticles.length > 0) {
                    lastReferencedArticles = data.referencedArticles;

                    // Append compact actionable article cards
                    data.referencedArticles.slice(0, 2).forEach(refArt => {
                        const cardDiv = document.createElement("div");
                        cardDiv.className = "ai-article-card";
                        cardDiv.innerHTML = `
                            <h5>${escapeHtml(refArt.title)}</h5>
                            <div class="ai-article-meta">${escapeHtml(refArt.source || 'SATYA')} • Status: ${escapeHtml(refArt.verifiedStatus || 'SUPPORTED')}</div>
                            <div class="ai-card-actions">
                                <button class="ai-card-btn open">Open Story</button>
                                <button class="ai-card-btn save">${isArticleSaved(refArt.id) ? 'Saved' : 'Save'}</button>
                            </div>
                        `;
                        cardDiv.querySelector(".ai-card-btn.open")?.addEventListener("click", () => openStoryModal(refArt));
                        cardDiv.querySelector(".ai-card-btn.save")?.addEventListener("click", () => toggleBookmark(refArt));
                        botMsg.appendChild(cardDiv);
                    });
                }

                conversationHistory.push({ role: "user", content: text });
                conversationHistory.push({ role: "assistant", content: aiReply });
                if (conversationHistory.length > 10) conversationHistory = conversationHistory.slice(-10);

                if (data.uiAction) {
                    executeAIAction(data.uiAction);
                } else if (Array.isArray(data.actions)) {
                    data.actions.forEach(executeAIAction);
                }
            } else {
                botMsg.innerHTML = `<p>SATYA AI currently does not have enough verified information about this event in its available sources.</p>`;
            }

            aiChatBody.appendChild(botMsg);
        } catch (err) {
            console.error("[SATYA AI ERROR]:", err);
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

    // -------------------------------------------------------------
    // FACT CHECK CLAIM VERIFICATION
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
            <div style="display:flex; align-items:center; gap:10px; color:#555; padding:18px;">
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

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await response.json();
            const status = result.verificationStatus || "SUPPORTED";
            const sources = Array.isArray(result.verifiedSources) ? result.verifiedSources : [];

            liveClaimResult.innerHTML = `
                <div class="event-cluster-card" style="margin-top:16px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <span class="event-meta-pill badge-${status.toLowerCase()}">${escapeHtml(status)}</span>
                        <span style="font-size:11px; color:#777;">Confidence: ${escapeHtml(result.confidence || 'MEDIUM')}</span>
                    </div>
                    <h4 style="font-size:14px; font-weight:700; color:#111; margin-bottom:6px;">Claim: "${escapeHtml(claim)}"</h4>
                    <p style="font-size:13px; color:#333; line-height:1.5; margin-bottom:10px;">${escapeHtml(result.explanation || 'Verified.')}</p>
                    ${sources.length > 0 ? `
                        <div style="font-size:11.5px; color:#666;">
                            <strong>Cross-Referenced Outlets:</strong> ${sources.map(s => `<span class="event-source-tag">${escapeHtml(s)}</span>`).join(' ')}
                        </div>
                    ` : ''}
                </div>
            `;
        } catch (err) {
            console.warn("[SATYA FACT CHECK ERROR]:", err);
            liveClaimResult.innerHTML = `<p style="padding:14px; color:#666;">Verification service temporarily unavailable.</p>`;
        }
    }

    verifyClaimBtn?.addEventListener("click", () => handleLiveClaimVerification());
    liveClaimInput?.addEventListener("keypress", (e) => {
        if (e.key === "Enter") handleLiveClaimVerification();
    });

    document.querySelectorAll(".example-claim-pill").forEach(pill => {
        pill.addEventListener("click", () => {
            const claim = pill.getAttribute("data-claim");
            if (claim) handleLiveClaimVerification(claim);
        });
    });

    function renderFactCheckView() {
        const grid = document.getElementById("factcheck-news-grid");
        if (!grid || liveNewsPool.length === 0) return;

        grid.innerHTML = "";
        liveNewsPool.slice(0, 6).forEach(item => {
            const card = createArticleCardElement(item);
            grid.appendChild(card);
        });
    }

    // -------------------------------------------------------------
    // INITIALIZATION
    // -------------------------------------------------------------
    const initialHash = window.location.hash.replace("#", "") || "home";
    loadNewsData().then(() => {
        if (initialHash && initialHash !== "home") {
            switchTab(initialHash, false);
        }
    });
});
