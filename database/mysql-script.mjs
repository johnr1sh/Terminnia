/**
 * Split a MySQL client script into server statements.
 *
 * DELIMITER is a mysql-client directive, not SQL sent to the server. This
 * parser removes those directives and keeps procedure/function bodies intact.
 */
export function splitMysqlScript(source) {
  if (typeof source !== 'string') throw new TypeError('SQL script must be a string.');

  const statements = [];
  let delimiter = ';';
  let buffer = '';
  let quote = null;
  let blockComment = false;
  let executableComment = false;
  let lineComment = false;
  let escaped = false;
  let lineStart = true;

  const pushStatement = () => {
    const statement = buffer.trim();
    if (statement) statements.push(statement);
    buffer = '';
  };

  for (let i = 0; i < source.length;) {
    const char = source[i];
    const next = source[i + 1] || '';

    if (lineStart && !quote && !blockComment && !lineComment && !buffer.trim()) {
      const lineEnd = source.indexOf('\n', i);
      const end = lineEnd === -1 ? source.length : lineEnd;
      const line = source.slice(i, end);
      const directive = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
      if (directive) {
        delimiter = directive[1];
        i = lineEnd === -1 ? source.length : lineEnd + 1;
        lineStart = true;
        continue;
      }
    }

    if (lineComment) {
      if (char === '\n') {
        lineComment = false;
        buffer += '\n';
        lineStart = true;
      }
      i++;
      continue;
    }

    if (blockComment) {
      if (char === '*' && next === '/') {
        if (executableComment) buffer += '*/';
        blockComment = false;
        executableComment = false;
        i += 2;
        continue;
      }
      if (executableComment) buffer += char;
      else if (char === '\n') {
        buffer += '\n';
        lineStart = true;
      }
      i++;
      continue;
    }

    if (quote) {
      buffer += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\' && quote !== '`') {
        escaped = true;
      } else if (char === quote) {
        if (next === quote) {
          buffer += next;
          i += 2;
          lineStart = false;
          continue;
        }
        quote = null;
      }
      lineStart = char === '\n';
      i++;
      continue;
    }

    if (char === '/' && next === '*') {
      executableComment = source[i + 2] === '!';
      blockComment = true;
      buffer += executableComment ? '/*!' : ' ';
      i += executableComment ? 3 : 2;
      continue;
    }
    if (char === '#' || (char === '-' && next === '-' && (!source[i + 2] || /\s/.test(source[i + 2])))) {
      lineComment = true;
      i += char === '#' ? 1 : 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      buffer += char;
      lineStart = false;
      i++;
      continue;
    }
    if (delimiter && source.startsWith(delimiter, i)) {
      pushStatement();
      i += delimiter.length;
      lineStart = false;
      continue;
    }

    buffer += char;
    lineStart = char === '\n';
    i++;
  }

  if (quote) throw new SyntaxError('Unterminated quoted value in MySQL script.');
  if (blockComment) throw new SyntaxError('Unterminated block comment in MySQL script.');
  pushStatement();
  return statements;
}
