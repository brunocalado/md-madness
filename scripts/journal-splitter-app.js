const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Journal Splitter — splits journal page headings into individual pages in a new journal.
 */
export class JournalSplitterApp extends HandlebarsApplicationMixin(ApplicationV2) {

    /** @override */
    static DEFAULT_OPTIONS = {
        id: "journal-splitter-app",
        tag: "div",
        window: {
            title: "Journal Splitter",
            icon: "fas fa-cut",
            resizable: true
        },
        classes: ["md-madness", "journal-splitter-app"],
        position: { width: 850, height: 600 },
        actions: {
            split: JournalSplitterApp.prototype._onSplit
        }
    };

    /** @override */
    static PARTS = {
        form: { template: "modules/md-madness/templates/journal-splitter.hbs" }
    };

    constructor(options = {}) {
        super(options);
        this._selectedJournalId = "";
        this._selectedPages = [];
        this._h1Level = 1;
        this._h2Level = 2;
        this._h3Level = 3;
        this._titleColor = "#cc2222";
        this._showTitle = true;
        this._displayPageTitle = false;
    }

    /**
     * @override
     * @returns {Promise<object>}
     */
    async _prepareContext(_options) {
        const journals = game.journal.contents
            .map(j => ({ id: j.id, name: j.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const pages = this._selectedJournalId
            ? this._analyzeJournal(this._selectedJournalId)
            : [];
        this._selectedPages = pages;

        return {
            journals,
            pages,
            levelOptions: [
                { value: 1, label: "Level 1 (largest)" },
                { value: 2, label: "Level 2 (medium)" },
                { value: 3, label: "Level 3 (smallest)" }
            ],
            h1Level: this._h1Level,
            h2Level: this._h2Level,
            h3Level: this._h3Level,
            titleColor: this._titleColor,
            showTitle: this._showTitle,
            displayPageTitle: this._displayPageTitle,
            hasSelection: !!this._selectedJournalId,
            pageCount: pages.length
        };
    }

    // ---- Analysis ----

    /**
     * @param {string} journalId
     * @returns {{ id: string, name: string, type: string, isText: boolean }[]}
     */
    _analyzeJournal(journalId) {
        const journal = game.journal.get(journalId);
        if (!journal) return [];
        return journal.pages.contents.map(p => ({
            id: p.id, name: p.name, type: p.type, isText: p.type === "text"
        }));
    }

    // ---- Splitting Logic ----

    /**
     * Splits an HTML string into sections at every heading tag.
     * @param {string} htmlContent
     * @param {number} h1Level  Page level to assign to H1 sections.
     * @param {number} h2Level  Page level to assign to H2 sections.
     * @param {number} h3Level  Page level to assign to H3+ sections.
     * @returns {{ title: string|null, heading: number|null, level: number|null, nodes: Node[] }[]}
     */
    _splitPageByHeadings(htmlContent, h1Level, h2Level, h3Level) {
        const doc = new DOMParser().parseFromString(htmlContent, "text/html");
        const sections = [];
        let cur = { title: null, heading: null, level: null, nodes: [] };

        for (const node of Array.from(doc.body.childNodes)) {
            const tag = node.nodeName?.toLowerCase();
            if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) {
                sections.push({ ...cur, nodes: [...cur.nodes] });
                const hNum = parseInt(tag[1]);
                cur = {
                    title: node.textContent.trim(),
                    heading: hNum,
                    level: hNum === 1 ? h1Level : hNum === 2 ? h2Level : h3Level,
                    nodes: []
                };
            } else {
                cur.nodes.push(node.cloneNode(true));
            }
        }
        sections.push({ ...cur, nodes: [...cur.nodes] });
        return sections;
    }

    /**
     * Returns true if the node list contains any visible text (ignoring whitespace and void elements).
     * @param {Node[]} nodes
     * @returns {boolean}
     */
    _hasRealText(nodes) {
        for (const n of nodes) {
            if (n.nodeType === 3) { if (n.textContent.trim().length > 0) return true; continue; }
            if (["img", "br", "hr"].includes(n.nodeName?.toLowerCase())) continue;
            if ((n.textContent?.trim() || "").length > 0) return true;
        }
        return false;
    }

    /**
     * Merges empty heading sections into the next section to avoid blank pages.
     * @param {{ title: string|null, nodes: Node[] }[]} sections
     * @returns {{ title: string|null, nodes: Node[] }[]}
     */
    _mergeEmptySections(sections) {
        const result = [];
        let pendingNodes = [];

        for (let i = 0; i < sections.length; i++) {
            const sec = sections[i];
            if (sec.title === null) {
                result.push({ ...sec, nodes: [...pendingNodes, ...sec.nodes] });
                pendingNodes = [];
                continue;
            }
            if (this._hasRealText(sec.nodes)) {
                result.push({ ...sec, nodes: [...pendingNodes, ...sec.nodes] });
                pendingNodes = [];
            } else {
                pendingNodes = [...pendingNodes, ...sec.nodes];
                if (i === sections.length - 1 && pendingNodes.length > 0) {
                    if (result.length > 0) result[result.length - 1].nodes.push(...pendingNodes);
                    else result.push({ ...sec, nodes: pendingNodes });
                    pendingNodes = [];
                }
            }
        }

        if (pendingNodes.length > 0 && result.length > 0) {
            result[result.length - 1].nodes.push(...pendingNodes);
        }
        return result;
    }

    /**
     * Serializes a Node array back to an HTML string.
     * @param {Node[]} nodes
     * @returns {string}
     */
    _nodesToHtml(nodes) {
        const d = document.createElement("div");
        nodes.forEach(n => d.appendChild(n.cloneNode(true)));
        return d.innerHTML;
    }

    /**
     * Optionally prepends a styled title line to the page body HTML.
     * @param {string} title
     * @param {string} bodyHtml
     * @returns {string}
     */
    _buildPageContent(title, bodyHtml) {
        if (!this._showTitle) return bodyHtml;
        const t = `<p><span style="color:${this._titleColor};font-family:'Palatino Linotype',Georgia,serif;font-size:1.3em;font-weight:bold;text-decoration:underline;">${title}</span></p>`;
        return t + "\n" + bodyHtml;
    }

    // ---- Event Listeners ----

    /**
     * Attaches all non-action DOM listeners after render.
     * @override
     */
    _onRender(_context, _options) {
        const el = this.element;

        el.querySelector(".js-journal-select")?.addEventListener("change", e => {
            this._selectedJournalId = e.target.value;
            this.render();
        });

        el.querySelector(".js-h1-level")?.addEventListener("change", e => (this._h1Level = parseInt(e.target.value)));
        el.querySelector(".js-h2-level")?.addEventListener("change", e => (this._h2Level = parseInt(e.target.value)));
        el.querySelector(".js-h3-level")?.addEventListener("change", e => (this._h3Level = parseInt(e.target.value)));
        el.querySelector(".js-show-title")?.addEventListener("change", e => (this._showTitle = e.target.checked));
        el.querySelector(".js-display-page-title")?.addEventListener("change", e => (this._displayPageTitle = e.target.checked));

        const colorPick = el.querySelector(".js-title-color");
        colorPick?.addEventListener("input", e => {
            this._titleColor = e.target.value;
            const preview = el.querySelector(".js-title-preview");
            if (preview) preview.style.color = e.target.value;
        });
    }

    // ---- Actions ----

    /**
     * Splits the selected journal into a new journal, batching all page creates in one call.
     */
    async _onSplit() {
        if (!this._selectedJournalId) return;

        const journal = game.journal.get(this._selectedJournalId);
        if (!journal) return ui.notifications.error("Journal not found.");

        const newName = `${journal.name} (Split)`;
        ui.notifications.info(`Processing "${journal.name}"...`);

        const newJournal = await JournalEntry.create({
            name: newName,
            folder: journal.folder?.id
        });

        const pageData = [];
        let order = 0;

        for (const page of journal.pages.contents) {
            if (page.type !== "text") {
                pageData.push({
                    name: page.name, type: page.type,
                    title: { show: this._displayPageTitle, level: 1 },
                    sort: order++ * 100000
                });
                continue;
            }

            const html = page.text?.content || "";
            const sections = this._mergeEmptySections(
                this._splitPageByHeadings(html, this._h1Level, this._h2Level, this._h3Level)
            );

            if (sections.length <= 1) {
                pageData.push({
                    name: page.name, type: "text",
                    title: { show: this._displayPageTitle, level: 1 },
                    text: { content: this._nodesToHtml(sections[0]?.nodes || []), format: 1 },
                    sort: order++ * 100000
                });
                continue;
            }

            // First section keeps the original page name without an injected title.
            pageData.push({
                name: page.name, type: "text",
                title: { show: this._displayPageTitle, level: 1 },
                text: { content: this._nodesToHtml(sections[0].nodes), format: 1 },
                sort: order++ * 100000
            });

            for (let i = 1; i < sections.length; i++) {
                const sec = sections[i];
                if (!sec.title) continue;
                pageData.push({
                    name: sec.title, type: "text",
                    title: { show: this._displayPageTitle, level: sec.level ?? 1 },
                    text: { content: this._buildPageContent(sec.title, this._nodesToHtml(sec.nodes)), format: 1 },
                    sort: order++ * 100000
                });
            }
        }

        await newJournal.createEmbeddedDocuments("JournalEntryPage", pageData);

        ui.notifications.info(`"${newName}" created successfully!`);
        newJournal.sheet.render(true);
        this.close();
    }
}
