const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Main application class for Quick Names.
 * Integrated into MD Madness.
 */
export class QuickNamesApp extends HandlebarsApplicationMixin(ApplicationV2) {
    
    /** @override */
    static DEFAULT_OPTIONS = {
        id: "quicknames-app",
        tag: "form",
        window: {
            title: "Quick Names",
            icon: "fas fa-book-open",
            resizable: true,
            width: 350,
            height: "auto"
        },
        classes: ["quicknames-app"],
        position: {
            width: 350,
            height: "auto"
        },
        actions: {
            generateName: QuickNamesApp.prototype._onGenerateName,
            copyName: QuickNamesApp.prototype._onCopyName
        }
    };

    /** @override */
    static PARTS = {
        form: {
            template: "modules/md-madness/templates/quicknames.hbs"
        }
    };

    async _prepareContext(_options) {
        const origins = [
            "Angels", "Arabic", "Brazilian", "Chinese", "Demons", 
            "Egyptian", "English", "German", "Greek", "Indian", 
            "Japanese", "Latin", "Nigerian", "Scandinavian", "Spanish"
        ];

        return {
            origins: origins,
            result: ""
        };
    }

    async _onGenerateName(event, target) {
        const formData = new FormData(this.element);
        const origin = formData.get("origin");
        const genderSelection = formData.get("gender"); 
        const hasSurname = formData.get("hasSurname") === "on";

        if (!origin) return;

        let firstNameTableName = "";
        let surnameTableName = "";
        let shouldRollSurname = hasSurname;

        if (["Angels", "Demons"].includes(origin)) {
            firstNameTableName = origin;
            shouldRollSurname = false; 
        } else {
            let genderToRoll = genderSelection;
            if (genderSelection === "all") {
                genderToRoll = Math.random() < 0.5 ? "Male" : "Female";
            }
            firstNameTableName = `${origin} ${genderToRoll}`;
            surnameTableName = `${origin} Surname`;
        }

        const firstName = await this._rollTableByName(firstNameTableName);
        let finalName = firstName;

        if (shouldRollSurname) {
            const surname = await this._rollTableByName(surnameTableName);
            if (surname) {
                finalName = `${firstName} ${surname}`;
            }
        }

        const resultInput = this.element.querySelector("#name-result");
        if (resultInput) {
            resultInput.value = finalName;
        }
    }

    _onCopyName(event, target) {
        const resultInput = this.element.querySelector("#name-result");
        const text = resultInput?.value;
        if (text) {
            game.clipboard.copyPlainText(text);
        }
    }

    /**
     * Helper to find a table by name and draw a result.
     */
    async _rollTableByName(tableName) {
        const pack = game.packs.get("md-madness.names");
        
        if (!pack) {
            ui.notifications.error(`MD Madness: Pack 'md-madness.names' not found! Check your module.json.`);
            return "";
        }

        const index = await pack.getIndex();
        const entry = index.find(e => e.name === tableName);

        if (!entry) return ""; 

        const table = await pack.getDocument(entry._id);
        const draw = await table.draw({ displayChat: false });
        
        if (!draw.results || draw.results.length === 0) return "";

        const result = draw.results[0];
        return result.name || "";
    }
}