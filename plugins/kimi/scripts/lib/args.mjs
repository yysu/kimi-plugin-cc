// Minimal argv parser. Recognized:
//   --flag           (boolean)
//   --opt value      (string)
//   --opt=value      (string)
//   positional args  (collected in order)
// Unknown flags are passed through as positional so callers can `.error()` if they care.

export function parseArgs(argv, spec = {}) {
  const flags = new Set(spec.flags || []);
  const opts = new Set(spec.opts || []);
  const out = { _: [], flags: {}, opts: {} };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      out._.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq < 0 ? a.slice(2) : a.slice(2, eq);
      const inlineVal = eq < 0 ? null : a.slice(eq + 1);
      if (flags.has(name)) {
        if (inlineVal !== null) throw new Error(`flag --${name} does not take a value`);
        out.flags[name] = true;
      } else if (opts.has(name)) {
        const v = inlineVal !== null ? inlineVal : argv[++i];
        if (v === undefined) throw new Error(`option --${name} requires a value`);
        out.opts[name] = v;
      } else {
        // Unknown — treat as positional so caller can decide.
        out._.push(a);
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}
