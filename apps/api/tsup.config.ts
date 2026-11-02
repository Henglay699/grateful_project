import fs from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    server: 'src/server.ts',
    'db/migrate': 'src/db/migrate.ts',
    'db/seed/index': 'src/db/seed/index.ts',
    'db/init': 'src/db/init.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Bundle the workspace package (it ships TypeScript source); keep npm deps external.
  noExternal: ['@gs/shared'],
  // The seed reads the CDC master list XLSX next to its bundle.
  async onSuccess() {
    fs.cpSync('src/db/seed/data', 'dist/db/seed/data', {
      recursive: true,
      filter: (src) => !src.endsWith('.ts'),
    });
  },
});
