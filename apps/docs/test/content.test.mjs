import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import test from 'node:test';

const root = new URL('../src/pages/', import.meta.url);
async function pages(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await pages(path)));
    else if (/\.mdx?$/.test(path)) files.push(path);
  }
  return files;
}

test('documentation routes and source references stay within Harbor', async () => {
  const files = await pages(root.pathname);
  const routes = new Set(
    files.map(
      (file) =>
        `/${relative(root.pathname, file)
          .replace(/\.mdx?$/, '')
          .replace(/^index$/, '')}`,
    ),
  );
  assert.ok(files.length >= 12);
  const config = await readFile(new URL('../vocs.config.ts', import.meta.url), 'utf8');
  let navigationLinks = 0;
  for (const match of config.matchAll(/link:\s*['"](\/[^'"]*)['"]/g)) {
    navigationLinks++;
    assert.ok(routes.has(match[1]), match[1]);
  }
  assert.equal(navigationLinks, routes.size, 'Every page must appear in navigation');
  for (const file of files) {
    const body = await readFile(file, 'utf8');
    for (const match of body.matchAll(/https:\/\/github\.com\/alycz\/harbor\/blob\/main\/([^\s)]+)/g)) {
      await access(new URL(`../../../${match[1]}`, import.meta.url));
    }
    assert.doesNotMatch(body, /github\.com\/alycz\/(?:pilot|atlasv1)/i);
    for (const match of body.matchAll(/\]\((\/[^)#]*)(?:#[^)]*)?\)/g))
      assert.ok(routes.has(match[1]), `${file}: ${match[1]}`);
  }
});
