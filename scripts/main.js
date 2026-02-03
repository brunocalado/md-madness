import { QuickNamesApp } from "./quick-names-app.js";
import { NewsApp } from "./news-app.js";

/**
 * GLOBAL CONSTANTS
 */
export const MODULE_ID = 'md-madness';

export const SETTINGS = {
    AUTO_UNPAUSE: 'autoUnpause',
    JOURNAL_SPACING: 'journalSpacing',
    SET_ENGLISH: 'setEnglish',
    TOKEN_ROTATE: 'tokenAutoRotate',
    TOKEN_BLINK: 'tokenAutoBlink'
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

    // --- REGISTER GLOBAL API ---
    window.madness = {
        QuickNames: () => {
            new QuickNamesApp().render(true);
        },
        /**
         * Abre o Jornal Animado.
         * @param {Object} args
         * @param {string} args.title - O título da janela (Ex: "📰 Arkham Advertiser")
         * @param {string} args.uuid - O UUID do JournalEntry a ser lido
         * @param {string} [args.obituary] - UUID do Jornal de Obituários (Opcional)
         */
        News: (args = {}) => {
            // Verifica se o UUID foi passado, senão avisa
            if (!args.uuid) {
                ui.notifications.warn(`${MODULE_ID} | madness.News requer um argumento 'uuid'.`);
                return;
            }
            new NewsApp(args).render(true);
        },
        /**
         * Atualiza o Prototype Token de todos os Actors do mundo em massa.
         * @param {Object} changes - Objeto com as configurações a serem aplicadas (Ex: { movementAction: "blink" })
         */
        SetPrototypeToken: async (changes = {}) => {
            // Verificação de Segurança: Apenas GM
            if (!game.user.isGM) {
                ui.notifications.warn(`${MODULE_ID} | Apenas o Gamemaster pode executar operações em massa.`);
                return;
            }

            // Verificação de Dados
            if (!changes || Object.keys(changes).length === 0) {
                ui.notifications.warn(`${MODULE_ID} | Nenhum parâmetro fornecido. Exemplo de uso: madness.SetPrototypeToken({ movementAction: "blink" })`);
                return;
            }

            // Confirmação (Opcional, mas recomendada para operações destrutivas em massa)
            const confirmed = await Dialog.confirm({
                title: "Atualização em Massa: Prototype Tokens",
                content: `<p>Você está prestes a atualizar o <strong>Prototype Token</strong> de <strong>${game.actors.size}</strong> atores.</p>
                          <p>Alterações: <code>${JSON.stringify(changes)}</code></p>
                          <p>Isso não pode ser desfeito facilmente. Deseja continuar?</p>`
            });

            if (!confirmed) return;

            // Prepara a lista de atualizações (Bulk Update)
            const updates = game.actors.map(actor => ({
                _id: actor.id,
                prototypeToken: changes
            }));

            // Executa a atualização
            try {
                await Actor.updateDocuments(updates);
                ui.notifications.info(`${MODULE_ID} | Sucesso! ${updates.length} atores foram atualizados.`);
                console.log(`${MODULE_ID} | SetPrototypeToken executado para ${updates.length} atores.`, changes);
            } catch (err) {
                console.error(err);
                ui.notifications.error(`${MODULE_ID} | Erro ao atualizar atores. Veja o console (F12).`);
            }
        }
    };
    
    console.log(`${MODULE_ID} | Global API registered: window.madness`);
});

/**
 * READY HOOK
 * Note: Marked async to handle settings updates
 */
Hooks.once('ready', async () => {
    // 1. Check Auto Unpause
    handleAutoUnpause();

    // 2. Apply Journal Spacing Preference
    const useSpacing = game.settings.get(MODULE_ID, SETTINGS.JOURNAL_SPACING);
    toggleJournalSpacing(useSpacing);

    // 3. Apply Default Preferences (Language, Modules, etc)
    await applyDefaultPreferences();
});

/**
 * PRE-CREATE ACTOR HOOK (NEW)
 * Intercepta a criação de novos atores para definir o padrão Blink.
 */
