import { readFile, rename, writeFile } from 'node:fs/promises';

const DEFAULTS = {
  host: '0.0.0.0',
  port: 8787,
  dataFile: 'data/db.json',
  settings: {
    baseUrl: 'http://localhost:8000/v1',
    apiKey: '',
    model: '',
    temperature: 0.3,
    enableThinking: true,
    reasoningEffort: '',
    contextMessages: 30,
  },
};

// Per-environment values (listen address, LLM endpoint, API key, ...) live in config.json.
// Settings changed in the UI are written back to its "settings" key.
export class Config {
  constructor(file) {
    this.file = file;
    this.raw = {};
    this.queue = Promise.resolve();
  }

  async load() {
    try {
      this.raw = JSON.parse(await readFile(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw new Error(`${this.file} を読み込めません: ${err.message}`);
      this.raw = {};
    }
    this.host = this.raw.host ?? DEFAULTS.host;
    this.port = Number(this.raw.port ?? DEFAULTS.port);
    this.dataFile = this.raw.dataFile ?? DEFAULTS.dataFile;
    this.settings = { ...DEFAULTS.settings, ...this.raw.settings };
  }

  saveSettings() {
    this.raw = { ...this.raw, settings: this.settings };
    const json = `${JSON.stringify(this.raw, null, 2)}\n`;
    this.queue = this.queue.catch(() => {}).then(async () => {
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, json);
      await rename(tmp, this.file);
    });
    return this.queue;
  }
}
