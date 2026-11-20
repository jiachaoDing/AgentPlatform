import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Coordinates include the owner, service, binding, purpose and generation.
export function createCredentialVault(keyBytes: Uint8Array) {
  if (keyBytes.byteLength !== 32)
    throw new Error("OAuth 加密主密钥必须为 32 字节");
  const key = Buffer.from(keyBytes);
  const algorithm = "aes-256-gcm";
  return {
    seal(value: string, coordinates: string[]) {
      const iv = randomBytes(12);
      const cipher = createCipheriv(algorithm, key, iv, { authTagLength: 16 });
      cipher.setAAD(Buffer.from(JSON.stringify(coordinates)));
      const encrypted = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
        "base64url",
      );
    },
    open(value: string, coordinates: string[]) {
      try {
        const payload = Buffer.from(value, "base64url");
        if (payload.length < 28) throw new Error("Ciphertext too short");
        const decipher = createDecipheriv(
          algorithm,
          key,
          payload.subarray(0, 12),
          { authTagLength: 16 },
        );
        decipher.setAAD(Buffer.from(JSON.stringify(coordinates)));
        decipher.setAuthTag(payload.subarray(12, 28));
        return Buffer.concat([
          decipher.update(payload.subarray(28)),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        throw new Error("无法读取 OAuth 凭证，请重新授权");
      }
    },
  };
}
