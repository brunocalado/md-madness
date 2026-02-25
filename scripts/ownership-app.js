const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Ownership Manager - Bulk ownership editor for folders and documents.
 * Integrated into MD Madness.
 */
export class OwnershipApp extends HandlebarsApplicationMixin(ApplicationV2) {

    /** @override */
    static DEFAULT_OPTIONS = {
        id: "ownership-app",
        tag: "div",
        window: {
            title: "Ownership Manager",
            icon: "fas fa-lock",
            resizable: true,
            width: 850,
            height: 600
        },
        classes: ["ownership-app"],
        position: {
            width: 850,
            height: 600
        },
        actions: {
            selectAll: OwnershipApp.prototype._onSelectAll,
            deselectAll: OwnershipApp.prototype._onDeselectAll,
            applyOwnership: OwnershipApp.prototype._onApplyOwnership
        }
    };

    /** @override */
    static PARTS = {
        form: {
            template: "modules/md-madness/templates/ownership.hbs"
        }
    };

    constructor(options = {}) {
        super(options);
        this.selectedFolders = new Set();
    }

    async _prepareContext(_options) {
        const documentTypes = [
            { key: "Actor", label: "Atores", collection: game.actors },
            { key: "Item", label: "Itens", collection: game.items },
            { key: "JournalEntry", label: "Diários", collection: game.journal },
            { key: "RollTable", label: "Tabelas", collection: game.tables },
            { key: "Macro", label: "Macros", collection: game.macros },
            { key: "Playlist", label: "Playlists", collection: game.playlists },
            { key: "Scene", label: "Cenas", collection: game.scenes },
            { key: "Cards", label: "Cartas", collection: game.cards }
        ];

        const users = game.users.map(u => ({
            id: u.id,
            name: u.name,
            isGM: u.isGM
        }));

        const ownershipLevels = [
            { value: 0, label: "Nenhum" },
            { value: 1, label: "Limitado" },
            { value: 2, label: "Observador" },
            { value: 3, label: "Proprietário" }
        ];

        const tree = this._buildFolderTree(documentTypes);
        const treeHtml = this._renderTree(tree);

        return { users, ownershipLevels, treeHtml };
    }

