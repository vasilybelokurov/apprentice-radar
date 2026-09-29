# UK Apprenticeship Finder and Alert App
## Detailed project setup and implementation brief for Claude CLI

**Status:** Project specification / build brief  
**Prepared:** 2026-09-29  
**Primary MVP coverage:** England, using the official Department for Education (DfE) Display Advert API v2  
**Target:** Responsive browser application that works well on phones and desktop, with optional PWA installation  
**Default search:** Cambridge, apprenticeship Level 2  
**Automation:** GitHub Actions synchronises vacancies regularly and sends configurable email alerts for new matching vacancies

---

# 1. Executive summary

Build a responsive web application that lets a user search currently open apprenticeship vacancies near a location and filter them by apprenticeship level, pay, field/category, keywords, employer, and other useful criteria.

The primary user journey is:

1. Open the site on a phone or desktop browser.
2. See a default search for **Cambridge** and **Level 2** apprenticeships.
3. Change location, radius, level, category, pay, or other filters.
4. See every currently open vacancy that matches the criteria, paginated in the UI without imposing an artificial result cap.
5. Open the official apprenticeship vacancy/application page for any result.
6. Separately, receive an email digest when newly discovered vacancies match a saved search.

The recommended architecture is deliberately split into three layers:

- **Ingestion:** a scheduled GitHub Actions job calls the official apprenticeship vacancy API and stores a local copy of current vacancies.
- **Web app:** a Next.js/TypeScript app queries the application's own database rather than exposing the DfE API key or calling DfE directly from the browser.
- **Alerts:** another scheduled GitHub Actions job evaluates saved-search criteria against the stored vacancies and sends only vacancies that have not previously been emailed for that saved search.

This is consistent with the current Display Advert API v2 schema, which states that direct browser use is not recommended and that clients should retrieve vacancies intermittently, store them, and serve their own sites from that datastore.

The MVP should be built for **England first**. The GOV.UK Find an apprenticeship service is the official service for apprenticeships in England. Scotland, Wales, and Northern Ireland have separate vacancy services. The codebase should therefore use a source-adapter abstraction so additional nations can be added later if a documented API/feed or permission to consume the data is available. Do not build fragile scrapers for the devolved services as part of the MVP.

---

# 2. Product goals

## 2.1 Required capabilities

The application must:

- work in a modern mobile browser and desktop browser;
- have a responsive mobile-first UI;
- default the location to **Cambridge**;
- default apprenticeship level to **Level 2**;
- let the user choose a search radius;
- let the user change apprenticeship level;
- let the user filter by field/category;
- let the user filter/search by text;
- let the user filter by pay while handling non-numeric pay safely;
- show only vacancies that are currently open;
- list all matching vacancies through pagination/infinite loading;
- show the official application/vacancy URL;
- support vacancies with multiple work locations;
- run a GitHub-hosted scheduled process to refresh vacancy data;
- run a configurable scheduled process that detects new matches;
- send an email alert/digest for newly matched vacancies;
- avoid duplicate alert emails for the same vacancy and saved search;
- keep the DfE API key and mail credentials out of browser code and source control.

## 2.2 Strongly recommended capabilities

Also include:

- sort by distance;
- sort by newest;
- sort by closing date;
- optional sort by explicit numeric wage;
- employer filter/search;
- Disability Confident filter;
- include/exclude nationally recruiting vacancies;
- closing-soon badge;
- "new" badge based on `postedDate`;
- result count;
- nearest matching location on each vacancy card;
- indication when a vacancy has multiple locations;
- filter state encoded in the URL so a search can be bookmarked/shared;
- manual GitHub workflow triggers for sync and alert testing;
- health/status information for the most recent successful data sync;
- installable PWA metadata, but no misleading offline vacancy data.

## 2.3 Explicit non-goals for the first release

Do **not** include these in the MVP unless requested later:

- submitting applications from this app;
- storing CVs or application forms;
- accounts for many users;
- social login;
- AI-generated application answers;
- scraping arbitrary employer career sites;
- scraping Scotland/Wales/Northern Ireland vacancy sites without a documented permitted integration;
- a map UI;
- push notifications;
- SMS alerts;
- complex recommendation/ranking algorithms;
- automated claims about applicant eligibility.

The app is a vacancy discovery and alert tool. Applications should continue on the official vacancy/application URL.

---

# 3. Scope clarification: "UK" versus England

The initial request is for UK apprenticeships, but the official public services are split by nation.

As of 2026-09-29:

| Nation | Public vacancy service | MVP integration |
|---|---|---|
| England | GOV.UK Find an apprenticeship / DfE Display Advert API | **Yes - primary source** |
| Scotland | Apprenticeships.scot | Adapter placeholder only |
| Wales | GOV.WALES / Careers Wales apprenticeship search | Adapter placeholder only |
| Northern Ireland | nidirect / JobApplyNI | Adapter placeholder only |

For the MVP, label coverage clearly in the UI:

> "Currently searching official apprenticeship vacancies for England."

Do not label England-only data as complete UK coverage.

Create a source interface from day one, for example:

```ts
export interface VacancySource {
  sourceId: string;
  sync(): Promise<SyncSummary>;
}
```

Start with:

```ts
DfEEnglandVacancySource
```

Later additions can be:

```ts
ScotlandVacancySource
WalesVacancySource
NorthernIrelandVacancySource
```

but only after verifying an appropriate API/feed/permission and its terms.

---

# 4. Verified primary data source: DfE Display Advert API v2

## 4.1 Base API

Use:

```text
https://api.apprenticeships.education.gov.uk/vacancies
```

Main vacancy endpoints:

```text
GET /vacancy
GET /vacancy/{vacancyReference}
GET /referencedata/courses
GET /referencedata/courses/routes
```

Required request headers:

```http
X-Version: 2
Ocp-Apim-Subscription-Key: <secret>
```

The API key must never appear in client-side JavaScript, a `NEXT_PUBLIC_*` environment variable, committed `.env` files, logs, screenshots, or test fixtures.

## 4.2 API key

The DfE developer hub says an independent developer can create an account and obtain a Display Advert API key.

Registration:

```text
https://developer.apprenticeships.education.gov.uk/third-party-accounts/register
```

Developer hub:

```text
https://developer.apprenticeships.education.gov.uk/
```

Store the key in:

- GitHub Actions secret: `DFE_DISPLAY_ADVERT_API_KEY`
- local `.env.local` only when needed for development
- optionally deployment environment secrets if any server-side on-demand DfE calls are later added

Do not expose it to the browser.

## 4.3 Rate limiting

The current DfE developer documentation states a rate limit of:

```text
150 requests per 5-minute period
```

The sync process must therefore:

- use the largest sensible page size supported by the API;
- paginate sequentially or with low concurrency;
- handle HTTP 429;
- implement retry with bounded exponential backoff and jitter;
- never hammer the endpoint after repeated failures.

## 4.4 Relevant v2 query parameters

The current v2 schema includes these useful list-query parameters:

- `PageNumber`
- `PageSize`
- `IncludeDetails`
- `Lat`
- `Lon`
- `DistanceInMiles`
- `Sort`
- `PostedInLastNumberOfDays`
- `Routes`
- `StandardLarsCode`
- `EmployerName`
- `ExcludeRecruitingNationally`
- `FilterBySubscription`

For the proposed architecture, ingest the complete public live vacancy set instead of calling the source separately for every end-user search.

Use approximately:

```text
GET /vacancy?PageNumber=1&PageSize=100&IncludeDetails=true&Sort=AgeDesc
```

