import { MODULE_ID } from "./constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * NewsApp — displays a journal entry as a parchment newspaper with page-flip animation,
 * per-user favorites/hidden lists, optional ads, and an obituary mode.
 */
export class NewsApp extends HandlebarsApplicationMixin(ApplicationV2) {

    /**
     * @param {object} options
     * @param {string} options.uuid    UUID of the main journal entry to display.
     * @param {string} [options.title] Window title override.
     * @param {string} [options.ads]   UUID of the ads journal entry.
     * @param {string} [options.obituary] UUID of the obituary journal entry.
     */
    constructor(options = {}) {
        options.window = options.window || {};
        if (options.title) options.window.title = options.title;
        super(options);

        this.newsConfig = {
            title: options.title || "📰 Arkham Advertiser",
            uuid: options.uuid,
            ads: options.ads,
            obituary: options.obituary || null,
            sound: `modules/${MODULE_ID}/assets/sfx/paperflip.mp3`
        };

        this.uiState = {
            filter: "all",
            selectedPageId: "",
            viewedPageId: "",
            animationClass: "",
            isAnimating: false
        };

        this._cachedAd = null;
        this._cachedAdId = null;
    }

    /** @override */
    static DEFAULT_OPTIONS = {
        id: "arkham-reader-app",
        tag: "div",
        window: {
            icon: "fas fa-newspaper",
            resizable: true
        },
        classes: ["md-madness", "md-news-app"],
        position: { width: 800, height: 850 },
        actions: {}
    };

    /** @override */
    static PARTS = {
        main: { template: `modules/${MODULE_ID}/templates/news-app.hbs` }
    };

    /**
     * Builds the full render context: pages, content, ads, obituary list.
     * @override
     * @returns {Promise<object>}
     */
    async _prepareContext(_options) {
        const isObituaryMode = this.uiState.filter === "obituary";

        const currentJournalUuid = (isObituaryMode && this.newsConfig.obituary)
            ? this.newsConfig.obituary
            : this.newsConfig.uuid;

        const journal = currentJournalUuid
            ? (fromUuidSync(currentJournalUuid) ?? await fromUuid(currentJournalUuid))
            : null;

        // Preferences are always saved on the main journal to avoid fragmented data.
        const mainJournal = this.newsConfig.uuid
            ? (fromUuidSync(this.newsConfig.uuid) ?? await fromUuid(this.newsConfig.uuid))
            : null;
        const prefs = await this._getUserPreferences(mainJournal);

        const favorites = prefs.favorites || [];
        const hidelist = prefs.hidelist || [];

        // --- ADS ---
        let adHtml = null;
        if (this.newsConfig.ads) {
            adHtml = this._cachedAd;
            if (!adHtml) {
                try {
                    const adJournal = fromUuidSync(this.newsConfig.ads) ?? await fromUuid(this.newsConfig.ads);
                    if (adJournal) {
                        const pages = adJournal.pages.contents;
                        if (pages.length > 0) {
                            const randomPage = pages[Math.floor(Math.random() * pages.length)];
                            const rawAd = randomPage.text.content || "";

                            const adDiv = document.createElement("div");
                            adDiv.innerHTML = rawAd;

                            adDiv.querySelectorAll(".edit-container").forEach(e => e.remove());
                            adDiv.querySelectorAll("*").forEach(e => {
                                e.removeAttribute("style");
                                if (e.id?.startsWith("JournalEntryPageProseMirrorSheet")) e.removeAttribute("id");
                            });

                            const seenText = new Set();
                            const cleanParts = [];
                            adDiv.querySelectorAll("p").forEach(p => {
                                const key = p.innerText.trim() || p.outerHTML;
                                if (!seenText.has(key)) {
                                    seenText.add(key);
                                    cleanParts.push(p.outerHTML);
                                }
                            });

                            adHtml = cleanParts.length > 0 ? cleanParts.join("") : adDiv.innerHTML;
                            this._cachedAd = adHtml;
                            this._cachedAdId = randomPage.id;
                        }
                    }
                } catch (err) {
                    console.warn("NewsApp | Error loading Ads:", err);
                }
            }
            if (!adHtml) adHtml = "<p>Advertise here! Contact the newsroom.</p>";
        }

        // --- PAGES ---
        let allPages = journal ? journal.pages.contents : [];
        allPages = allPages
            .filter(p => p.name !== "metadata" && p.testUserPermission(game.user, "OBSERVER"))
            .sort((a, b) => a.sort - b.sort);

        // --- OBITUARY MODE ---
        let obituaryList = [];
        if (isObituaryMode) {
            obituaryList = allPages.map(p => this._extractImageAndContent(p));
        }

        // --- NORMAL MODE (with filters) ---
        const filteredPages = isObituaryMode ? [] : allPages.filter(p => {
            const isFav = favorites.includes(p.id);
            const isHidden = hidelist.includes(p.id);
            if (this.uiState.filter === "favorites") return isFav;
            if (this.uiState.filter === "hidden") return isHidden;
            return !isHidden;
        });

        if (!this.uiState.isAnimating && !isObituaryMode) {
            const isValidSelection = this.uiState.selectedPageId
                && filteredPages.some(p => p.id === this.uiState.selectedPageId);

            if (!isValidSelection) {
                this.uiState.selectedPageId = filteredPages[0]?.id ?? "";
                this.uiState.viewedPageId = filteredPages[0]?.id ?? "";
            } else if (!this.uiState.viewedPageId) {
                this.uiState.viewedPageId = this.uiState.selectedPageId;
            }
        }

        let contentPage = null;
        if (this.uiState.viewedPageId && !isObituaryMode) {
            const originalPage = journal?.pages.get(this.uiState.viewedPageId);
            if (originalPage) {
                contentPage = {
                    id: originalPage.id,
                    name: originalPage.name,
                    type: originalPage.type,
                    src: originalPage.src,
                    image: originalPage.image,
                    text: { content: originalPage.text.content }
                };

                if (adHtml && this._cachedAdId !== this.uiState.viewedPageId) {
                    const tempDiv = document.createElement("div");
                    tempDiv.innerHTML = contentPage.text.content;

                    // Guard against duplicate ad injection if the page was saved with the ad box already present.
                    if (!tempDiv.querySelector(".news-ad-box")) {
                        const adContainer = `<div class="news-ad-box" style="border:6px double #222;padding:15px;margin:20px 0;background:#c0b8a0;box-shadow:0 4px 6px rgba(0,0,0,0.3);text-align:center;">${adHtml}</div>`;
                        const paragraphs = Array.from(tempDiv.querySelectorAll("p"));
                        if (paragraphs.length > 0) {
                            paragraphs[Math.floor(paragraphs.length / 2)].insertAdjacentHTML("afterend", adContainer);
                        } else {
                            tempDiv.innerHTML += adContainer;
                        }
                        contentPage.text.content = tempDiv.innerHTML;
                    }
                }
            }
        }

        return {
            pages: filteredPages.map(p => ({
                id: p.id,
                name: p.name,
                isFavorite: favorites.includes(p.id),
                isHidden: hidelist.includes(p.id)
            })),
            selectedPageId: this.uiState.selectedPageId,
            contentPage,
            filter: this.uiState.filter,
            isFavorite: this.uiState.selectedPageId ? favorites.includes(this.uiState.selectedPageId) : false,
            isHidden: this.uiState.selectedPageId ? hidelist.includes(this.uiState.selectedPageId) : false,
            animationClass: this.uiState.animationClass,
            adContent: null,
            enableObituary: !!this.newsConfig.obituary,
            isObituaryMode,
            obituaryList
        };
    }

