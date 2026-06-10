import { MODULE_ID } from "./constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Quick Names — draws a random name from the bundled RollTable compendium.
 */
export class QuickNamesApp extends HandlebarsApplicationMixin(ApplicationV2) {

    /** @override */
    static DEFAULT_OPTIONS = {
        id: "quicknames-app",
        tag: "form",
        window: {
            title: "Quick Names",
            icon: "fas fa-book-open",
            resizable: true
        },
        classes: ["md-madness", "quicknames-app"],
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
        form: { template: `modules/${MODULE_ID}/templates/quicknames.hbs` }
    };

    /**
     * @override
     * @returns {Promise<object>}
     */
    async _prepareContext(_options) {
        return {
            origins: [
                "Angels", "Arabic", "Brazilian", "Chinese", "Demons",
                "Egyptian", "English", "German", "Greek", "Indian",
                "Japanese", "Latin", "Nigerian", "Scandinavian", "Spanish"
            ],
            result: ""
        };
    }

    /**
     * Reads form state, resolves the correct table(s), and fills the result input.
     * @param {PointerEvent} _event
     * @param {HTMLElement} _target
     */
    async _onGenerateName(_event, _target) {
        const formData = new FormData(this.element);
        const origin = formData.get("origin");
        const genderSelection = formData.get("gender");
        const hasSurname = formData.get("hasSurname") === "on";

        if (!origin) return;

        let firstNameTableName;
        let shouldRollSurname = hasSurname;

        if (["Angels", "Demons"].includes(origin)) {
            firstNameTableName = origin;
            shouldRollSurname = false;
        } else {
            const gender = genderSelection === "all"
                ? (Math.random() < 0.5 ? "Male" : "Female")
                : genderSelection;
            firstNameTableName = `${origin} ${gender}`;
        }

        const firstName = await this._rollTableByName(firstNameTableName);
        let finalName = firstName;

        if (shouldRollSurname) {
            const surname = await this._rollTableByName(`${origin} Surname`);
            if (surname) finalName = `${firstName} ${surname}`;
        }

        const resultInput = this.element.querySelector("#name-result");
        if (resultInput) resultInput.value = finalName;
    }

    /**
     * Copies the current result to the clipboard.
     * @param {PointerEvent} _event
     * @param {HTMLElement} _target
     */
    _onCopyName(_event, _target) {
        const text = this.element.querySelector("#name-result")?.value;
        if (text) game.clipboard.copyPlainText(text);
    }

    /**
     * Finds a RollTable by name in the module compendium and draws one result.
     * @param {string} tableName
     * @returns {Promise<string>}
     */
    async _rollTableByName(tableName) {
        const pack = game.packs.get(`${MODULE_ID}.names`);
        if (!pack) {
            ui.notifications.error(`${MODULE_ID}: Pack '${MODULE_ID}.names' not found.`);
            return "";
        }

        const index = await pack.getIndex();
        const entry = index.find(e => e.name === tableName);
        if (!entry) return "";

        const table = await pack.getDocument(entry._id);
        const draw = await table.draw({ displayChat: false });
        return draw.results?.[0]?.name ?? "";
    }
}
