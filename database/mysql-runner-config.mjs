export function resolveMysqlRunnerUrl({ enabled, configuredUrl, frontendOrigin }) {
  if (enabled !== true || typeof configuredUrl !== 'string' || !configuredUrl.trim()) return '';
  try {
    const frontend = new URL(frontendOrigin);
    const runner = new URL(configuredUrl.trim(), frontend);
    const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(runner.hostname);
    if (runner.origin === frontend.origin) return '';
    if (runner.protocol !== 'https:' && !(runner.protocol === 'http:' && localHost)) return '';
    return runner.href.replace(/\/+$/, '');
  } catch {
    return '';
  }
}
