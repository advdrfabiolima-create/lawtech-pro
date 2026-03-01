// Configurar variável de ambiente antes de importar o módulo
process.env.ENCRYPTION_KEY = 'a'.repeat(64); // 64 hex chars = 32 bytes

const { encrypt, decrypt } = require('../utils/crypto');

describe('encrypt/decrypt', () => {
    test('encripta e decripta corretamente', () => {
        const original = 'texto secreto 123';
        const encrypted = encrypt(original);
        expect(encrypted).not.toBe(original);
        expect(encrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
        const decrypted = decrypt(encrypted);
        expect(decrypted).toBe(original);
    });

    test('cada encriptação gera IV diferente (não-determinístico)', () => {
        const plain = 'mesmo texto';
        const enc1 = encrypt(plain);
        const enc2 = encrypt(plain);
        expect(enc1).not.toBe(enc2);
        expect(decrypt(enc1)).toBe(plain);
        expect(decrypt(enc2)).toBe(plain);
    });

    test('retorna null para input null', () => {
        expect(encrypt(null)).toBeNull();
        expect(decrypt(null)).toBeNull();
    });

    test('retorna valor original para texto não-encriptado no decrypt', () => {
        const plainText = 'não encriptado';
        const result = decrypt(plainText);
        expect(result).toBe(plainText);
    });

    test('encripta strings com caracteres especiais', () => {
        const special = 'São Paulo — Ação Jurídica & <test> "quotes"';
        expect(decrypt(encrypt(special))).toBe(special);
    });

    test('encripta strings longas', () => {
        const long = 'a'.repeat(1000);
        expect(decrypt(encrypt(long))).toBe(long);
    });

    test('formato do texto encriptado tem 3 partes separadas por ":"', () => {
        const enc = encrypt('test');
        const parts = enc.split(':');
        expect(parts).toHaveLength(3);
        expect(parts[0]).toHaveLength(32); // IV hex = 16 bytes
        expect(parts[1]).toHaveLength(32); // authTag hex = 16 bytes
    });
});