and iterate `PageNumber` until all pages have been processed.

The current v2 schema says `IncludeDetails=true` can return full text details when page size is `<= 100`.

Do not assume that today's number of pages will remain stable. Always follow the response metadata:

- `total`
- `totalFiltered`
- `totalPages`

## 4.5 Fields available from the source

Important fields include:

- `vacancyReference`
- `title`
- `description`
- `numberOfPositions`
- `postedDate`
- `closingDate`
- `startDate`
- wage information
- `hoursPerWeek`
- `expectedDuration`
- one or more `addresses`
- `applicationUrl`
- `distance` when a geospatial source query is used
- `employerName`
- employer website/contact fields
- course:
  - `larsCode`
  - `title`
  - `level`
  - `route`
  - `type`
- `apprenticeshipLevel`
- `providerName`
- `ukprn`
- `isDisabilityConfident`
- `vacancyUrl`
- `isNationalVacancy`
- `isNationalVacancyDetails`
- full detail fields such as:
  - `employerDescription`
  - `trainingDescription`
  - `additionalTrainingDescription`
  - `outcomeDescription`
  - `fullDescription`
  - `skills`
  - `qualifications`
  - `thingsToConsider`
  - `companyBenefitsInformation`

## 4.6 Multiple locations

Display Advert API v2 supports apprenticeships available at more than one location.

The app must not duplicate a vacancy card for each address.

Store:

- one `vacancies` row per `vacancyReference`;
- zero or more `vacancy_locations` rows.

For a radius search:

- a vacancy matches if **at least one** work location is within the radius;
- show the nearest matching address on the card;
- if there are other locations, show text such as "Also available at N other locations";
- nationally recruiting vacancies need separate handling because the API may supply no address.

---

# 5. Apprenticeship levels and defaults

The user-requested default is:

```text
Level 2
```

Current Find an apprenticeship UI describes:

- Level 2 as equivalent to GCSE;
- Level 3 as equivalent to A level;
- Level 4 as equivalent to HNC;
- Level 5 as equivalent to HND;
- Level 6 as degree level;
- Level 7 as master's level.

The application should **not** infer that a person with GCSEs is only eligible for Level 2. Eligibility is vacancy-specific and can depend on qualifications and employer requirements.

Implementation:

```ts
const DEFAULT_LEVELS = [2];
```

Provide controls for Levels 2-7.

Also preserve the DfE course type:

```text
apprenticeship
foundationApprenticeship
```

A Level 2 search should match Level 2 vacancies regardless of whether the course type is a regular apprenticeship or foundation apprenticeship, unless the user applies an additional type filter.

---

# 6. Location resolution

## 6.1 Recommended service

Use **Postcodes.io** for UK postcode/place geocoding.

It is a free/open-source UK postcode geocoder and currently exposes:

```text
GET https://api.postcodes.io/postcodes?q=<query>
GET https://api.postcodes.io/places?q=<query>
```

The Places response includes latitude/longitude for named places in Great Britain.

Use it for explicit search submissions and location suggestions.

Documentation:

```text
https://postcodes.io/docs/overview/
https://postcodes.io/docs/api/places/
```

## 6.2 Default location

Store the default as a human-readable query:

```text
Cambridge, Cambridgeshire
```

At setup/seed time, resolve it through the same location resolver used for normal searches and store the returned coordinates.

Do not silently hard-code an unverified Cambridge coordinate into application logic.

## 6.3 Ambiguous place names

The resolver must support multiple matching places.

Example UI behavior:

1. user enters a town/postcode;
2. if a postcode resolves uniquely, use it;
3. if a place query produces multiple plausible towns, return a short choice list containing place, county/region, and country;
4. user chooses one;
5. preserve both the display label and coordinates in the search URL/state.

## 6.4 Search radius

Make radius a first-class search property:

```ts
radiusMiles: number
```

The original requirement does not define a numeric default radius. Therefore:

- make `DEFAULT_RADIUS_MILES` configurable;
- document the chosen product value in `.env.example`;
- do not bury it as a magic number in UI code.

Example only:

```env
DEFAULT_RADIUS_MILES=20
```

Treat that as a configurable product setting, not a factual requirement.

---

# 7. Pay model and filtering

Pay requires careful handling.

The current v2 schema exposes `wageType` values including:

```text
ApprenticeshipMinimum
NationalMinimum
Custom
CompetitiveSalary
```

It also exposes:

```text
wageAmount
wageUnit
wageAdditionalInformation
workingWeekDescription
```

The schema states that `wageAmount` is available for a custom wage. A listing can therefore be valid while not having a directly comparable numeric annual amount.

## 7.1 Database fields

Store the source values without inventing data:

```text
wage_type
wage_amount
wage_unit
wage_additional_information
working_week_description
```

Optionally also store:

```text
annual_wage_numeric
```

but populate it only where the source provides enough unambiguous information to do so.

Do **not** convert "Competitive" to a guessed number.

Do **not** infer a National Minimum Wage annual salary without explicit product approval and a carefully maintained legal/rate model.

## 7.2 UI behavior

Recommended pay controls:

- Minimum explicit annual pay
- Include listings without an explicit numeric salary: yes/no
- Optional wage type chips:
  - Custom amount
  - Apprenticeship minimum
  - National minimum
  - Competitive

Default:

```text
includeUnknownPay = true
```

If the user sets a numeric minimum, display a short explanation:

> "Vacancies that only state minimum wage or competitive pay may not have a comparable numeric salary."

## 7.3 Sorting by pay

If sorting by pay:

- explicit numeric values can be ordered;
- null/non-numeric entries should appear after numeric entries;
- show the source wording prominently so the user understands why a result was not numerically ranked.

---

# 8. Search and filter model

Define a single typed search object used by:

- browser URL state;
- web API/server actions;
- alert matching;
- tests.

Example:

```ts
export interface SearchCriteria {
  location?: {
    label: string;
    latitude: number;
    longitude: number;
  };
  radiusMiles?: number;
  levels: number[];
  routes: string[];
  courseTypes: Array<"apprenticeship" | "foundationApprenticeship">;
  keywords?: string;
  employer?: string;
  minAnnualPay?: number;
  includeUnknownPay: boolean;
  disabilityConfidentOnly: boolean;
  includeNational: boolean;
  postedWithinDays?: number;
  closingWithinDays?: number;
  sort:
    | "distance"
    | "newest"
    | "closingSoon"
    | "startDate"
    | "payHigh";
  page: number;
  pageSize: number;
}
```

## 8.1 Core filters

Required:

- location;
- radius;
- level;
- category/route;
- pay;
- keyword/text.

Recommended:

- employer;
- course type;
- Disability Confident;
- nationally recruiting vacancies;
- posted recently;
- closes soon.

## 8.2 Categories

Use the DfE route/category values dynamically from:

```text
GET /referencedata/courses/routes
```

Do not hard-code route names as the sole source of truth.

Cache/sync the route reference data.

The Find an apprenticeship site currently presents categories such as Digital, Engineering and manufacturing, Health and science, Business and administration, and others, but the application should derive selectable categories from the current API reference data.

## 8.3 Keyword matching

For the first release, search case-insensitively over:

- vacancy title;
- employer name;
- course title;
- route;
- short description.

Optionally include full description/skills later.

Do not use an opaque relevance model for MVP.

## 8.4 "Currently open" definition

A result is displayable only when:

```text
source_active = true
AND closing_date >= current_time
```

Use timezone-aware timestamps in the database.

