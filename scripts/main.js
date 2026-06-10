import { MODULE_ID, SETTINGS } from "./constants.js";
import { QuickNamesApp } from "./quick-names-app.js";
import { NewsApp } from "./news-app.js";
import { SelectPlayerAPI, SelectPlayerConfig } from "./select-player-app.js";
import { OwnershipApp } from "./ownership-app.js";
import { JournalSplitterApp } from "./journal-splitter-app.js";

export { MODULE_ID, SETTINGS };

/**
 * INITIALIZATION
 */
Hooks.once("init", () => {
    console.log(`${MODULE_ID} | Initializing module...`);

    game.settings.register(MODULE_ID, SETTINGS.AUTO_UNPAUSE, {
        name: "Auto Unpause on Load",
        hint: "If enabled, the game will automatically unpause when the world finishes loading (GM only).",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, SETTINGS.JOURNAL_SPACING, {
        name: "Fix Journal Spacing",
        hint: "Adds minimum height to empty paragraphs in journals to prevent layout collapse. Useful for imported content.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: (value) => toggleJournalSpacing(value)
    });

    game.settings.register(MODULE_ID, SETTINGS.SET_ENGLISH, {
        name: "Set to English",
        hint: "Uncheck to force Portuguese (pt-BR). Check to use English.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, SETTINGS.TOKEN_ROTATE, {
        name: "Enable Auto Token Rotation",
        hint: "Uncheck to disable automatic token rotation when moving.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, SETTINGS.TOKEN_BLINK, {
        name: "Auto Token Blink",
        hint: "If enabled, all newly created actors will have their Prototype Token animation set to \"Blink\" by default.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, SETTINGS.SELECT_PLAYER_CONFIG, {
        name: "Player Configuration",
        scope: "world",
        config: false,
        type: Object,
        default: {}
    });

    game.settings.register(MODULE_ID, SETTINGS.SELECT_PLAYER_SOUND, {
        name: "Selection Sound",
        hint: "Audio file played when a player is selected.",
        scope: "world",
        config: true,
        type: String,
        default: `modules/${MODULE_ID}/assets/sfx/selected.mp3`,
        filePicker: "audio"
    });

    game.settings.registerMenu(MODULE_ID, "selectPlayerMenu", {
        name: "Configure Players (Splash & Names)",
        label: "Open Configuration",
        hint: "Set custom images and names for the player selection.",
        icon: "fas fa-user-cog",
        type: SelectPlayerConfig,
        restricted: true
    });

    window.madness = {
        QuickNames: () => new QuickNamesApp().render(true),
        News: (args = {}) => {
            if (!args.uuid) {
                ui.notifications.warn(`${MODULE_ID} | madness.News requires a 'uuid' argument.`);
                return;
            }
            new NewsApp(args).render(true);
        },
        Select: SelectPlayerAPI.Players.bind(SelectPlayerAPI),
        SelectConfig: () => new SelectPlayerConfig().render(true),
        Ownership: () => new OwnershipApp().render(true),
        JournalSplitter: () => new JournalSplitterApp().render(true),
        SetPrototypeToken: async (changes = {}) => {
            if (!game.user.isGM) {
                ui.notifications.warn(`${MODULE_ID} | Only the Gamemaster can run mass operations.`);
                return;
            }
            if (!changes || Object.keys(changes).length === 0) {
                ui.notifications.warn(`${MODULE_ID} | No parameters provided.`);
                return;
            }

            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: "Mass Update" },
                content: `<p>Update <strong>${game.actors.size}</strong> actors?</p><p>Changes: <code>${JSON.stringify(changes)}</code></p>`,
                rejectClose: false
            });

            if (!confirmed) return;

            const updates = game.actors.map(actor => ({
                _id: actor.id,
                prototypeToken: changes
            }));

            try {
                await Actor.implementation.updateDocuments(updates);
                ui.notifications.info(`${MODULE_ID} | Success! ${updates.length} actors updated.`);
            } catch (err) {
                console.error(err);
                ui.notifications.error(`${MODULE_ID} | Error updating actors.`);
            }
        }
    };
});

/**
 * READY HOOK
 */
