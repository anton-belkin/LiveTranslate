import crypto from "node:crypto";

export type KeysFileV1 = {
  version: 1;
  kdf: "scrypt";
  keyHint: "embedded_app_version";
  appVersion: string;
  saltB64: string;
  ivB64: string;
  tagB64: string;
  ciphertextB64: string;
};

export type PlainKeys = {
  azureSpeechKey: string;
  azureSpeechRegion: string;
  azureSpeechEndpoint?: string;
  groqApiKey: string;
};

function b64(buf: Buffer) {
  return buf.toString("base64");
}

function fromB64(s: string) {
  return Buffer.from(s, "base64");
}

function deriveKey(passphrase: string, salt: Buffer) {
  return crypto.scryptSync(passphrase, salt, 32);
}

export function encryptKeysFileV1(args: {
  passphrase: string;
  appVersion: string;
  keys: PlainKeys;
}): KeysFileV1 {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(args.passphrase, salt);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(args.keys), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    kdf: "scrypt",
    keyHint: "embedded_app_version",
    appVersion: args.appVersion,
    saltB64: b64(salt),
    ivB64: b64(iv),
    tagB64: b64(tag),
    ciphertextB64: b64(ciphertext)
  };
}

export function decryptKeysFileV1(args: { passphrase: string; file: KeysFileV1 }): PlainKeys {
  const salt = fromB64(args.file.saltB64);
  const iv = fromB64(args.file.ivB64);
  const tag = fromB64(args.file.tagB64);
  const ciphertext = fromB64(args.file.ciphertextB64);
  const key = deriveKey(args.passphrase, salt);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");

  const parsed = JSON.parse(plaintext) as Partial<PlainKeys>;
  const azureSpeechKey = String(parsed.azureSpeechKey ?? "").trim();
  const azureSpeechRegion = String(parsed.azureSpeechRegion ?? "").trim();
  const azureSpeechEndpoint = String(parsed.azureSpeechEndpoint ?? "").trim();
  const groqApiKey = String(parsed.groqApiKey ?? "").trim();

  if (!azureSpeechKey) throw new Error("Invalid keys file: missing Azure Speech key.");
  if (!azureSpeechRegion) throw new Error("Invalid keys file: missing Azure Speech region.");
  if (!groqApiKey) throw new Error("Invalid keys file: missing Groq API key.");

  return {
    azureSpeechKey,
    azureSpeechRegion,
    azureSpeechEndpoint: azureSpeechEndpoint || undefined,
    groqApiKey
  };
}