The DfE list endpoint should already contain live adverts, but the local database can become stale between syncs, so enforce the closing-date condition independently.

---

# 9. National vacancies

A nationally recruiting vacancy can have no physical address.

Keep them in the datastore, but make their inclusion explicit in a radius search.

Recommended behavior:

- default strict radius results to location-based vacancies;
- provide a toggle: `Include nationally recruiting roles`;
- when enabled, national vacancies appear in a separate clearly labeled group or with a prominent `National` badge;
- do not display a fake distance for a vacancy without a location.

Do not treat a national vacancy as "0 miles away".

---

# 10. Recommended technical stack

Use a conventional TypeScript stack that Claude CLI can work with reliably.

## 10.1 Web app

- Next.js
- TypeScript with strict mode
- React
- App Router
- server-side data access for search
- Tailwind CSS or a small component system built on accessible primitives
- Zod for runtime validation
- URL query parameters as the canonical shareable search state

Do not pin versions in this document. At project bootstrap, install current stable versions and commit the generated lock file.

## 10.2 Package manager

Use:

```text
pnpm
```

Commit:

```text
pnpm-lock.yaml
```

## 10.3 Database

Use PostgreSQL.

Recommended managed options:

- Supabase Postgres
- Neon Postgres
- another standard hosted PostgreSQL provider

Do not couple business logic to a proprietary database feature in the MVP.

For the current dataset size, standard latitude/longitude columns plus a tested Haversine distance query are sufficient. A later scale-up can introduce PostGIS with a spatial index.

## 10.4 ORM / migrations

Use Drizzle ORM with SQL migrations, or an equivalent TypeScript-first PostgreSQL layer.

Whichever library Claude selects:

- migrations must be checked into `db/migrations`;
- SQL schema changes must not be applied manually only;
- production migrations must be repeatable;
- tests must run against a disposable database.

## 10.5 Scheduled execution

Use GitHub Actions.

Separate concerns:

```text
sync-vacancies.yml
send-alerts.yml
ci.yml
```

The sync and alert scripts live in the repository and can also be run manually from the CLI.

## 10.6 Email

Implement an email transport interface rather than coupling search logic to a provider.

MVP options:

1. SMTP using Nodemailer; or
2. a transactional provider API.

A provider-neutral SMTP setup is suitable for a single-user MVP:

```env
SMTP_HOST=
SMTP_PORT=
SMTP_SECURE=
SMTP_USER=
SMTP_PASS=
ALERT_FROM_EMAIL=
ALERT_TO_EMAIL=
```

Never log `SMTP_PASS`.

For a future multi-user product, switch to a transactional mail provider and proper unsubscribe/preferences handling.

---

# 11. Proposed repository layout

```text
apprenticeship-finder/
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── sync-vacancies.yml
│       └── send-alerts.yml
├── db/
│   ├── migrations/
│   └── seeds/
├── docs/
│   ├── data-sources.md
│   └── operations.md
├── public/
│   ├── icons/
│   └── ...
├── scripts/
│   ├── sync-vacancies.ts
│   ├── send-alerts.ts
│   ├── seed-default-search.ts
│   └── verify-dfe-api.ts
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── locations/
│   │   │   └── search/
│   │   ├── apprenticeship/
│   │   │   └── [reference]/
│   │   ├── layout.tsx
│   │   ├── manifest.ts
│   │   └── page.tsx
│   ├── components/
│   │   ├── filters/
│   │   ├── results/
│   │   └── ui/
│   ├── lib/
│   │   ├── alerts/
│   │   │   ├── match.ts
│   │   │   ├── render-email.ts
│   │   │   └── sender.ts
│   │   ├── config/
│   │   ├── db/
│   │   │   ├── client.ts
│   │   │   ├── schema.ts
│   │   │   └── queries.ts
│   │   ├── dfe/
│   │   │   ├── client.ts
│   │   │   ├── normalize.ts
│   │   │   ├── source.ts
│   │   │   └── schemas.ts
│   │   ├── geo/
│   │   │   ├── distance.ts
│   │   │   └── location-resolver.ts
│   │   ├── search/
│   │   │   ├── criteria.ts
│   │   │   ├── parse-query.ts
│   │   │   └── search-vacancies.ts
│   │   └── time/
│   └── test/
│       ├── fixtures/
│       ├── integration/
│       └── unit/
├── .env.example
├── .gitignore
├── CLAUDE.md
├── PROJECT_SETUP.md
├── package.json
├── pnpm-lock.yaml
├── playwright.config.ts
├── tsconfig.json
└── README.md
```

Keep the codebase as one application repository. A monorepo is unnecessary for the MVP.

---

# 12. Database design

Use `vacancyReference` as the authoritative source identifier for DfE vacancies.

## 12.1 `vacancies`

Suggested columns:

```sql
CREATE TABLE vacancies (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  title TEXT NOT NULL,
  short_description TEXT,
  full_description TEXT,
  employer_name TEXT,
  employer_website_url TEXT,
  employer_contact_name TEXT,
  employer_contact_phone TEXT,
  employer_contact_email TEXT,

  posted_date TIMESTAMPTZ NOT NULL,
  closing_date TIMESTAMPTZ NOT NULL,
  start_date TIMESTAMPTZ,

  number_of_positions INTEGER,
  hours_per_week NUMERIC,
  expected_duration TEXT,

  wage_type TEXT,
  wage_amount NUMERIC,
  wage_unit TEXT,
  wage_additional_information TEXT,
  working_week_description TEXT,

  course_lars_code INTEGER,
  course_title TEXT,
  course_level INTEGER,
  course_route TEXT,
  course_type TEXT,
  apprenticeship_level TEXT,

  provider_name TEXT,
  ukprn INTEGER,
  is_disability_confident BOOLEAN NOT NULL DEFAULT FALSE,

  vacancy_url TEXT,
  application_url TEXT,

  is_national_vacancy BOOLEAN NOT NULL DEFAULT FALSE,
  national_vacancy_details TEXT,

  employer_description TEXT,
  training_description TEXT,
  additional_training_description TEXT,
  outcome_description TEXT,
  things_to_consider TEXT,
  company_benefits_information TEXT,

  source_active BOOLEAN NOT NULL DEFAULT TRUE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  inactive_at TIMESTAMPTZ,
  last_sync_run_id UUID,

  raw_json JSONB,

  UNIQUE (source, source_reference)
);
```

## 12.2 `vacancy_locations`

```sql
CREATE TABLE vacancy_locations (
  id BIGSERIAL PRIMARY KEY,
  vacancy_id BIGINT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,

  address_line_1 TEXT,
  address_line_2 TEXT,
  address_line_3 TEXT,
  address_line_4 TEXT,
  postcode TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,

  location_key TEXT NOT NULL,

  UNIQUE (vacancy_id, location_key)
);
```

`location_key` should be deterministic, for example a hash or normalized concatenation of source address fields and coordinates.

## 12.3 `vacancy_skills`

Optional normalized table:

```sql
CREATE TABLE vacancy_skills (
  vacancy_id BIGINT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  skill TEXT NOT NULL,
  PRIMARY KEY (vacancy_id, skill)
);
```

Alternatively keep source arrays in JSON for MVP if they are not used in search.

## 12.4 `vacancy_qualifications`

```sql
CREATE TABLE vacancy_qualifications (
  id BIGSERIAL PRIMARY KEY,
  vacancy_id BIGINT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  weighting TEXT,
  qualification_type TEXT,
  subject TEXT,
  grade TEXT
);
```

