const { Plugin, PluginSettingTab, Setting, Notice } = require('obsidian');

const DEFAULT_SETTINGS = {
  enabled: true,
  cycleSeconds: 240,
  fps: 30,
  direction: 1,
  startHue: 0,
  saturation: 100,
  accentLightness: 50,
  textLightness: 88,
  panelTint: 100,
  contrastOffset: 180,
  animateHeadings: true,
  animateLinks: true,
  animateGraph: true,
  animateTags: true,
  animateCode: true
};

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function normHue(v) { const n = Number(v) || 0; return ((n % 360) + 360) % 360; }
function round(n, p = 2) { const k = 10 ** p; return Math.round(n * k) / k; }

class ContinuousThemeSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Style Settings — непрерывная тема' });
    containerEl.createEl('p', {
      text: 'Вместо восьми готовых тем используется один непрерывный цветовой круг. Плагин меняет оттенок от 0° до 360°, а остальные цвета темы вычисляются автоматически.'
    });

    new Setting(containerEl)
      .setName('Непрерывный перелив')
      .setDesc('Включает постоянное движение по цветовому кругу.')
      .addToggle(t => t.setValue(this.plugin.settings.enabled).onChange(async v => {
        this.plugin.settings.enabled = v;
        await this.plugin.saveSettings();
        v ? this.plugin.start() : this.plugin.stop(true);
      }));

    new Setting(containerEl)
      .setName('Время полного круга')
      .setDesc('Сколько секунд занимает 360°: красный → жёлтый → зелёный → голубой → синий → фиолетовый → красный.')
      .addText(t => t.setValue(String(this.plugin.settings.cycleSeconds)).onChange(async v => {
        const n = Number(String(v).replace(',', '.'));
        if (Number.isFinite(n) && n >= 1 && n <= 86400) {
          this.plugin.settings.cycleSeconds = n;
          await this.plugin.saveSettings();
          this.plugin.restartIfRunning();
        }
      }));

    new Setting(containerEl)
      .setName('Частота обновления')
      .setDesc('На iPhone 30 кадров/с обычно достаточно. Сам цвет вычисляется непрерывно независимо от числа опорных тем.')
      .addDropdown(d => d
        .addOption('15', '15 кадров/с')
        .addOption('30', '30 кадров/с')
        .addOption('60', '60 кадров/с')
        .setValue(String(this.plugin.settings.fps))
        .onChange(async v => {
          this.plugin.settings.fps = Number(v);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Направление')
      .setDesc('Направление движения по цветовому кругу.')
      .addDropdown(d => d
        .addOption('1', 'По часовой стрелке')
        .addOption('-1', 'Против часовой стрелки')
        .setValue(String(this.plugin.settings.direction))
        .onChange(async v => {
          this.plugin.settings.direction = Number(v) === -1 ? -1 : 1;
          await this.plugin.saveSettings();
          this.plugin.restartIfRunning();
        }));

    new Setting(containerEl)
      .setName('Начальный оттенок')
      .setDesc('0° — красный, 60° — жёлтый, 120° — зелёный, 180° — голубой, 240° — синий, 300° — пурпурный.')
      .addSlider(s => s
        .setLimits(0, 359, 1)
        .setDynamicTooltip()
        .setValue(this.plugin.settings.startHue)
        .onChange(async v => {
          this.plugin.settings.startHue = v;
          await this.plugin.saveSettings();
          if (!this.plugin.running) this.plugin.applyHue(v);
        }));

    new Setting(containerEl)
      .setName('Насыщенность')
      .setDesc('Насыщенность главного цвета.')
      .addSlider(s => s
        .setLimits(0, 100, 1)
        .setDynamicTooltip()
        .setValue(this.plugin.settings.saturation)
        .onChange(async v => {
          this.plugin.settings.saturation = v;
          await this.plugin.saveSettings();
          this.plugin.rebuildStyle();
        }));

    new Setting(containerEl)
      .setName('Яркость главного цвета')
      .setDesc('Светлота основного акцента.')
      .addSlider(s => s
        .setLimits(30, 70, 1)
        .setDynamicTooltip()
        .setValue(this.plugin.settings.accentLightness)
        .onChange(async v => {
          this.plugin.settings.accentLightness = v;
          await this.plugin.saveSettings();
          this.plugin.rebuildStyle();
        }));

    new Setting(containerEl)
      .setName('Яркость текста')
      .setDesc('Светлота основного текста, слегка окрашенного текущим оттенком.')
      .addSlider(s => s
        .setLimits(70, 96, 1)
        .setDynamicTooltip()
        .setValue(this.plugin.settings.textLightness)
        .onChange(async v => {
          this.plugin.settings.textLightness = v;
          await this.plugin.saveSettings();
          this.plugin.rebuildStyle();
        }));

    new Setting(containerEl)
      .setName('Окрашивание панелей')
      .setDesc('0% — почти нейтральные тёмные панели; 100% — максимально заметный оттенок в тёмных поверхностях.')
      .addSlider(s => s
        .setLimits(0, 100, 1)
        .setDynamicTooltip()
        .setValue(this.plugin.settings.panelTint)
        .onChange(async v => {
          this.plugin.settings.panelTint = v;
          await this.plugin.saveSettings();
          this.plugin.rebuildStyle();
        }));

    new Setting(containerEl)
      .setName('Смещение контрастного цвета')
      .setDesc('180° даёт противоположный цвет. Например: красный ↔ голубой, жёлтый ↔ синий.')
      .addSlider(s => s
        .setLimits(0, 360, 1)
        .setDynamicTooltip()
        .setValue(this.plugin.settings.contrastOffset)
        .onChange(async v => {
          this.plugin.settings.contrastOffset = v;
          await this.plugin.saveSettings();
          this.plugin.rebuildStyle();
        }));

    containerEl.createEl('h3', { text: 'Что переливается' });
    const toggles = [
      ['animateHeadings', 'Заголовки'],
      ['animateLinks', 'Ссылки'],
      ['animateGraph', 'Граф'],
      ['animateTags', 'Теги'],
      ['animateCode', 'Код']
    ];
    for (const [key, name] of toggles) {
      new Setting(containerEl).setName(name).addToggle(t => t
        .setValue(this.plugin.settings[key])
        .onChange(async v => {
          this.plugin.settings[key] = v;
          await this.plugin.saveSettings();
          this.plugin.rebuildStyle();
        }));
    }

    const info = containerEl.createDiv({ cls: 'sscc-status is-ok' });
    info.setText(`Текущий оттенок: ${Math.round(this.plugin.currentHue)}°. Опорных тем: 0. Цвет вычисляется непрерывно.`);

    new Setting(containerEl)
      .setName('Вернуться к красному')
      .setDesc('Сбрасывает текущую позицию цикла на 0° и начинает движение заново.')
      .addButton(b => b.setButtonText('Сбросить').onClick(() => {
        this.plugin.resetToStart();
        new Notice('Цветовой цикл начат с начального оттенка.');
        this.display();
      }));
  }
}

module.exports = class ContinuousMinimalThemePlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() || {});
    this.running = false;
    this.rafId = null;
    this.startTime = 0;
    this.lastFrame = 0;
    this.currentHue = normHue(this.settings.startHue);

    this.styleTag = document.createElement('style');
    this.styleTag.id = 'style-settings-continuous-theme';
    document.head.appendChild(this.styleTag);

    this.addSettingTab(new ContinuousThemeSettingTab(this.app, this));
    this.addCommand({
      id: 'toggle-continuous-color-cycle',
      name: 'Включить/выключить непрерывный цветовой цикл',
      callback: async () => {
        this.settings.enabled = !this.settings.enabled;
        await this.saveSettings();
        this.settings.enabled ? this.start() : this.stop(true);
        new Notice(this.settings.enabled ? 'Непрерывный цветовой цикл включён.' : 'Непрерывный цветовой цикл выключен.');
      }
    });
    this.addCommand({
      id: 'restart-continuous-color-cycle',
      name: 'Начать непрерывный цветовой цикл заново',
      callback: () => this.resetToStart()
    });

    this.rebuildStyle();
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.enabled) this.start();
      else this.applyHue(this.settings.startHue);
    });
  }

  onunload() {
    this.stop(true);
    if (this.styleTag) this.styleTag.remove();
  }

  async saveSettings() { await this.saveData(this.settings); }

  group(enabled, declarations) { return enabled ? declarations : ''; }

  rebuildStyle() {
    if (!this.styleTag) return;
    const s = this.settings;
    const sat = clamp(Number(s.saturation) || 100, 0, 100);
    const accL = clamp(Number(s.accentLightness) || 50, 0, 100);
    const textL = clamp(Number(s.textLightness) || 88, 0, 100);
    const tint = clamp(Number(s.panelTint) || 0, 0, 100) / 100;
    const contrast = normHue(Number(s.contrastOffset) || 180);

    const panelSat1 = round(6 + 22 * tint);
    const panelSat2 = round(8 + 27 * tint);
    const panelSat3 = round(10 + 30 * tint);
    const mutedSat = round(15 + 20 * tint);
    const paleSat = round(35 + 65 * (sat / 100));

    const headings = this.group(s.animateHeadings, `
      --h1-color: hsl(var(--sscc-contrast-h) ${sat}% 50%);
      --h2-color: hsl(var(--sscc-contrast-h) ${paleSat}% 75%);
      --h3-color: hsl(var(--sscc-contrast-h) ${paleSat}% 88%);
      --h4-color: hsl(var(--sscc-contrast-h) ${paleSat}% 88%);
      --h5-color: hsl(var(--sscc-contrast-h) ${paleSat}% 88%);
      --h6-color: hsl(var(--sscc-contrast-h) ${paleSat}% 88%);
    `);

    const links = this.group(s.animateLinks, `
      --link-color: hsl(var(--sscc-h) ${sat}% ${accL}%);
      --link-color-hover: hsl(var(--sscc-contrast-h) ${sat}% 50%);
      --link-unresolved-color: hsl(var(--sscc-h) ${mutedSat}% 50%);
      --link-unresolved-decoration-color: hsl(var(--sscc-contrast-h) ${sat}% 50%);
      --link-external-color: hsl(var(--sscc-h) ${sat}% 62%);
      --link-external-color-hover: hsl(var(--sscc-contrast-h) ${sat}% 50%);
    `);

    const graph = this.group(s.animateGraph, `
      --graph-line: hsl(var(--sscc-h) ${panelSat2}% 38%);
      --graph-node: hsl(var(--sscc-h) ${sat}% ${accL}%);
      --graph-node-focused: hsl(var(--sscc-contrast-h) ${sat}% 50%);
      --graph-node-tag: hsl(var(--sscc-h) ${sat}% ${accL}%);
      --graph-node-attachment: hsl(var(--sscc-contrast-h) ${paleSat}% 88%);
      --graph-node-unresolved: hsl(var(--sscc-h) ${Math.min(100, sat)}% 25%);
    `);

    const tags = this.group(s.animateTags, `
      --tag-color: hsl(var(--sscc-h) ${paleSat}% 75%);
      --tag-background: hsl(var(--sscc-h) ${panelSat1}% 5%);
      --tag-background-hover: hsl(var(--sscc-contrast-h) ${panelSat1}% 8%);
    `);

    const code = this.group(s.animateCode, `
      --code-background: hsl(var(--sscc-h) ${panelSat1}% 4%);
      --code-normal: hsl(var(--sscc-h) ${sat}% ${accL}%);
    `);

    this.styleTag.textContent = `
      body.css-settings-manager,
      body.theme-dark,
      body.theme-dark.css-settings-manager {
        --sscc-h: ${round(this.currentHue)};
        --sscc-contrast-h: calc(var(--sscc-h) + ${contrast});

        --background-primary: #000000;
        --background-primary-alt: #000000;
        --background-secondary: hsl(var(--sscc-h) ${panelSat1}% 4%);
        --background-secondary-alt: hsl(var(--sscc-h) ${panelSat1}% 7%);

        --bg1: #000000;
        --base: #000000;
        --bg2: hsl(var(--sscc-h) ${panelSat1}% 4%);
        --bg3: hsl(var(--sscc-h) ${panelSat1}% 7%);

        --ui1: hsl(var(--sscc-h) ${panelSat1}% 20%);
        --ui2: hsl(var(--sscc-h) ${panelSat2}% 38%);
        --ui3: hsl(var(--sscc-h) ${sat}% ${accL}%);

        --ax1: hsl(var(--sscc-h) ${sat}% ${accL}%);
        --ax2: hsl(var(--sscc-contrast-h) ${paleSat}% 75%);
        --ax3: hsl(var(--sscc-h) ${paleSat}% ${textL}%);
        --sp1: hsl(var(--sscc-contrast-h) ${sat}% 50%);

        --canvas-dot-pattern: hsl(var(--sscc-h) ${panelSat2}% 38%);

        --embed-background: hsl(var(--sscc-h) ${paleSat}% ${textL}% / 0.05);
        --embed-decoration-color: hsl(var(--sscc-h) ${panelSat2}% 38%);

        --line-number-color: hsl(var(--sscc-h) ${panelSat3}% 41%);
        --line-number-color-active: hsl(var(--sscc-h) ${sat}% ${accL}%);
        --active-line-bg: hsl(var(--sscc-h) ${sat}% ${accL}% / 0.05);

        --tx1: hsl(var(--sscc-h) ${paleSat}% ${textL}%);
        --tx2: hsl(var(--sscc-h) ${mutedSat}% 50%);
        --tx3: hsl(var(--sscc-h) ${panelSat1}% 31%);

        --text-normal: hsl(var(--sscc-h) ${paleSat}% ${textL}%);
        --text-muted: hsl(var(--sscc-h) ${mutedSat}% 50%);
        --text-faint: hsl(var(--sscc-h) ${panelSat1}% 31%);
        --text-accent: hsl(var(--sscc-h) ${sat}% ${accL}%);
        --text-accent-hover: hsl(var(--sscc-contrast-h) ${sat}% 50%);

        --text-formatting: hsl(var(--sscc-h) ${sat}% 62%);
        --italic-color: hsl(var(--sscc-h) ${paleSat}% 75%);
        --bold-color: hsl(var(--sscc-h) ${sat}% 62%);

        --hl1: hsl(var(--sscc-contrast-h) ${sat}% 50% / 0.25);
        --hl2: hsl(var(--sscc-h) ${sat}% ${accL}% / 0.15);

        --interactive-accent: hsl(var(--sscc-h) ${sat}% ${accL}%);
        --interactive-accent-hover: hsl(var(--sscc-contrast-h) ${sat}% 50%);
        --interactive-normal: hsl(var(--sscc-h) ${panelSat1}% 11%);
        --interactive-hover: hsl(var(--sscc-h) ${panelSat2}% 18%);

        ${headings}
        ${links}
        ${graph}
        ${tags}
        ${code}

        --h1-size: 1.7em;
        --h1-weight: 700;
        --h2-size: 1.43em;
        --h2-weight: 600;
        --h3-size: 1.2em;
        --h3-weight: 500;
        --h4-size: 1.11em;
        --h4-weight: 400;
        --h5-size: 0.94em;
        --h5-weight: 400;
        --h6-size: 0.8em;
        --bold-modifier: 400;
        --p-spacing: 1.75rem;
        --heading-spacing: 1.4em;
        --tag-radius: 14px;
        --tag-border-width: 1px;
        --link-unresolved-opacity: 0.45;
        --gutter-background: transparent;
      }
    `;
  }

  applyHue(hue) {
    this.currentHue = normHue(hue);
    if (this.styleTag) this.styleTag.style.setProperty('--unused', '');
    const roots = document.querySelectorAll('body');
    roots.forEach(el => {
      el.style.setProperty('--sscc-h', String(round(this.currentHue)));
      el.style.setProperty('--sscc-contrast-h', String(round(normHue(this.currentHue + Number(this.settings.contrastOffset || 180)))));
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.startTime = performance.now();
    this.lastFrame = 0;
    const baseHue = this.currentHue;

    const tick = now => {
      if (!this.running) return;
      const fps = clamp(Number(this.settings.fps) || 30, 1, 120);
      const minFrameMs = 1000 / fps;
      if (now - this.lastFrame >= minFrameMs) {
        const duration = Math.max(1, Number(this.settings.cycleSeconds) || 240) * 1000;
        const progress = ((now - this.startTime) % duration) / duration;
        const dir = Number(this.settings.direction) === -1 ? -1 : 1;
        this.applyHue(baseHue + dir * progress * 360);
        this.lastFrame = now;
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(clear) {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.running = false;
    document.body.style.removeProperty('--sscc-h');
    document.body.style.removeProperty('--sscc-contrast-h');
    if (clear && this.styleTag) this.styleTag.textContent = '';
  }

  restartIfRunning() {
    if (!this.running) {
      this.rebuildStyle();
      this.applyHue(this.currentHue);
      return;
    }
    this.stop(false);
    this.rebuildStyle();
    this.start();
  }

  resetToStart() {
    const wasRunning = this.running || this.settings.enabled;
    this.stop(false);
    this.currentHue = normHue(this.settings.startHue);
    this.rebuildStyle();
    this.applyHue(this.currentHue);
    if (wasRunning && this.settings.enabled) this.start();
  }
};
