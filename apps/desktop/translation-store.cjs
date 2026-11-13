const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = function translationStore(directory, secure) {
  const file = path.join(directory, 'translation.json');
  const persistent = () =>
    secure.isEncryptionAvailable() &&
    (process.platform !== 'linux' || secure.getSelectedStorageBackend?.() !== 'basic_text');
  return {
    persistent,
    async read() {
      let data;
      try {
        data = JSON.parse(await fs.readFile(file, 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw new Error('无法读取翻译设置。');
      }
      const { secret, ...config } = data;
      let apiKey = '';
      if (secret && persistent()) {
        try {
          apiKey = secure.decryptString(Buffer.from(secret, 'base64'));
        } catch {}
      }
      return { ...config, apiKey };
    },
    async write({ apiKey, ...config }) {
      const secret =
        apiKey && persistent() ? secure.encryptString(apiKey).toString('base64') : undefined;
      await fs.writeFile(file + '.tmp', JSON.stringify({ ...config, secret }), { mode: 0o600 });
      await fs.rename(file + '.tmp', file);
    },
  };
};
