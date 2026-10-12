import { useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FileCode2, Image, Library } from 'lucide-react';
import type { Project } from '../core/model';
export function FileTree({
  project,
  selectedFolder,
  onFolder,
  onFile,
}: {
  project: Project;
  selectedFolder: string;
  onFolder: (path: string) => void;
  onFile: (path: string) => void;
}) {
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
              className={project.activeFile === file.path ? 'selected' : ''}
              onClick={() => {
                onFile(file.path);
                onFolder(root);
              }}
            >
              {file.binary ? (
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
  return <div className="file-tree">{tree()}</div>;
}