## 12.5 `sync_runs`

```sql
CREATE TABLE sync_runs (
  id UUID PRIMARY KEY,
  source TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  success BOOLEAN,
  pages_fetched INTEGER NOT NULL DEFAULT 0,
  vacancies_received INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);
```

## 12.6 `saved_searches`

For the single-user MVP, store one row but design it as a reusable model.

```sql
CREATE TABLE saved_searches (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,

  location_label TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  radius_miles DOUBLE PRECISION,

  levels INTEGER[] NOT NULL DEFAULT '{}',
  routes TEXT[] NOT NULL DEFAULT '{}',
  course_types TEXT[] NOT NULL DEFAULT '{}',

  keywords TEXT,
  employer TEXT,

  min_annual_pay NUMERIC,
  include_unknown_pay BOOLEAN NOT NULL DEFAULT TRUE,
  disability_confident_only BOOLEAN NOT NULL DEFAULT FALSE,
  include_national BOOLEAN NOT NULL DEFAULT FALSE,

  alert_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

For a personal deployment, `alert_email` can instead remain only in the `ALERT_TO_EMAIL` secret to reduce stored personal information.

## 12.7 `alert_deliveries`

This table is the key to idempotent email alerts.

```sql
CREATE TABLE alert_deliveries (
  id BIGSERIAL PRIMARY KEY,
  saved_search_id UUID NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
  vacancy_id BIGINT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  first_matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  emailed_at TIMESTAMPTZ,
  delivery_status TEXT NOT NULL,
  provider_message_id TEXT,
  error_message TEXT,

  UNIQUE (saved_search_id, vacancy_id)
);
```

A vacancy is "new for this alert" if there is no successful delivery for the `(saved_search_id, vacancy_id)` pair.

## 12.8 Useful indexes

At minimum:

```sql
CREATE INDEX vacancies_open_idx
  ON vacancies (source_active, closing_date);

CREATE INDEX vacancies_level_idx
  ON vacancies (course_level);

CREATE INDEX vacancies_route_idx
  ON vacancies (course_route);

CREATE INDEX vacancies_posted_idx
  ON vacancies (posted_date DESC);

CREATE INDEX vacancies_employer_idx
  ON vacancies (employer_name);

CREATE INDEX vacancy_locations_lat_lon_idx
  ON vacancy_locations (latitude, longitude);
```

A later optimization can add PostgreSQL full-text search and/or PostGIS.

---

# 13. Distance calculation

For the MVP, calculate great-circle distance from the user's coordinates to each vacancy location with one shared, tested implementation.

Do not use straight-line degree differences.

Recommended behavior:

```ts
nearestDistanceMiles(vacancy.locations, searchLocation)
```

returns:

- `null` for a national/no-location vacancy;
- otherwise the minimum Haversine distance over all valid source locations.

A vacancy matches a radius if:

```ts
nearestDistanceMiles <= radiusMiles
```

Keep all radius units in miles because the DfE API and UK job-search context use miles.

Use one authoritative conversion constant when converting miles/metres and document it in code.

If query volume grows substantially, move this logic into PostGIS and add a spatial index.

---

# 14. Data ingestion algorithm

Implement:

```text
scripts/sync-vacancies.ts
```

## 14.1 Safe sync sequence

1. Create a `sync_runs` row with a new UUID.
2. Fetch DfE reference route/course data as needed.
3. Fetch `/vacancy` page 1 using API v2.
4. Validate the response with Zod.
5. Read `totalPages`.
6. Fetch every remaining page.
7. Normalize each source vacancy.
8. Upsert into `vacancies`.
9. Replace/upsert its location rows.
10. Record the current `sync_run_id` and `last_seen_at`.
11. Only after **every page** succeeds:
    - mark previously active DfE vacancies not seen in this completed run as inactive;
    - set `inactive_at`.
12. Mark the `sync_runs` row successful.
13. On any unrecoverable error:
    - mark the run failed;
    - do **not** deactivate unseen vacancies.

This protects the database from mass false closures caused by a partial API failure.

## 14.2 Source validation

Do not trust external data shape blindly.

Create Zod schemas for:

- list response;
- vacancy item;
- address;
- course;
- wage;
- detailed fields.

Allow optional/null fields where documented.

Log validation errors without printing secrets.

## 14.3 Raw source record

Keep `raw_json` for debugging/auditing.

Business logic must use normalized columns, not repeatedly reach into raw JSON.

## 14.4 HTTP behavior

The DfE client must implement:

- request timeout;
- retry for transient 5xx errors;
- retry/backoff for 429;
- no retry for ordinary 4xx authentication/configuration errors;
- redaction of API key in all logs;
- identifiable but non-secret user agent if appropriate;
- structured error messages.

---

# 15. Search implementation

The web application should search the local database, not the DfE API.

## 15.1 Request flow

```text
Browser
  -> Next.js search route/server function
  -> validate query parameters
  -> database query
  -> distance filtering/sorting
  -> paginated result DTO
  -> browser
```

## 15.2 Search response DTO

Return only fields needed by the list page:

```ts
export interface VacancySearchResult {
  reference: string;
  title: string;
  employerName: string | null;
  courseTitle: string | null;
  level: number | null;
  route: string | null;
  postedDate: string;
  closingDate: string;
  startDate: string | null;
  wage: {
    type: string | null;
    amount: number | null;
    unit: string | null;
    additionalInformation: string | null;
  };
  nearestLocation: {
    label: string;
    postcode: string | null;
    distanceMiles: number | null;
  } | null;
  otherLocationCount: number;
  isNational: boolean;
  isDisabilityConfident: boolean;
  vacancyUrl: string | null;
  applicationUrl: string | null;
}
```

## 15.3 Result completeness

"All matching vacancies" means:

- no silent first-100 cap;
- server returns total matching count;
- UI paginates through the complete set;
- tests verify that page boundaries do not lose or duplicate rows.

Recommended page size can be a UI/product setting; do not couple it to DfE ingestion page size.

---

# 16. Web UI specification

## 16.1 Desktop

Layout:

```text
+---------------------------------------------------------------+
| App title / last data update                                  |
+----------------------+----------------------------------------+
| Filters              | N apprenticeships found                |
|                      | Sort: Distance / Newest / Closing soon |
| Location             |                                        |
| Radius               | Result card                            |
| Level                | Result card                            |
| Category             | Result card                            |
| Pay                  | Result card                            |
| Other filters        | ...                                    |
+----------------------+----------------------------------------+
```

## 16.2 Mobile

Use:

- top search summary;
- `Filters` button opening a bottom sheet or full-height drawer;
- single-column result cards;
- large tap targets;
- sticky `Show results` action inside the filter drawer;
- no dense desktop table.

## 16.3 Result card

Display:

- title;
- employer;
- course title;
- apprenticeship level;
- category/route;
- nearest location;
- distance;
- wage source wording;
- posted date;
- closing date;
- start date;
- badges:
  - New
  - Closing soon
  - Disability Confident
  - National
  - Foundation, where relevant
- primary action: `View vacancy`
- optional secondary action: `Apply`, if `applicationUrl` differs from vacancy URL

Always make clear when the action leaves this application.

## 16.4 Detail page

Route:

```text
/apprenticeship/[reference]
```

Show:

- all list fields;
- vacancy description;
- employer information;
- training details;
- skills;
- qualifications;
- things to consider;
- benefits;
- all work locations;
- official source link;
- apply link.

Do not mirror an application form.

---

# 17. URL/search state

The user should be able to bookmark a search.

Example:

```text
/?location=Cambridge%2C+Cambridgeshire
&lat=...
&lon=...
&radius=...
&level=2
&route=Digital
&minPay=...
&includeUnknownPay=1
&sort=distance
```

Rules:

- parse URL parameters with Zod;
- reject/normalize invalid values;
- use defaults only when a parameter is absent;
- never trust client-supplied latitude/longitude without numeric bounds validation;
- use URL state as the primary state, with local component state only while editing filters.

---

# 18. PWA/mobile-app behavior

The core requirement is browser usability, not a native app.

Implement:

- `manifest.ts` / web manifest;
- app name and short name;
- icons;
- `display: standalone`;
- suitable viewport metadata;
- responsive design;
- installability where browsers support it.

Do **not** aggressively cache vacancy API/search responses for offline use. "Currently open" is time-sensitive.

A service worker is optional for MVP. If included, cache only:

- static application shell;
- icons/fonts;
- non-time-sensitive assets.

Use network-first/no-store behavior for vacancy search results.

---

# 19. Alert design

## 19.1 Preferred semantics

An email alert should mean:

> "These vacancies currently match your saved criteria and have not previously been successfully emailed for this saved search."

Do not define "new" only as `postedDate` within the last N days; that can miss items after failed jobs and can duplicate items after overlapping schedules.

Use `alert_deliveries` for durable idempotency.

## 19.2 Alert flow

For each enabled saved search:

1. run the same matching logic used by the web app;
2. select currently open matching vacancies;
3. left join `alert_deliveries`;
4. keep only vacancies without a successful prior delivery;
5. if zero:
   - normally send no email;
   - log `0 new matches`;
6. if one or more:
   - render one digest email;
   - send it;
   - only after successful send, mark each vacancy delivered.

If sending fails:

- store/log the failure;
- do not mark vacancies as successfully delivered;
- next scheduled run can retry.

## 19.3 Digest content

Subject example:

```text
New apprenticeship matches near Cambridge
```

Body:

```text
3 new apprenticeships matched your saved search.

