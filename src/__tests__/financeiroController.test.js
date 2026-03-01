jest.mock('../config/db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../utils/validators', () => ({ validarDocumento: jest.fn() }));
jest.mock('../utils/crypto', () => ({ encrypt: jest.fn(), decrypt: jest.fn() }));
jest.mock('axios');

const pool = require('../config/db');
const axios = require('axios');
const { validarDocumento } = require('../utils/validators');
const { encrypt, decrypt } = require('../utils/crypto');

// Load controller AFTER mocks
const c = require('../controllers/financeiroController');

function makeReqRes(overrides = {}) {
    const req = {
        user: { id: 1, escritorio_id: 10, role: 'admin' },
        params: {},
        body: {},
        query: {},
        headers: {},
        ...overrides
    };
    const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        send: jest.fn()
    };
    return { req, res };
}

beforeEach(() => jest.clearAllMocks());

// ── listarLancamentos ─────────────────────────────────────────────────────────
describe('listarLancamentos', () => {
    test('retorna rows do banco', async () => {
        const rows = [{ id: 1, descricao: 'Taxa' }];
        pool.query.mockResolvedValue({ rows });
        const { req, res } = makeReqRes();
        await c.listarLancamentos(req, res);
        expect(res.json).toHaveBeenCalledWith(rows);
    });

    test('retorna 500 em erro de banco', async () => {
        pool.query.mockRejectedValue(new Error('DB error'));
        const { req, res } = makeReqRes();
        await c.listarLancamentos(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
    });
});

// ── criarLancamento ───────────────────────────────────────────────────────────
describe('criarLancamento', () => {
    test('retorna 400 se campos obrigatórios faltam', async () => {
        const { req, res } = makeReqRes({ body: { descricao: 'Teste' } });
        await c.criarLancamento(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ erro: expect.any(String) }));
    });

    test('cria lançamento com sucesso → 201', async () => {
        const row = { id: 5, descricao: 'Receita', valor: 100, tipo: 'Receita', status: 'Pendente' };
        pool.query.mockResolvedValue({ rows: [row] });
        const { req, res } = makeReqRes({
            body: { descricao: 'Receita', valor: 100, tipo: 'Receita', data_vencimento: '2026-04-01' }
        });
        await c.criarLancamento(req, res);
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith(row);
    });

    test('retorna 500 em erro de banco', async () => {
        pool.query.mockRejectedValue(new Error('DB'));
        const { req, res } = makeReqRes({
            body: { descricao: 'X', valor: 10, tipo: 'Receita', data_vencimento: '2026-01-01' }
        });
        await c.criarLancamento(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
    });
});

// ── atualizarLancamento ───────────────────────────────────────────────────────
describe('atualizarLancamento', () => {
    test('retorna dado atualizado', async () => {
        const row = { id: 3, descricao: 'Updated' };
        pool.query.mockResolvedValue({ rows: [row] });
        const { req, res } = makeReqRes({ params: { id: '3' }, body: { descricao: 'Updated', valor: 50, tipo: 'Despesa', data_vencimento: '2026-05-01' } });
        await c.atualizarLancamento(req, res);
        expect(res.json).toHaveBeenCalledWith(row);
    });

    test('retorna 500 em erro', async () => {
        pool.query.mockRejectedValue(new Error('DB'));
        const { req, res } = makeReqRes({ params: { id: '3' }, body: {} });
        await c.atualizarLancamento(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
    });
});

// ── marcarPago ────────────────────────────────────────────────────────────────
describe('marcarPago', () => {
    test('marca como pago → retorna row', async () => {
        const row = { id: 2, status: 'Pago' };
        pool.query.mockResolvedValue({ rows: [row] });
        const { req, res } = makeReqRes({ params: { id: '2' } });
        await c.marcarPago(req, res);
        expect(res.json).toHaveBeenCalledWith(row);
    });

    test('retorna 404 se não encontrado', async () => {
        pool.query.mockResolvedValue({ rows: [] });
        const { req, res } = makeReqRes({ params: { id: '99' } });
        await c.marcarPago(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });

    test('retorna 500 em erro', async () => {
        pool.query.mockRejectedValue(new Error('DB'));
        const { req, res } = makeReqRes({ params: { id: '2' } });
        await c.marcarPago(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
    });
});

// ── excluirLancamento ─────────────────────────────────────────────────────────
describe('excluirLancamento', () => {
    test('deleta com sucesso', async () => {
        pool.query.mockResolvedValue({ rowCount: 1 });
        const { req, res } = makeReqRes({ params: { id: '4' } });
        await c.excluirLancamento(req, res);
        expect(res.json).toHaveBeenCalledWith({ mensagem: 'Excluído com sucesso' });
    });

    test('retorna 500 em erro', async () => {
        pool.query.mockRejectedValue(new Error('DB'));
        const { req, res } = makeReqRes({ params: { id: '4' } });
        await c.excluirLancamento(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
    });
});

// ── calcularSaldo ─────────────────────────────────────────────────────────────
describe('calcularSaldo', () => {
    test('retorna saldoLiquido correto', async () => {
        pool.query.mockResolvedValue({
            rows: [{ receitas_reais: 1000, despesas_pagas: 300, a_receber: 500, a_pagar: 200 }]
        });
        const { req, res } = makeReqRes();
        await c.calcularSaldo(req, res);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ saldoLiquido: 700 }));
    });

    test('retorna 500 em erro', async () => {
        pool.query.mockRejectedValue(new Error('DB'));
        const { req, res } = makeReqRes();
        await c.calcularSaldo(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
    });
});

// ── gerarRelatorio ────────────────────────────────────────────────────────────
describe('gerarRelatorio', () => {
    test('retorna 400 se datas ausentes', async () => {
        const { req, res } = makeReqRes({ query: {} });
        await c.gerarRelatorio(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('retorna rows com datas válidas', async () => {
        const rows = [{ id: 1 }];
        pool.query.mockResolvedValue({ rows });
        const { req, res } = makeReqRes({ query: { dataInicio: '2026-01-01', dataFim: '2026-01-31' } });
        await c.gerarRelatorio(req, res);
        expect(res.json).toHaveBeenCalledWith(rows);
    });

    test('retorna 500 em erro de banco', async () => {
        pool.query.mockRejectedValue(new Error('DB'));
        const { req, res } = makeReqRes({ query: { dataInicio: '2026-01-01', dataFim: '2026-01-31' } });
        await c.gerarRelatorio(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
    });
});

// ── resetAsaas ────────────────────────────────────────────────────────────────
describe('resetAsaas', () => {
    test('retorna ok após resetar', async () => {
        pool.query.mockResolvedValue({ rowCount: 1 });
        const { req, res } = makeReqRes();
        await c.resetAsaas(req, res);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    });

    test('retorna 500 em erro', async () => {
        pool.query.mockRejectedValue(new Error('DB'));
        const { req, res } = makeReqRes();
        await c.resetAsaas(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
    });
});
