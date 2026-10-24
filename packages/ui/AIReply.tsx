import { memo, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Check, Copy } from 'lucide-react';
import 'katex/dist/katex.min.css';

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="ai-code-block">
      <button
        type="button"
        className="icon-button"
        aria-label={copied ? '已复制代码' : '复制代码'}
        onClick={async (e) => {
          const text = e.currentTarget.parentElement?.querySelector('pre')?.textContent || '';
          try {
            if (window.texite?.writeClipboard) await window.texite.writeClipboard(text);
            else await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

// No raw HTML or remote image requests: model output is untrusted document content.
export const AIReply = memo(function AIReply({ text }: { text: string }) {
  return (
    <div className="ai-reply ai-markdown">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { trust: false, strict: 'ignore' }]]}
        skipHtml
        components={{
          pre: CodeBlock,
          a: ({ href, children }) =>
            href && /^(https?:|mailto:)/i.test(href) ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ src, alt }) =>
            typeof src === 'string' && /^https?:/i.test(src) ? (
              <a href={src} target="_blank" rel="noopener noreferrer">
                {alt || '查看图片'}
              </a>
            ) : (
              <span>{alt}</span>
            ),
          table: ({ children }) => (
            <div className="ai-table-scroll">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
});
