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
        const journal = await this._getJournal();
        const prefs = await this._getUserPreferences(journal);
        const favorites = prefs.favorites || [];
        const hidelist = prefs.hidelist || [];

        // --- ADS LOGIC ---
        let adContent = null;
        if (this.newsConfig.ads) {
            adContent = this._cachedAd;
            if (!adContent) {
                try {
                    const adJournal = fromUuidSync(this.newsConfig.ads) || await fromUuid(this.newsConfig.ads);
                    if (adJournal) {
                        const pages = adJournal.pages.contents;
                        if (pages.length > 0) {
                            const randomPage = pages[Math.floor(Math.random() * pages.length)];
                            const tempDiv = document.createElement("div");
                            tempDiv.innerHTML = randomPage.text.content;
                            adContent = (tempDiv.textContent || tempDiv.innerText || "").trim();
                            this._cachedAd = adContent;
                        }
                    }
                } catch (err) {
                    console.warn("NewsApp | Erro ao carregar Ads:", err);
                }
            }
            if (!adContent) adContent = "Anuncie aqui! Contate a redação.";
        } 

        // --- PAGE LOGIC ---
        let allPages = journal ? journal.pages.contents : [];
        allPages = allPages.filter(p => p.name !== "metadata" && p.testUserPermission(game.user, "OBSERVER"));
        allPages.sort((a, b) => a.sort - b.sort);

        // Filtra as páginas baseadas no filtro atual
        const filteredPages = allPages.filter(p => {
            const isFav = favorites.includes(p.id);
            const isHidden = hidelist.includes(p.id);
            if (this.uiState.filter === "favorites") return isFav;
            if (this.uiState.filter === "hidden") return isHidden;
            return !isHidden; 
        });

        // --- AUTO-SELECTION LOGIC (UPDATED) ---
        // Se não estamos no meio de uma animação, validamos o estado
        if (!this.uiState.isAnimating) {
            
            // Verifica se a seleção atual ainda é válida dentro do novo filtro
            const isValidSelection = this.uiState.selectedPageId && filteredPages.some(p => p.id === this.uiState.selectedPageId);

            if (!isValidSelection) {
                // Se não temos seleção ou ela não é mais válida no filtro atual
                if (filteredPages.length > 0) {
                    // Seleciona automaticamente a primeira página da lista
                    this.uiState.selectedPageId = filteredPages[0].id;
                    this.uiState.viewedPageId = filteredPages[0].id;
                } else {
                    // Nenhuma página disponível neste filtro
                    this.uiState.selectedPageId = "";
                    this.uiState.viewedPageId = "";
                }
            } else {
                // Se temos uma seleção válida, garante que o que está sendo visto é o selecionado
                // (Exceto durante animação, mas já checamos isAnimating acima)
                if (!this.uiState.viewedPageId) {
                    this.uiState.viewedPageId = this.uiState.selectedPageId;
                }
            }
        }

        let contentPage = null;
        if (this.uiState.viewedPageId) {
            contentPage = journal.pages.get(this.uiState.viewedPageId);
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
            adContent: adContent 
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
    }

    async _onChangeFilter(event) {
        event.preventDefault();
        event.stopPropagation();
        this.uiState.filter = event.target.value;
        
        // Removemos o reset forçado aqui. Deixamos o _prepareContext decidir:
        // 1. Se a página atual ainda existe no novo filtro, mantemos ela.
        // 2. Se não existe, o _prepareContext vai selecionar a primeira da lista.
        // this.uiState.selectedPageId = ""; 
        // this.uiState.viewedPageId = ""; 
        
        this.render();
    }

    async _onChangePage(event) {
        event.preventDefault(); 
        event.stopPropagation();

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
        if (!this.uiState.selectedPageId) return;

        await this._modifyList("hidelist", this.uiState.selectedPageId, true);
        await this._modifyList("favorites", this.uiState.selectedPageId);
        this.render();
    }

    async _onToggleHide(event) {
        event.preventDefault();
        event.stopPropagation();
        if (!this.uiState.selectedPageId) return;

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