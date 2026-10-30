const fs = require('node:fs/promises');
const path = require('node:path');
class ToolSettings {
  constructor(directory) {
    this.file = path.join(directory, 'compile-tools.json');
  }
  async get() {
    try {
      const value = JSON.parse(await fs.readFile(this.file, 'utf8'));
      return Object.fromEntries(
        ['inkscape', 'latexminted'].map((name) => [
          name,
          typeof value[name] === 'string' ? value[name] : '',
        ]),
      );
    } catch (e) {
      if (e.code === 'ENOENT') return { inkscape: '', latexminted: '' };
      throw e;
    }
  }
  async set(name, binary) {
    if (!['inkscape', 'latexminted'].includes(name)) throw new Error('未知的外部工具。');
    if (binary) {
      if (
        !path.isAbsolute(binary) ||
        !new RegExp('^' + name + '(?:\\.exe)?$', 'i').test(path.basename(binary)) ||
        !(await fs.stat(binary)).isFile()
      )
        throw new Error('请选择 ' + name + ' 可执行程序，而不是快捷方式或脚本配置文件。');
    }
    const settings = { ...(await this.get()), [name]: binary };
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file + '.tmp', JSON.stringify(settings));
    await fs.rename(this.file + '.tmp', this.file);
    return settings;
  }
}
module.exports = { ToolSettings };
