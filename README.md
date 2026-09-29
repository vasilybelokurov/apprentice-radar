# Apprentice Radar

Search currently open apprenticeship vacancies in England near a location, and get email alerts
for new matches. Data comes from the official DfE Display Advert API v2.

Runs entirely on GitHub: Actions sync vacancies daily and send alerts weekly; the search page is
served by GitHub Pages. The original project brief is in [docs/](docs/).

## Local setup

```bash
source .venv/bin/activate   # project-local Node 24 + npm
npm ci
```

Check the DfE API key (stored in the macOS Keychain, never in files):

```bash
DFE_API_KEY="$(security find-generic-password -s apprentice-radar-dfe-key -w)" \
  node scripts/verify-dfe-api.ts
```
