"""Keep reviewable simulator screenshots without bundling repeated debug videos."""
import json
from pathlib import Path
import shutil
import subprocess

out = Path('release/ios/screenshots')
out.mkdir(parents=True, exist_ok=True)
for result in Path('release/ios').glob('*.xcresult'):
    folder = Path('.tools/ios-attachments') / result.stem
    folder.mkdir(parents=True, exist_ok=True)
    exported = subprocess.run(['xcrun', 'xcresulttool', 'export', 'attachments', '--path', str(result), '--output-path', str(folder)])
    manifest = folder / 'manifest.json'
    if exported.returncode or not manifest.exists():
        continue
    count = 0
    for group in json.loads(manifest.read_text()):
        for item in group.get('attachments', []):
            name = Path(item.get('exportedFileName', '')).name
            if not name.endswith('.png'):
                continue
            if 'offline-chinese-pdf' in item.get('suggestedHumanReadableName', '') or item.get('isAssociatedWithFailure'):
                count += 1
                shutil.copyfile(folder / name, out / f'{result.stem}-{count}.png')
