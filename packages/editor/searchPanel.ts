import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  search,
  SearchQuery,
  getSearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  closeSearchPanel,
} from '@codemirror/search';

export const localizedSearch = [
  EditorState.phrases.of({
    Search: '查找',
    Replace: '替换',
    next: '下一处',
    previous: '上一处',
    all: '全部',
    'match case': '区分大小写',
    'by word': '全词匹配',
    regexp: '正则表达式',
    replace: '替换',
    'replace all': '全部替换',
    close: '关闭',
    'Go to line': '跳转到行',
    go: '跳转',
  }),
  search({
    top: true,
    literal: true,
    createPanel(view: EditorView) {
      const dom = document.createElement('div');
      dom.className = 'texite-search';
      dom.setAttribute('aria-label', '查找与替换');
      const first = document.createElement('div'),
        second = document.createElement('div'),
        options = document.createElement('div');
      first.className = second.className = 'search-row';
      options.className = 'search-options';
      function input(name: string, placeholder: string) {
        const el = document.createElement('input');
        el.name = name;
        el.placeholder = placeholder;
        el.setAttribute('aria-label', placeholder);
        el.setAttribute('main-field', 'true');
        return el;
      }
      const query = input('search', '查找内容'),
        replacement = input('replace', '替换为');
      replacement.removeAttribute('main-field');
      const count = document.createElement('span');
      count.className = 'search-count';
      count.setAttribute('aria-live', 'polite');
      function button(text: string, action: () => void) {
        const el = document.createElement('button');
        el.type = 'button';
        const icon = ({ 上一处: '↑', 下一处: '↓', 关闭: '×' } as Record<string, string>)[text];
        el.textContent = icon || text;
        el.setAttribute('aria-label', text);
        if (icon) {
          el.title = text;
          el.className = 'search-icon';
        }
        el.onclick = action;
        return el;
      }
      const flags: Record<string, HTMLInputElement> = {};
      for (const [key, text] of [
        ['caseSensitive', '区分大小写'],
        ['wholeWord', '全词匹配'],
        ['regexp', '正则表达式'],
      ]) {
        const label = document.createElement('label'),
          check = document.createElement('input');
        check.type = 'checkbox';
        flags[key] = check;
        label.append(check, text);
        options.append(label);
        check.onchange = sync;
      }
      function sync() {
        view.dispatch({
          effects: setSearchQuery.of(
            new SearchQuery({
              search: query.value,
              replace: replacement.value,
              literal: true,
              caseSensitive: flags.caseSensitive.checked,
              wholeWord: flags.wholeWord.checked,
              regexp: flags.regexp.checked,
            }),
          ),
        });
      }
      function update() {
        const q = getSearchQuery(view.state);
        query.value = q.search;
        replacement.value = q.replace;
        for (const k of ['caseSensitive', 'wholeWord', 'regexp'] as const) flags[k].checked = q[k];
        let n = 0;
        if (q.valid) {
          const cursor = q.getCursor(view.state);
          while (!cursor.next().done && n <= 9999) n++;
        }
        count.textContent = !q.search
          ? ''
          : !q.valid
            ? '表达式无效'
            : `${n > 9999 ? '9999+' : n} 处匹配`;
      }
      query.oninput = replacement.oninput = sync;
      query.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          (e.shiftKey ? findPrevious : findNext)(view);
        }
      };
      first.append(
        query,
        count,
        button('上一处', () => findPrevious(view)),
        button('下一处', () => findNext(view)),
        button('关闭', () => closeSearchPanel(view)),
      );
      second.append(
        replacement,
        button('替换', () => replaceNext(view)),
        button('全部替换', () => replaceAll(view)),
      );
      dom.append(first, second, options);
      update();
      return { dom, update, top: true };
    },
  }),
];
