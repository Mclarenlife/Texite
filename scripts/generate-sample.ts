// Regenerate with: pnpm exec tsx scripts/generate-sample.ts; then compile in .tools/sample.
import { mkdir, writeFile } from 'node:fs/promises';
import { createProject } from '../packages/core/sample';
await mkdir('.tools/sample', { recursive: true });
for (const file of createProject().files)
  await writeFile('.tools/sample/' + file.path, file.content);
