jest.mock('../config/db', () => ({ query: jest.fn() }));
jest.mock('../utils/storage', () => ({
    upload:     jest.fn().mockResolvedValue(undefined),
    download:   jest.fn().mockResolvedValue(true),
    delete:     jest.fn().mockResolvedValue(undefined),
    isR2Active: jest.fn().mockReturnValue(false)
}));
jest.mock('multer', () => {
    const m = jest.fn(() => ({
        single: jest.fn(() => (req, res, cb) => cb())
    }));
    m.memoryStorage = jest.fn(() => ({}));
    m.MulterError = class MulterError extends Error {};
    return m;
});
jest.mock('path', () => ({
    extname: jest.fn(() => '.pdf'),
    basename: jest.fn((f) => f)
}));

const pool = require('../config/db');
const storage = require('../utils/storage');
const c = require('../controllers/documentosController');

function makeReqRes(overrides = {}) {
    const req = {
        user: { id: 1, escritorio_id: 10, role: 'admin' },
        params: {},
        body: {},
        query: {},
        file: null,
        ...overrides
    };
    const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        headersSent: false
    };
    return { req, res };
}

beforeEach(() => jest.clearAllMocks());

// ── listarDocumentos ──────────────────────────────────────────────────────────
describe('listarDocumentos', () => {
    test('retorna lista de documentos', async () => {
        const rows = [{ id: 1, nome: 'Petição' }];
        pool.query.mockResolvedValue({ rows });
        const { req, res } = makeReqRes();
        await c.listarDocumentos(req, res);
        expect(res.json).toHaveBeenCalledWith(rows);
    });

    test('retorna 500 em erro de banco', async () => {
        pool.query.mockRejectedValue(new Error('DB'));
        const { req, res } = makeReqRes();
        await c.listarDocumentos(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
    });
});

// ── criarDocumento ────────────────────────────────────────────────────────────
describe('criarDocumento', () => {
    test('retorna 400 se sem arquivo', async () => {
        const { req, res } = makeReqRes({ file: null });
        await c.criarDocumento(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(storage.upload).not.toHaveBeenCalled();
    });

    test('retorna 400 se nome vazio', async () => {
        const { req, res } = makeReqRes({
            file: { buffer: Buffer.from('x'), mimetype: 'application/pdf', originalname: 'doc.pdf', size: 100 },
            body: { nome: '   ' }
        });
        await c.criarDocumento(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('cria documento com sucesso → 201', async () => {
        const row = { id: 7, nome: 'Contrato' };
        pool.query.mockResolvedValue({ rows: [row] });
        const { req, res } = makeReqRes({
            file: { buffer: Buffer.from('x'), mimetype: 'application/pdf', originalname: 'doc.pdf', size: 512 },
            body: { nome: 'Contrato', categoria: 'contrato' }
        });
        await c.criarDocumento(req, res);
        expect(storage.upload).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith(row);
    });

    test('chama storage.delete e retorna 500 se upload OK mas DB falha', async () => {
        storage.upload.mockResolvedValue(undefined);
        pool.query.mockRejectedValue(new Error('DB'));
        const { req, res } = makeReqRes({
            file: { buffer: Buffer.from('x'), mimetype: 'application/pdf', originalname: 'doc.pdf', size: 512 },
            body: { nome: 'Erro', categoria: 'outros' }
        });
        await c.criarDocumento(req, res);
        expect(storage.delete).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
    });
});

// ── servirArquivo ─────────────────────────────────────────────────────────────
describe('servirArquivo', () => {
    test('retorna 404 se documento não encontrado no banco', async () => {
        pool.query.mockResolvedValue({ rows: [] });
        const { req, res } = makeReqRes({ params: { id: '99' } });
        await c.servirArquivo(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });

    test('retorna 404 se storage retorna null', async () => {
        pool.query.mockResolvedValue({ rows: [{ id: 1, arquivo_nome: 'doc.pdf', mimetype: 'application/pdf', arquivo_original: 'doc.pdf' }] });
        storage.download.mockResolvedValue(null);
        const { req, res } = makeReqRes({ params: { id: '1' } });
        await c.servirArquivo(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });

    test('serve arquivo com sucesso', async () => {
        pool.query.mockResolvedValue({ rows: [{ id: 1, arquivo_nome: 'doc.pdf', mimetype: 'application/pdf', arquivo_original: 'doc.pdf' }] });
        storage.download.mockResolvedValue(true);
        const { req, res } = makeReqRes({ params: { id: '1' } });
        await c.servirArquivo(req, res);
        expect(storage.download).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(404);
        expect(res.status).not.toHaveBeenCalledWith(500);
    });
});

// ── excluirDocumento ──────────────────────────────────────────────────────────
describe('excluirDocumento', () => {
    test('retorna 404 se documento não encontrado', async () => {
        pool.query.mockResolvedValue({ rows: [] });
        const { req, res } = makeReqRes({ params: { id: '99' } });
        await c.excluirDocumento(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });

    test('exclui família e chama storage.delete', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id: 5, documento_pai_id: null }] }) // buscar doc
            .mockResolvedValueOnce({ rows: [{ arquivo_nome: 'a.pdf' }, { arquivo_nome: 'b.pdf' }] }) // familia
            .mockResolvedValueOnce({ rowCount: 2 }); // DELETE
        const { req, res } = makeReqRes({ params: { id: '5' } });
        await c.excluirDocumento(req, res);
        expect(storage.delete).toHaveBeenCalledTimes(2);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    });
});

// ── roleAdminOp ───────────────────────────────────────────────────────────────
describe('roleAdminOp', () => {
    test('bloqueia role visitante', () => {
        const { req, res } = makeReqRes({ user: { role: 'visitante' } });
        const next = jest.fn();
        c.roleAdminOp(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('permite admin', () => {
        const { req, res } = makeReqRes({ user: { role: 'admin' } });
        const next = jest.fn();
        c.roleAdminOp(req, res, next);
        expect(next).toHaveBeenCalled();
    });
});
