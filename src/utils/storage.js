/**
 * storage.js — Abstração unificada de armazenamento de arquivos.
 *
 * Ativo em modo R2 se todas as 4 vars estiverem presentes:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 *
 * Caso contrário, usa fallback automático para disco local (uploads/).
 *
 * API pública:
 *   storage.upload(buffer, key, mimetype)  → Promise<void>
 *   storage.download(key, res, opts)       → Promise<true|null>  (null = não encontrado)
 *   storage.getBuffer(key)                 → Promise<Buffer|null>
 *   storage.delete(key)                    → Promise<void>
 *   storage.isR2Active()                   → Boolean
 *
 * Migração gradual (zero downtime):
 *   - Novos uploads vão para R2 (ou disco).
 *   - Downloads tentam R2 primeiro; se o objeto não existe (404), caem para disco.
 *   - Arquivos antigos continuam acessíveis enquanto ainda estiverem no disco.
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ── Detectar se R2 está configurado ──────────────────────────────────────────
const R2_VARS    = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];
const r2Active   = R2_VARS.every(v => process.env[v]);

let s3Client             = null;
let bucketName           = null;
let GetObjectCommand     = null;
let PutObjectCommand     = null;
let DeleteObjectCommand  = null;
let HeadObjectCommand    = null;
let getSignedUrl         = null;

if (r2Active) {
    const sdk = require('@aws-sdk/client-s3');
    const presigner = require('@aws-sdk/s3-request-presigner');

    GetObjectCommand    = sdk.GetObjectCommand;
    PutObjectCommand    = sdk.PutObjectCommand;
    DeleteObjectCommand = sdk.DeleteObjectCommand;
    HeadObjectCommand   = sdk.HeadObjectCommand;
    getSignedUrl        = presigner.getSignedUrl;
    bucketName          = process.env.R2_BUCKET_NAME;

    s3Client = new sdk.S3Client({
        region: 'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId:     process.env.R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
        }
    });

    console.log(`[storage] Modo R2 ativo — bucket: ${bucketName}`);
} else {
    console.log('[storage] Modo disco local (R2 não configurado)');
}

// ── Caminho local de fallback ─────────────────────────────────────────────────
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');

function localPath(key) {
    return path.join(UPLOAD_ROOT, key);
}

// ── Helper: verificar se erro S3 é "não encontrado" ──────────────────────────
function isNotFound(err) {
    return (
        err.$metadata?.httpStatusCode === 404 ||
        err.name === 'NotFound' ||
        err.name === 'NoSuchKey' ||
        err.Code === 'NoSuchKey'
    );
}

// ── Helper: coletar stream em Buffer ─────────────────────────────────────────
async function streamToBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

// ── Tipos inline (Content-Disposition: inline) ────────────────────────────────
const INLINE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']);

// ─────────────────────────────────────────────────────────────────────────────
// upload(buffer, key, mimetype) → Promise<void>
// ─────────────────────────────────────────────────────────────────────────────
async function upload(buffer, key, mimetype) {
    if (r2Active) {
        await s3Client.send(new PutObjectCommand({
            Bucket:      bucketName,
            Key:         key,
            Body:        buffer,
            ContentType: mimetype
        }));
        return;
    }

    // Disco local
    const filePath = localPath(key);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, buffer);
}

// ─────────────────────────────────────────────────────────────────────────────
// download(key, res, opts) → Promise<true|null>
//   null  → arquivo não encontrado (caller deve responder 404)
//   true  → resposta enviada (redirect ou stream iniciado)
// ─────────────────────────────────────────────────────────────────────────────
async function download(key, res, opts = {}) {
    const { mimetype, filename } = opts;
    const isInline = INLINE_TYPES.has(mimetype);
    const disposition = filename
        ? `${isInline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(filename)}"`
        : undefined;

    if (r2Active) {
        try {
            // Verifica existência no R2
            await s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));

            // Gera presigned URL (1 hora) com Content-Disposition personalizado
            const cmdParams = { Bucket: bucketName, Key: key };
            if (disposition) cmdParams.ResponseContentDisposition = disposition;

            const url = await getSignedUrl(
                s3Client,
                new GetObjectCommand(cmdParams),
                { expiresIn: 3600 }
            );

            res.redirect(url);
            return true;
        } catch (err) {
            if (!isNotFound(err)) throw err;
            // Objeto não existe no R2 → tenta disco (migração gradual)
        }
    }

    // Fallback: disco local
    const filePath = localPath(key);
    if (!fs.existsSync(filePath)) return null;

    const stats = fs.statSync(filePath);
    if (mimetype)     res.setHeader('Content-Type', mimetype);
    if (disposition)  res.setHeader('Content-Disposition', disposition);
    res.setHeader('Content-Length', stats.size);
    fs.createReadStream(filePath).pipe(res);
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// getBuffer(key) → Promise<Buffer|null>
//   null → arquivo não encontrado
// ─────────────────────────────────────────────────────────────────────────────
async function getBuffer(key) {
    if (r2Active) {
        try {
            const data = await s3Client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
            return await streamToBuffer(data.Body);
        } catch (err) {
            if (!isNotFound(err)) throw err;
            // Não existe no R2 → tenta disco
        }
    }

    // Disco local
    const filePath = localPath(key);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
}

// ─────────────────────────────────────────────────────────────────────────────
// del(key) → Promise<void>
// ─────────────────────────────────────────────────────────────────────────────
async function del(key) {
    if (r2Active) {
        try {
            await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
        } catch (_) { /* objeto já não existe — ignora */ }
    }

    // Remove do disco também (migração gradual: arquivo pode ainda estar lá)
    const filePath = localPath(key);
    if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (_) { /* ignora */ }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// isR2Active() → Boolean
// ─────────────────────────────────────────────────────────────────────────────
function isR2Active() {
    return r2Active;
}

module.exports = { upload, download, getBuffer, delete: del, isR2Active };