1. <title>
   <employer>
   Level <n> - <course>
   <nearest location> - <distance> miles
   Pay: <source wording>
   Closes: <date>
   <official URL>

...
```

Include the saved filter summary near the top.

For a single-user deployment, no unsubscribe workflow is necessary if the user controls the repository and secret. If this becomes a multi-user service, implement consent, preferences, unsubscribe, and privacy handling before launch.

---

# 20. Scheduling with GitHub Actions

Use two schedules.

## 20.1 Vacancy sync

Recommended product behavior:

- sync once per day;
- schedule away from minute `00` because GitHub documents that scheduled jobs can be delayed during high-load periods, particularly around the start of an hour;
- include `workflow_dispatch` for manual runs.

Illustrative workflow:

```yaml
name: Sync apprenticeship vacancies

on:
  workflow_dispatch:
  schedule:
    - cron: "17 6 * * *"
      timezone: "Europe/London"

jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: "lts/*"
          cache: "pnpm"

      - run: pnpm install --frozen-lockfile

      - run: pnpm db:migrate

      - run: pnpm sync:vacancies
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          DFE_DISPLAY_ADVERT_API_KEY: ${{ secrets.DFE_DISPLAY_ADVERT_API_KEY }}
```

When Claude implements the project, verify current major versions of reusable GitHub Actions rather than blindly copying the example.

## 20.2 Email alerts

The user requested every few days or weekly.

Make cadence easy to change in one workflow file.

A weekly example:

```yaml
name: Send apprenticeship alerts

on:
  workflow_dispatch:
  schedule:
    - cron: "23 7 * * 1"
      timezone: "Europe/London"

jobs:
  alerts:
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: "lts/*"
          cache: "pnpm"

      - run: pnpm install --frozen-lockfile

      - run: pnpm alerts:send
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          SMTP_HOST: ${{ secrets.SMTP_HOST }}
          SMTP_PORT: ${{ secrets.SMTP_PORT }}
          SMTP_SECURE: ${{ secrets.SMTP_SECURE }}
          SMTP_USER: ${{ secrets.SMTP_USER }}
          SMTP_PASS: ${{ secrets.SMTP_PASS }}
          ALERT_FROM_EMAIL: ${{ secrets.ALERT_FROM_EMAIL }}
          ALERT_TO_EMAIL: ${{ secrets.ALERT_TO_EMAIL }}
```

To run twice a week, change only the cron schedule.

## 20.3 GitHub scheduling caveats

Current GitHub documentation says:

- scheduled workflows use POSIX cron;
- timezone-aware schedules can use an IANA timezone;
- scheduled workflows run from the latest commit on the default branch;
- scheduled runs may be delayed under high load;
- in a public repository, scheduled workflows can be automatically disabled after 60 days without repository activity.

For a personal utility, a private repository avoids the public-repository inactivity caveat and also reduces accidental configuration exposure, though secrets are still required.

---

# 21. Environment variables and secrets

Create `.env.example` containing variable names but no secrets:

```env
# App
APP_BASE_URL=http://localhost:3000
DEFAULT_LOCATION_QUERY=Cambridge, Cambridgeshire
DEFAULT_RADIUS_MILES=
DEFAULT_LEVELS=2

# Database
DATABASE_URL=

# DfE
DFE_DISPLAY_ADVERT_API_BASE_URL=https://api.apprenticeships.education.gov.uk/vacancies
DFE_DISPLAY_ADVERT_API_VERSION=2
DFE_DISPLAY_ADVERT_API_KEY=

# Location resolver
POSTCODES_IO_BASE_URL=https://api.postcodes.io

