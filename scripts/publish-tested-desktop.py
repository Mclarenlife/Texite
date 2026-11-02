"""Publish only desktop installers from matching, successful CI runs. Manual workflow only."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.parse
import urllib.request

REPO = os.environ['GITHUB_REPOSITORY']
API = 'https://api.github.com/repos/' + REPO
HEADERS = {'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
           'Accept': 'application/vnd.github+json', 'User-Agent': 'Texite-release'}


def request(route, method='GET', body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + route, data=data, method=method,
                                 headers={**HEADERS, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=90) as response:
        return json.load(response)


runs = []
for variable, workflow in [('DESKTOP_RUN', '.github/workflows/desktop.yml'),
                           ('VALIDATION_RUN', '.github/workflows/ci.yml')]:
    run_id = os.environ[variable]
    assert run_id.isdecimal(), 'Invalid run ID'
    run = request('/actions/runs/' + run_id)
    assert run['conclusion'] == 'success' and run['status'] == 'completed', 'Tests not successful'
    assert run['path'] == workflow and run['head_repository']['full_name'] == REPO, 'Unexpected build source'
    assert run['event'] == 'push', 'Only repository push builds can be published'
    runs.append(run)
assert runs[0]['head_sha'] == runs[1]['head_sha'], 'Builds use different commits'
sha = runs[0]['head_sha']
package = request('/contents/package.json?ref=' + sha)
version = json.loads(base64.b64decode(package['content']))['version']
assert re.fullmatch(r'\d+\.\d+\.\d+-beta\.\d+', version), 'This workflow only publishes beta releases'
tag = 'v' + version

subprocess.run(['gh', 'run', 'download', str(runs[0]['id']), '--repo', REPO,
                '--name', 'Texite-Windows-desktop', '--name', 'Texite-macOS-desktop',
                '--dir', 'installers'], check=True)
files = []
for name in [f'Texite Setup {version}.exe', f'Texite-{version}-arm64.dmg']:
    matches = list(Path('installers').rglob(name))
    assert len(matches) == 1, 'Installer missing or ambiguous: ' + name
    files.append(matches[0])
digests = {p.name.replace(' ', '.'): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}

notes = f'''本次为 {version} 桌面测试版。

- 修复 EPS 图片自动转换，支持 Biber、MakeIndex 及常见辅助编译流程。
- 改善大项目导入，支持超过 500 个文件和 50 MB 的项目，优化大文件传输与保存。
- 支持项目内跨文档引用与依赖编译，并复用编译缓存，可清理后重新编译。
- 新增投稿 ZIP 和生成文件导出；重新编译后保留 PDF 阅读位置和缩放。
- 支持标准 TikZ 外部化，以及配置本机 Inkscape、latexminted 后的 SVG 和 minted 3 编译。
- 修复 macOS 的内部辅助文件读取兼容问题，保留现有文件访问限制。

仅提供 Windows x64 和 Mac Apple Silicon（arm64）安装包，扩展包沿用此前版本。
Inkscape、latexminted 需在本机另行安装并配置；此版本不启用任意 shell escape。
macOS 使用 ad-hoc 签名，尚未进行 Apple Developer ID 公证。

Windows/macOS 构建、编译测试、安装包启动检查及网页回归已通过。
源代码提交：`{sha}`
构建记录：{runs[0]['html_url']}
回归记录：{runs[1]['html_url']}

SHA-256：
'''
notes += '\n'.join(f'`{name}`\n```text\n{digest}\n```' for name, digest in digests.items())
release = next((r for r in request('/releases?per_page=100') if r['tag_name'] == tag), None)
if release is None:
    release = request('/releases', 'POST', {'tag_name': tag, 'target_commitish': sha,
                      'name': 'Texite ' + version, 'body': notes, 'draft': True,
                      'prerelease': True, 'make_latest': 'false'})
assert release['target_commitish'] == sha, 'Existing release targets another commit'
release_route = '/releases/' + str(release['id'])
for path in files:
    name = path.name.replace(' ', '.')
    assets = request(release_route + '/assets')
    existing = next((a for a in assets if a['name'] == name), None)
    if existing is None:
        assert release['draft'], 'Cannot add missing assets to a published release'
        url = release['upload_url'].split('{')[0] + '?name=' + urllib.parse.quote(name)
        req = urllib.request.Request(url, data=path.read_bytes(), method='POST',
                                     headers={**HEADERS, 'Content-Type': 'application/octet-stream'})
        with urllib.request.urlopen(req, timeout=600) as response:
            existing = json.load(response)
    assert existing['size'] == path.stat().st_size and existing.get('digest') == 'sha256:' + digests[name], 'Asset verification failed'
    print('Verified', name, digests[name], flush=True)
assets = request(release_route + '/assets')
assert set(a['name'] for a in assets) == set(digests), 'Unexpected release attachments'
if release['draft']:
    request(release_route, 'PATCH', {'body': notes, 'draft': False, 'prerelease': True, 'make_latest': 'false'})
release = request(release_route)
assert not release['draft'] and len(release['assets']) == 2
print(release['html_url'], flush=True)
with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as summary:
    summary.write(f"Published [{tag}]({release['html_url']}) with two verified desktop installers.\n")
