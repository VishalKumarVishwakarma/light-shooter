// Mechanical bug-pattern scan. Complements (does not replace) reading the code:
// each rule below is a shape that has a known failure mode, so a hit is a
// place to look -- not automatically a bug.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const roots = [path.join(HERE, 'src'), path.join(HERE, '..', 'server', 'src')];
const files = [];
for (const r of roots) {
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.ts')) files.push(p);
    }
  };
  if (fs.existsSync(r)) walk(r);
}

const RULES = [
  ['timer never cancelled', /\bsetInterval\(/, (l) => !/clearInterval/.test(l)],
  ['raw setTimeout', /\bsetTimeout\(/, () => true],
  ['forEach + delete/clear same line', /\.forEach\(.*\b(delete|clear|remove)\b/, () => true],
  ['parseInt/float without radix', /parseInt\([^,)]+\)/, () => true],
  ['loose equality', /[^=!<>]==[^=]/, (l) => !/https?:|== '/.test(l)],
  ['Math.random() in a range test', /Math\.random\(\)\s*[<>]=?/, () => true],
  ['array index without length guard', /\[[a-z]+[0-9]*\]\s*(=|\.|\+)/, (l) => !/\.length|length\s*[<>=]/.test(l)],
  ['toFixed on non-literal', /\.toFixed\(/, (l) => !/Math\.|progress|alpha|speed|hp|frac|t\b|time/.test(l)],
  ['DOM listener without removal', /addEventListener\(/, (l) => !/removeEventListener/.test(l)],
  ['innerHTML', /\.innerHTML\s*=/, () => true],
  ['eval / Function ctor', /\beval\(|new Function\(/, () => true],
  ['await inside a non-async-looking callback', /onMessage\([^)]*=>\s*\{[^}]*await/, () => true],
  ['empty catch swallowing everything', /catch\s*(\([^)]*\))?\s*\{\s*\}/, () => true],
  ['optional chain absent on a known-maybe-null call', /state\?\.players\.get\([^)]*\)\./, () => true],
  ['while(true)', /while\s*\(\s*true\s*\)/, () => true],
  ['bitwise ops (32-bit truncation risk)', /[^&|]\s*<<|>>\s*[0-9]/, () => true],
  ['sort with a non-total comparator', /\.sort\(\(?[a-z]\)?\s*=>/, (l) => !/b\.|a\./.test(l)],
  ['JSON.parse without try', /JSON\.parse\(/, (l) => !/try|catch/.test(l)],
  ['Number()/parseInt on a possibly-undefined', /Number\([a-zA-Z_.]+\)/, (l) => !/\?\?|\|\||typeof|length/.test(l)],
];

let hits = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  const lines = src.split('\n');
  lines.forEach((l, i) => {
    for (const [name, re, extra] of RULES) {
      if (!re.test(l)) continue;
      if (extra && !extra(l)) continue;
      hits++;
      console.log(`${f}:${i + 1}  [${name}]  ${l.trim().slice(0, 104)}`);
    }
  });
}
console.log(`\n${hits} pattern hits across ${files.length} source files`);
