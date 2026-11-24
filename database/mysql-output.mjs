export function decodeXml(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code) => {
    const key = code.toLowerCase();
    if (key === "amp") return "&";
    if (key === "lt") return "<";
    if (key === "gt") return ">";
    if (key === "quot") return '"';
    if (key === "apos") return "'";
    const point = key.startsWith("#x") ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10);
    try { return Number.isFinite(point) ? String.fromCodePoint(point) : entity; } catch { return "\uFFFD"; }
  });
}

function readField(attributes, body) {
  const name = attributes.match(/\bname="([^"]*)"/i)?.[1];
  if (name === undefined) return null;
  const nil = /\bxsi:nil="true"/i.test(attributes);
  return { name: decodeXml(name), value: nil ? null : decodeXml(body.replace(/<[^>]*>/g, "")) };
}

export function parseMysqlXml(output, maxRows = 5000) {
  if (typeof output !== "string" || !output.trim()) return [];
  const results = [];
  let totalRows = 0;
  const resultsetPattern = /<resultset\b[^>]*>([\s\S]*?)<\/resultset>/gi;
  for (const resultset of output.matchAll(resultsetPattern)) {
    const values = [];
    let columns = [];
    const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>/gi;
    for (const row of resultset[1].matchAll(rowPattern)) {
      const fields = [];
      const fieldPattern = /<field\b([^>]*?)(?:\s*\/\s*>|>([\s\S]*?)<\/field>)/gi;
      for (const field of row[1].matchAll(fieldPattern)) {
        const parsed = readField(field[1], field[2] || "");
        if (parsed) fields.push(parsed);
      }
      if (!fields.length) continue;
      if (!columns.length) columns = fields.map(field => field.name);
      if (totalRows < maxRows) {
        values.push(fields.map(field => field.value));
        totalRows++;
      }
    }
    results.push({ columns, values, rowCount: values.length, truncated: totalRows >= maxRows });
    if (totalRows >= maxRows) break;
  }
  return results;
}
