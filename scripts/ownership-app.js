const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * Ownership Manager — bulk ownership editor for folders and world documents.
 */
export class OwnershipApp extends HandlebarsApplicationMixin(ApplicationV2) {

    /** @override */
    static DEFAULT_OPTIONS = {
        id: "ownership-app",
        tag: "div",
        window: {
            title: "Ownership Manager",
            icon: "fas fa-lock",
            resizable: true
        },
        classes: ["md-madness", "ownership-app"],
        position: { width: 850, height: 600 },
        actions: {
            selectAll: OwnershipApp.prototype._onSelectAll,
            deselectAll: OwnershipApp.prototype._onDeselectAll,
            applyOwnership: OwnershipApp.prototype._onApplyOwnership
        }
    };

    /** @override */
    static PARTS = {
        form: { template: "modules/md-madness/templates/ownership.hbs" }
    };

    constructor(options = {}) {
        super(options);
        this.selectedFolders = new Set();
    }

    /**
     * @override
     * @returns {Promise<object>}
     */
    async _prepareContext(_options) {
        const documentTypes = [
            { key: "Actor", label: "Actors", collection: game.actors },
            { key: "Item", label: "Items", collection: game.items },
            { key: "JournalEntry", label: "Journals", collection: game.journal },
            { key: "RollTable", label: "Tables", collection: game.tables },
            { key: "Macro", label: "Macros", collection: game.macros },
            { key: "Playlist", label: "Playlists", collection: game.playlists },
            { key: "Scene", label: "Scenes", collection: game.scenes },
            { key: "Cards", label: "Cards", collection: game.cards }
        ];

        const users = game.users.map(u => ({ id: u.id, name: u.name, isGM: u.isGM }));

        const ownershipLevels = [
            { value: 0, label: "None" },
            { value: 1, label: "Limited" },
            { value: 2, label: "Observer" },
            { value: 3, label: "Owner" }
        ];

        return { users, ownershipLevels, treeHtml: this._renderTree(this._buildFolderTree(documentTypes)) };
    }

    // ---- Tree Building ----

    /**
     * Builds a virtual folder tree from all registered document types.
     * @param {{ key: string, label: string, collection: WorldCollection }[]} documentTypes
     * @returns {object[]}
     */
    _buildFolderTree(documentTypes) {
        const tree = [];
        for (const type of documentTypes) {
            const folders = game.folders.filter(f => f.type === type.key);
            const rootFolders = folders.filter(f => !f.folder);
            if (rootFolders.length === 0 && type.collection.size === 0) continue;

            const typeNode = {
                id: `type-${type.key}`,
                name: type.label,
                type: "type",
                documentType: type.key,
                children: []
            };

            for (const folder of rootFolders) {
                typeNode.children.push(this._buildFolderNode(folder, type.collection));
            }

            const orphanDocs = type.collection.filter(d => !d.folder);
            if (orphanDocs.length > 0) {
                typeNode.children.push({
                    id: `orphan-${type.key}`,
                    name: `No Folder (${orphanDocs.length})`,
                    type: "orphan",
                    documentType: type.key,
                    isLeaf: true
                });
            }

            tree.push(typeNode);
        }
        return tree;
    }

    /**
     * @param {Folder} folder
     * @param {WorldCollection} collection
     * @returns {object}
     */
    _buildFolderNode(folder, collection) {
        const node = { id: folder.id, name: folder.name, type: "folder", documentType: folder.type, children: [] };
        for (const subfolder of game.folders.filter(f => f.folder?.id === folder.id)) {
            node.children.push(this._buildFolderNode(subfolder, collection));
        }
        const docs = collection.filter(d => d.folder?.id === folder.id);
        if (docs.length > 0) {
            node.children.push({ id: `docs-${folder.id}`, name: `Documents (${docs.length})`, type: "documents", parentFolder: folder.id, isLeaf: true });
        }
        return node;
    }

