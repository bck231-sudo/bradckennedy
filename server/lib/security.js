import {
  createCipheriv,
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from "node:crypto";

const PASSWORD_ALGO = "pbkdf2_sha256";
const PASSWORD_ITERATIONS = 210000;
const PASSWORD_KEYLEN = 32;
const PASSWORD_DIGEST = "sha256";

function toBase64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + "=".repeat(padLength), "base64");
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function passwordMeetsMinimum(password) {
  return typeof password === "string" && password.length >= 8;
}

export function hashPassword(password) {
  if (!passwordMeetsMinimum(password)) {
    throw new Error("Password must be at least 8 characters.");
  }
  const salt = randomBytes(16).toString("hex");
  const digest = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEYLEN, PASSWORD_DIGEST).toString("hex");
  return `${PASSWORD_ALGO}$${PASSWORD_ITERATIONS}$${salt}$${digest}`;
}

export function verifyPassword(password, storedHash) {
  try {
    const [algo, iterationString, salt, digestHex] = String(storedHash || "").split("$");
    if (algo !== PASSWORD_ALGO || !salt || !digestHex) return false;
    const iterations = Number(iterationString);
    if (!Number.isFinite(iterations) || iterations < 1000) return false;
    const expected = Buffer.from(digestHex, "hex");
    const actual = pbkdf2Sync(String(password || ""), salt, iterations, expected.length, PASSWORD_DIGEST);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch (_error) {
    return false;
  }
}

export function createOpaqueToken(size = 32) {
  return toBase64Url(randomBytes(size));
}

export function hashOpaqueToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function deriveStateKey(passphrase, accountId) {
  return scryptSync(String(passphrase), `medication-tracker:${accountId}`, 32);
}

export function encryptJsonForAccount(jsonValue, passphrase, accountId) {
  if (!passphrase) {
    return {
      state: jsonValue,
      stateCipher: null,
      stateEncoding: "plain"
    };
  }

  const iv = randomBytes(12);
  const key = deriveStateKey(passphrase, accountId);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`account:${accountId}`, "utf8"));

  const plaintext = Buffer.from(JSON.stringify(jsonValue), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    state: null,
    stateEncoding: "aes-256-gcm",
    stateCipher: {
      v: 1,
      alg: "aes-256-gcm",
      iv: toBase64Url(iv),
      tag: toBase64Url(tag),
      data: toBase64Url(encrypted)
    }
  };
}

export function decryptJsonForAccount(account, passphrase, accountId) {
  if (account?.stateCipher) {
    if (!passphrase) {
      throw new Error("Server encryption key is not configured.");
    }

    const payload = account.stateCipher;
    if (payload.v !== 1 || payload.alg !== "aes-256-gcm") {
      throw new Error("Unsupported encrypted state format.");
    }

    const key = deriveStateKey(passphrase, accountId);
    const decipher = createDecipheriv("aes-256-gcm", key, fromBase64Url(payload.iv));
    decipher.setAAD(Buffer.from(`account:${accountId}`, "utf8"));
    decipher.setAuthTag(fromBase64Url(payload.tag));

    const decrypted = Buffer.concat([
      decipher.update(fromBase64Url(payload.data)),
      decipher.final()
    ]);

    return JSON.parse(decrypted.toString("utf8"));
  }

  if (account?.state && typeof account.state === "object") {
    return account.state;
  }

  return null;
}

export function sanitizeUser(user) {
  if (!user || typeof user !== "object") return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || ""
  };
}

export function roleAllowsWrite(role) {
  return String(role || "").toLowerCase() === "owner";
}

export function normalizeRole(role) {
  const normalized = String(role || "viewer").trim().toLowerCase();
  if (["owner", "viewer", "family", "clinician"].includes(normalized)) {
    return normalized;
  }
  return "viewer";
}

export function roleAllowsAuditRead(role) {
  const normalized = normalizeRole(role);
  return normalized === "owner" || normalized === "clinician";
}

export function roleLabel(role) {
  const normalized = normalizeRole(role);
  if (normalized === "owner") return "Owner";
  if (normalized === "family") return "Family";
  if (normalized === "clinician") return "Clinician";
  return "Viewer";
}
