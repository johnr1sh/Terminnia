import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { splitMysqlScript } from '../database/mysql-script.mjs';

const PORT = Number(process.env.PORT || 8787);
const MYSQL_IMAGE = process.env.MYSQL_IMAGE || 'mysql:8.4';
const IDLE_TTL_MS = 20 * 60 * 1000;
const MAX_LIFETIME_MS = 2 * 60 * 60 * 1000;
const MAX_SQL_BYTES = 64 * 1024;
const MAX_BODY_BYTES = 72 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_ROWS = 5000;
const MAX_ACTIVE_SESSIONS = 8;
const STARTUP_TIMEOUT_MS = 45_000;
const QUERY_TIMEOUT_MS = 8_000;
const sessions = new Map();
const rateBuckets = new Map();
const allowedOrigins = new Set((process.env.RUNNER_ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean));
let shuttingDown = false;
let provisioning = 0;

function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function equalHex(a, b) {
  const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}
function send(res, status, body, origin) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {})
  });
  res.end(JSON.stringify(body));
}
function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [], oversized = false;
    req.on('data', chunk => {
      if (oversized) return;
      size += chunk.length;
      if (size > limit) { oversized = true; chunks = []; return; }
      chunks.push(chunk);
    });
    req.on('end', () => oversized
      ? reject(Object.assign(new Error('Request body is too large.'), { status: 413 }))
      : resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function clientKey(req) {
  // Trust a reverse-proxy IP only when the deployment explicitly enables it.
  return process.env.TRUST_PROXY === '1'
    ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()
    : String(req.socket.remoteAddress || 'unknown');
}
function rateLimit(key, limit, windowMs) {
  const now = Date.now(), bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}
function docker(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.DOCKER_BIN || 'docker', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), settled = false;
    const max = options.maxOutput || MAX_OUTPUT_BYTES;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(Object.assign(new Error('Docker operation timed out.'), { code: 'ETIMEDOUT' })); }, options.timeout || 20_000);
    child.stdout.on('data', chunk => {
      stdout = Buffer.concat([stdout, chunk]);
      if (stdout.length + stderr.length > max) { child.kill('SIGKILL'); finish(Object.assign(new Error('Docker output limit exceeded.'), { code: 'OUTPUT_LIMIT' })); }
    });
    child.stderr.on('data', chunk => {
      stderr = Buffer.concat([stderr, chunk]);
      if (stdout.length + stderr.length > max) { child.kill('SIGKILL'); finish(Object.assign(new Error('Docker output limit exceeded.'), { code: 'OUTPUT_LIMIT' })); }
    });
    child.on('error', error => finish(error));
    child.on('close', code => code === 0
      ? finish(null, stdout.toString('utf8').trim())
      : finish(Object.assign(new Error(stderr.toString('utf8').trim() || 'Docker command failed.'), { code: 'DOCKER_FAILED' })));
    if (options.input) child.stdin.end(options.input); else child.stdin.end();
  });
}
async function removeContainer(containerId) {
  if (!containerId) return;
  try { await docker(['rm', '-f', containerId], { timeout: 15_000, maxOutput: 32_000 }); } catch { /* idempotent cleanup */ }
}
async function createContainer(session) {
  const args = [
    'run', '-d', '--name', session.containerName,
    '--label', 'app=terminnia-mysql-runner',
    '--label', 'terminnia.session=' + session.id,
    '--network', 'none',
    '--memory', '512m', '--memory-swap', '512m', '--cpus', '1',
    '--pids-limit', '128', '--ulimit', 'nofile=4096:4096', '--read-only',
    '--log-driver', 'json-file', '--log-opt', 'max-size=5m', '--log-opt', 'max-file=1',
    '--tmpfs', '/var/lib/mysql:rw,nosuid,nodev,size=256m',
    '--tmpfs', '/var/run/mysqld:rw,nosuid,nodev,size=16m',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=32m',
    '--cap-drop', 'ALL',
    '--cap-add', 'CHOWN', '--cap-add', 'DAC_OVERRIDE', '--cap-add', 'FOWNER',
    '--cap-add', 'SETGID', '--cap-add', 'SETUID', '--cap-add', 'NET_BIND_SERVICE',
    '--security-opt', 'no-new-privileges',
    '--env', 'MYSQL_ROOT_PASSWORD=' + session.dbPassword,
    '--env', 'MYSQL_ROOT_HOST=localhost',
    MYSQL_IMAGE
  ];
  const id = await docker(args, { timeout: 30_000, maxOutput: 32_000 });
  session.containerId = id;
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await docker(['exec', '-e', 'MYSQL_PWD=' + session.dbPassword, id, 'mysqladmin', '--protocol=socket', '-uroot', 'ping', '--silent'], { timeout: 4_000, maxOutput: 8_000 });
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 900));
    }
  }
  throw new Error('The isolated MySQL server did not become ready in time.');
}
function decodeCell(value) {
  if (value === '\\N') return null;
  return value.replace(/\\\\/g, '\\').replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\r/g, '\r');
}
function parseMysqlOutput(output) {
  if (!output.trim()) return [];
  const blocks = output.trim().split(/\n\s*\n/);
  const results = [];
  let totalRows = 0;
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    if (!lines.length) continue;
    const columns = lines[0].split('\t').map(decodeCell);
    const values = [];
    for (const line of lines.slice(1)) {
      if (totalRows >= MAX_ROWS) break;
      values.push(line.split('\t').map(decodeCell));
      totalRows++;
    }
    if (columns.length) results.push({ columns, values, rowCount: values.length, truncated: totalRows >= MAX_ROWS });
    if (totalRows >= MAX_ROWS) break;
  }
  return results;
}
async function executeSql(session, sql, credentials = {}) {
  if (typeof sql !== 'string' || !sql.trim()) throw Object.assign(new Error('SQL must be a non-empty string.'), { status: 400 });
  if (Buffer.byteLength(sql, 'utf8') > MAX_SQL_BYTES) throw Object.assign(new Error('SQL script exceeds the 64 KB limit.'), { status: 413 });
  const statements = splitMysqlScript(sql);
  if (!statements.length) return { results: [], statementCount: 0 };
  // DELIMITER is a mysql-client directive. Re-frame complete statements with
  // a random delimiter so procedure/function bodies remain intact.
  const delimiter = '__TERM_' + randomBytes(8).toString('hex') + '__';
  const script = 'DELIMITER ' + delimiter + '\n' + statements.map(s => s + delimiter).join('\n') + '\nDELIMITER ;\n';
  const username = credentials.username || 'root';
  const password = credentials.username ? credentials.password : session.dbPassword;
  const output = await docker([
    'exec', '-i', '-e', 'MYSQL_PWD=' + password, session.containerId,
    'mysql', '--protocol=socket', '--user=' + username, ...(session.currentDatabase ? ['--database=' + session.currentDatabase] : []), '--batch', '--column-names',
    '--default-character-set=utf8mb4', '--skip-line-numbers'
  ], { input: script, timeout: QUERY_TIMEOUT_MS, maxOutput: MAX_OUTPUT_BYTES });
  session.lastUsedAt = Date.now();
  for (const statement of statements) {
    const use = statement.match(/^\\s*USE\\s+(?:`((?:``|[^`])+)`|([A-Za-z0-9_$]+))\\s*$/i);
    const drop = statement.match(/^\\s*DROP\\s+DATABASE(?:\\s+IF\\s+EXISTS)?\\s+(?:`((?:``|[^`])+)`|([A-Za-z0-9_$]+))/i);
    if (use) session.currentDatabase = (use[1] || use[2]).replace(/``/g, '`');
    if (drop && (drop[1] || drop[2]) === session.currentDatabase) session.currentDatabase = null;
  }
  return { results: parseMysqlOutput(output), statementCount: statements.length };
}
function findSession(req, id) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer ([A-Za-z0-9_-]{40,})$/);
  if (!match) return null;
  const session = sessions.get(id);
  if (!session || !equalHex(session.tokenHash, sha(match[1]))) return null;
  if (Date.now() - session.createdAt > MAX_LIFETIME_MS || Date.now() - session.lastUsedAt > IDLE_TTL_MS) return null;
  session.lastUsedAt = Date.now();
  return session;
}
async function destroySession(session) {
  sessions.delete(session.id);
  await removeContainer(session.containerId);
}
async function createSession() {
  provisioning++;
  try {
  const id = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const session = {
    id, tokenHash: sha(token), dbPassword: randomBytes(32).toString('base64url'),
    containerName: 'terminnia-mysql-' + id, containerId: null,
    createdAt: Date.now(), lastUsedAt: Date.now(), currentDatabase: null
  };
  try { await createContainer(session); }
  catch (error) { await removeContainer(session.containerId); throw error; }
  sessions.set(id, session);
  return { id, token, expiresInSeconds: Math.floor(IDLE_TTL_MS / 1000), maxLifetimeSeconds: Math.floor(MAX_LIFETIME_MS / 1000), engine: 'MySQL 8.4' };
  } finally { provisioning--; }
}
function jsonRoute(path) {
  const match = path.match(/^\/api\/sandboxes\/([0-9a-f-]{36})(?:\/(execute|schema|reset))?$/i);
  return match ? { id: match[1], action: match[2] || 'session' } : null;
}
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin) {
    if (!allowedOrigins.has(origin)) return send(res, 403, { error: 'Origin is not allowed.' });
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS', 'access-control-allow-headers': 'authorization,content-type', 'access-control-max-age': '600', vary: 'Origin' });
      return res.end();
    }
  }
  if (shuttingDown) return send(res, 503, { error: 'Runner is shutting down.' }, origin);
  const url = new URL(req.url, 'http://runner.local');
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, service: 'terminnia-mysql-runner' }, origin);
  if (req.method === 'POST' && url.pathname === '/api/sandboxes') {
    if (sessions.size + provisioning >= MAX_ACTIVE_SESSIONS) return send(res, 503, { error: 'All MySQL learning sandboxes are currently busy. Try again shortly.' }, origin);
    if (!rateLimit('create:' + clientKey(req), 3, 10 * 60_000)) return send(res, 429, { error: 'Too many sandbox requests. Try again later.' }, origin);
    try { return send(res, 201, await createSession(), origin); }
    catch (error) { return send(res, 503, { error: 'A MySQL sandbox could not be started.', detail: process.env.NODE_ENV === 'development' ? error.message : undefined }, origin); }
  }
  const route = jsonRoute(url.pathname);
  if (!route) return send(res, 404, { error: 'Not found.' }, origin);
  const session = findSession(req, route.id);
  if (!session) return send(res, 401, { error: 'Sandbox session is invalid or expired.' }, origin);
  try {
    if (route.action === 'execute' && req.method === 'POST') {
      if (!rateLimit('execute:' + session.id, 30, 60_000)) return send(res, 429, { error: 'Query rate limit reached. Wait a moment before running more SQL.' }, origin);
      const raw = await readBody(req);
      let body;
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'Request must contain valid JSON.' }, origin); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'Request body must be a JSON object.' }, origin);
      const hasCredentials = Object.hasOwn(body, 'username') || Object.hasOwn(body, 'password');
      if (hasCredentials && (typeof body.username !== 'string' || !/^[A-Za-z0-9_.$-]{1,80}$/.test(body.username) || typeof body.password !== 'string' || Buffer.byteLength(body.password, 'utf8') > 256)) {
        return send(res, 400, { error: 'Provide a valid MySQL username and a password no longer than 256 bytes.' }, origin);
      }
      const result = await executeSql(session, body.sql, hasCredentials ? { username: body.username, password: body.password } : {});
      return send(res, 200, result, origin);
    }
    if (route.action === 'schema' && req.method === 'GET') {
      if (!session.currentDatabase) return send(res, 200, { objects: [] }, origin);
      const result = await executeSql(session, 'SHOW FULL TABLES');
      return send(res, 200, { objects: result.results[0]?.values || [] }, origin);
    }
    if (route.action === 'reset' && req.method === 'POST') {
      await removeContainer(session.containerId);
      session.containerId = null;
      session.currentDatabase = null;
      try { await createContainer(session); }
      catch (error) { await destroySession(session); throw error; }
      session.lastUsedAt = Date.now();
      return send(res, 200, { ok: true, engine: 'MySQL 8.4' }, origin);
    }
    if (route.action === 'session' && req.method === 'DELETE') {
      await destroySession(session);
      return send(res, 200, { ok: true }, origin);
    }
    return send(res, 405, { error: 'Method not allowed.' }, origin);
  } catch (error) {
    // Killing the mysql client alone does not guarantee the server-side query
    // stopped. Destroy the disposable container on timeout/output overflow.
    if (error.code === 'ETIMEDOUT' || error.code === 'OUTPUT_LIMIT') await destroySession(session);
    const status = error.status || (error.code === 'ETIMEDOUT' ? 408 : 422);
    return send(res, status, { error: status === 408 ? 'SQL execution timed out.' : 'SQL execution failed.', detail: process.env.NODE_ENV === 'development' ? error.message : undefined }, origin);
  }
});
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const session of sessions.values()) {
    if (now - session.lastUsedAt > IDLE_TTL_MS || now - session.createdAt > MAX_LIFETIME_MS) void destroySession(session);
  }
  for (const [key, bucket] of rateBuckets) if (bucket.resetAt < now) rateBuckets.delete(key);
}, 30_000);
sweeper.unref();

async function reapOrphanedContainers() {
  const ids = await docker(['ps', '-aq', '-a', '--filter', 'label=app=terminnia-mysql-runner'], { timeout: 15_000, maxOutput: 64_000 });
  if (ids) await docker(['rm', '-f', ...ids.split(/\s+/).filter(Boolean)], { timeout: 30_000, maxOutput: 64_000 });
}
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(sweeper);
  server.close();
  await Promise.all([...sessions.values()].map(destroySession));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  reapOrphanedContainers().then(() => {
    server.listen(PORT, '0.0.0.0', () => process.stdout.write('Terminnia MySQL runner listening on ' + PORT + '\n'));
  }).catch(error => {
    process.stderr.write('Runner startup blocked: Docker cleanup failed: ' + error.message + '\n');
    process.exitCode = 1;
  });
}
export { server, parseMysqlOutput, rateLimit };