    /**
     * Extracts the lead image and cleaned text content from a page for obituary layout.
     * @param {JournalEntryPage} page
     * @returns {{ id: string, name: string, content: string, image: string }}
     */
    _extractImageAndContent(page) {
        const defaultImg = `modules/${MODULE_ID}/assets/images/obituary.webp`;

        if (page.type === "image") {
            return { id: page.id, name: page.name, content: page.image.caption || "", image: page.src || defaultImg };
        }

        const div = document.createElement("div");
        div.innerHTML = page.text.content;
        const imgEl = div.querySelector("img");
        const imgSrc = imgEl?.getAttribute("src") || defaultImg;
        imgEl?.remove();

        return { id: page.id, name: page.name, content: div.innerHTML, image: imgSrc };
    }

    /**
     * Attaches non-action DOM listeners after each render.
     * @override
     * @param {object} _context
     * @param {object} _options
     */
    _onRender(_context, _options) {
        const filterSelect = this.element.querySelector("#filter-select");
        if (filterSelect) {
            filterSelect.value = this.uiState.filter;
            filterSelect.addEventListener("click", e => e.stopPropagation());
            filterSelect.addEventListener("mousedown", e => e.stopPropagation());
            filterSelect.addEventListener("change", e => this._onChangeFilter(e));
        }

        const pageSelect = this.element.querySelector("#page-select");
        if (pageSelect) {
            if (this.uiState.selectedPageId) pageSelect.value = this.uiState.selectedPageId;
            pageSelect.addEventListener("click", e => e.stopPropagation());
            pageSelect.addEventListener("mousedown", e => e.stopPropagation());
            pageSelect.addEventListener("change", e => this._onChangePage(e));
        }

        this.element.querySelector("#btn-favorite")?.addEventListener("click", e => this._onToggleFavorite(e));
        this.element.querySelector("#btn-hide")?.addEventListener("click", e => this._onToggleHide(e));

        if (this.uiState.filter === "obituary") {
            this.element.querySelectorAll(".news-viewport img, .obituary-list img, .news-content-wrapper img")
                .forEach(img => {
                    img.style.cursor = "zoom-in";
                    img.style.pointerEvents = "auto";
                    img.addEventListener("click", ev => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        const src = img.getAttribute("src") || img.src;
                        if (src) new foundry.applications.apps.ImagePopout({ src, window: { title: "Obituário" } }).render(true);
                    });
                });
        }
    }

    /** @param {Event} event */
    async _onChangeFilter(event) {
        event.preventDefault();
        event.stopPropagation();
        this.uiState.filter = event.target.value;
        if (this.uiState.filter === "obituary") {
            this.uiState.selectedPageId = "";
            this.uiState.viewedPageId = "";
        }
        this.render();
    }

    /** @param {Event} event */
    async _onChangePage(event) {
        event.preventDefault();
        event.stopPropagation();

        if (this.uiState.filter === "obituary") return;

        const newPageId = event.target.value;
        if (newPageId === this.uiState.selectedPageId || this.uiState.isAnimating) return;

        const journal = await this._getJournal();
        const allPages = journal.pages.contents
            .filter(p => p.name !== "metadata")
            .sort((a, b) => a.sort - b.sort);

        const oldIndex = allPages.findIndex(p => p.id === this.uiState.selectedPageId);
        const newIndex = allPages.findIndex(p => p.id === newPageId);
        const direction = (oldIndex !== -1 && newIndex < oldIndex) ? "back" : "forward";

        this.uiState.isAnimating = true;
        this.uiState.selectedPageId = newPageId;

        if (this.newsConfig.sound) {
            foundry.audio.AudioHelper.play({ src: this.newsConfig.sound, volume: 0.5, autoplay: true, loop: false }, false);
        }

        this.uiState.animationClass = direction === "back" ? "page-back-out" : "page-turn-out";
        await this.render();
        await new Promise(r => setTimeout(r, 450));

        this.uiState.viewedPageId = newPageId;
        this.uiState.animationClass = direction === "back" ? "page-back-in" : "page-turn-in";
        await this.render();

        setTimeout(() => {
            this.uiState.animationClass = "";
            this.uiState.isAnimating = false;
            this.render();
        }, 600);
    }

    /** @param {Event} event */
    async _onToggleFavorite(event) {
        event.preventDefault();
        event.stopPropagation();
        if (!this.uiState.selectedPageId || this.uiState.filter === "obituary") return;
        await this._modifyList("hidelist", this.uiState.selectedPageId, true);
        await this._modifyList("favorites", this.uiState.selectedPageId);
        this.render();
    }

    /** @param {Event} event */
    async _onToggleHide(event) {
        event.preventDefault();
        event.stopPropagation();
        if (!this.uiState.selectedPageId || this.uiState.filter === "obituary") return;
        await this._modifyList("favorites", this.uiState.selectedPageId, true);
        await this._modifyList("hidelist", this.uiState.selectedPageId);
        this.render();
    }

    /**
     * Adds or removes a page ID from a user-preference list stored as a flag on the metadata page.
     * @param {"favorites"|"hidelist"} type
     * @param {string} pageId
     * @param {boolean} [forceRemove=false]
     */
    async _modifyList(type, pageId, forceRemove = false) {
        const journal = await this._getJournal();
        const metadataPage = journal?.pages.find(p => p.name === "metadata");
        if (!metadataPage) return;

        const actorKey = this._getActorKey();
        const currentData = metadataPage.getFlag(MODULE_ID, actorKey) || { actoruuid: actorKey, favorites: [], hidelist: [] };
        if (!Array.isArray(currentData.favorites)) currentData.favorites = [];
        if (!Array.isArray(currentData.hidelist)) currentData.hidelist = [];

        const list = currentData[type];
        const index = list.indexOf(pageId);
        if (forceRemove) {
            if (index > -1) list.splice(index, 1);
        } else {
            if (index > -1) list.splice(index, 1);
            else list.push(pageId);
        }

        await metadataPage.setFlag(MODULE_ID, actorKey, currentData);
    }

    /**
     * @returns {Promise<JournalEntry|null>}
     */
    async _getJournal() {
        return this.newsConfig.uuid ? fromUuid(this.newsConfig.uuid) : null;
    }

    /**
     * Fetches user preferences from the journal's metadata page, creating it if necessary.
     * @param {JournalEntry|null} journal
     * @returns {Promise<{ favorites: string[], hidelist: string[] }>}
     */
    async _getUserPreferences(journal) {
        if (!journal) return {};
        let metadataPage = journal.pages.find(p => p.name === "metadata");

        if (!metadataPage) {
            if (!game.user.isGM) return {};
            try {
                [metadataPage] = await journal.createEmbeddedDocuments("JournalEntryPage", [{
                    name: "metadata",
                    type: "text",
                    text: { content: "<p>SYSTEM DATA - DO NOT DELETE</p>" },
                    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER }
                }]);
            } catch (err) { return {}; }
        }

        if (game.user.isGM && metadataPage.ownership.default !== CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) {
            await metadataPage.update({ "ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
        }

        return metadataPage.getFlag(MODULE_ID, this._getActorKey()) || { favorites: [], hidelist: [] };
    }

    /**
     * Returns a stable key identifying the current user's linked character (or the user itself).
     * @returns {string}
     */
    _getActorKey() {
        return game.user.character?.uuid ?? game.user.uuid;
    }
}
