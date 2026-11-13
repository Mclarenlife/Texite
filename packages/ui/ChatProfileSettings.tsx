import { useState } from 'react';
import type { AIController } from '../workbench/useAI';
import { Select } from './Select';
export function ChatProfileSettings({ ai, onSaved }: { ai: AIController; onSaved(): void }) {
  const [profileId, setProfileId] = useState(ai.chatConfig.id || '');
  const [profileName, setProfileName] = useState(ai.chatConfig.name || '');
  const [baseURL, setBaseURL] = useState(ai.chatConfig.baseURL);
  const [apiModel, setApiModel] = useState(ai.chatConfig.model);
  const [apiKey, setApiKey] = useState('');
  const [configError, setConfigError] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  return (
    <form
      className="api-settings"
      onSubmit={async (e) => {
        e.preventDefault();
        if (savingConfig) return;
        setSavingConfig(true);
        try {
          await ai.saveChatConfig({
            id: profileId,
            name: profileName,
            baseURL,
            model: apiModel,
            apiKey,
          });
          onSaved();
          setApiKey('');
        } catch (err) {
          setConfigError((err as Error).message);
        } finally {
          setSavingConfig(false);
        }
      }}
    >
      <div className="ai-inline-actions">
        <Select
          aria-label="编辑 API 配置"
          value={profileId}
          onValueChange={(id) => {
            const c = ai.chatProfiles.find((p) => p.id === id);
            if (!c) return;
            setProfileId(id);
            setProfileName(c.name || '');
            setBaseURL(c.baseURL);
            setApiModel(c.model);
            setApiKey('');
          }}
        >
          <option value="">新 API 配置</option>
          {ai.chatProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || p.model}
            </option>
          ))}
        </Select>
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            setProfileId('');
            setProfileName('');
            setBaseURL('');
            setApiModel('');
            setApiKey('');
          }}
        >
          新增 API
        </button>
      </div>
      <label>
        配置名称
        <input
          aria-label="API 配置名称"
          value={profileName}
          maxLength={100}
          onChange={(e) => setProfileName(e.target.value)}
          placeholder="例如：论文助手"
        />
      </label>
      <label>
        API 地址
        <input
          aria-label="API 地址"
          value={baseURL}
          onChange={(e) => setBaseURL(e.target.value)}
          placeholder="https://api.openai.com/v1"
          required
        />
      </label>
      <label>
        模型
        <input
          aria-label="API 模型名称"
          value={apiModel}
          onChange={(e) => setApiModel(e.target.value)}
          placeholder="服务商提供的模型 ID"
          required
        />
      </label>
      <label>
        API Key
        <input
          aria-label="API Key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            ai.chatProfiles.find((p) => p.id === profileId)?.hasKey
              ? '已配置，留空保留'
              : '本机无鉴权服务可留空'
          }
        />
      </label>
      <p>
        {window.texite?.chat
          ? '密钥使用系统加密保存；系统加密不可用时仅在本次运行保留。'
          : '网页版密钥仅在内存保留，刷新后需重新填写；接口需允许浏览器跨域访问。'}
      </p>
      {configError && (
        <p className="form-error" role="alert">
          {configError}
        </p>
      )}
      <div className="ai-inline-actions">
        <button className="primary-button" disabled={ai.busy || savingConfig}>
          保存配置
        </button>
        <button
          type="button"
          className="text-button"
          disabled={ai.busy}
          onClick={async () => {
            try {
              await ai.saveChatConfig({
                id: profileId,
                name: profileName,
                baseURL,
                model: apiModel,
                apiKey: '',
                clearKey: true,
              });
              setApiKey('');
            } catch (err) {
              setConfigError((err as Error).message);
            }
          }}
        >
          清除密钥
        </button>
      </div>
    </form>
  );
}
