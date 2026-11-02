const fs = require('fs');
const path = require('path');

class JsonlStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.items = [];
    this.reload();
  }

  reload() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.items = [];
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, '', 'utf8');
      return this.items;
    }
    const raw = fs.readFileSync(this.filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        this.items.push(JSON.parse(line));
      } catch (error) {
        console.warn(`跳过损坏记录 ${this.filePath}: ${error.message}`);
      }
    }
    return this.items;
  }

  append(item) {
    fs.appendFileSync(this.filePath, `${JSON.stringify(item)}\n`, 'utf8');
    this.items.push(item);
    return item;
  }

  replaceAll(items) {
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, items.map((item) => JSON.stringify(item)).join('\n') + '\n', 'utf8');
    fs.renameSync(tempPath, this.filePath);
    this.items = items;
  }
}

module.exports = { JsonlStore };
