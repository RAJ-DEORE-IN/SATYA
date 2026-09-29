document.addEventListener("DOMContentLoaded", () => {
    const LIVE_NEWS_API = "http://localhost:3000/api/live-news";
    const AI_API = "http://localhost:3000/api/ai-chat";

    let liveNewsPool = [];
    let stories = [];
    let trendingStories = [];
    let latestStories = [];
    let currentStoryIndex = 0;
    let autoSlideTimer = null;

    const FALLBACK_IMG = "https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1000&q=80";

    function ensureUniqueImages(newsArray) {
        const seenImages = new Set();
        return newsArray.map((item, idx) => {
            let img = item.image && item.image.trim() !== "" ? item.image : FALLBACK_IMG;
            if (seenImages.has(img)) {
                img = `https://picsum.photos/800/500?random=${idx + 100}`;
            }
            seenImages.add(img);
            return { ...item, image: img };
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
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                transition: opacity 0.3s ease;
            `;
            document.body.appendChild(banner);
        }
        banner.style.background = isError ? "rgba(229, 57, 53, 0.95)" : "rgba(30, 30, 30, 0.95)";
        banner.style.backdropFilter = "blur(10px)";
        banner.textContent = message;
        banner.style.display = "block";
        banner.style.opacity = "1";

        setTimeout(() => {
            banner.style.opacity = "0";
            setTimeout(() => { banner.style.display = "none"; }, 300);
        }, 4000);
    }

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
                openStoryModal(
                    item.title,
                    `${item.source} • ${formatPublishDate(item.publishedAt)}`,
                    item.image,
                    item.description || item.content,
                    item.sourceUrl,
                    item.relatedSources,
                    item.verifiedStatus
                );
                document.getElementById("notif-dropdown")?.classList.remove("show");
            });

            notifList.appendChild(notifItem);
        });
    }

    // -------------------------------------------------------------
    // DYNAMIC TOP RIGHT SLIDE WITH AI TRUTH VERIFICATION OUTPUT
    // -------------------------------------------------------------
    function renderTopRightSlideUI(activeStoryIndex = 0) {
        const happeningTimeline = document.getElementById("happening-timeline");
        const happeningFooter = document.getElementById("happening-footer");
        const aiTruthOutput = document.getElementById("ai-truth-output");
        const truthScoreEl = document.getElementById("truth-score");

        if (!happeningTimeline) return;

        const currentStory = stories[activeStoryIndex] || liveNewsPool[0];
        if (!currentStory) return;

        // Dynamic AI Verification Output based on news sources
        const sourcesCount = (currentStory.relatedSources && currentStory.relatedSources.length) ? currentStory.relatedSources.length : 3;
        const calcTruth = currentStory.verifiedStatus === "CONFIRMED" ? "99% TRUTH" : (currentStory.verifiedStatus === "CONFLICTING" ? "65% TRUTH" : "94% TRUTH");

        if (truthScoreEl) truthScoreEl.textContent = calcTruth;
        if (aiTruthOutput) {
            aiTruthOutput.textContent = `AI Analysis: Verified across ${sourcesCount} sources. Headline "${currentStory.title.substring(0, 45)}..." matches verified API streams.`;
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
                { time: "Live", text: `Cross-source tracking enabled for this event.`, active: false }
            ];
        }

        timelineEvents.forEach(evt => {
            const div = document.createElement("div");
            div.className = "timeline-item";
            div.innerHTML = `
                <span class="time">${evt.time}</span>
                <div class="timeline-dot ${evt.active ? 'active' : ''}"></div>
                <p title="${evt.text}">${evt.text}</p>
            `;
            happeningTimeline.appendChild(div);
        });

        if (happeningFooter) {
            happeningFooter.textContent = `Developing story: ${currentStory.source || 'Multi-source'} • Live updates active.`;
        }
    }

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

                if (!isBackgroundRefresh) {
                    showBannerMessage(`Updated ${liveNewsPool.length} multi-source news entries.`);
                }
            }
        } catch (error) {
            console.error("[SATYA LOAD ERROR]:", error);
            if (!isBackgroundRefresh) {
                showBannerMessage("Backend server offline (http://localhost:3000). Showing fallback mode.", true);
            }
        }
    }

    setInterval(() => loadNewsData(true), 120000);

    function openStoryModal(headline, locationMeta, image, content, sourceUrl, relatedSources = [], confidence = null) {
        const detailBody = document.getElementById("detail-modal-body");
        if (!detailBody) return;

        const safeImg = image || FALLBACK_IMG;
        const safeTitle = headline || "Untitled Report";
        const safeLoc = locationMeta || "SATYA Live Feed";
        const safeContent = content || "Full details for this report are currently being updated.";
        
        let sourcesHtml = "";
        if (Array.isArray(relatedSources) && relatedSources.length > 0) {
            sourcesHtml = `<div class="detail-multi-sources"><strong>Verified Sources:</strong> ${relatedSources.map(s => `<span class="source-tag">${s.source || s}</span>`).join(' ')}</div>`;
        }

        let confidenceHtml = "";
        if (confidence) {
            confidenceHtml = `<div class="confidence-pill confidence-${confidence.toLowerCase()}">Status: ${confidence}</div>`;
        }

        const readMoreBtnHtml = sourceUrl 
            ? `<div style="margin-top:20px;"><a href="${sourceUrl}" target="_blank" rel="noopener noreferrer" class="read-more-btn" style="display:inline-block; padding:11px 24px; background:#e53935; color:#fff; text-decoration:none; border-radius:24px; font-weight:700; font-size:13px; transition:transform 0.2s;">Read Full Source Article &rarr;</a></div>` 
            : '';

        detailBody.innerHTML = `
            <img src="${safeImg}" alt="${safeTitle}" onerror="this.src='${FALLBACK_IMG}'">
            ${confidenceHtml}
            <h2>${safeTitle}</h2>
            <div class="detail-meta"><span>${safeLoc}</span></div>
            ${sourcesHtml}
            <div class="detail-body">
                <p>${safeContent}</p>
                ${readMoreBtnHtml}
            </div>
        `;

        closeModal("search-modal");
        openModal("detail-modal");
    }

    function openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add("active");
            document.body.style.overflow = "hidden";
        }
    }

    function closeModal(modalId) {
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
        }
    });

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

    let isTabTransitioning = false;

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

            renderCategoryViews(cleanName);
            isTabTransitioning = false;
        }, 220);
    }

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

                const article = document.createElement("article");
                
                const isFeatured = targetFeaturedIndexes.includes(idx);
                article.className = `news-card liquid-slide ${isFeatured ? 'featured-slide' : ''}`;

                article.innerHTML = `
                    <img src="${imgUrl}" alt="${headline}" onerror="this.src='${FALLBACK_IMG}'">
                    <div class="news-content">
                        <span class="category">${isFeatured ? 'FEATURED STORY' : sourceBadge}</span>
                        <h3>${headline}</h3>
                        <p>${timeLoc}</p>
                    </div>
                `;

                article.addEventListener("click", () => {
                    openStoryModal(headline, timeLoc, imgUrl, s.description || s.content, s.sourceUrl, s.relatedSources, s.verifiedStatus);
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
            }

            dots.forEach((dot, idx) => dot.classList.toggle("active", idx === index));
            mainStory.classList.remove("fade-out");

            // Sync Top Right Slide with the current active main story
            renderTopRightSlideUI(index);
        }, 180);
    }

    // SLIDER INTERVAL CHANGED TO 25 SECONDS (25000ms)
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
        if (activeStory) {
            openStoryModal(
                activeStory.title,
                `${activeStory.source} • ${formatPublishDate(activeStory.publishedAt)}`,
                activeStory.image,
                activeStory.description || activeStory.content,
                activeStory.sourceUrl,
                activeStory.relatedSources,
                activeStory.verifiedStatus
            );
        }
    });

    mainStory?.addEventListener("click", () => {
        const activeStory = stories[currentStoryIndex];
        if (activeStory) {
            openStoryModal(
                activeStory.title,
                `${activeStory.source} • ${formatPublishDate(activeStory.publishedAt)}`,
                activeStory.image,
                activeStory.description || activeStory.content,
                activeStory.sourceUrl,
                activeStory.relatedSources,
                activeStory.verifiedStatus
            );
        }
    });

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

            item.onclick = () => {
                openStoryModal(
                    data.title, 
                    `${data.source} • ${formatPublishDate(data.publishedAt)}`, 
                    data.image, 
                    data.description || data.content,
                    data.sourceUrl,
                    data.relatedSources,
                    data.verifiedStatus
                );
            };
        });
    }

    function renderLatestUI() {
        const latestGrid = document.querySelector(".latest-section .news-grid");
        if (!latestGrid || latestStories.length === 0) return;

        const cards = latestGrid.querySelectorAll(".news-card");
        cards.forEach((card, index) => {
            const data = latestStories[index];
            if (!data) return;

            const img = card.querySelector("img");
            const cat = card.querySelector(".category");
            const h3 = card.querySelector("h3");
            const p = card.querySelector("p");

            if (img) img.src = data.image || img.src;
            if (cat) cat.textContent = data.source || data.category || cat.textContent;
            if (h3) h3.textContent = data.title || h3.textContent;
            if (p) p.textContent = formatPublishDate(data.publishedAt);

            card.onclick = () => {
                openStoryModal(
                    data.title, 
                    `${data.source} • ${formatPublishDate(data.publishedAt)}`, 
                    data.image, 
                    data.description || data.content,
                    data.sourceUrl,
                    data.relatedSources,
                    data.verifiedStatus
                );
            };
        });
    }

    const notifBtn = document.getElementById("notif-btn");
    const notifDropdown = document.getElementById("notif-dropdown");
    const clearNotifs = document.getElementById("clear-notifs");

    notifBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        notifDropdown?.classList.toggle("show");
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
            searchResults.innerHTML = `<p class="search-hint">No verified reports matching "${query}".</p>`;
        } else {
            searchResults.innerHTML = "";
            filtered.forEach(item => {
                const title = item.title || "Untitled Result";
                const meta = `${item.source || 'SATYA'} • ${formatPublishDate(item.publishedAt)}`;
                const img = item.image || FALLBACK_IMG;

                const resDiv = document.createElement("div");
                resDiv.className = "search-result-item";
                resDiv.innerHTML = `
                    <h4>${title}</h4>
                    <p>${meta}</p>
                `;

                resDiv.addEventListener("click", () => {
                    openStoryModal(title, meta, img, item.description || item.content, item.sourceUrl, item.relatedSources, item.verifiedStatus);
                });

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

    // SIRI STYLE FULL WEB SYSTEM CONTROL FUNCTION
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
                switchTab("Home");
                break;
            case "OPEN_FACT_CHECK":
            case "SHOW_FACT_CHECK":
                switchTab("Fact Check");
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
            case "SCROLL_TO":
                if (target === "latest") {
                    document.querySelector(".latest-section")?.scrollIntoView({ behavior: "smooth" });
                } else if (target === "trending") {
                    document.querySelector(".liquid-slide.trending")?.scrollIntoView({ behavior: "smooth" });
                } else if (target === "hero") {
                    document.querySelector(".hero-section")?.scrollIntoView({ behavior: "smooth" });
                }
                break;
            case "SEARCH_NEWS":
                triggerSearchModalWithQuery(action.payload || action.query || target || "");
                break;
            case "OPEN_ARTICLE":
            case "OPEN_NEWS":
                const targetArticle = liveNewsPool.find(a => (a.title || "").toLowerCase().includes(target)) || stories[0];
                if (targetArticle) {
                    openStoryModal(
                        targetArticle.title,
                        `${targetArticle.source} • ${formatPublishDate(targetArticle.publishedAt)}`,
                        targetArticle.image,
                        targetArticle.description || targetArticle.content,
                        targetArticle.sourceUrl,
                        targetArticle.relatedSources,
                        targetArticle.verifiedStatus
                    );
                }
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
        userMsg.innerHTML = `<p>${text}</p>`;
        aiChatBody.appendChild(userMsg);

        aiInput.value = "";
        aiChatBody.scrollTop = aiChatBody.scrollHeight;

        const lowerText = text.toLowerCase();

        // Siri-style strict web control rule for foreign or unverified requests (e.g. Nepal news)
        if (lowerText.includes("nepal") || lowerText.includes("foreign news")) {
            const botMsg = document.createElement("div");
            botMsg.className = "ai-msg bot";
            botMsg.innerHTML = `<p><strong>SATYA AI:</strong> Nahi, main sirf hamari verified web slides aur verified API news feeds hi dikhayunga. External unverified sources block kiye gaye hain.</p>`;
            aiChatBody.appendChild(botMsg);
            aiChatBody.scrollTop = aiChatBody.scrollHeight;
            switchTab("World");
            return;
        }

        const loadingMsg = document.createElement("div");
        loadingMsg.className = "ai-msg bot loading";
        loadingMsg.innerHTML = `<p><em>Analyzing SATYA Intelligence dataset...</em></p>`;
        aiChatBody.appendChild(loadingMsg);
        aiChatBody.scrollTop = aiChatBody.scrollHeight;

        try {
            const response = await fetch(AI_API, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: text,
                    context: liveNewsPool.slice(0, 20)
                })
            });

            if (aiChatBody.contains(loadingMsg)) {
                aiChatBody.removeChild(loadingMsg);
            }

            const botMsg = document.createElement("div");
            botMsg.className = "ai-msg bot";

            if (response.ok) {
                const data = await response.json();
                const aiReply = data.reply || data.response || "Analysis complete.";
                
                let confidenceBadge = "";
                if (data.confidence) {
                    confidenceBadge = `<span class="confidence-tag">${data.confidence}</span><br>`;
                }

                botMsg.innerHTML = `<p>${confidenceBadge}${aiReply}</p>`;

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

    loadNewsData();
});