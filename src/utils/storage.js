/**
 * storage.js — Abstração unificada de armazenamento de arquivos.
 *
 * Prioridade de ativação:
 *   1. Backblaze B2 (se B2_KEY_ID + B2_APP_KEY + B2_BUCKET_NAME + B2_ENDPOINT estiverem presentes)
 *   2. Cloudflare R2 (se R2_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY + R2_BUCKET_NAME)
 *   3. Disco local (fallback automático)
 *
 * API pública:
 *   storage.upload(buffer, key, mimetype)  → Promise<void>
 *   storage.download(key, res, opts)       → Promise<true|null>  (null = não encontrado)
 *   storage.getBuffer(key)                 → Promise<Buffer|null>
 *   storage.delete(key)                    → Promise<void>
 *   storage.isR2Active()                   → Boolean
 *
 * Migração gradual (zero downtime):
 *   - Novos uploads vão para B2/R2 (ou disco).
 *   - Downloads tentam nuvem primeiro; se o objeto não existe (404), caem para disco.
 *   - Arquivos antigos continuam acessíveis enquanto ainda estiverem no disco.
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ── Detectar Backblaze B2 ─────────────────────────────────────────────────────
const B2_VARS   = ['B2_KEY_ID', 'B2_APP_KEY', 'B2_BUCKET_NAME', 'B2_ENDPOINT'];
const b2Active  = B2_VARS.every(v => process.env[v]);

// ── Detectar Cloudflare R2 ────────────────────────────────────────────────────
const R2_VARS   = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];
const r2Active  = !b2Active && R2_VARS.every(v => process.env[v]);

const cloudActive = b2Active || r2Active;

let s3Client             = null;
let bucketName           = null;
let GetObjectCommand     = null;
let PutObjectCommand     = null;
let DeleteObjectCommand  = null;
let HeadObjectCommand    = null;
let getSignedUrl         = null;

if (b2Active) {
    const sdk       = require('@aws-sdk/client-s3');
    const presigner = require('@aws-sdk/s3-request-presigner');

    GetObjectCommand    = sdk.GetObjectCommand;
    PutObjectCommand    = sdk.PutObjectCommand;
    DeleteObjectCommand = sdk.DeleteObjectCommand;
    HeadObjectCommand   = sdk.HeadObjectCommand;
    getSignedUrl        = presigner.getSignedUrl;
    bucketName          = process.env.B2_BUCKET_NAME;

    s3Client = new sdk.S3Client({
        region: 'us-east-1', // B2 aceita qualquer região neste campo
        endpoint: process.env.B2_ENDPOINT, // ex: https://s3.us-west-004.backblazeb2.com
        credentials: {
            accessKeyId:     process.env.B2_KEY_ID,
            secretAccessKey: process.env.B2_APP_KEY
        },
        forcePathStyle: true // necessário para Backblaze B2
    });

    console.log(`[storage] Modo Backblaze B2 ativo — bucket: ${bucketName}`);

} else if (r2Active) {
    const sdk       = require('@aws-sdk/client-s3');
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
    console.log('[storage] Modo disco local (B2 e R2 não configurados)');
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
    if (cloudActive) {
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

    if (cloudActive) {
        try {
            // Verifica existência no storage
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
            // Objeto não existe na nuvem → tenta disco (migração gradual)
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
    if (cloudActive) {
        try {
            const data = await s3Client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
            return await streamToBuffer(data.Body);
        } catch (err) {
            if (!isNotFound(err)) throw err;
            // Não existe na nuvem → tenta disco
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
    if (cloudActive) {
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
// isR2Active() → Boolean (mantido para compatibilidade com server.js)
// ─────────────────────────────────────────────────────────────────────────────
function isR2Active() {
    return cloudActive;
}

module.exports = { upload, download, getBuffer, delete: del, isR2Active };