# Email
SMTP_HOST=
SMTP_PORT=
SMTP_SECURE=
SMTP_USER=
SMTP_PASS=
ALERT_FROM_EMAIL=
ALERT_TO_EMAIL=
```

Rules:

- `.env*` files containing secrets must be ignored;
- `.env.example` is safe to commit;
- no secret is prefixed `NEXT_PUBLIC_`;
- CI must fail if a required server-side config variable is missing for the command that needs it;
- redact secrets from exceptions.

---

# 22. GitHub repository settings

Recommended:

- private repository for the personal MVP;
- default branch: `main`;
- branch protection after initial bootstrap;
- GitHub Actions enabled;
- workflow permissions limited to read unless a job genuinely needs write access;
- Dependabot/Renovate optional;
- secret scanning enabled where available.

GitHub Actions secrets:

```text
DATABASE_URL
DFE_DISPLAY_ADVERT_API_KEY
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASS
ALERT_FROM_EMAIL
ALERT_TO_EMAIL
```

Do not use a workflow that commits "seen IDs" back to the repository. The database should hold sync and alert state.

---

# 23. Deployment

## 23.1 Web

Recommended simplest deployment:

```text
GitHub -> Vercel -> Next.js app
```

The deployed app needs database access.

It does **not** need the DfE API key if DfE ingestion is performed exclusively by GitHub Actions.

## 23.2 Database

Use a managed PostgreSQL database.

Production requirements:

- encrypted connections;
- backups appropriate to the provider;
- connection pooling suitable for serverless Next.js;
- restricted credentials;
- migrations run in a controlled step.

## 23.3 Scheduled jobs

Keep scheduled ingestion/alerts in GitHub Actions as specifically requested.

Do not duplicate the schedules in both Vercel Cron and GitHub Actions.

---

# 24. Observability and operational safety

## 24.1 Structured logs

Each sync should log:

```text
sync_run_id
source
pages_fetched
vacancies_received
vacancies_inserted
vacancies_updated
vacancies_deactivated
duration
success/failure
```

Never log:

- DfE API key;
- SMTP password;
- complete connection string;
- mail provider auth token.

## 24.2 Sync status in app

Optionally show:

```text
Vacancy data last updated: <timestamp>
```

Only use the timestamp of the latest successful sync.

If the last successful sync is old, show a non-alarming data freshness warning.

## 24.3 Failure alerts

For MVP, a failed GitHub job is visible in Actions.

Later add an operations email only after preventing alert loops.

---

# 25. Security and privacy

## 25.1 Minimum data collection

For a personal single-user app, avoid accounts and avoid storing applicant details.

The only personal data needed for alerts can be:

```text
alert recipient email address
```

Prefer storing it as a GitHub secret for the single-user MVP.

## 25.2 External links

Sanitize/validate source URLs before rendering.

Only permit `http:` and `https:`.

Use appropriate `rel` attributes for external links opened in new tabs.

## 25.3 Input validation

Validate:

- level between supported values;
- radius is positive and within an application-defined reasonable bound;
- latitude `[-90, 90]`;
- longitude `[-180, 180]`;
- page/page size;
- sort enum;
- category names;
- keyword length;
- pay range.

Use parameterized queries only.

## 25.4 API abuse

The web search endpoint reads the local DB, so it should not expose the DfE rate limit.

Still add basic defensive controls:

- server-side validation;
- reasonable page-size maximum;
- short cache where appropriate;
- no expensive unbounded wildcard search on full descriptions without indexes.

---

# 26. Accessibility

Target WCAG 2.2 AA quality where practical.

Required:

- semantic headings;
- real labels for every input;
- keyboard-operable filters;
- visible focus states;
- no information conveyed by color alone;
- date/pay/location text readable by screen readers;
- buttons rather than clickable `div`s;
- accessible filter drawer focus management;
- logical tab order;
- sufficient contrast;
- error messages associated with fields.

Run an automated accessibility check in end-to-end tests, but also perform keyboard/manual checks.

---

# 27. Testing strategy

## 27.1 Unit tests

Test:

- DfE source normalization;
- null/unknown wage behavior;
- Level 2 matching;
- route matching;
- national vacancy handling;
- Haversine distance;
- multi-location nearest distance;
- closing-date active check;
- URL query parser;
- alert idempotency decision.

## 27.2 API fixture tests

Store redacted representative JSON fixtures for:

- ordinary single-location vacancy;
- multi-location vacancy;
- national vacancy;
- Level 2 foundation apprenticeship;
- custom wage;
- minimum-wage type with null numeric amount;
- competitive salary;
- Disability Confident vacancy;
- closing today;
- malformed/partial source record.

Never put an API key in fixtures.

## 27.3 Integration tests

Test complete sync behavior:

### Successful full sync

- records inserted;
- records updated;
- multi-location rows refreshed;
- missing previously-active records marked inactive.

### Partial failed sync

- job reports failure;
- unseen existing vacancies are **not** marked inactive.

### Alert run

- new match -> email rendered -> delivery recorded;
- next run -> no duplicate;
- email failure -> not recorded as successful -> retry on next run.

## 27.4 E2E tests with Playwright

Test:

1. default page is Cambridge + Level 2;
2. changing radius updates results;
3. changing to another level works;
4. route filter works;
5. numeric pay filter does not silently discard unknown pay unless the setting says so;
6. URL can be copied/reloaded with same filters;
7. mobile filter drawer works;
8. result card opens official vacancy link;
9. detail page renders multiple locations;
10. expired vacancy is not shown.

## 27.5 CI

On every pull request:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run Playwright in CI once the base app is stable.

---

# 28. Acceptance criteria

The MVP is complete when all of the following are true.

## Data

- [ ] DfE Display Advert API v2 key is used only server-side/in scheduled jobs.
- [ ] A manual sync can retrieve all current source pages.
- [ ] Current vacancies are stored locally.
- [ ] Multi-location vacancies are represented correctly.
- [ ] A partial failed sync cannot mass-deactivate the database.
- [ ] Closed/inactive vacancies do not appear in search.

## Search

- [ ] Opening `/` defaults to Cambridge.
- [ ] Level 2 is selected by default.
- [ ] User can change radius.
- [ ] User can select one or more levels.
- [ ] User can select category/route.
- [ ] User can search by keyword.
- [ ] User can filter by pay with explicit unknown-pay behavior.
- [ ] User can include/exclude national vacancies.
- [ ] Search returns a total count.
- [ ] User can access every page of matching results.
- [ ] Distance is based on the nearest location for multi-location vacancies.

## UI

- [ ] Works at common phone widths without horizontal scrolling.
- [ ] Works on desktop.
- [ ] Filters are keyboard accessible.
- [ ] Vacancy cards clearly show employer, level, course, location/distance, pay, and closing date.
- [ ] Official source/apply links work.
- [ ] PWA manifest is valid.

## Alerts

- [ ] Saved default search exists.
- [ ] Alert workflow can be manually run.
- [ ] Scheduled alert workflow exists.
- [ ] Email includes only newly delivered matches.
- [ ] Running alert twice does not duplicate the same vacancies.
- [ ] A failed mail send does not falsely mark vacancies delivered.

## Operations

- [ ] CI passes.
- [ ] Production secrets are stored outside source control.
- [ ] README documents local setup.
- [ ] Latest successful sync timestamp is available.
- [ ] GitHub Actions workflows have manual triggers.

---

# 29. Implementation phases for Claude CLI

Claude should implement this in small reviewable phases and run tests after each phase.

## Phase 0 - Repository bootstrap

Tasks:

1. initialize Git;
2. create Next.js TypeScript app;
3. configure `pnpm`;
4. enable strict TypeScript;
5. add linting/testing;
6. create `.env.example`;
7. add `CLAUDE.md`;
8. commit baseline.

Deliverable:

```text
App starts locally and CI skeleton runs.
```

## Phase 1 - Database and data model

Tasks:

1. configure PostgreSQL client/ORM;
2. create migrations;
3. implement tables in Section 12;
4. create DB access helpers;
5. create seed for default saved search;
6. add DB tests.

Deliverable:

```text
Fresh database can be created entirely from committed migrations.
```

## Phase 2 - DfE API client

Tasks:

1. implement typed v2 API client;
2. add request headers;
3. add Zod schemas;
4. implement pagination;
5. implement retries/rate-limit handling;
6. add fixtures and tests;
7. add `verify-dfe-api.ts`.

Deliverable:

```text
Manual command can validate connectivity and fetch a page without leaking the key.
```

## Phase 3 - Full vacancy sync

Tasks:

1. implement normalization;
2. upsert vacancies;
3. upsert locations;
4. track sync run;
5. safe deactivate-on-success behavior;
6. sync stats/logging;
7. integration tests.

Deliverable:

```text
pnpm sync:vacancies
```

produces a complete local live-vacancy dataset.

## Phase 4 - Location resolver

Tasks:

1. Postcodes.io client;
2. postcode search;
3. place search;
4. ambiguity handling;
5. Cambridge default seed resolution;
6. tests with mocked responses.

Deliverable:

```text
User can resolve Cambridge and arbitrary supported UK postcode/place queries to coordinates.
```

## Phase 5 - Search engine

Tasks:

1. typed criteria model;
2. open-vacancy filter;
3. level;
4. route;
5. keyword;
6. employer;
7. pay;
8. national toggle;
9. distance calculation;
10. sort;
11. pagination;
12. unit/integration tests.

Deliverable:

```text
A server function/API returns correct deterministic result pages and total count.
```

## Phase 6 - Responsive UI

Tasks:

1. page layout;
2. desktop sidebar;
3. mobile filter drawer;
4. result cards;
5. result count;
6. sort selector;
7. URL-state sync;
8. loading/error/empty states;
9. detail page;
10. accessibility pass.

Deliverable:

```text
Usable search app on phone and desktop.
```

## Phase 7 - PWA metadata

Tasks:

1. manifest;
2. icons;
3. install metadata;
4. verify no stale vacancy caching.

Deliverable:

```text
Browser can offer install/add-to-home-screen where supported.
```

## Phase 8 - Email alerts

Tasks:

1. saved-search query;
2. new-match selection;
3. HTML/plain-text digest renderer;
4. email sender abstraction;
5. SMTP implementation;
6. delivery table;
7. idempotency tests.

Deliverable:

```text
pnpm alerts:send
```

sends only undelivered current matches.

## Phase 9 - GitHub Actions

Tasks:

1. CI workflow;
2. daily sync workflow;
3. weekly alert workflow;
4. manual triggers;
5. secrets documentation;
6. verify log redaction.

Deliverable:

```text
Actions can sync and send alerts without a developer machine.
```

## Phase 10 - Deployment and hardening

Tasks:

1. deploy web app;
2. connect production DB;
3. run migrations;
4. run first production sync;
5. confirm search;
6. send test alert;
7. test mobile;
8. verify accessibility;
9. review all environment variables;
10. write operations docs.

---

# 30. `package.json` script contract

Claude should provide at least:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "...",
    "typecheck": "tsc --noEmit",
    "test": "...",
    "test:e2e": "...",
    "db:generate": "...",
    "db:migrate": "...",
    "db:seed": "...",
    "dfe:verify": "...",
    "sync:vacancies": "...",
    "alerts:send": "..."
  }
}
```

