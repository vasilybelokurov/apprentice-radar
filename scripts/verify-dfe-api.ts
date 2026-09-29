// Checks that the DfE Display Advert API v2 key works, without ever printing it.
//
// Usage (key loaded from the macOS Keychain only for this command):
//   DFE_API_KEY="$(security find-generic-password -s apprentice-radar-dfe-key -w)" \
//     node scripts/verify-dfe-api.ts
//
// Prints: HTTP status, vacancy totals, and the field names of one vacancy (no values).

const BASE_URL = "https://api.apprenticeships.education.gov.uk/vacancies";

const key = process.env.DFE_API_KEY?.trim();
if (!key) {
  console.error("DFE_API_KEY is not set.");
  process.exit(2);
}

// Remove the key from any text before it is printed.
const redact = (text: string) => text.split(key).join("<redacted>");

try {
  const url = `${BASE_URL}/vacancy?PageNumber=1&PageSize=1&Sort=AgeDesc`;
  const response = await fetch(url, {
    headers: { "X-Version": "2", "Ocp-Apim-Subscription-Key": key },
    signal: AbortSignal.timeout(20_000),
  });
  console.log(`HTTP ${response.status} ${response.statusText}`);

  const body = await response.text();
  if (!response.ok) {
    console.log(redact(body.slice(0, 300)));
    process.exit(1);
  }

  const data = JSON.parse(body) as Record<string, unknown>;
  const { vacancies, ...meta } = data;
  console.log("metadata:", JSON.stringify(meta));
  const first = Array.isArray(vacancies) ? vacancies[0] : undefined;
  if (first && typeof first === "object") {
    console.log("vacancy fields:", Object.keys(first).sort().join(", "));
  }
} catch (error) {
  console.error("request failed:", redact(String(error)));
  process.exit(1);
}
