const { randomUUID } = require('node:crypto');

// Search turns share the configured CLI, but have no editor tools or conversation history.
class LiteratureClient {
  constructor(ai, chat, fetcher) {
    this.ai = ai;
    this.chat = chat;
    this.fetcher = fetcher;
  }
  event(event) {
    const job = this.job;
    if (!job || event.runId !== job.runId) return false;
    if (event.type === 'text') job.text = (job.text + event.delta).slice(0, 60000);
    if (event.type === 'tool') {
      const list = event.tool === 'texite_list_files';
      this.ai.reply(event.requestId, {
        success: list,
        value: list ? { files: [] } : { error: '文献检索仅使用已提供的材料。' },
      });
    }
    if (event.type === 'done') {
      if (event.status === 'completed') job.resolve(job.text);
      else job.reject(new Error(event.error || 'CLI 检索已停止。'));
    }
    return true;
  }
  cancel(id) {
    if (this.job && (!id || this.job.id === id)) this.job.controller.abort();
  }
  async ask({ id, mode, prompt, context, model }) {
    if (this.job) throw new Error('上一轮文献检索仍在结束，请稍后重试。');
    if (
      !['cli', 'api'].includes(mode) ||
      typeof id !== 'string' ||
      id.length > 100 ||
      typeof prompt !== 'string' ||
      prompt.length > 4000 ||
      typeof context !== 'string' ||
      context.length > 60000 ||
      typeof model !== 'string' ||
      model.length > 200
    )
      throw new Error('文献检索请求无效。');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    const job = (this.job = { id, controller, runId: randomUUID(), text: '' });
    try {
      if (mode === 'api') {
        const { streamChat } = await import('./chat-transport.mjs');
        await streamChat(
          await this.chat.load(),
          [
            { role: 'system', content: prompt },
            { role: 'user', content: context },
          ],
          (delta) => {
            job.text += delta;
          },
          controller.signal,
          this.fetcher,
        );
        return job.text;
      }
      const connection = await this.ai.connect();
      controller.signal.throwIfAborted();
      if (!connection.authenticated) throw new Error('请先在终端登录已配置的 CLI。');
      const selected =
        connection.models.find((m) => m.id === model) ||
        connection.models.find((m) => m.isDefault) ||
        connection.models[0];
      if (!selected) throw new Error('CLI 未提供可用模型。');
      return await new Promise((resolve, reject) => {
        Object.assign(job, { resolve, reject });
        controller.signal.addEventListener(
          'abort',
          () => {
            if (this.ai.client?.active?.runId === job.runId)
              void Promise.resolve(this.ai.cancel()).catch(() => {});
            reject(new Error('文献检索已取消或超时。'));
          },
          { once: true },
        );
        this.ai
          .start({
            runId: job.runId,
            projectId: 'texite-literature',
            conversationId: job.runId,
            prompt,
            context,
            readOnly: true,
            model: selected.id,
          })
          .catch(reject);
      });
    } finally {
      clearTimeout(timer);
      this.job = null;
      if (mode === 'cli' && !this.ai.active)
        this.ai.clearHistory('texite-literature', 'chat', job.runId);
    }
  }
}
module.exports = { LiteratureClient };
