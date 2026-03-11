import { randomUUID } from "node:crypto";
import { hashOpaqueToken } from "./security.js";

export function nowIso() {
  return new Date().toISOString();
}

function normalizeObject(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeMember(input) {
  if (!input || typeof input !== "object") return null;
  if (!input.userId) return null;
  return {
    userId: String(input.userId),
    email: String(input.email || "").toLowerCase(),
    name: String(input.name || ""),
    role: String(input.role || "viewer").toLowerCase(),
    status: String(input.status || "active"),
    invitedBy: String(input.invitedBy || ""),
    createdAt: String(input.createdAt || nowIso()),
    updatedAt: String(input.updatedAt || input.createdAt || nowIso()),
    lastSeenAt: String(input.lastSeenAt || "")
  };
}

function normalizeInvite(input) {
  if (!input || typeof input !== "object") return null;
  if (!input.id || !input.tokenHash) return null;
  return {
    id: String(input.id),
    tokenHash: String(input.tokenHash),
    email: String(input.email || "").toLowerCase(),
    name: String(input.name || ""),
    role: String(input.role || "viewer").toLowerCase(),
    createdBy: String(input.createdBy || ""),
    createdAt: String(input.createdAt || nowIso()),
    expiresAt: String(input.expiresAt || ""),
    acceptedAt: String(input.acceptedAt || ""),
    acceptedByUserId: String(input.acceptedByUserId || ""),
    revokedAt: String(input.revokedAt || "")
  };
}

function normalizeAuditEntry(input) {
  if (!input || typeof input !== "object") return null;
  return {
    id: String(input.id || randomUUID()),
    at: String(input.at || nowIso()),
    action: String(input.action || "event"),
    actorUserId: String(input.actorUserId || ""),
    actorRole: String(input.actorRole || ""),
    metadata: normalizeObject(input.metadata)
  };
}

function normalizeNotification(input) {
  if (!input || typeof input !== "object") return null;
  return {
    id: String(input.id || randomUUID()),
    type: String(input.type || "info"),
    level: String(input.level || "low"),
    message: String(input.message || ""),
    createdAt: String(input.createdAt || nowIso()),
    metadata: normalizeObject(input.metadata)
  };
}

function normalizeShare(input) {
  if (!input || typeof input !== "object") return null;
  const tokenHash = String(input.tokenHash || "").trim()
    || (input.token ? hashOpaqueToken(String(input.token)) : "");
  if (!input.id || !tokenHash) return null;
  return {
    id: String(input.id),
    tokenHash,
    name: String(input.name || "Shared viewer"),
    email: String(input.email || "").toLowerCase(),
    role: String(input.role || "viewer").toLowerCase(),
    preset: String(input.preset || "full"),
    permissions: normalizeObject(input.permissions),
    allowedModes: normalizeArray(input.allowedModes).map((value) => String(value || "")).filter(Boolean),
    startSection: String(input.startSection || "dashboard"),
    createdByUserId: String(input.createdByUserId || ""),
    createdAt: String(input.createdAt || nowIso()),
    expiresAt: String(input.expiresAt || ""),
    revokedAt: String(input.revokedAt || ""),
    lastOpenedAt: String(input.lastOpenedAt || ""),
    opens: Number(input.opens || 0)
  };
}

function normalizePasswordReset(input) {
  if (!input || typeof input !== "object") return null;
  if (!input.id || !input.tokenHash || !input.userId) return null;
  return {
    id: String(input.id),
    tokenHash: String(input.tokenHash),
    userId: String(input.userId),
    email: String(input.email || "").toLowerCase(),
    createdAt: String(input.createdAt || nowIso()),
    expiresAt: String(input.expiresAt || ""),
    consumedAt: String(input.consumedAt || ""),
    accountId: String(input.accountId || ""),
    requestedFromIp: String(input.requestedFromIp || "")
  };
}

export function createEmptyStore() {
  return {
    version: 2,
    users: {},
    sessions: {},
    accounts: {},
    passwordResets: {}
  };
}

export function normalizeStore(raw) {
  const source = normalizeObject(raw);
  const store = createEmptyStore();
  store.version = Number(source.version || 2);

  const users = normalizeObject(source.users);
  for (const [userId, user] of Object.entries(users)) {
    if (!user || typeof user !== "object") continue;
    const email = String(user.email || "").toLowerCase();
    if (!email) continue;
    store.users[userId] = {
      id: String(user.id || userId),
      email,
      name: String(user.name || ""),
      passwordHash: String(user.passwordHash || ""),
      createdAt: String(user.createdAt || nowIso()),
      updatedAt: String(user.updatedAt || user.createdAt || nowIso()),
      lastLoginAt: String(user.lastLoginAt || "")
    };
  }

  const sessions = normalizeObject(source.sessions);
  for (const [tokenHash, session] of Object.entries(sessions)) {
    if (!session || typeof session !== "object") continue;
    if (!session.userId || !session.accountId) continue;
    store.sessions[tokenHash] = {
      id: String(session.id || randomUUID()),
      tokenHash: String(tokenHash),
      userId: String(session.userId),
      accountId: String(session.accountId),
      role: String(session.role || "viewer").toLowerCase(),
      createdAt: String(session.createdAt || nowIso()),
      expiresAt: String(session.expiresAt || ""),
      lastSeenAt: String(session.lastSeenAt || ""),
      revokedAt: String(session.revokedAt || "")
    };
  }

  const accounts = normalizeObject(source.accounts);
  for (const [accountId, account] of Object.entries(accounts)) {
    const normalizedAccount = {
      id: String(account?.id || accountId),
      state: account?.state && typeof account.state === "object" ? account.state : null,
      stateCipher: account?.stateCipher && typeof account.stateCipher === "object" ? account.stateCipher : null,
      stateEncoding: String(account?.stateEncoding || (account?.stateCipher ? "aes-256-gcm" : "plain")),
      updatedAt: String(account?.updatedAt || ""),
      shareAccess: normalizeObject(account?.shareAccess),
      members: {},
      invites: {},
      shares: {},
      notifications: [],
      audit: []
    };

    const members = normalizeObject(account?.members);
    for (const [memberId, member] of Object.entries(members)) {
      const normalizedMember = normalizeMember({ ...member, userId: member?.userId || memberId });
      if (!normalizedMember) continue;
      normalizedAccount.members[normalizedMember.userId] = normalizedMember;
    }

    const invites = normalizeObject(account?.invites);
    for (const [inviteId, invite] of Object.entries(invites)) {
      const normalizedInvite = normalizeInvite({ ...invite, id: invite?.id || inviteId });
      if (!normalizedInvite) continue;
      normalizedAccount.invites[normalizedInvite.id] = normalizedInvite;
    }

    const shares = normalizeObject(account?.shares);
    for (const [shareId, share] of Object.entries(shares)) {
      const normalizedShare = normalizeShare({ ...share, id: share?.id || shareId });
      if (!normalizedShare) continue;
      normalizedAccount.shares[normalizedShare.id] = normalizedShare;
    }

    for (const notification of normalizeArray(account?.notifications)) {
      const normalizedNotification = normalizeNotification(notification);
      if (normalizedNotification) normalizedAccount.notifications.push(normalizedNotification);
    }

    for (const auditEntry of normalizeArray(account?.audit)) {
      const normalizedAudit = normalizeAuditEntry(auditEntry);
      if (normalizedAudit) normalizedAccount.audit.push(normalizedAudit);
    }

    store.accounts[accountId] = normalizedAccount;
  }

  const passwordResets = normalizeObject(source.passwordResets);
  for (const [resetId, reset] of Object.entries(passwordResets)) {
    const normalizedReset = normalizePasswordReset({ ...reset, id: reset?.id || resetId });
    if (!normalizedReset) continue;
    store.passwordResets[normalizedReset.id] = normalizedReset;
  }

  return store;
}

export function ensureAccount(store, accountId) {
  const key = String(accountId || "default").trim() || "default";
  if (!store.accounts[key]) {
    store.accounts[key] = {
      id: key,
      state: null,
      stateCipher: null,
      stateEncoding: "plain",
      updatedAt: "",
      shareAccess: {},
      members: {},
      invites: {},
      shares: {},
      notifications: [],
      audit: []
    };
  }
  return store.accounts[key];
}

export function addAuditEvent(account, event) {
  const now = nowIso();
  const entry = normalizeAuditEntry({
    id: randomUUID(),
    at: now,
    action: event?.action || "event",
    actorUserId: event?.actorUserId || "",
    actorRole: event?.actorRole || "",
    metadata: event?.metadata || {}
  });
  account.audit = [...normalizeArray(account.audit), entry].slice(-1200);
  return entry;
}

export function addNotification(account, input) {
  const notification = normalizeNotification({
    id: randomUUID(),
    type: input?.type || "info",
    level: input?.level || "low",
    message: input?.message || "",
    createdAt: nowIso(),
    metadata: input?.metadata || {}
  });
  account.notifications = [...normalizeArray(account.notifications), notification].slice(-500);
  return notification;
}

export function listMembers(account) {
  return Object.values(normalizeObject(account?.members));
}

export function listInvites(account) {
  return Object.values(normalizeObject(account?.invites));
}

export function listShares(account) {
  return Object.values(normalizeObject(account?.shares));
}

export function accountHasMembers(account) {
  return listMembers(account).length > 0;
}

export function findUserByEmail(store, email) {
  const target = String(email || "").trim().toLowerCase();
  if (!target) return null;
  return Object.values(store.users).find((user) => String(user.email || "").toLowerCase() === target) || null;
}

export function memberForUser(account, userId) {
  return normalizeObject(account?.members)[String(userId || "")] || null;
}

export function findPasswordResetByHash(store, tokenHash) {
  const resets = normalizeObject(store?.passwordResets);
  return Object.values(resets).find((entry) => entry?.tokenHash === tokenHash) || null;
}
