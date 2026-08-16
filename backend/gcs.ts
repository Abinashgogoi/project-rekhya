type ServiceAccountJson = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type CachedToken = { token: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

function base64Url(input: string | Uint8Array) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToPkcs8(pem: string) {
  const normalized = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function serviceAccount(): ServiceAccountJson {
  const raw = process.env.GCS_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GCS_SERVICE_ACCOUNT_JSON is not configured on the server.");
  const parsed = JSON.parse(raw) as Partial<ServiceAccountJson>;
  if (!parsed.client_email || !parsed.private_key) throw new Error("Google Cloud service-account secret is incomplete.");
  return parsed as ServiceAccountJson;
}

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 90 > now) return cachedToken.token;

  const account = serviceAccount();
  const tokenUri = account.token_uri || "https://oauth2.googleapis.com/token";
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/devstorage.full_control",
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  ));
  const assertion = `${unsigned}.${base64Url(signature)}`;

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`Google Cloud token exchange failed (${response.status}).`);
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("Google Cloud token exchange returned no access token.");
  cachedToken = { token: body.access_token, expiresAt: now + Number(body.expires_in || 3600) };
  return body.access_token;
}

function objectUrl(bucket: string, objectKey: string, media: boolean) {
  const base = media ? "https://storage.googleapis.com/download/storage/v1" : "https://storage.googleapis.com/storage/v1";
  return `${base}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectKey)}${media ? "?alt=media" : ""}`;
}

export async function fetchGcsObject(bucket: string, objectKey: string) {
  const token = await accessToken();
  const response = await fetch(objectUrl(bucket, objectKey, true), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Google Cloud evidence read failed (${response.status}).`);
  return response;
}

export async function deleteGcsObject(bucket: string, objectKey: string) {
  const token = await accessToken();
  const response = await fetch(objectUrl(bucket, objectKey, false), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Google Cloud evidence delete failed (${response.status}).`);
  }
}
