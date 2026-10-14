import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FileCode2,
  FileText,
  Image,
  Library,
  Trash2,
} from 'lucide-react';
import type { Project } from '../core/model';
export function FileTree({
  project,
  selectedFolder,
  onFolder,
  onFile,
  onDelete,
}: {
  project: Project;
  selectedFolder: string;
  onFolder: (path: string) => void;
  onFile: (path: string) => void;
  onDelete: (path: string, folder: boolean) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; folder: boolean } | null>(
    null,
  );
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menu) return;
    menuButton.current?.focus();
    const close = () => setMenu(null);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', key);
    };
  }, [menu]);
  function context(e: React.MouseEvent, path: string, folder: boolean) {
    e.preventDefault();
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 170),
      y: Math.min(e.clientY, window.innerHeight - 50),
      path,
      folder,
    });
  }
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const folders = new Set(project.folders || []);
  for (const file of project.files) {
    const parts = file.path.split('/');
    while (parts.length > 1) {
      parts.pop();
      folders.add(parts.join('/'));
    }
  }
  const parent = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  function tree(root = '', depth = 0): React.ReactNode {
    return (
      <>
        {[...folders]
          .filter((p) => parent(p) === root)
          .sort()
          .map((folder) => (
            <div key={folder}>
              <button
                className={selectedFolder === folder ? 'folder selected' : 'folder'}
                style={{ paddingLeft: 10 + depth * 14 }}
                title={folder}
                onContextMenu={(e) => context(e, folder, true)}
                aria-expanded={!collapsed.has(folder)}
                onClick={() => {
                  onFolder(folder);
                  setCollapsed((current) => {
                    const next = new Set(current);
                    next.has(folder) ? next.delete(folder) : next.add(folder);
                    return next;
                  });
                }}
              >
                {collapsed.has(folder) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <Folder size={15} />
                <span>{folder.split('/').pop()}</span>
              </button>
              {!collapsed.has(folder) && tree(folder, depth + 1)}
            </div>
          ))}
        {project.files
          .filter((f) => parent(f.path) === root)
          .map((file) => (
            <button
              key={file.path}
              style={{ paddingLeft: 12 + depth * 14 }}
              title={file.path}
              onContextMenu={(e) => context(e, file.path, false)}
              className={project.activeFile === file.path ? 'selected' : ''}
              onClick={() => {
                onFile(file.path);
                onFolder(root);
              }}
            >
              {/\.pdf$/i.test(file.path) ? (
                <FileText size={15} />
              ) : file.binary ? (
                <Image size={15} />
              ) : file.path.endsWith('.bib') ? (
                <Library size={15} />
              ) : (
                <FileCode2 size={15} />
              )}
              <span>{file.path.split('/').pop()}</span>
              {file.path === project.mainFile && <span className="main-dot" title="主文件" />}
            </button>
          ))}
      </>
    );
  }
  return (
    <div className="file-tree">
      {tree()}
      {menu &&
        createPortal(
          <div
            className="file-context-menu"
            role="menu"
            style={{ left: menu.x, top: menu.y }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              ref={menuButton}
              role="menuitem"
              onClick={() => {
                onDelete(menu.path, menu.folder);
                setMenu(null);
              }}
            >
              <Trash2 size={15} />
              {menu.folder ? '删除文件夹' : '删除文件'}
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