Hooks.on("preCreateActor", (actor) => {
    // Verifica se a configuração está habilitada
    const useBlink = game.settings.get(MODULE_ID, SETTINGS.TOKEN_BLINK);
    
    if (useBlink) {
        // updateSource modifica os dados antes de serem salvos no DB
        actor.updateSource({
            "prototypeToken.movementAction": "blink"
        });
    }
});

/**
 * SCENE CONTROLS (Quick Names Button)
 */
Hooks.on("getSceneControlButtons", (controls) => {
    let tokenControls;

    if (Array.isArray(controls)) {
        tokenControls = controls.find(c => c.name === "token");
    } else if (typeof controls === "object" && controls !== null) {
        if (Array.isArray(controls.controls)) {
            tokenControls = controls.controls.find(c => c.name === "token");
        } else if (controls.token) {
            tokenControls = controls.token;
        }
    }

    if (tokenControls && tokenControls.tools) {
        if (!tokenControls.tools.find(t => t.name === "quicknames")) {
            tokenControls.tools.push({
                name: "quicknames",
                title: "Quick Names",
                icon: "fas fa-book-open",
                onClick: () => {
                    if (window.madness && window.madness.QuickNames) {
                        window.madness.QuickNames();
                    } else {
                        ui.notifications.warn("MD Madness features not initialized.");
                    }
                },
                button: true
            });
        }
    }
});

/* -------------------------------------------- */
/* LOGIC FUNCTIONS                             */
/* -------------------------------------------- */

/**
 * Applies the "Hated Configs" fixes and Default Preferences
 */
async function applyDefaultPreferences() {
    
    // --- Core: Language ---
    const useEnglish = game.settings.get(MODULE_ID, SETTINGS.SET_ENGLISH);
    const targetLang = useEnglish ? 'en' : 'pt-BR';
    
    if (game.settings.get('core', 'language') !== targetLang) {
        await game.settings.set('core', 'language', targetLang);
        console.log(`${MODULE_ID} | Language forced to ${targetLang}`);
    }

    // --- Core: Token Rotation ---
    const enableRotate = game.settings.get(MODULE_ID, SETTINGS.TOKEN_ROTATE);
    if (game.settings.get('core', 'tokenAutoRotate') !== enableRotate) {
        await game.settings.set('core', 'tokenAutoRotate', enableRotate);
    }

    // --- Core: UI Annoyances (Forced OFF) ---
    // Only set if they are currently true to avoid spamming writes
    if (game.settings.get('core', 'chatBubbles') !== false) 
        await game.settings.set('core', 'chatBubbles', false);

    if (game.settings.get('core', 'chatBubblesPan') !== false) 
        await game.settings.set('core', 'chatBubblesPan', false);

    if (game.settings.get('core', 'showToolclips') !== false) 
        await game.settings.set('core', 'showToolclips', false);


    // --- External Modules ---
    
    // Simple Calendar: Don't open on load
    if (game.modules.get("foundryvtt-simple-calendar")?.active) {
        try {
            await game.settings.set('foundryvtt-simple-calendar', 'open-on-load', false);
        } catch(e) { /* Ignore if setting key differs in versions */ }
    }

    // Module Credits: Don't show changelog
    if (game.modules.get("module-credits")?.active) {
        try {
            await game.settings.set('module-credits', 'showNewChangelogsOnLoad', false);
        } catch(e) { }
    }

    // DFreds Droppables: Random drop style
    if (game.modules.get("dfreds-droppables")?.active) {
        try {
            await game.settings.set('dfreds-droppables', 'dropStyle', 'random');
        } catch(e) { }
    }
}


/**
 * Auto Unpause Logic
 */
export function handleAutoUnpause() {
    if (!game.user.isGM) return;
    const shouldUnpause = game.settings.get(MODULE_ID, SETTINGS.AUTO_UNPAUSE);

    if (shouldUnpause && game.paused) {
        console.log(`${MODULE_ID} | Auto Unpause triggered.`);
        game.togglePause(false, { broadcast: true }); 
    }
}

/**
 * Journal Spacing Toggle
 */
export function toggleJournalSpacing(enabled) {
    if (enabled) {
        document.body.classList.add('md-fix-journal-spacing');
    } else {
        document.body.classList.remove('md-fix-journal-spacing');
    }
}