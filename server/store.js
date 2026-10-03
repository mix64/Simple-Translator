import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Keeps sessions and messages in memory, persisted to a single JSON file.
// Writes go to a temp file and are renamed into place so a crash never leaves a broken file.
export class Store {
  constructor(file) {
    this.file = file;
    this.data = null;
    this.queue = Promise.resolve();
  }

  async load() {
    let data = {};
    try {
      data = JSON.parse(await readFile(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    this.data = {
      sessions: data.sessions ?? [],
      messages: data.messages ?? [],
    };
  }

  save() {
    const json = JSON.stringify(this.data, null, 2);
    this.queue = this.queue
      .then(async () => {
        await mkdir(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        await writeFile(tmp, json);
        await rename(tmp, this.file);
      })
      .catch((err) => console.error('データの保存に失敗しました:', err));
    return this.queue;
  }
}