Do not leave placeholder commands in the final implementation.

---

# 31. Error states the UI must handle

The UI needs explicit states for:

- no matches;
- invalid location;
- ambiguous location;
- database temporarily unavailable;
- search request timeout;
- stale source data;
- vacancy removed since last page view;
- missing/non-numeric wage;
- nationally recruiting vacancy with no distance.

Never convert source/data failure into "0 apprenticeships found" if the system cannot actually determine that.

---

# 32. Search result freshness

Display:

```text
Data last updated <time>
```

from the latest successful sync.

Daily sync is recommended because:

- the user wants "currently open" vacancies;
- a weekly-only sync can leave vacancies visible after they close or delay newly posted vacancies for several days.

Email alerts can remain weekly even while the datastore syncs daily.

This separates **data freshness** from **notification frequency**.

---

# 33. Future UK-wide expansion

The source adapter should normalize all nations into the same internal model.

Before adding each nation:

1. identify an official API/feed;
2. verify current terms of use;
3. verify allowed caching/display behavior;
4. map local qualification levels to internal/display semantics without falsely equating different national frameworks;
5. add source-specific tests;
6. preserve original source wording and source link;
7. disclose coverage accurately in the UI.

Do not assume Scotland's SCQF levels map 1:1 to English apprenticeship levels.

Do not present a unified numeric level filter for all UK nations until mappings and UX are intentionally designed.

---

# 34. Potential Phase 2 product features

After MVP:

- multiple saved searches;
- user accounts;
- multiple alert recipients;
- alert frequency per saved search;
- instant/daily/weekly digests;
- favourites/bookmarks;
- "seen" state;
- application tracking;
- map view;
- calendar export for closing dates;
- push notifications;
- employer watchlists;
- course/standard watchlists;
- full UK source adapters;
- richer full-text search;
- PostGIS;
- admin/operations dashboard.

Keep these out of the first implementation unless they are required to satisfy acceptance criteria.

---

# 35. Claude CLI working rules

Create a `CLAUDE.md` in the repository containing the following project rules.

Suggested content:

```md
# Claude project rules

Read PROJECT_SETUP.md before making architectural changes.

## Core invariants

- DfE API key is server-side only.
- Browser searches our database, not DfE directly.
- DfE API version is v2.
- One vacancy card per source vacancy reference, even with multiple locations.
- A full successful sync is required before unseen vacancies may be marked inactive.
- Current search excludes closed/inactive vacancies.
- Default location is Cambridge.
- Default apprenticeship level is Level 2.
- Never invent a salary for Competitive, National Minimum, or Apprenticeship Minimum wage types.
- Alert delivery must be idempotent.
- A failed email must not be recorded as successfully delivered.
- URL state must reproduce a search.
- All external payloads and browser query parameters are runtime validated.
- Never commit secrets.
- Add or update tests whenever matching/sync logic changes.

## Development workflow

Before editing:
1. state which phase/task you are implementing;
2. inspect existing code and tests;
3. make the smallest coherent change.

After editing:
1. run formatting/linting;
2. run typecheck;
3. run relevant tests;
4. run build for changes affecting production;
5. summarize changed files and remaining issues.

Do not silently change product defaults or database schema without documenting the change.
```

---

# 36. Suggested Claude CLI prompts

Use these sequentially rather than asking Claude to implement everything in one giant pass.

## Prompt 1 - Understand and plan

```text
Read PROJECT_SETUP.md in full. Do not write code yet.

Inspect the repository and produce:
1. a short architecture summary;
2. an implementation checklist mapped to Phases 0-10;
3. any conflict between the existing repo and PROJECT_SETUP.md;
4. the exact files you propose to create/change for Phase 0.

Do not change the product requirements or defaults.
```

## Prompt 2 - Bootstrap

```text
Implement Phase 0 from PROJECT_SETUP.md.

Requirements:
- pnpm
- current stable Next.js with TypeScript/App Router
- strict TypeScript
- lint, typecheck, unit-test, and build scripts
- .env.example with no secrets
- CLAUDE.md with the project invariants
- minimal responsive page that says the app is under construction

Run lint, typecheck, tests, and build.
Summarize what you changed and any command I need to run locally.
```

## Prompt 3 - Database

```text
Implement Phase 1 from PROJECT_SETUP.md.

Use PostgreSQL and a TypeScript migration/ORM approach suitable for Next.js.
Create committed migrations for the specified schema.
Do not add user authentication.
Add tests for schema/migration assumptions.
Create a seed path for the default saved search, but resolve Cambridge coordinates through the location resolver in its later phase rather than inventing coordinates.

Run all relevant checks.
```

## Prompt 4 - DfE client

```text
Implement Phase 2 from PROJECT_SETUP.md.

Use Display Advert API v2 only.
Headers:
- X-Version: 2
- Ocp-Apim-Subscription-Key from server-side env

Implement Zod validation, pagination primitives, retry/backoff for transient failures and 429, timeout, and redacted logging.

Add source fixtures representing normal, multi-location, national, level-2, custom-wage, minimum-wage, and competitive-salary vacancies.

Do not call DfE from any browser component.
Run tests and typecheck.
```

## Prompt 5 - Ingestion

```text
Implement Phase 3.

Critical safety property:
Do not mark an existing vacancy inactive unless the entire source pagination run completed successfully.

Use source_reference/vacancyReference as the stable source ID.
Preserve multiple locations.
Store raw_json as well as normalized fields.
Log a concise sync summary without secrets.

Add integration tests for both a successful full sync and a failed partial sync.
```

## Prompt 6 - Geocoding