    /**
     * Recursively renders the folder tree to an HTML string for injection into the template.
     * @param {object[]} nodes
     * @param {number} [level=0]
     * @returns {string}
     */
    _renderTree(nodes, level = 0) {
        let html = "";
        for (const node of nodes) {
            const hasChildren = node.children?.length > 0;
            const isLeaf = node.isLeaf || !hasChildren;
            const classes = ["tree-item", level > 0 && "child", isLeaf && "leaf"].filter(Boolean);
            const icon = node.type === "type" ? "fa-database"
                : node.type === "folder" ? "fa-folder"
                : node.type === "documents" ? "fa-file-alt"
                : "fa-file";

            html += `<div class="${classes.join(" ")}">`;
            html += `<div class="tree-item-header">`;
            html += isLeaf
                ? `<span class="folder-toggle" style="visibility:hidden;"></span>`
                : `<span class="folder-toggle"></span>`;
            html += `<input type="checkbox" class="tree-checkbox" data-id="${node.id}" data-type="${node.type}">`;
            html += `<i class="fas ${icon} tree-icon"></i>`;
            html += `<span class="tree-label">${node.name}</span>`;
            html += `</div>`;
            if (hasChildren) {
                html += `<div class="tree-children">${this._renderTree(node.children, level + 1)}</div>`;
            }
            html += `</div>`;
        }
        return html;
    }

    // ---- Document Resolution ----

    /** @param {string} type @returns {WorldCollection} */
    _getCollection(type) {
        const map = {
            Actor: game.actors, Item: game.items, JournalEntry: game.journal,
            RollTable: game.tables, Macro: game.macros, Playlist: game.playlists,
            Scene: game.scenes, Cards: game.cards
        };
        return map[type];
    }

    /**
     * Resolves the full list of Document instances for all selected checkboxes.
     * @returns {ClientDocument[]}
     */
    _getSelectedDocuments() {
        const documents = [];
        for (const id of this.selectedFolders) {
            if (id.startsWith("docs-")) {
                const folder = game.folders.get(id.replace("docs-", ""));
                if (folder) documents.push(...this._getCollection(folder.type).filter(d => d.folder?.id === folder.id));
            } else if (id.startsWith("orphan-")) {
                const collection = this._getCollection(id.replace("orphan-", ""));
                documents.push(...collection.filter(d => !d.folder));
            } else {
                const folder = game.folders.get(id);
                if (folder) documents.push(...this._getAllDocumentsInFolder(folder));
            }
        }
        return [...new Set(documents)];
    }

    /**
     * Recursively collects all documents inside a folder and its subfolders.
     * @param {Folder} folder
     * @returns {ClientDocument[]}
     */
    _getAllDocumentsInFolder(folder) {
        const collection = this._getCollection(folder.type);
        const docs = collection.filter(d => d.folder?.id === folder.id);
        for (const subfolder of game.folders.filter(f => f.folder?.id === folder.id)) {
            docs.push(...this._getAllDocumentsInFolder(subfolder));
        }
        return docs;
    }

    // ---- Ownership Helpers ----

    /** @param {number} level @returns {string} */
    _getOwnershipLabel(level) {
        return { 0: "None", 1: "Limited", 2: "Observer", 3: "Owner" }[level] ?? "Unknown";
    }

    /**
     * @param {ClientDocument} doc
     * @param {string} userId
     * @returns {string}
     */
    _getCurrentOwnership(doc, userId) {
        if (!doc.ownership) return "None";
        const level = userId === "default"
            ? doc.ownership.default ?? 0
            : doc.ownership[userId] ?? doc.ownership.default ?? 0;
        return this._getOwnershipLabel(level);
    }

    // ---- Event Listeners ----

    /**
     * Attaches all non-action DOM listeners after render.
     * @override
     */
    _onRender(_context, _options) {
        const el = this.element;

        el.querySelector("#om-search-input")?.addEventListener("input", e => {
            this._filterTree(e.target.value.toLowerCase());
        });

        el.querySelectorAll(".folder-toggle").forEach(toggle => {
            toggle.addEventListener("click", e => {
                e.stopPropagation();
                e.currentTarget.closest(".tree-item").classList.toggle("expanded");
            });
        });

        el.querySelectorAll(".tree-checkbox").forEach(cb => {
            cb.addEventListener("change", e => {
                const id = e.currentTarget.dataset.id;
                if (e.currentTarget.checked) this.selectedFolders.add(id);
                else this.selectedFolders.delete(id);
                this._updateSelectedCount();
                this._updatePreview();
            });
        });

        el.querySelector("#om-ownership-level")?.addEventListener("change", () => this._updatePreview());
        el.querySelector("#om-target-user")?.addEventListener("change", () => this._updatePreview());

        this._updatePreview();
    }

