const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey() {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
        console.warn('⚠️ ENCRYPTION_KEY não configurada. Dados sensíveis não serão encriptados.');
        return null;
    }
    // Aceita key em hex (64 chars) ou usa SHA-256 para derivar 32 bytes
    if (key.length === 64 && /^[0-9a-f]+$/i.test(key)) {
        return Buffer.from(key, 'hex');
    }
    return crypto.createHash('sha256').update(key).digest();
}

/**
 * Encripta um texto usando AES-256-GCM
 * Retorna: iv:authTag:ciphertext (tudo em hex)
 */
function encrypt(plaintext) {
    if (!plaintext) return null;

    const key = getEncryptionKey();
    if (!key) return plaintext; // Sem chave, retorna sem encriptar

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decripta um texto encriptado com encrypt()
 */
function decrypt(encryptedText) {
    if (!encryptedText) return null;

    const key = getEncryptionKey();
    if (!key) return encryptedText;

    // Se não está no formato encriptado (iv:authTag:ciphertext), retorna como está
    const parts = encryptedText.split(':');
    if (parts.length !== 3) return encryptedText;

    const [ivHex, authTagHex, ciphertext] = parts;

    try {
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (err) {
        // Se falhar na decriptação, pode ser um valor antigo não encriptado
        console.warn('⚠️ Falha ao decriptar. Retornando valor original.');
        return encryptedText;
    }
}

module.exports = { encrypt, decrypt };
