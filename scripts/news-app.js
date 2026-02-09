const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
import { MODULE_ID } from "./main.js";

export class NewsApp extends HandlebarsApplicationMixin(ApplicationV2) {

    constructor(options = {}) {
        options.window = options.window || {};
        if (options.title) options.window.title = options.title;
        super(options);
        
        this.newsConfig = {
            title: options.title || "📰 Arkham Advertiser",
            uuid: options.uuid,
            ads: options.ads,
            obituary: options.obituary || null, // Agora armazena o UUID do journal de obituário
            sound: "modules/md-madness/assets/sfx/paperflip.mp3"
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
  
    static DEFAULT_OPTIONS = {
        id: "arkham-reader-app",
        tag: "div",
        window: {
            icon: "fas fa-newspaper",
            resizable: true,
            width: 800,
            height: 850
        },
        position: { width: 800, height: 850 },
        classes: ["md-news-app"],
        actions: {} 
    };

    static PARTS = {
        main: { template: "modules/md-madness/templates/news-app.hbs" }
    };

    async _prepareContext(_options) {
        // Decide qual Journal carregar baseados no filtro
        let currentJournalUuid = this.newsConfig.uuid;
        const isObituaryMode = this.uiState.filter === "obituary";

        if (isObituaryMode && this.newsConfig.obituary) {
            currentJournalUuid = this.newsConfig.obituary;
        }

        const journal = currentJournalUuid ? (fromUuidSync(currentJournalUuid) || await fromUuid(currentJournalUuid)) : null;
        
        // Preferências são sempre salvas no journal PRINCIPAL para não fragmentar dados
        const mainJournal = this.newsConfig.uuid ? (fromUuidSync(this.newsConfig.uuid) || await fromUuid(this.newsConfig.uuid)) : null;
        const prefs = await this._getUserPreferences(mainJournal);
        
        const favorites = prefs.favorites || [];
        const hidelist = prefs.hidelist || [];

        // --- ADS LOGIC ---
        let adHtml = null;
        if (this.newsConfig.ads) {
            adHtml = this._cachedAd;
            if (!adHtml) {
                try {
                    const adJournal = fromUuidSync(this.newsConfig.ads) || await fromUuid(this.newsConfig.ads);
                    if (adJournal) {
                        const pages = adJournal.pages.contents;
                        if (pages.length > 0) {
                            const randomPage = pages[Math.floor(Math.random() * pages.length)];
                            const rawAd = randomPage.text.content || "";

                            // --- CLEANUP: Remove duplicatas e artefatos do Foundry (ProseMirror) ---
                            const adDiv = document.createElement("div");
                            adDiv.innerHTML = rawAd;
                            
                            // Remove containers de edição
                            adDiv.querySelectorAll(".edit-container").forEach(e => e.remove());
                            
                            // Remove estilos inline (copiados de dark mode, etc) e IDs de sessão
                            adDiv.querySelectorAll("*").forEach(e => {
                                e.removeAttribute("style");
                                if (e.id && e.id.startsWith("JournalEntryPageProseMirrorSheet")) e.removeAttribute("id");
                            });

                            const paragraphs = Array.from(adDiv.querySelectorAll("p"));
                            const seenText = new Set();
                            const cleanParts = [];

                            paragraphs.forEach(p => {
                                const txt = p.innerText.trim();
                                const key = txt.length > 0 ? txt : p.outerHTML; // Deduplica por texto ou HTML
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
                    console.warn("NewsApp | Erro ao carregar Ads:", err);
                }
            }
            if (!adHtml) adHtml = "<p>Anuncie aqui! Contate a redação.</p>";
        } 

        // --- PAGE LOGIC ---
        let allPages = journal ? journal.pages.contents : [];
        allPages = allPages.filter(p => p.name !== "metadata" && p.testUserPermission(game.user, "OBSERVER"));
        allPages.sort((a, b) => a.sort - b.sort);

        // -- MODO OBITUÁRIO --
        let obituaryList = [];
        if (isObituaryMode) {
            // Processa TODAS as páginas do journal de obituário
            obituaryList = allPages.map(p => this._extractImageAndContent(p));
        }

        // -- MODO JORNAL (Filtros Normais) --
        const filteredPages = isObituaryMode ? [] : allPages.filter(p => {
            const isFav = favorites.includes(p.id);
            const isHidden = hidelist.includes(p.id);
            if (this.uiState.filter === "favorites") return isFav;
            if (this.uiState.filter === "hidden") return isHidden;
            return !isHidden; 
        });

        // --- AUTO-SELECTION LOGIC ---
        // Se não estiver em modo obituário, faz a seleção automática
        if (!this.uiState.isAnimating && !isObituaryMode) {
            const isValidSelection = this.uiState.selectedPageId && filteredPages.some(p => p.id === this.uiState.selectedPageId);

            if (!isValidSelection) {
                if (filteredPages.length > 0) {
                    this.uiState.selectedPageId = filteredPages[0].id;
                    this.uiState.viewedPageId = filteredPages[0].id;
                } else {
                    this.uiState.selectedPageId = "";
                    this.uiState.viewedPageId = "";
                }
            } else {
                if (!this.uiState.viewedPageId) {
                    this.uiState.viewedPageId = this.uiState.selectedPageId;
                }
            }
        }

        let contentPage = null;
        if (this.uiState.viewedPageId && !isObituaryMode) {
            const originalPage = journal ? journal.pages.get(this.uiState.viewedPageId) : null;
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
                    const adContainer = `<div class="news-ad-box" style="border: 6px double #222; padding: 15px; margin: 20px 0; background: #c0b8a0; box-shadow: 0 4px 6px rgba(0,0,0,0.3); text-align: center;">${adHtml}</div>`;
                    const tempDiv = document.createElement("div");
                    tempDiv.innerHTML = contentPage.text.content;
                    
                    // SEGURANÇA: Verifica se já existe um box de anúncio no conteúdo (previne duplicação se a página foi salva com o ad)
                    if (!tempDiv.querySelector(".news-ad-box")) {
                        const paragraphs = Array.from(tempDiv.querySelectorAll("p"));
                        if (paragraphs.length > 0) {
                            const midIndex = Math.floor(paragraphs.length / 2);
                            paragraphs[midIndex].insertAdjacentHTML("afterend", adContainer);
                            contentPage.text.content = tempDiv.innerHTML;
                        } else {
                            contentPage.text.content += adContainer;
                        }
                    }
                }
            }
        }

        const isFavorite = this.uiState.selectedPageId ? favorites.includes(this.uiState.selectedPageId) : false;
        const isHidden = this.uiState.selectedPageId ? hidelist.includes(this.uiState.selectedPageId) : false;

        const selectOptions = filteredPages.map(p => ({
            id: p.id,
            name: p.name,
            isFavorite: favorites.includes(p.id),
            isHidden: hidelist.includes(p.id)
        }));

        return {
            pages: selectOptions,
            selectedPageId: this.uiState.selectedPageId, 
            contentPage: contentPage,                    
            filter: this.uiState.filter,
            isFavorite,
            isHidden,
            animationClass: this.uiState.animationClass,
            adContent: null,
            enableObituary: !!this.newsConfig.obituary, 
            isObituaryMode: isObituaryMode,
            obituaryList: obituaryList 
        };
    }

    /**
     * Helper para extrair imagem e limpar texto para o layout de obituário
     */
    _extractImageAndContent(page) {
        const defaultImg = "modules/md-madness/assets/images/obituary.webp";
        let imgSrc = defaultImg;
        let finalContent = "";

        if (page.type === "image") {
            imgSrc = page.src || defaultImg;
            finalContent = page.image.caption || ""; 
        } else {
            // É texto. Vamos parsear o HTML para achar <img src="...">
            const div = document.createElement("div");
            div.innerHTML = page.text.content;

            const imgElement = div.querySelector("img");
            if (imgElement) {
                imgSrc = imgElement.getAttribute("src") || defaultImg;
                // Remove a imagem do texto para não duplicar visualmente
                imgElement.remove();
            }

            finalContent = div.innerHTML;
        }

        return {
            id: page.id,
            name: page.name,
            content: finalContent,
            image: imgSrc
        };
    }

    _onRender(context, options) {
        const filterSelect = this.element.querySelector('#filter-select');
        if (filterSelect) {
            filterSelect.value = this.uiState.filter;
            filterSelect.addEventListener('click', (e) => e.stopPropagation());
            filterSelect.addEventListener('mousedown', (e) => e.stopPropagation());
            filterSelect.addEventListener('change', (e) => this._onChangeFilter(e));
        }

        const pageSelect = this.element.querySelector('#page-select');
        if (pageSelect) {
            if (this.uiState.selectedPageId) pageSelect.value = this.uiState.selectedPageId;
            pageSelect.addEventListener('click', (e) => e.stopPropagation());
            pageSelect.addEventListener('mousedown', (e) => e.stopPropagation());
            pageSelect.addEventListener('change', (e) => this._onChangePage(e));
        }

        const btnFav = this.element.querySelector('#btn-favorite');
        if (btnFav) btnFav.addEventListener('click', (e) => this._onToggleFavorite(e));

        const btnHide = this.element.querySelector('#btn-hide');
        if (btnHide) btnHide.addEventListener('click', (e) => this._onToggleHide(e));

        // --- OBITUARY IMAGE POPUP ---
        if (this.uiState.filter === "obituary") {
            // Seletor corrigido para incluir .news-viewport (usado no CSS atual) e .obituary-list
            const images = this.element.querySelectorAll(".news-viewport img, .obituary-list img, .news-content-wrapper img");
            images.forEach(img => {
                img.style.cursor = "zoom-in";
                img.style.pointerEvents = "auto";

                img.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const src = img.getAttribute("src") || img.src;
                    if (src) {
                        new foundry.applications.apps.ImagePopout({
                            src: src,
                            window: { title: "Obituário" }
                        }).render(true);
                    }
                });
            });
        }
    }

    async _onChangeFilter(event) {
        event.preventDefault();
        event.stopPropagation();
        this.uiState.filter = event.target.value;
        // Se mudou para obituário, limpa seleção. Se saiu, o prepareContext resolve.
        if (this.uiState.filter === "obituary") {
            this.uiState.selectedPageId = "";
            this.uiState.viewedPageId = "";
        }
        this.render();
    }

    async _onChangePage(event) {
        event.preventDefault(); 
        event.stopPropagation();
        
        // Bloqueia troca de página manual se estiver em modo obituário
        if (this.uiState.filter === "obituary") return;

        const newPageId = event.target.value;
        if (newPageId === this.uiState.selectedPageId || this.uiState.isAnimating) return;

        const journal = await this._getJournal();
        const allPages = journal.pages.contents
            .filter(p => p.name !== "metadata")
            .sort((a, b) => a.sort - b.sort);
        
        const oldIndex = allPages.findIndex(p => p.id === this.uiState.selectedPageId);
        const newIndex = allPages.findIndex(p => p.id === newPageId);
        
        const direction = (oldIndex !== -1 && newIndex < oldIndex) ? 'back' : 'forward';

        this.uiState.isAnimating = true;
        this.uiState.selectedPageId = newPageId;

        if (this.newsConfig.sound) {
            foundry.audio.AudioHelper.play({ src: this.newsConfig.sound, volume: 0.5, autoplay: true, loop: false }, false);
        }

        if (direction === 'back') {
             this.uiState.animationClass = "page-back-out";
        } else {
             this.uiState.animationClass = "page-turn-out";
        }
        await this.render();

        await new Promise(r => setTimeout(r, 450));

        this.uiState.viewedPageId = newPageId;
        
        if (direction === 'back') {
            this.uiState.animationClass = "page-back-in";
        } else {
            this.uiState.animationClass = "page-turn-in";
        }
        await this.render();

        setTimeout(() => {
            this.uiState.animationClass = "";
            this.uiState.isAnimating = false;
            this.render();
        }, 600);
    }

    async _onToggleFavorite(event) {
        event.preventDefault();
        event.stopPropagation();
        if (!this.uiState.selectedPageId || this.uiState.filter === "obituary") return;

        await this._modifyList("hidelist", this.uiState.selectedPageId, true);
        await this._modifyList("favorites", this.uiState.selectedPageId);
        this.render();
    }

    async _onToggleHide(event) {
        event.preventDefault();
        event.stopPropagation();
        if (!this.uiState.selectedPageId || this.uiState.filter === "obituary") return;

        await this._modifyList("favorites", this.uiState.selectedPageId, true);
        await this._modifyList("hidelist", this.uiState.selectedPageId);
        this.render();
    }

    async _modifyList(type, pageId, forceRemove = false) {
        const journal = await this._getJournal();
        const metadataPage = journal.pages.find(p => p.name === "metadata");
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

    // Helper para pegar o jornal PRINCIPAL (usado para salvar flags e carregar páginas padrão)
    async _getJournal() {
        if (this.newsConfig.uuid) return fromUuid(this.newsConfig.uuid);
        return null;
    }

    async _getUserPreferences(journal) {
        if (!journal) return {};
        let metadataPage = journal.pages.find(p => p.name === "metadata");

        if (!metadataPage) {
            if (game.user.isGM) {
                try {
                    [metadataPage] = await journal.createEmbeddedDocuments("JournalEntryPage", [{
                        name: "metadata",
                        type: "text",
                        text: { content: "<p>SYSTEM DATA - DO NOT DELETE</p>" },
                        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER }
                    }]);
                } catch (err) { return {}; }
            } else { return {}; }
        }
        
        if (game.user.isGM && metadataPage.ownership.default !== CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) {
             await metadataPage.update({ "ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
        }

        const actorKey = this._getActorKey();
        const data = metadataPage.getFlag(MODULE_ID, actorKey) || { favorites: [], hidelist: [] };
        return data;
    }

    _getActorKey() {
        return game.user.character?.uuid || game.user.uuid;
    }
}