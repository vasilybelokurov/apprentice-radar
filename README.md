# Apprentice Radar

Search currently open apprenticeship vacancies in England near a location.
Live site: **https://vasilybelokurov.github.io/apprentice-radar/**

Data comes from the official DfE Display Advert API v2. Coverage is England only.

## How it works

- A GitHub Action (`.github/workflows/deploy.yml`) runs daily, on every push to `main`, and on demand. It fetches every
  live vacancy, checks the data and writes `data/vacancies.json`. It then runs the tests, builds the page and publishes
  both to GitHub Pages. If the sync is incomplete or a check fails, nothing is published and the previous site stays up.
- The page is static. Filtering, distance and sorting run in the browser (`src/lib/search.ts`), and the search is
  kept in the URL so it can be bookmarked.
- The "Open with GCSEs" filter keeps vacancies whose essential entry requirements are no more than GCSEs or
  Functional Skills, and leaves out degree apprenticeships (`src/lib/requirements.ts`).
- `jobs.html` lists ordinary jobs (not apprenticeships) within 5 miles of Cambridge from the
  [Reed Jobseeker API](https://www.reed.co.uk/developers/jobseeker), judged for an 18-year-old with GCSEs but no
  A levels (`src/lib/jobs-fit.ts`). Reed has no structured requirements, so the rule reads the advert wording;
  every left-out job is listed with the sentence that decided it. `scripts/sync-jobs.ts` fetches full adverts only
  for jobs not already in the published `jobs.json`, and keeps the last published file if Reed fails.
- Place names and postcodes are resolved with [Postcodes.io](https://postcodes.io/).
- API keys are only ever GitHub Actions secrets (`DFE_API_KEY`, `REED_API_KEY`) or, locally, in the macOS Keychain
  (`apprentice-radar-dfe-key`, `apprentice-radar-reed-key`).

## Keeping the schedules running

GitHub switches off scheduled workflows in a public repository after 60 days without commits, and sends a warning
email beforehand. No automatic keepalive is used. When the warning arrives, either push any real change or re-enable
each workflow: **Actions → Sync and deploy / Send alerts → Enable workflow**. While the schedules are off, the site
stays up and shows a "may be out of date" notice once the data is more than 48 hours old.

## Local setup

```bash
source .venv/bin/activate   # project-local Node 24 + npm
npm ci
npm run check               # type check + tests
npm run sync:local          # live apprenticeship sync; reads the key from the Keychain
npm run sync:jobs:local     # live jobs sync (Reed); reads the key from the Keychain
npm run dev                 # http://localhost:5173
```

The original project brief is in [docs/](docs/).