Hooks.once("ready", async () => {
    handleAutoUnpause();

    const useSpacing = game.settings.get(MODULE_ID, SETTINGS.JOURNAL_SPACING);
    toggleJournalSpacing(useSpacing);

    await applyDefaultPreferences();
});

/**
 * PRE-CREATE ACTOR HOOK
 * Sets the blink movement animation on newly created actors when the setting is enabled.
 */
Hooks.on("preCreateActor", (actor) => {
    const useBlink = game.settings.get(MODULE_ID, SETTINGS.TOKEN_BLINK);
    if (useBlink) actor.updateSource({ "prototypeToken.movementAction": "blink" });
});

/**
 * SCENE CONTROLS
 * Adds the Quick Names button to the token controls toolbar.
 */
Hooks.on("getSceneControlButtons", (controls) => {
    let tokenControls;
    if (Array.isArray(controls)) {
        tokenControls = controls.find(c => c.name === "token");
    } else if (controls.token) {
        tokenControls = controls.token;
    }

    if (tokenControls?.tools && !tokenControls.tools.find(t => t.name === "quicknames")) {
        tokenControls.tools.push({
            name: "quicknames",
            title: "Quick Names",
            icon: "fas fa-book-open",
            onClick: () => window.madness?.QuickNames(),
            button: true
        });
    }
});

/**
 * SELECT PLAYER: createChatMessage Hook
 * Synchronizes the visual splash effect across all clients.
 */
Hooks.on("createChatMessage", (message) => {
    const flags = message.flags?.[MODULE_ID];
    if (flags?.isSelectResult) SelectPlayerAPI.showSplash(flags.image, flags.name);
});

/* -------------------------------------------- */
/* LOGIC FUNCTIONS                               */
/* -------------------------------------------- */

/**
 * Attempts to set a setting safely.
 * Silently ignores permission errors (e.g., a Player trying to write a World setting).
 * @param {string} namespace
 * @param {string} key
 * @param {*} value
 */
async function safeSet(namespace, key, value) {
    try {
        const current = game.settings.get(namespace, key);
        if (current !== value) {
            await game.settings.set(namespace, key, value);
            console.log(`${MODULE_ID} | Enforced ${namespace}.${key} = ${value}`);
        }
    } catch (err) {
        if (!err.message?.includes("permission")) {
            console.warn(`${MODULE_ID} | Failed to set ${namespace}.${key}:`, err);
        }
    }
}

/**
 * Applies global default preferences for language, token behavior, and UI.
 * Called from the ready hook; uses safeSet so Players silently skip World-scoped keys.
 */
async function applyDefaultPreferences() {
    const useEnglish = game.settings.get(MODULE_ID, SETTINGS.SET_ENGLISH);
    await safeSet("core", "language", useEnglish ? "en" : "pt-BR");

    const enableRotate = game.settings.get(MODULE_ID, SETTINGS.TOKEN_ROTATE);
    await safeSet("core", "tokenAutoRotate", enableRotate);

    await safeSet("core", "chatBubbles", false);
    await safeSet("core", "chatBubblesPan", false);
    await safeSet("core", "showToolclips", false);

    if (game.modules.get("foundryvtt-simple-calendar")?.active) {
        await safeSet("foundryvtt-simple-calendar", "open-on-load", false);
    }

    if (game.modules.get("module-credits")?.active) {
        await safeSet("module-credits", "showNewChangelogsOnLoad", false);
    }

    if (game.user.isGM && game.modules.get("dfreds-droppables")?.active) {
        await safeSet("dfreds-droppables", "dropStyle", "random");
    }
}

/**
 * Auto-unpauses the game on load if the setting is enabled and the user is GM.
 */
export function handleAutoUnpause() {
    if (!game.user.isGM) return;
    if (game.settings.get(MODULE_ID, SETTINGS.AUTO_UNPAUSE) && game.paused) {
        console.log(`${MODULE_ID} | Auto Unpause triggered.`);
        game.togglePause(false, { broadcast: true });
    }
}

/**
 * Toggles the journal spacing fix by adding/removing the CSS trigger class on body.
 * @param {boolean} enabled
 */
export function toggleJournalSpacing(enabled) {
    document.body.classList.toggle("md-fix-journal-spacing", enabled);
}