    // ---- Tree Building ----

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
                    name: `Sem Pasta (${orphanDocs.length})`,
                    type: "orphan",
                    documentType: type.key,
                    isLeaf: true
                });
            }

            tree.push(typeNode);
        }

        return tree;
    }

    _buildFolderNode(folder, collection) {
        const node = {
            id: folder.id,
            name: folder.name,
            type: "folder",
            documentType: folder.type,
            children: []
        };

        const subfolders = game.folders.filter(f => f.folder?.id === folder.id);
        for (const subfolder of subfolders) {
            node.children.push(this._buildFolderNode(subfolder, collection));
        }

        const docs = collection.filter(d => d.folder?.id === folder.id);
        if (docs.length > 0) {
            node.children.push({
                id: `docs-${folder.id}`,
                name: `Documentos (${docs.length})`,
                type: "documents",
                parentFolder: folder.id,
                isLeaf: true
            });
        }

        return node;
    }

    _renderTree(nodes, level = 0) {
        let html = "";

        for (const node of nodes) {
            const hasChildren = node.children && node.children.length > 0;
            const isLeaf = node.isLeaf || !hasChildren;
            const classes = ["tree-item"];
            if (level > 0) classes.push("child");
            if (isLeaf) classes.push("leaf");

            const icon = node.type === "type" ? "fa-database"
                : node.type === "folder" ? "fa-folder"
                : node.type === "documents" ? "fa-file-alt"
                : "fa-file";

            html += `<div class="${classes.join(" ")}">`;
            html += `<div class="tree-item-header">`;

            if (!isLeaf) {
                html += `<span class="folder-toggle"></span>`;
            } else {
                html += `<span class="folder-toggle" style="visibility:hidden;"></span>`;
            }

            html += `<input type="checkbox" class="tree-checkbox" data-id="${node.id}" data-type="${node.type}">`;
            html += `<i class="fas ${icon} tree-icon"></i>`;
            html += `<span class="tree-label">${node.name}</span>`;
            html += `</div>`;

            if (hasChildren) {
                html += `<div class="tree-children">`;
                html += this._renderTree(node.children, level + 1);
                html += `</div>`;
            }

            html += `</div>`;
        }

        return html;
    }

    // ---- Document Resolution ----

    _getCollection(type) {
        const map = {
            Actor: game.actors,
            Item: game.items,
            JournalEntry: game.journal,
            RollTable: game.tables,
            Macro: game.macros,
            Playlist: game.playlists,
            Scene: game.scenes,
            Cards: game.cards
        };
        return map[type];
    }

    _getSelectedDocuments() {
        const documents = [];

        for (const id of this.selectedFolders) {
            if (id.startsWith("docs-")) {
                const folderId = id.replace("docs-", "");
                const folder = game.folders.get(folderId);
                if (folder) {
                    const collection = this._getCollection(folder.type);
                    documents.push(...collection.filter(d => d.folder?.id === folderId));
                }
            } else if (id.startsWith("orphan-")) {
                const type = id.replace("orphan-", "");
                const collection = this._getCollection(type);
                documents.push(...collection.filter(d => !d.folder));
            } else {
                const folder = game.folders.get(id);
                if (folder) {
                    documents.push(...this._getAllDocumentsInFolder(folder));
                }
            }
        }

        return [...new Set(documents)];
    }

    _getAllDocumentsInFolder(folder) {
        const documents = [];
        const collection = this._getCollection(folder.type);

        documents.push(...collection.filter(d => d.folder?.id === folder.id));

        const subfolders = game.folders.filter(f => f.folder?.id === folder.id);
        for (const subfolder of subfolders) {
            documents.push(...this._getAllDocumentsInFolder(subfolder));
        }

        return documents;
    }

    // ---- Ownership Helpers ----

    _getOwnershipLabel(level) {
        const labels = { 0: "Nenhum", 1: "Limitado", 2: "Observador", 3: "Proprietário" };
        return labels[level] || "Desconhecido";
    }

    _getCurrentOwnership(doc, userId) {
        if (!doc.ownership) return "Nenhum";
        if (userId === "default") {
            return this._getOwnershipLabel(doc.ownership.default || 0);
        }
        return this._getOwnershipLabel(doc.ownership[userId] || doc.ownership.default || 0);
    }

    // ---- Event Listeners ----

    _onRender(context, options) {
        const el = this.element;

        // Search
        const searchInput = el.querySelector("#om-search-input");
        searchInput?.addEventListener("input", (e) => {
            this._filterTree(e.target.value.toLowerCase());
        });

        // Toggle expansion
        el.querySelectorAll(".folder-toggle").forEach(toggle => {
            toggle.addEventListener("click", (e) => {
                e.stopPropagation();
                const item = e.currentTarget.closest(".tree-item");
                item.classList.toggle("expanded");
            });
        });

        // Checkbox selection
        el.querySelectorAll(".tree-checkbox").forEach(cb => {
            cb.addEventListener("change", (e) => {
                const id = e.currentTarget.dataset.id;
                if (e.currentTarget.checked) {
                    this.selectedFolders.add(id);
                } else {
                    this.selectedFolders.delete(id);
                }
                this._updateSelectedCount();
                this._updatePreview();
            });
        });

        // Ownership / user change
        el.querySelector("#om-ownership-level")?.addEventListener("change", () => this._updatePreview());
        el.querySelector("#om-target-user")?.addEventListener("change", () => this._updatePreview());

        this._updatePreview();
    }

    _filterTree(term) {
        const items = this.element.querySelectorAll(".tree-item");
        items.forEach(item => {
            const label = item.querySelector(".tree-label")?.textContent.toLowerCase() || "";
            if (term === "" || label.includes(term)) {
                item.style.display = "";
                if (term !== "") {
                    let parent = item.parentElement?.closest(".tree-item");
                    while (parent) {
                        parent.classList.add("expanded");
                        parent.style.display = "";
                        parent = parent.parentElement?.closest(".tree-item");
                    }
                }
            } else {
                item.style.display = "none";
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

        let html = `<div class="om-preview-summary">`;
        html += `<strong>${documents.length} documento(s) afetados</strong><br>`;

        if (userId === "default") {
            html += `Ownership Padrão: <span class="om-badge level-${level}">${this._getOwnershipLabel(level)}</span>`;
        } else {
            const user = game.users.get(userId);
            html += `Usuário: <strong>${user?.name}</strong><br>`;
            html += `Nível: <span class="om-badge level-${level}">${this._getOwnershipLabel(level)}</span>`;
        }
        html += `</div>`;

        if (documents.length > 0) {
            html += `<div class="om-preview-docs"><strong>Exemplos:</strong><ul>`;
            const sample = documents.slice(0, 10);
            for (const doc of sample) {
                const current = this._getCurrentOwnership(doc, userId);
                html += `<li>${doc.name} <span class="om-current">(Atual: ${current})</span></li>`;
            }
            if (documents.length > 10) {
                html += `<li>... e mais ${documents.length - 10} documento(s)</li>`;
            }
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
        this.element.querySelectorAll(".tree-checkbox").forEach(cb => {
            cb.checked = false;
        });
        this.selectedFolders.clear();
        this._updateSelectedCount();
        this._updatePreview();
    }

    async _onApplyOwnership() {
        const el = this.element;
        const level = parseInt(el.querySelector("#om-ownership-level")?.value ?? 0);
        const userId = el.querySelector("#om-target-user")?.value ?? "default";
        const documents = this._getSelectedDocuments();

        if (documents.length === 0) {
            ui.notifications.warn("Nenhum documento selecionado!");
            return;
        }

        const confirmed = await Dialog.confirm({
            title: "Confirmar Mudança de Ownership",
            content: `<p>Modificar ownership de <strong>${documents.length} documento(s)</strong>?</p>
                      <p>Esta ação não pode ser desfeita facilmente.</p>`
        });

        if (!confirmed) return;

        ui.notifications.info(`Aplicando ownership a ${documents.length} documentos...`);

        let updated = 0;
        let errors = 0;

        for (const doc of documents) {
            try {
                const currentOwnership = foundry.utils.duplicate(doc.ownership || {});

                if (userId === "default") {
                    currentOwnership.default = level;
                } else {
                    currentOwnership[userId] = level;
                }

                await doc.update({ ownership: currentOwnership });
                updated++;
            } catch (err) {
                console.error(`Erro ao atualizar ${doc.name}:`, err);
                errors++;
            }
        }

        if (errors === 0) {
            ui.notifications.info(`Ownership atualizada em ${updated} documento(s)!`);
        } else {
            ui.notifications.warn(`${updated} atualizados, ${errors} falharam.`);
        }

        this.selectedFolders.clear();
        this.element.querySelectorAll(".tree-checkbox").forEach(cb => cb.checked = false);
        this._updateSelectedCount();
        this._updatePreview();
    }
}
