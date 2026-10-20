import {readFile, writeFile, mkdir, copyFile, access, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pages from '../pages.mjs';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(site, '../..');
const docs = path.join(site, '.generated/docs');
const assets = path.join(site, 'static/generated');
const github = 'https://github.com/EndPx/zeer';
const urlFor = id => `/docs/${id === 'intro' ? '' : id + '/'}`;
const routes = new Map(pages.map(([id, , , source]) => [path.resolve(root, source), urlFor(id)]));
// Only this workspace-owned generated directory may be cleared. Retired pages
// must not remain routable when a manifest entry is removed or renamed.
if (path.relative(root, docs) !== path.join('apps', 'docs', '.generated', 'docs')) throw new Error('Unsafe generated docs path');
await rm(docs, {recursive: true, force: true});
await mkdir(assets, {recursive: true});
const search = [], bundle = [], index = ['# Zeer documentation', '', '> Zcash testnet developer preview. Prep is public data; private receipts and memos are a local Chef workflow.', ''];
for (const [id, title, description, source] of pages) {
  const input = path.resolve(root, source);
  let text = (await readFile(input, 'utf8')).replace(/^# [^\n]+\r?\n/, '').trim();
  // Rewrite prose links, preserving fenced code verbatim. Unpublished repo files
  // link to their actual GitHub source rather than dead documentation routes.
  const pieces = text.split(/(^```[^\n]*\n[\s\S]*?^```\s*$)/gm);
  for (let i = 0; i < pieces.length; i += 2) {
    pieces[i] = pieces[i].replace(/(!?\[[^\]]*\]\()([^\s)]+)(\))/g, (all, start, target, end) => {
      if (/^(?:[a-z]+:|\/|#)/i.test(target)) return all;
      const [file, fragment] = target.split('#');
      const absolute = path.resolve(path.dirname(input), decodeURIComponent(file));
      const relative = path.relative(root, absolute).replaceAll('\\', '/');
      if (relative.startsWith('../')) throw new Error(`Link escapes repository: ${source}: ${target}`);
      const destination = routes.get(absolute) ?? `${github}/blob/main/${relative}`;
      return `${start}${destination}${fragment ? '#' + fragment : ''}${end}`;
    });
  }
  text = pieces.join('');
  const output = path.join(docs, `${id}.md`);
  await mkdir(path.dirname(output), {recursive: true});
  const editUrl = `${github}/edit/main/${source}`;
  const header = `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\nslug: ${JSON.stringify(id === 'intro' ? '/' : '/' + id)}\ncustom_edit_url: ${JSON.stringify(editUrl)}\n---\n\n`;
  await writeFile(output, header + text + '\n');
  const section = id.startsWith('prep/') ? 'Prep' : id.startsWith('chef/') ? 'Chef' : 'Start here';
  // All body text participates in local search; descriptions remain concise.
  search.push({title, description, section, url: urlFor(id), text: text.replace(/[`#*|>]/g, '').replace(/\s+/g, ' ')});
  bundle.push(`# ${title}\n\nSource: https://zeer.endpx.cloud${urlFor(id)}\n\n${text}`);
  index.push(`- [${title}](https://zeer.endpx.cloud${urlFor(id)}): ${description}`);
}
await writeFile(path.join(site, '.generated/search-index.json'), JSON.stringify(search));
await writeFile(path.join(assets, 'search-index.json'), JSON.stringify(search));
await writeFile(path.join(assets, 'llms.txt'), index.join('\n') + '\n');
await writeFile(path.join(assets, 'llms-full.txt'), bundle.join('\n\n---\n\n'));
await copyFile(path.join(root, 'apps/web/src/app/icon.svg'), path.join(assets, 'zeer.svg'));
for (const [pkg, file, output] of [
  ['@fontsource-variable/manrope', 'manrope-latin-wght-normal.woff2', 'manrope.woff2'],
  ['@fontsource/ibm-plex-mono', 'ibm-plex-mono-latin-400-normal.woff2', 'mono.woff2'],
]) {
  // Resolve the workspace-installed package, whether npm hoists it or not.
  const css = fileURLToPath(import.meta.resolve(pkg + '/index.css'));
  const font = path.join(path.dirname(css), 'files', file);
  await access(font);
  await copyFile(font, path.join(assets, output));
  await copyFile(path.join(path.dirname(css), 'LICENSE'), path.join(assets, output.replace('.woff2', '-OFL.txt')));
}
console.log(`Prepared ${pages.length} documentation pages, local search, fonts and LLM references.`);
