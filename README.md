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
- Searches default to Cambridge within five miles, with no qualification-level restriction and "Open with GCSEs" enabled.
  Weekly alerts use the same criteria. Apprenticeship level describes the qualification earned, not the entry requirements.
- The "Open with GCSEs" filter keeps vacancies whose essential entry requirements are no more than GCSEs or
  Functional Skills, and leaves out degree apprenticeships (`src/lib/requirements.ts`).
- `jobs.html` combines ordinary jobs within 5 miles of Cambridge from
  [Reed](https://www.reed.co.uk/developers/jobseeker) and five direct employer sources: Greene King,
  Accor hotels, McMullen pubs, Caffè Nero and Downing College. The existing advert-wording rules screen jobs
  for an 18-year-old with GCSEs but no A levels (`src/lib/jobs-fit.ts`). Excluded jobs show the reason and evidence.
  Permanent, temporary, part-time and casual work are included by default.
- `scripts/sync-jobs.ts` maintains Reed's `jobs.json`, reusing previously read adverts when the suitability rules
  have not changed. `scripts/sync-hospitality.ts` independently refreshes the employer adverts into
  `hospitality.json`, without API keys. Each card credits its source and links to its original advert.
- Place names and postcodes are resolved with [Postcodes.io](https://postcodes.io/).
- API keys are only ever GitHub Actions secrets (`DFE_API_KEY`, `REED_API_KEY`) or, locally, in the macOS Keychain
  (`apprentice-radar-dfe-key`, `apprentice-radar-reed-key`).

## Direct employer sources

| Source | Integration | Coverage |
|---|---|---|
| Greene King | Public SmartRecruiters Posting API | Cambridge pub roles, measured against the five-mile radius |
| Accor hotels | Public SmartRecruiters Posting API | Cambridge hotel roles, measured against the five-mile radius |
| McMullen pubs | Structured data in active careers search and advert pages | Five-mile search, including seasonal work |
| Caffè Nero | Public careers search and JobPosting JSON-LD | Five-mile search, including baristas |
| Downing College | Public Vacancy Filler feed embedded in its staff-vacancies page | Current college staff vacancies, including casual work |

The employer sync reads full adverts on each run. It checks list completeness, dates and coordinates before
publishing. A failed source keeps only its own previous data, with its original last-success date and a visible
warning; after seven days without a successful check, its cached adverts are removed. A successful empty search
removes withdrawn adverts immediately. Failure of one source does not block the others or the apprenticeship page.

The browser merges the files and removes duplicate IDs or original advert URLs. Different source URLs may still
describe the same vacancy; we do not merge roles merely because their titles and employers match. Category labels
use titles and, for ambiguous hospitality team-member roles, the employer's sector. Pay ceilings remain ceilings.
This is coverage of the named sources, not a complete census of local jobs. Employer pages can change; check each
source's status under **Job sources and updates** on the jobs page.

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
npm run sync:hospitality    # direct employer feeds; no keys needed
npm run dev                 # http://localhost:5173
```

The original project brief is in [docs/](docs/).
