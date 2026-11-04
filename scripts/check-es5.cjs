/* Syntax compatibility only: firmware-specific API availability is checked separately. */
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const root = path.resolve(__dirname, '..');
let count = 0;
function parse(source, file) {
  // QML library directives are not JavaScript and precede otherwise ES5 helpers.
  source = source.replace(/^\.pragma library[^\n]*/m, '');
  try { acorn.parse(source, {ecmaVersion: 5, allowHashBang: true}); }
  catch (error) { throw new Error(file + ': ' + error.message); }
  count++;
}
function visit(relative) {
  for (const entry of fs.readdirSync(path.join(root, relative), {withFileTypes: true})) {
    const file = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (entry.name.endsWith('.js')) parse(fs.readFileSync(path.join(root, file), 'utf8'), file);
    else if (entry.name.endsWith('.html')) {
      const html = fs.readFileSync(path.join(root, file), 'utf8');
      let index = 0;
      for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
        if (/\bsrc\s*=/i.test(script[1]) || !script[2].trim()) continue;
        parse(script[2], file + ' inline script ' + (++index));
      }
    }
  }
}
visit('app');
visit('tv');
console.log('ES5 syntax passed for ' + count + ' app/TV JavaScript sources and inline HTML scripts.');
