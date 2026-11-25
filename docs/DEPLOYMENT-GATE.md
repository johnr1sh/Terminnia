# Terminnia production deployment gate

## Automated checks

The GitHub Actions workflow `.github/workflows/quality.yml` runs on every push to `main`. Its required job is:

- **Terminnia quality checks / browser-smoke**
- **Terminnia quality checks / mysql-lab-integration**
- **Terminnia quality checks / mysql-runner-integration**

The job installs the exact versions in `package-lock.json`, runs the database adapter unit tests, enforces `npm audit --audit-level=moderate`, builds the Vite production bundle, and runs the Playwright browser suite against the built output.

Keep the job name stable. If it changes, update the required check selected in Vercel.

## One-time Vercel setting

Vercel's Deployment Checks configuration is managed in the project dashboard, not through the available project-settings API.

1. Open the `terminnia.site` project in Vercel.
2. Go to **Settings → Build and Deployment → Deployment Checks**.
3. Add all three GitHub Actions checks listed above.
4. Mark all three **Required** for the **Production** environment.
5. Keep automatic production domain assignment enabled so Vercel promotes the deployment after the required check passes.

Vercel may still build the commit while GitHub Actions runs. The required check holds production promotion; a failed or pending check must not be bypassed.

## Deployment behavior

- Git pushes continue to trigger automatic Vercel builds.
- Preview builds can be inspected without promoting them to production.
- Production domains should only receive a deployment after all required GitHub Actions checks pass.
- Keep `VITE_MYSQL_LAB_ENABLED` unset or `false` while no dedicated production runner is deployed and verified. A frontend URL is not a MySQL runner URL.
- Set `VITE_MYSQL_LAB_ENABLED=true` only after the runner has a separate HTTPS endpoint, its `/health` endpoint is reachable, and real SQL execution plus the security/coursework acceptance suites pass.
- Do not replace this with an Ignored Build Step that cancels failing deployments; canceled builds still consume deployment quota.
