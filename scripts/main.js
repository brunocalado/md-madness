import { QuickNamesApp } from "./quick-names-app.js";
import { NewsApp } from "./news-app.js";
import { SelectPlayerAPI, SelectPlayerConfig } from "./select-player-app.js";
import { OwnershipApp } from "./ownership-app.js";
import { JournalSplitterApp } from "./journal-splitter-app.js";

/**
 * GLOBAL CONSTANTS
 */
export const MODULE_ID = 'md-madness';

export const SETTINGS = {
    AUTO_UNPAUSE: 'autoUnpause',
    JOURNAL_SPACING: 'journalSpacing',
    SET_ENGLISH: 'setEnglish',
    TOKEN_ROTATE: 'tokenAutoRotate',
    TOKEN_BLINK: 'tokenAutoBlink',
    SELECT_PLAYER_CONFIG: 'selectPlayerConfig',
    SELECT_PLAYER_SOUND: 'selectPlayerSound'
};

/**
 * INITIALIZATION
 */
Hooks.once('init', () => {
    console.log(`${MODULE_ID} | Initializing module...`);

    // --- REGISTER SETTINGS ---

    // 1. Auto Unpause
    game.settings.register(MODULE_ID, SETTINGS.AUTO_UNPAUSE, {
        name: "Auto Unpause on Load",
        hint: "If enabled, the game will automatically unpause when the world finishes loading (GM only).",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    // 2. Journal Spacing Fix
    game.settings.register(MODULE_ID, SETTINGS.JOURNAL_SPACING, {
        name: "Fix Journal Spacing",
        hint: "Adds minimum height to empty paragraphs in journals to prevent layout collapse. Useful for imported content.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: (value) => toggleJournalSpacing(value)
    });

    // 3. Language Setting (Default Preferences)
    game.settings.register(MODULE_ID, SETTINGS.SET_ENGLISH, {
        name: 'Set to English',
        hint: 'Uncheck to force Portuguese (pt-BR). Check to use English.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });

    // 4. Token Rotation (Default Preferences)
    game.settings.register(MODULE_ID, SETTINGS.TOKEN_ROTATE, {
        name: 'Enable Auto Token Rotation',
        hint: 'Uncheck to disable automatic token rotation when moving.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: false
    });

    // 5. Auto Token Blink (NEW)
    game.settings.register(MODULE_ID, SETTINGS.TOKEN_BLINK, {
        name: 'Auto Token Blink',
        hint: 'If enabled, all newly created actors will have their Prototype Token animation set to "Blink" by default.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });

    // 6. Select Player - Configuração de jogadores (imagem e nome)
    game.settings.register(MODULE_ID, SETTINGS.SELECT_PLAYER_CONFIG, {
        name: "Player Configuration",
        scope: "world",
        config: false,
        type: Object,
        default: {}
    });

    // 7. Select Player - Som de seleção
    game.settings.register(MODULE_ID, SETTINGS.SELECT_PLAYER_SOUND, {
        name: "Som de Seleção",
        hint: "Arquivo de áudio que toca quando um jogador é sorteado.",
        scope: "world",
        config: true,
        type: String,
        default: "modules/md-madness/assets/sfx/selected.mp3",
        filePicker: "audio"
    });

    // 8. Select Player - Menu de configuração
    game.settings.registerMenu(MODULE_ID, 'selectPlayerMenu', {
        name: "Configurar Jogadores (Splash & Nomes)",
        label: "Abrir Configuração",
        hint: "Defina imagens e nomes personalizados para o sorteio.",
        icon: "fas fa-user-cog",
        type: SelectPlayerConfig,
        restricted: true
    });

    // --- REGISTER GLOBAL API ---
    window.madness = {
        QuickNames: () => {
            new QuickNamesApp().render(true);
        },
        News: (args = {}) => {
            if (!args.uuid) {
                ui.notifications.warn(`${MODULE_ID} | madness.News requer um argumento 'uuid'.`);
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
                ui.notifications.warn(`${MODULE_ID} | Apenas o Gamemaster pode executar operações em massa.`);
                return;
            }
            if (!changes || Object.keys(changes).length === 0) {
                ui.notifications.warn(`${MODULE_ID} | Nenhum parâmetro fornecido.`);
                return;
            }

            const confirmed = await Dialog.confirm({
                title: "Atualização em Massa",
                content: `<p>Atualizar <strong>${game.actors.size}</strong> atores?</p><p>Mudanças: <code>${JSON.stringify(changes)}</code></p>`
            });

            if (!confirmed) return;

            const updates = game.actors.map(actor => ({
                _id: actor.id,
                prototypeToken: changes
            }));

            try {
                await Actor.updateDocuments(updates);
                ui.notifications.info(`${MODULE_ID} | Sucesso! ${updates.length} atores atualizados.`);
            } catch (err) {
                console.error(err);
                ui.notifications.error(`${MODULE_ID} | Erro ao atualizar atores.`);
            }
        }
    };
});

/**
 * READY HOOK
 */
Hooks.once('ready', async () => {
    // 1. Check Auto Unpause
    handleAutoUnpause();

    // 2. Apply Journal Spacing Preference
    const useSpacing = game.settings.get(MODULE_ID, SETTINGS.JOURNAL_SPACING);
    toggleJournalSpacing(useSpacing);

    // 3. Apply Default Preferences
    await applyDefaultPreferences();
});

/**
 * PRE-CREATE ACTOR HOOK
 */
Hooks.on("preCreateActor", (actor) => {
    const useBlink = game.settings.get(MODULE_ID, SETTINGS.TOKEN_BLINK);
    if (useBlink) {
        actor.updateSource({ "prototypeToken.movementAction": "blink" });
    }
});

/**
 * SCENE CONTROLS
 */
Hooks.on("getSceneControlButtons", (controls) => {
    let tokenControls;
    if (Array.isArray(controls)) {
        tokenControls = controls.find(c => c.name === "token");
    } else if (controls.token) {
        tokenControls = controls.token;
    }

    if (tokenControls && tokenControls.tools) {
        if (!tokenControls.tools.find(t => t.name === "quicknames")) {
            tokenControls.tools.push({
                name: "quicknames",
                title: "Quick Names",
                icon: "fas fa-book-open",
                onClick: () => {
                    if (window.madness?.QuickNames) window.madness.QuickNames();
                },
                button: true
            });
        }
    }
});

/**
 * SELECT PLAYER: createChatMessage Hook
 * Sincroniza o efeito visual (splash) entre todos os clientes.
 */
Hooks.on('createChatMessage', (message) => {
    const flags = message.flags?.[MODULE_ID];
    if (flags && flags.isSelectResult) {
        SelectPlayerAPI.showSplash(flags.image, flags.name);
    }
});

/* -------------------------------------------- */
/* LOGIC FUNCTIONS                             */
/* -------------------------------------------- */

/**
 * Tenta definir uma configuração com segurança.
 * Se falhar por permissão (Player tentando mudar World Setting), ignora silenciosamente.
 */
async function safeSet(namespace, key, value) {
    try {
        const current = game.settings.get(namespace, key);
        if (current !== value) {
            await game.settings.set(namespace, key, value);
            console.log(`${MODULE_ID} | Enforced ${namespace}.${key} = ${value}`);
        }
    } catch (err) {
        // Se for erro de permissão, ignoramos (significa que é World Setting e o user é Player)
        // Se for outro erro, logamos como aviso
        if (!err.message?.includes("permission")) {
            console.warn(`${MODULE_ID} | Failed to set ${namespace}.${key}:`, err);
        }
    }
}

/**
 * Applies preferences safely for both GM and Players
 */
async function applyDefaultPreferences() {
    
    // 1. Language (Tentativa segura para todos)
    const useEnglish = game.settings.get(MODULE_ID, SETTINGS.SET_ENGLISH);
    const targetLang = useEnglish ? 'en' : 'pt-BR';
    await safeSet('core', 'language', targetLang);

    // 2. Token Rotation (Tentativa segura para todos)
    const enableRotate = game.settings.get(MODULE_ID, SETTINGS.TOKEN_ROTATE);
    await safeSet('core', 'tokenAutoRotate', enableRotate);

    // 3. UI Annoyances (Tentativa segura para todos)
    // Chat Bubbles: Tenta desativar para todos. 
    // Se for World Setting restrita, falhará silenciosamente no Player, mas funcionará no GM.
    await safeSet('core', 'chatBubbles', false); 
    await safeSet('core', 'chatBubblesPan', false);
    await safeSet('core', 'showToolclips', false);

    // 4. External Modules
    if (game.modules.get("foundryvtt-simple-calendar")?.active) {
        await safeSet('foundryvtt-simple-calendar', 'open-on-load', false);
    }

    if (game.modules.get("module-credits")?.active) {
        await safeSet('module-credits', 'showNewChangelogsOnLoad', false);
    }

    // 5. Configurações Exclusivas de GM (Para garantir)
    // Se algo PRECISA ser forçado pelo GM porque o Player não tem acesso nem de leitura/escrita correta
    if (game.user.isGM) {
        if (game.modules.get("dfreds-droppables")?.active) {
            await safeSet('dfreds-droppables', 'dropStyle', 'random');
        }
    }
}

export function handleAutoUnpause() {
    if (!game.user.isGM) return;
    const shouldUnpause = game.settings.get(MODULE_ID, SETTINGS.AUTO_UNPAUSE);
    if (shouldUnpause && game.paused) {
        console.log(`${MODULE_ID} | Auto Unpause triggered.`);
        game.togglePause(false, { broadcast: true }); 
    }
}

export function toggleJournalSpacing(enabled) {
    if (enabled) document.body.classList.add('md-fix-journal-spacing');
    else document.body.classList.remove('md-fix-journal-spacing');
}