    /** @param {string} term */
    _filterTree(term) {
        this.element.querySelectorAll(".tree-item").forEach(item => {
            const label = item.querySelector(".tree-label")?.textContent.toLowerCase() ?? "";
            const visible = term === "" || label.includes(term);
            item.style.display = visible ? "" : "none";
            if (visible && term !== "") {
                let parent = item.parentElement?.closest(".tree-item");
                while (parent) {
                    parent.classList.add("expanded");
                    parent.style.display = "";
                    parent = parent.parentElement?.closest(".tree-item");
                }
            }
        });
    }

    _updateSelectedCount() {
        const counter = this.element.querySelector("#om-selected-count");
        if (counter) counter.textContent = this.selectedFolders.size;
    }

    _updatePreview() {
        const el = this.element;
        const level = parseInt(el.querySelector("#om-ownership-level")?.value ?? 0);
        const userId = el.querySelector("#om-target-user")?.value ?? "default";
        const documents = this._getSelectedDocuments();

        let html = `<div class="om-preview-summary"><strong>${documents.length} document(s) affected</strong><br>`;
        if (userId === "default") {
            html += `Default Ownership: <span class="om-badge level-${level}">${this._getOwnershipLabel(level)}</span>`;
        } else {
            const user = game.users.get(userId);
            html += `User: <strong>${user?.name}</strong><br>Level: <span class="om-badge level-${level}">${this._getOwnershipLabel(level)}</span>`;
        }
        html += `</div>`;

        if (documents.length > 0) {
            html += `<div class="om-preview-docs"><strong>Examples:</strong><ul>`;
            documents.slice(0, 10).forEach(doc => {
                html += `<li>${doc.name} <span class="om-current">(Current: ${this._getCurrentOwnership(doc, userId)})</span></li>`;
            });
            if (documents.length > 10) html += `<li>... and ${documents.length - 10} more</li>`;
            html += `</ul></div>`;
        }

        const previewBox = el.querySelector("#om-preview-content");
        if (previewBox) previewBox.innerHTML = html;
    }

    // ---- Actions ----

    _onSelectAll() {
        this.element.querySelectorAll(".tree-checkbox").forEach(cb => {
            cb.checked = true;
            this.selectedFolders.add(cb.dataset.id);
        });
        this._updateSelectedCount();
        this._updatePreview();
    }

    _onDeselectAll() {
        this.element.querySelectorAll(".tree-checkbox").forEach(cb => (cb.checked = false));
        this.selectedFolders.clear();
        this._updateSelectedCount();
        this._updatePreview();
    }

    /**
     * Applies the selected ownership level to all selected documents in one batch per document type.
     */
    async _onApplyOwnership() {
        const el = this.element;
        const level = parseInt(el.querySelector("#om-ownership-level")?.value ?? 0);
        const userId = el.querySelector("#om-target-user")?.value ?? "default";
        const documents = this._getSelectedDocuments();

        if (documents.length === 0) {
            ui.notifications.warn("No documents selected!");
            return;
        }

        const confirmed = await DialogV2.confirm({
            window: { title: "Confirm Ownership Change" },
            content: `<p>Modify ownership of <strong>${documents.length} document(s)</strong>?</p>
                      <p>This action is difficult to undo.</p>`,
            rejectClose: false
        });

        if (!confirmed) return;

        ui.notifications.info(`Applying ownership to ${documents.length} documents...`);

        // Group by document type to batch per-type rather than per-document.
        const byType = new Map();
        for (const doc of documents) {
            const key = doc.documentName;
            if (!byType.has(key)) byType.set(key, []);
            byType.get(key).push(doc);
        }

        let updated = 0;
        let errors = 0;

        for (const [documentName, docs] of byType) {
            try {
                const DocumentClass = getDocumentClass(documentName);
                const updates = docs.map(doc => {
                    const ownership = foundry.utils.duplicate(doc.ownership ?? {});
                    if (userId === "default") ownership.default = level;
                    else ownership[userId] = level;
                    return { _id: doc.id, ownership };
                });
                const results = await DocumentClass.implementation.updateDocuments(updates);
                updated += results.length;
            } catch (err) {
                console.error(`Error updating ${documentName}:`, err);
                errors += docs.length;
            }
        }

        if (errors === 0) ui.notifications.info(`Ownership updated on ${updated} document(s)!`);
        else ui.notifications.warn(`${updated} updated, ${errors} failed.`);

        this.selectedFolders.clear();
        this.element.querySelectorAll(".tree-checkbox").forEach(cb => (cb.checked = false));
        this._updateSelectedCount();
        this._updatePreview();
    }
}
