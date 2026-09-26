"use client";

import { Identity } from "@semaphore-protocol/identity";
import { exportSpki, generateSessionKey, signPayload, type Action, type Receipt } from "@townsquare/core";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

// Everything that identifies you lives only in this browser's IndexedDB.
// One Semaphore identity per conversation; the session key is non-extractable.

interface Session {
  pid: string;
  keyVersion: number;
  privateKey: CryptoKey;
  spki: string;
  nonce: number;
}

interface VaultDB extends DBSchema {
  identities: { key: string; value: { slug: string; secret: string; registered: boolean; memberIndex?: number; txHash?: string | null } };
  sessions: { key: string; value: Session & { slug: string } };
  receipts: { key: string; value: Receipt & { slug: string; kind: string; label: string } ; indexes: { bySlug: string } };
}

let dbp: Promise<IDBPDatabase<VaultDB>> | null = null;
function db() {
  dbp ??= openDB<VaultDB>("townsquare", 1, {
    upgrade(d) {
      d.createObjectStore("identities", { keyPath: "slug" });
      d.createObjectStore("sessions", { keyPath: "slug" });
      d.createObjectStore("receipts", { keyPath: "eventHash" }).createIndex("bySlug", "slug");
    },
  });
  return dbp;
}

export async function identityFor(slug: string): Promise<{ identity: Identity; registered: boolean; memberIndex?: number; txHash?: string | null }> {
  const d = await db();
  const row = await d.get("identities", slug);
  if (row) return { identity: Identity.import(row.secret), registered: row.registered, memberIndex: row.memberIndex, txHash: row.txHash };
  const identity = new Identity();
  await d.put("identities", { slug, secret: identity.export(), registered: false });
  return { identity, registered: false };
}

export async function markRegistered(slug: string, memberIndex: number, txHash: string | null) {
  const d = await db();
  const row = await d.get("identities", slug);
  if (row) await d.put("identities", { ...row, registered: true, memberIndex, txHash });
}

export async function backupFile(slug: string): Promise<Blob> {
  const row = await (await db()).get("identities", slug);
  if (!row) throw new Error("no identity for this conversation");
  const data = { townsquare: 1, slug, identity: row.secret, registered: row.registered };
  return new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
}

export async function restoreFile(slug: string, file: File) {
  const data = JSON.parse(await file.text());
  if (data.townsquare !== 1 || data.slug !== slug || typeof data.identity !== "string") throw new Error("not a backup for this conversation");
  Identity.import(data.identity); // throws if malformed
  const d = await db();
  await d.put("identities", { slug, secret: data.identity, registered: !!data.registered });
  await d.delete("sessions", slug);
}

export async function newSessionKey() {
  const kp = await generateSessionKey(false);
  return { privateKey: kp.privateKey, spki: await exportSpki(kp.publicKey) };
}

export async function saveSession(slug: string, s: Session) {
  await (await db()).put("sessions", { ...s, slug });
}

export async function getSession(slug: string) {
  return (await db()).get("sessions", slug);
}

export async function clearSession(slug: string) {
  await (await db()).delete("sessions", slug);
}

// Signs with the stored key and bumps the nonce first, so a retry never reuses one.
export async function signAction(slug: string, build: (base: { v: 1; conv: string; pid: string; keyVersion: number; nonce: number }) => Action) {
  const d = await db();
  const s = await d.get("sessions", slug);
  if (!s) throw new Error("not joined");
  const nonce = s.nonce + 1;
  await d.put("sessions", { ...s, nonce });
  const action = build({ v: 1, conv: slug, pid: s.pid, keyVersion: s.keyVersion, nonce });
  return { action, sig: await signPayload(s.privateKey, action) };
}

export async function saveReceipt(slug: string, r: Receipt, kind: string, label: string) {
  await (await db()).put("receipts", { ...r, slug, kind, label });
}

export async function listReceipts(slug: string) {
  return (await db()).getAllFromIndex("receipts", "bySlug", slug);
}
