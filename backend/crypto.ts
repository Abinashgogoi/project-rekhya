const encoder = new TextEncoder();
const decoder = new TextDecoder();

function credentialKeyBytes(value: string) {
  if (/^[0-9a-f]{64}$/i.test(value)) {
    return new Uint8Array(value.match(/.{2}/g)!.map((part) => Number.parseInt(part, 16)));
  }
  try {
    const decoded = base64ToBytes(value);
    if (decoded.byteLength === 32) return decoded;
  } catch {
    // The shared error below intentionally avoids exposing any secret details.
  }
  throw new Error("Credential encryption key is not configured correctly.");
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function credentialKey() {
  const secret = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!secret) throw new Error("Credential encryption is unavailable.");
  return crypto.subtle.importKey("raw", credentialKeyBytes(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptCredential(plaintext: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await credentialKey(), encoder.encode(plaintext));
  return `v1:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptCredential(ciphertext: string) {
  const [version, iv, encrypted] = ciphertext.split(":");
  if (version !== "v1" || !iv || !encrypted) throw new Error("Unsupported credential cipher version.");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, await credentialKey(), base64ToBytes(encrypted));
  return decoder.decode(plaintext);
}
