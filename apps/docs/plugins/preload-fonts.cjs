const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = function preloadFonts() {
  return {
    name: 'zeer-preload-fonts',
    async postBuild({outDir, baseUrl}) {
      const fonts = (await fs.readdir(path.join(outDir, 'assets/fonts')))
        .filter(name => name.startsWith('manrope-') && name.endsWith('.woff2'));
      if (fonts.length !== 1) throw new Error('Expected one emitted Manrope font');
      const preload = `<link rel="preload" href="${baseUrl}assets/fonts/${fonts[0]}" as="font" type="font/woff2" crossorigin="anonymous">`;
      for (const file of await fs.readdir(outDir, {recursive: true})) {
        if (!file.endsWith('.html')) continue;
        const target = path.join(outDir, file);
        const html = await fs.readFile(target, 'utf8');
        await fs.writeFile(target, html.replace('</head>', preload + '</head>'));
      }
    },
  };
};
