import { MODULE_ID, SETTINGS } from "./constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Configuration window for customizing per-player splash images and display names.
 */
export class SelectPlayerConfig extends HandlebarsApplicationMixin(ApplicationV2) {

    /** @override */
    static DEFAULT_OPTIONS = {
        tag: "form",
        id: "select-player-config",
        window: {
            title: "Select Player - Configure Players",
            icon: "fas fa-user-edit",
            resizable: true
        },
        classes: ["md-madness", "select-player-config"],
        position: { width: 600, height: "auto" },
        form: {
            handler: SelectPlayerConfig.submit,
            closeOnSubmit: true
        }
    };

    /** @override */
    static PARTS = {
        form: { template: `modules/${MODULE_ID}/templates/select-config.hbs` }
    };

    /**
     * @override
     * @returns {Promise<object>}
     */
    async _prepareContext(_options) {
        const playerConfig = game.settings.get(MODULE_ID, SETTINGS.SELECT_PLAYER_CONFIG) || {};

        const users = game.users.filter(u => !u.isGM).map(u => {
            const config = playerConfig[u.id] || {};
            return {
                id: u.id,
                userName: u.name,
                actorName: u.character?.name ?? "No Linked Actor",
                avatar: u.avatar,
                customImage: config.image || "",
                customName: config.name || ""
            };
        });

        return { users };
    }

    /**
     * Persists the player configuration from the submitted form.
     * Called from the AppV2 form handler (DEFAULT_OPTIONS.form.handler).
     * @param {SubmitEvent} _event
     * @param {HTMLFormElement} _form
     * @param {FormDataExtended} formData
     */
    static async submit(_event, _form, formData) {
        const data = foundry.utils.expandObject(formData.object);
        await game.settings.set(MODULE_ID, SETTINGS.SELECT_PLAYER_CONFIG, data);
        ui.notifications.info("Select Player: Settings saved!");
    }
}

/**
 * API for the player selection flow: drawing a random player, showing the splash, and posting to chat.
 */
export class SelectPlayerAPI {

    /**
     * Selects a random active non-GM player, shows the splash on all clients via chat,
     * and returns the selected user data.
     * @returns {Promise<{ user: User, name: string }|null>}
     */
    static async Players() {
        const eligibleUsers = game.users.filter(u => u.active && !u.isGM);
        if (eligibleUsers.length === 0) {
            ui.notifications.warn("Select Player: No connected players to select.");
            return null;
        }

        const selectedUser = eligibleUsers[Math.floor(Math.random() * eligibleUsers.length)];
        const playerConfig = game.settings.get(MODULE_ID, SETTINGS.SELECT_PLAYER_CONFIG) || {};
        const userSettings = playerConfig[selectedUser.id] || {};

        // Resolution order: custom config > linked actor > user name/avatar
        const displayName = userSettings.name || selectedUser.character?.name || selectedUser.name;
        const displayImage = userSettings.image || selectedUser.avatar;

        await this._postChatMessage(selectedUser, displayName, displayImage);
        return { user: selectedUser, name: displayName };
    }

    /**
     * Plays the selection sound and shows the full-screen splash overlay.
     * Called on every client via the createChatMessage hook in main.js.
     * @param {string} imgPath
     * @param {string} name
     */
    static showSplash(imgPath, name) {
        const soundPath = game.settings.get(MODULE_ID, SETTINGS.SELECT_PLAYER_SOUND);
        if (soundPath) {
            foundry.audio.AudioHelper.play({ src: soundPath, channel: "environment", loop: false, volume: 1 });
        }

        document.getElementById("select-player-splash")?.remove();

        const splash = document.createElement("div");
        splash.id = "select-player-splash";
        splash.innerHTML = `
            <div class="splash-content">
                <img src="${imgPath}" class="splash-img">
                <div class="splash-text">${name}</div>
            </div>
        `;
        document.body.appendChild(splash);

        setTimeout(() => {
            splash.classList.add("fade-out");
            setTimeout(() => splash.remove(), 500);
        }, 3000);
    }

    /**
     * Posts a chat message that triggers the splash on all clients.
     * The createChatMessage hook in main.js reads the module flags to call showSplash.
     * @param {User} user
     * @param {string} finalName
     * @param {string} finalImage
     */
    static async _postChatMessage(user, finalName, finalImage) {
        await ChatMessage.create({
            content: `
                <div class="select-player-card">
                    <h3>★ Selected!</h3>
                    <div class="winner-info">
                        <img src="${finalImage}" alt="${finalName}" />
                        <span class="winner-name">${finalName}</span>
                    </div>
                </div>
            `,
            speaker: ChatMessage.getSpeaker({ alias: "Gamemaster" }),
            style: CONST.CHAT_MESSAGE_STYLES.OTHER,
            flags: {
                [MODULE_ID]: { isSelectResult: true, image: finalImage, name: finalName }
            }
        });
    }
}
