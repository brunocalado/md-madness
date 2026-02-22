import { MODULE_ID } from './main.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * ==========================================
 * PARTE 1: Janela de Configuração (AppV2)
 * ==========================================
 */
export class SelectPlayerConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    id: "select-player-config",
    window: {
      title: "Select Player - Configurar Jogadores",
      icon: "fas fa-user-edit",
      resizable: true,
      width: 600
    },
    position: { width: 600, height: "auto" },
    form: {
      handler: SelectPlayerConfig.submit,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    form: { template: "modules/md-madness/templates/select-config.hbs" }
  };

  async _prepareContext(_options) {
    const playerConfig = game.settings.get(MODULE_ID, 'selectPlayerConfig') || {};

    const users = game.users.filter(u => !u.isGM).map(u => {
      const config = playerConfig[u.id] || {};
      const actorName = u.character ? u.character.name : "Sem Actor Linkado";

      return {
        id: u.id,
        userName: u.name,
        actorName: actorName,
        avatar: u.avatar,
        customImage: config.image || "",
        customName: config.name || ""
      };
    });

    return { users };
  }

  static async submit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    await game.settings.set(MODULE_ID, 'selectPlayerConfig', data);
    ui.notifications.info("Select Player: Configurações salvas!");
  }
}

/**
 * ==========================================
 * PARTE 2: Lógica Principal (Sorteio & Visual)
 * ==========================================
 */
export class SelectPlayerAPI {

  static async Players() {
    const eligibleUsers = game.users.filter(u => u.active && !u.isGM);

    if (eligibleUsers.length === 0) {
      ui.notifications.warn("Select Player: Nenhum jogador conectado para sortear.");
      return null;
    }

    // --- Sorteio ---
    const randomIndex = Math.floor(Math.random() * eligibleUsers.length);
    const selectedUser = eligibleUsers[randomIndex];
    const userId = selectedUser.id;

    // --- Resolução de Dados (Config > Actor > User) ---
    const playerConfig = game.settings.get(MODULE_ID, 'selectPlayerConfig') || {};
    const userSettings = playerConfig[userId] || {};

    // 1. Resolução do NOME
    let displayName = userSettings.name;
    if (!displayName && selectedUser.character) {
      displayName = selectedUser.character.name;
    }
    if (!displayName) {
      displayName = selectedUser.name;
    }

    // 2. Resolução da IMAGEM
    let displayImage = userSettings.image;
    if (!displayImage) {
      displayImage = selectedUser.avatar;
    }

    // --- Execução ---
    await this._postChatMessage(selectedUser, displayName, displayImage);

    return { user: selectedUser, name: displayName };
  }

  static showSplash(imgPath, name) {
    // --- Lógica de Som ---
    const soundPath = game.settings.get(MODULE_ID, 'selectPlayerSound');
    if (soundPath) {
      foundry.audio.AudioHelper.play({ src: soundPath, channel: "environment", loop: false, volume: 1 });
    }

    // --- Lógica Visual ---
    const existing = document.getElementById('select-player-splash');
    if (existing) existing.remove();

    const splash = document.createElement('div');
    splash.id = 'select-player-splash';
    splash.innerHTML = `
        <div class="splash-content">
            <img src="${imgPath}" class="splash-img">
            <div class="splash-text">${name}</div>
        </div>
    `;

    document.body.appendChild(splash);

    setTimeout(() => {
      splash.classList.add('fade-out');
      setTimeout(() => splash.remove(), 500);
    }, 3000);
  }

  static async _postChatMessage(user, finalName, finalImage) {
    const content = `
      <div class="select-player-card">
        <h3>★ Selecionado!</h3>
        <div class="winner-info">
          <img src="${finalImage}" alt="${finalName}" />
          <span class="winner-name">${finalName}</span>
        </div>
      </div>
    `;

    await ChatMessage.create({
      content: content,
      speaker: ChatMessage.getSpeaker({ alias: "Gamemaster" }),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        [MODULE_ID]: {
          isSelectResult: true,
          image: finalImage,
          name: finalName
        }
      }
    });
  }
}
