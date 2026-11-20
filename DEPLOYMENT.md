# Meridian Pages preview: deployment and approval boundary

## Authorized

Publish the new independent public repository `SUaDtL/Meridian` to **its own** GitHub Pages URL. Test and review it there. The existing `SUaDtL/SIM` repository is only an architectural reference.

## Not authorized

- No `CNAME`, custom-domain mapping, DNS modifications or changes to `arbiterforge.com`
- No PR or code change in `arbiterForge/arbiterforge-site`
- No changes to `SUaDtL/SIM` or integration into `/news/` or `/SIM/`
- No link or navigation integration with the existing site

## Deployment procedure

1. Open a feature PR in `SUaDtL/Meridian`. The PR runs build/checksum/static integrity validation but **does not publish**.
2. Review and merge after checks pass. A push to `main` runs the same validation, then attempts an independent Pages deployment.
3. Set **Settings → Pages → Build and deployment → Source → GitHub Actions** in this repository when needed. Pages may require this one-time repository configuration; if the first deploy fails before enabling Pages, rerun the workflow afterward.
4. Open the URL reported by the deploy job, normally `https://suadtl.github.io/Meridian/`. Confirm it over HTTPS and check that Mermaid editor, sample gallery, theme controls, presentation mode, local save/load, and all exports function.
5. Check mobile UI, reduced-motion behavior, refresh persistence, and that the repo has no custom domain.

Only a later separate, explicitly approved PR may expose Meridian through `arbiterforge.com`.

## Rollback

Revert the `main` commit or disable this repository's Pages deployment. There is no shared site or DNS migration to roll back.
