import { test, expect } from '@playwright/test';
test('compiler library previews optional modules, confirms removal and shows the selected engine', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const base = {
      id: 'engine-pdflatex',
      label: 'pdfLaTeX',
      version: 'TeX Live 2025 final',
      kind: 'engine' as const,
      engine: 'pdflatex' as const,
      dependencies: [],
      bytes: 2_000_000,
      requiredBy: [],
    };
    const font = {
      id: 'fonts',
      label: 'OpenType 字体',
      version: '2025',
      kind: 'package' as const,
      dependencies: [],
      bytes: 10_000_000,
      requiredBy: [],
    };
    const xe = {
      ...base,
      id: 'engine-xelatex',
      engine: 'xelatex' as const,
      label: 'XeLaTeX',
      dependencies: ['fonts'],
    };
    let installed: any[] = [base];
    window.texite = {
      openProject: async () => null,
      listProjects: async () => [],
      reopenProject: async () => null,
      importProject: async (p) => p,
      saveProject: async () => ({ cancelled: true }),
      detectEngines: async () => ({
        bundled: true,
        latexmk: false,
        engines: {
          pdflatex: installed.some((m) => m.engine === 'pdflatex'),
          xelatex: installed.some((m) => m.engine === 'xelatex'),
          lualatex: false,
          tectonic: false,
        },
        details: { pdflatex: 'pdfLaTeX · TeX Live 2025 final · 离线' },
      }),
      listRuntime: async () => installed,
      chooseRuntimePack: async () => ({
        label: 'XeLaTeX 离线扩展',
        platform: 'win32-x64',
        modules: [font, xe],
      }),
      installRuntimePack: async () => {
        installed = [base, font, xe];
        return installed;
      },
      removeRuntimeModule: async (id) => {
        installed = installed.filter((m) => m.id !== id);
        return installed;
      },
      restoreDefaultRuntime: async () => {
        installed = [base];
        return installed;
      },
      onCompileLog: () => () => {},
      cancelCompile: async () => {},
      compile: async (p) => ({
        success: false,
        revision: p.revision,
        log: 'XeLaTeX 未安装。不会自动切换到其他引擎。',
      }),
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '编译设置' }).click();
  const library = page.getByRole('region', { name: '引擎与宏包管理' });
  await expect(library.getByText('TeX Live 2025 final · 2.0 MB')).toBeVisible();
  await library.getByRole('button', { name: '导入离线扩展包' }).click();
  await expect(library.getByText('XeLaTeX 离线扩展')).toBeVisible();
  await expect(library.getByRole('checkbox')).toHaveCount(2);
  await library.getByRole('button', { name: '取消', exact: true }).click();
  await expect(library.getByRole('button', { name: '卸载 XeLaTeX' })).toHaveCount(0);
  await library.getByRole('button', { name: '导入离线扩展包' }).click();
  await library.getByRole('button', { name: '安装所选模块及依赖' }).click();
  await expect(library.getByRole('button', { name: '卸载 XeLaTeX' })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: '.qa/runtime-manager.png' });
  await library.getByRole('button', { name: '卸载 XeLaTeX' }).click();
  await expect(library.getByRole('alert')).toContainText('文稿会保留');
  await library.getByRole('button', { name: '取消', exact: true }).click();
  await expect(library.getByRole('button', { name: '卸载 XeLaTeX' })).toBeVisible();
  await library.getByRole('button', { name: '卸载 XeLaTeX' }).click();
  await library.getByRole('button', { name: '确认卸载' }).click();
  await expect(library.getByRole('button', { name: '卸载 XeLaTeX' })).toHaveCount(0);
  await page.getByLabel('编译引擎').selectOption('xelatex');
  await page.getByRole('dialog').getByRole('button', { name: '关闭' }).click();
  await expect(page.locator('.status-bar')).toContainText('XeLaTeX · 未安装');
  await page.getByRole('button', { name: '编译文稿', exact: false }).click();
  await expect(
    page.getByText('XeLaTeX 未安装。不会自动切换到其他引擎。', { exact: false }),
  ).toBeVisible();
});
