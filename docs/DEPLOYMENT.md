# Deployment guide

The authoritative build, verification, publishing, and rollback procedure is in [the repository deployment guide](../DEPLOYMENT.md).

Meridian is a standalone static application in **SUaDtL/Meridian**. Its Pages deployment is separate from `arbiterforge.com`, `arbiterForge/arbiterforge-site`, and `SUaDtL/SIM`. Integration with those surfaces requires separate approval.

## Portable application

`npm run build:standalone` generates `standalone/Meridian.html`. It embeds the application, styles, all diagram renderers, favicon, and dependency notices. The exact script is authorized by its SHA-256 Content Security Policy; runtime network connections are disabled.

Modern browsers can open this file locally. Browser storage and clipboard permissions for local files vary, so use `.meridian.json` project exports as portable backups. The production HTTP build remains the primary tested path.

The application HTML is different from a diagram's smaller HTML presentation export. The former includes the editor; the latter includes the finished diagram and playback controls.

## Isolated companion interface

`npm run build:companion` emits the optional file exchange interface in `companion/dist`. Its same-origin API starts at `/v1/session` and its designated sign-in route is `/auth/login`. The interface reads the request in browser memory, presents the exact share scope and charge ceiling, and sends the file only after consent. An interrupted generation has an explicit status check. It never restarts automatically.

`npm run build:companion-fixture` builds the local test adapter. The browser test serves the built interface at a reserved HTTPS origin through Playwright and exercises it against the reference API, SQLite and an in-process model fixture. Run `npm run test:browser -- tests/browser/companion-ui.spec.ts` after building both. The companion artifact stays outside the Pages and portable application artifacts.

A hosted companion needs an approved dedicated HTTPS origin and identity, provider, ledger, retention and operator configuration. Its server supplies the authentication routes and the `frame-ancestors 'none'` and `Cache-Control: no-store` headers. The local browser fixture uses an injected verified session for protocol testing.

## Dependency attribution

Both build commands run `scripts/third-party-notices.mjs`. It reads the committed lockfile and matching installed package metadata, reproduces available dependency license/notice files, and explicitly identifies optional platform packages that are not installed. It makes no network requests. The standalone application embeds the generated notices as escaped text.
