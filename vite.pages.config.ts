import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig(() => {
  const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1];
  const basePath = repositoryName ? `/${repositoryName}` : '';

  return {
    base: `${basePath}/`,
    css: { postcss: { plugins: [tailwindcss()] } },
    define: {
      'process.env.NEXT_PUBLIC_BASE_PATH': JSON.stringify(basePath),
    },
    plugins: [react()],
    publicDir: 'public',
    build: {
      outDir: 'pages-dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: resolve(process.cwd(), 'index.html'),
          v2: resolve(process.cwd(), 'v2/index.html'),
        },
      },
    },
  };
});
