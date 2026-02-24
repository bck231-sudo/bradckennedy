import test from "node:test";
import assert from "node:assert/strict";

import {
  createOpaqueToken,
  decryptJsonForAccount,
  encryptJsonForAccount,
  hashOpaqueToken,
  hashPassword,
  normalizeRole,
  verifyPassword
} from "../server/lib/security.js";
import { ensureAccount, normalizeStore } from "../server/lib/store-model.js";

test("password hashing verifies valid password and rejects invalid", () => {
  const hash = hashPassword("super-secure-password");
  assert.equal(verifyPassword("super-secure-password", hash), true);
  assert.equal(verifyPassword("wrong-password", hash), false);
});

test("opaque token hash is stable for same token", () => {
  const token = createOpaqueToken();
  assert.equal(hashOpaqueToken(token), hashOpaqueToken(token));
});

test("account encryption roundtrip decrypts to original object", () => {
  const accountId = "acct-test";
  const state = { version: 3, medications: [{ id: "m1", name: "Test" }] };
  const encrypted = encryptJsonForAccount(state, "encryption-key", accountId);
  assert.equal(encrypted.state, null);
  assert.ok(encrypted.stateCipher?.data);

  const account = {
    id: accountId,
    state: encrypted.state,
    stateCipher: encrypted.stateCipher
  };

  const decrypted = decryptJsonForAccount(account, "encryption-key", accountId);
  assert.deepEqual(decrypted, state);
});

test("legacy plain account state remains readable", () => {
  const state = { version: 3, notes: [{ id: "n1" }] };
  const account = { id: "plain", state };
  assert.deepEqual(decryptJsonForAccount(account, "", "plain"), state);
});

test("store normalization preserves legacy accounts and creates defaults", () => {
  const store = normalizeStore({ accounts: { default: { state: { version: 2 }, updatedAt: "2026-01-01T00:00:00.000Z" } } });
  const account = ensureAccount(store, "default");
  assert.deepEqual(account.state, { version: 2 });
  assert.equal(Array.isArray(account.audit), true);
  assert.equal(Array.isArray(account.notifications), true);
});

test("normalizeRole constrains unexpected values", () => {
  assert.equal(normalizeRole("owner"), "owner");
  assert.equal(normalizeRole("clinician"), "clinician");
  assert.equal(normalizeRole("other"), "viewer");
});
