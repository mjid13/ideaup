import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DomainError } from "@/lib/projects/errors";

export type ProjectEncryptionMode = "off" | "prepare" | "required" | "read-only";

export interface EncryptedProjectEnvelope {
  _ideaup_encrypted: true;
  version: 1;
  algorithm: "A256GCM";
  keyId: string;
  nonce: string;
  ciphertext: string;
  tag: string;
}

interface EncryptionConfig {
  mode: ProjectEncryptionMode;
  activeKeyId?: string;
  keys: Map<string, Buffer>;
}

const KEY_ID = /^[A-Za-z0-9._-]{1,100}$/;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

type EncryptionFailureReason = "invalid_configuration" | "invalid_envelope"
  | "missing_decryption_key" | "invalid_encoding" | "decryption_failed" | "invalid_plaintext";

function unavailable(reason: EncryptionFailureReason = "invalid_configuration"): DomainError {
  return new DomainError("INTERNAL_ERROR", "Project data is temporarily unavailable.", { encryptionReason: reason });
}

function decodeKey(value: unknown): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw unavailable();
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32) throw unavailable();
  return decoded;
}

export function projectEncryptionConfig(env: NodeJS.ProcessEnv = process.env): EncryptionConfig {
  const configuredMode = env.PROJECT_ENCRYPTION_MODE;
  const defaultMode = env.NODE_ENV === "production" ? undefined : "off";
  const mode = configuredMode ?? defaultMode;
  if (!mode || !["off", "prepare", "required", "read-only"].includes(mode)) throw unavailable();
  const validatedMode = mode as ProjectEncryptionMode;
  if (env.NODE_ENV === "production" && validatedMode === "off") throw unavailable();
  if (validatedMode === "off") return { mode: validatedMode, keys: new Map() };

  let source: unknown;
  try {
    source = JSON.parse(env.PROJECT_ENCRYPTION_KEYS ?? "");
  } catch {
    throw unavailable();
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) throw unavailable();

  const keys = new Map<string, Buffer>();
  for (const [keyId, encoded] of Object.entries(source)) {
    if (!KEY_ID.test(keyId)) throw unavailable();
    keys.set(keyId, decodeKey(encoded));
  }
  const activeKeyId = env.PROJECT_ENCRYPTION_ACTIVE_KEY_ID;
  if (!activeKeyId || !keys.has(activeKeyId)) throw unavailable();
  return { mode: validatedMode, activeKeyId, keys };
}

function aad(projectId: string): Buffer {
  return Buffer.from(`ideaup:project:v1:${projectId}`, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isEncryptedProjectData(value: unknown): value is EncryptedProjectEnvelope {
  return isRecord(value) && value._ideaup_encrypted === true;
}

function parseEnvelope(value: unknown): EncryptedProjectEnvelope {
  if (!isRecord(value)
    || value._ideaup_encrypted !== true
    || value.version !== 1
    || value.algorithm !== "A256GCM"
    || typeof value.keyId !== "string"
    || !KEY_ID.test(value.keyId)
    || typeof value.nonce !== "string"
    || typeof value.ciphertext !== "string"
    || typeof value.tag !== "string") throw unavailable("invalid_envelope");
  return value as unknown as EncryptedProjectEnvelope;
}

function decodeBase64Url(value: string, expectedBytes?: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw unavailable("invalid_encoding");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value
    || (expectedBytes !== undefined && decoded.length !== expectedBytes)
    || decoded.length === 0) throw unavailable("invalid_encoding");
  return decoded;
}

function encrypt(projectId: string, value: unknown, config: EncryptionConfig): EncryptedProjectEnvelope {
  const keyId = config.activeKeyId;
  const key = keyId ? config.keys.get(keyId) : undefined;
  if (!keyId || !key) throw unavailable();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(projectId));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    _ideaup_encrypted: true,
    version: 1,
    algorithm: "A256GCM",
    keyId,
    nonce: nonce.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
}

export function encodeProjectData(projectId: string, value: unknown): unknown {
  const config = projectEncryptionConfig();
  assertProjectWritesAllowed(config);
  return config.mode === "required" ? encrypt(projectId, value, config) : value;
}

export function assertProjectWritesAllowed(config = projectEncryptionConfig()): void {
  if (config.mode === "read-only") {
    throw new DomainError("INTERNAL_ERROR", "Project changes are temporarily unavailable.");
  }
}

export function decodeProjectData(projectId: string, value: unknown): unknown {
  if (!isEncryptedProjectData(value)) return value;
  const envelope = parseEnvelope(value);
  const config = projectEncryptionConfig();
  const key = config.keys.get(envelope.keyId);
  if (!key) throw unavailable("missing_decryption_key");
  let plaintext: string;
  try {
    const nonce = decodeBase64Url(envelope.nonce, NONCE_BYTES);
    const tag = decodeBase64Url(envelope.tag, TAG_BYTES);
    const ciphertext = decodeBase64Url(envelope.ciphertext);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(projectId));
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw unavailable("decryption_failed");
  }
  try {
    return JSON.parse(plaintext) as unknown;
  } catch {
    throw unavailable("invalid_plaintext");
  }
}

export function assertProjectEncryptionReady(): void {
  projectEncryptionConfig();
}
