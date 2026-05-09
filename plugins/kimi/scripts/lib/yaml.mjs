// Minimal YAML subset parser, scoped to what plan frontmatter needs.
//
// Supported:
//   key: scalar           (scalar may be quoted with " or ' or unquoted)
//   key: |                (block-literal: indented lines below, joined by \n)
//   key:                  (followed by indented `- item` lines → string array)
//     - item
//     - "another"
//   # comment             (full-line comment)
//   blank lines           (ignored)
//
// NOT supported (we throw on these): nested mappings, flow style ({a: b}, [a, b]),
// anchors/aliases, tags, multi-doc separators. Plan frontmatter does not need them.
//
// Returns: plain object. Errors on malformed input with line numbers.

const QUOTED = /^(['"])((?:\\.|(?!\1).)*)\1$/;

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '') return '';
  const m = s.match(QUOTED);
  if (m) {
    const body = m[2];
    return m[1] === '"' ? body.replace(/\\(["\\nt])/g, (_, c) =>
      c === 'n' ? '\n' : c === 't' ? '\t' : c) : body;
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

function indentOf(line) {
  const m = line.match(/^( *)/);
  return m ? m[1].length : 0;
}

export function parseYaml(text) {
  // normalize line endings, drop trailing newlines
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = {};
  let i = 0;

  const fail = (msg, lineNo) => {
    throw new Error(`YAML parse error on line ${lineNo + 1}: ${msg}`);
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '' || trimmed.startsWith('#')) {
      i++;
      continue;
    }

    if (indentOf(line) !== 0) fail('unexpected indentation at top level', i);

    const colon = line.indexOf(':');
    if (colon < 0) fail('expected "key: ..."', i);

    const key = line.slice(0, colon).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) fail(`invalid key "${key}"`, i);
    const rhs = line.slice(colon + 1);
    const rhsTrim = rhs.trim();

    if (rhsTrim === '|') {
      // block literal
      i++;
      const blockLines = [];
      let blockIndent = -1;
      while (i < lines.length) {
        const bl = lines[i];
        if (bl.trim() === '') {
          blockLines.push('');
          i++;
          continue;
        }
        const ind = indentOf(bl);
        if (ind === 0) break;
        if (blockIndent < 0) blockIndent = ind;
        if (ind < blockIndent) break;
        blockLines.push(bl.slice(blockIndent));
        i++;
      }
      // strip trailing blank lines
      while (blockLines.length && blockLines[blockLines.length - 1] === '') blockLines.pop();
      out[key] = blockLines.join('\n');
      continue;
    }

    if (rhsTrim === '') {
      // expect array of `- item` on indented lines, OR empty value
      i++;
      const arr = [];
      let arrIndent = -1;
      while (i < lines.length) {
        const al = lines[i];
        if (al.trim() === '' || al.trim().startsWith('#')) { i++; continue; }
        const ind = indentOf(al);
        if (ind === 0) break;
        if (arrIndent < 0) arrIndent = ind;
        if (ind < arrIndent) break;
        const body = al.slice(arrIndent);
        if (!body.startsWith('- ') && body !== '-') fail('expected "- item"', i);
        const item = body.slice(2).trim();
        arr.push(parseScalar(item));
        i++;
      }
      out[key] = arr;
      continue;
    }

    out[key] = parseScalar(rhsTrim);
    i++;
  }

  return out;
}

// Extract YAML frontmatter from a markdown file. Returns { data, body }.
// Frontmatter is delimited by lines that are exactly `---`.
export function splitFrontmatter(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  if (lines[0] !== '---') {
    return { data: null, body: markdown };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { end = i; break; }
  }
  if (end < 0) {
    throw new Error('frontmatter started with `---` but never closed');
  }
  const fmText = lines.slice(1, end).join('\n');
  const body = lines.slice(end + 1).join('\n');
  return { data: parseYaml(fmText), body };
}
