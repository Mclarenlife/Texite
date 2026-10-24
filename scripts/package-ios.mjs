import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

if (process.platform !== 'darwin') throw new Error('iOS 模拟器打包需要 macOS 和 Xcode 26；Windows 可运行 pnpm build:ios 验证网页部分。');
const root = process.cwd();
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });
const out = path.join(root, 'release/ios');
mkdirSync(out, { recursive: true });
run('sips', ['-z', '1024', '1024', 'apps/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png']);
run('xcodebuild', ['-project', 'apps/ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug', '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', '.tools/ios-build', 'CODE_SIGNING_ALLOWED=NO', 'ONLY_ACTIVE_ARCH=NO', 'build']);
const name = 'Texite-0.1.0-alpha.1-ios-simulator.zip';
run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', '.tools/ios-build/Build/Products/Debug-iphonesimulator/App.app', path.join(out, name)]);
writeFileSync(path.join(out, 'SHA256SUMS.txt'), `${createHash('sha256').update(readFileSync(path.join(out, name))).digest('hex')}  ${name}\n`);
writeFileSync(path.join(out, 'build-info.json'), JSON.stringify({ version: '0.1.0-alpha.1', platform: 'ios-simulator', minimumOS: '17.4', commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), signedForDevice: false }, null, 2));
