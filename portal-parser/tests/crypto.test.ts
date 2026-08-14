import assert from "node:assert/strict";
import test from "node:test";
import { decryptCredential, encryptCredential } from "../../backend/crypto";

test("credential encryption accepts a 32-byte Base64 key", async () => {
  const previous = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.from(Array.from({ length: 32 }, (_, index) => index)).toString("base64");
  try {
    const ciphertext = await encryptCredential("confirmed-password");
    assert.notEqual(ciphertext, "confirmed-password");
    assert.equal(await decryptCredential(ciphertext), "confirmed-password");
  } finally {
    if (previous === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = previous;
  }
});

test("credential encryption continues to accept a 32-byte hex key", async () => {
  const previous = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY = "11".repeat(32);
  try {
    const ciphertext = await encryptCredential("another-password");
    assert.equal(await decryptCredential(ciphertext), "another-password");
  } finally {
    if (previous === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = previous;
  }
});