```text
Implement Phase 4 using Postcodes.io.

Support:
- exact/full UK postcode lookup/search;
- place-name lookup;
- multiple place choices;
- storage/return of label + latitude + longitude.

Default query is "Cambridge, Cambridgeshire".
Do not hard-code coordinates.
Mock external calls in automated tests.
```

## Prompt 7 - Search engine

```text
Implement Phase 5.

Use one typed SearchCriteria model for web search and alerts.
Implement:
- active/open filter;
- radius using nearest vacancy location;
- Level 2 default;
- multi-level selection;
- routes;
- keywords;
- employer;
- pay with includeUnknownPay semantics;
- Disability Confident;
- includeNational;
- distance/newest/closingSoon/startDate/payHigh sorting;
- deterministic pagination and total count.

Add comprehensive unit and integration tests.
```

## Prompt 8 - UI

```text
Implement Phase 6.

Build a mobile-first responsive UI:
- desktop filter sidebar;
- mobile filter drawer;
- result cards;
- sorting;
- result count;
- loading/error/empty states;
- shareable URL query state;
- detail page.

The initial page must represent Cambridge + Level 2.
Do not use a desktop table for mobile.
Do an accessibility-focused pass and add Playwright coverage for the core flow.
```

## Prompt 9 - Alerts

```text
Implement Phase 8.

Create a provider-neutral email sender interface and an SMTP implementation.
Implement saved-search matching through the same search logic as the website.

Use alert_deliveries for idempotency:
- email only undelivered matching vacancies;
- record successful delivery only after email send succeeds;
- failed send remains retryable.

Create both plain-text and HTML digest output.
Do not send email when there are zero new matches.
Add tests.
```

## Prompt 10 - Actions

```text
Implement Phase 9.

Add:
- ci.yml
- sync-vacancies.yml
- send-alerts.yml

Both scheduled jobs must support workflow_dispatch.
Use timezone Europe/London.
Do not schedule exactly on minute 00.
Sync should be daily.
Alert should be weekly by default and easy to edit.

Use GitHub Secrets only.
Do not commit state or secrets back into the repository.
Document every required secret.
```

## Prompt 11 - Final audit

```text
Audit the entire repository against every checkbox in the Acceptance Criteria section of PROJECT_SETUP.md.

Do not just describe problems:
- fix any issue that can safely be fixed now;
- add missing tests;
- run lint, typecheck, unit tests, integration tests, E2E tests if configured, and production build.

Then return:
1. acceptance criteria status;
2. test/build results;
3. required manual setup steps;
4. remaining known limitations;
5. deployment checklist.
```

---

# 37. Local setup target

Once implemented, a clean local setup should look approximately like:

```bash
git clone <repo>
cd apprenticeship-finder

cp .env.example .env.local
# fill DATABASE_URL and DFE_DISPLAY_ADVERT_API_KEY as required

pnpm install
pnpm db:migrate
pnpm db:seed
pnpm sync:vacancies
pnpm dev
```

For email testing:

```bash
pnpm alerts:send
```

The actual README must describe the concrete commands produced by the selected ORM/test stack.

---

# 38. Definition of done for production

Before calling the application production-ready:

1. DfE API key obtained and stored securely.
2. Production DB created.
3. Migrations applied.
4. Manual sync succeeds.
5. Current source vacancies appear in DB.
6. Cambridge + Level 2 default search returns a valid page, including a legitimate zero-results state if that is what the current data contains.
7. Radius filtering is manually spot-checked against source coordinates.
8. Multi-location result tested.
9. National vacancy behavior tested.
10. Unknown-pay behavior tested.
11. Mobile layout tested in at least one iOS-class and Android-class viewport.
12. Desktop layout tested.
13. Official vacancy/apply links tested.
14. Email test received.
15. Re-running alert sends no duplicate vacancy.
16. Daily sync Action enabled.
17. Weekly alert Action enabled.
18. CI passing on `main`.
19. No secrets appear in Git history.
20. Coverage statement says England, not full UK, until more sources are integrated.

---

# 39. Important implementation decisions recap

These choices are intentional:

### Store source data locally

Reason:

- DfE v2 schema recommends intermittent retrieval/storage rather than direct browser calls;
- keeps API key private;
- supports pay/level/text filters not all available as upstream query filters;
- supports alerts and durable deduplication;
- reduces dependency on source availability for each page view.

### Daily sync, weekly alert

Reason:

- search freshness and email frequency are different concerns;
- daily sync helps "currently open" stay accurate;
- weekly digest satisfies the requested alert cadence without delaying the web search dataset.

### England first

Reason:

- verified official API exists;
- UK nations operate separate services;
- better to be accurate about coverage than to call an England-only dataset "UK-wide."

### Persistent alert-delivery table

Reason:

- makes alerts idempotent;
- avoids duplicates after manual workflow runs;
- does not miss vacancies after a temporary job failure;
- avoids committing state files back to Git.

### No guessed salary

Reason:

- source wage model contains non-numeric forms;
- a guessed annual salary would make a pay filter misleading.

---

# 40. Verified references

All links below were checked while preparing this document on 2026-09-29.

## England / DfE

DfE Apprenticeship service developer hub:

```text
https://developer.apprenticeships.education.gov.uk/
```

Display Advert API v2 catalogue/overview:

```text
https://beta-find-and-use-an-api.education.gov.uk/api/display-advert-api-2
```

DfE developer terms for the Display Advert API:

```text
https://developer.apprenticeships.education.gov.uk/third-party-accounts/terms-conditions
```

Create a Display Advert API developer account:

```text
https://developer.apprenticeships.education.gov.uk/third-party-accounts/register
```

GOV.UK Find an apprenticeship entry page:

```text
https://www.gov.uk/apply-apprenticeship
```

Find an apprenticeship search UI:

```text
https://www.findapprenticeship.service.gov.uk/
```

A publicly accessible mirror of the current v2 OpenAPI schema used to cross-check field names and v2 behavior:

```text
https://gist.github.com/dexit/835d80f6474b9d80e1a00d6cde7a0ba9
```

Treat the official DfE catalogue/developer hub as authoritative. The schema mirror is a convenience for inspecting the currently published schema when the catalogue's document download is difficult to consume automatically.

## Location/geocoding

Postcodes.io overview:

```text
https://postcodes.io/docs/overview/
```

Postcodes.io Places API:

```text
https://postcodes.io/docs/api/places/
```

## GitHub Actions

Workflow schedule syntax:

```text
https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
```

Scheduled workflow event behavior:

```text
https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
```

## Other UK nation services

Scotland apprenticeship vacancies:

```text
https://www.apprenticeships.scot/find-a-vacancy
```

Wales apprenticeship information/search entry:

```text
https://www.gov.wales/find-apprenticeship
```

Careers Wales apprenticeships:

```text
https://careerswales.gov.wales/apprenticeships
```

Northern Ireland apprenticeship opportunities:

```text
https://www.nidirect.gov.uk/services/search-apprenticeship-opportunities
```

---

# 41. Final instruction to Claude CLI

The core architectural rule is:

> Build the web app against a normalized local database populated from the official DfE Display Advert API v2. Do not expose or proxy the DfE API key from browser code. Use the same typed matching logic for interactive search and scheduled alerts, and make alert delivery idempotent in the database.

Prioritize correctness of:

1. live/open status;
2. location radius;
3. apprenticeship level;
4. multi-location handling;
5. pay semantics;
6. deduplication;
7. secret handling;

before adding visual polish or secondary features.
