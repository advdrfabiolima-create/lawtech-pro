jest.mock('../config/db', () => ({ query: jest.fn() }));

const pool = require('../config/db');
const c = require('../controllers/clientesController');

function makeReqRes(overrides = {}) {
    const req = {
        user: { id: 1, escritorio_id: 10, role: 'admin' },
        params: {},
        body: {},
        ...overrides
    };
    const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
    };
    return { req, res };
}

beforeEach(() => jest.clearAllMocks());

// ── listarClientes ────────────────────────────────────────────────────────────
describe('listarClientes', () => {
    test('retorna lista de clientes', async () => {
        const rows = [{ id: 1, nome: 'João Silva' }];
        pool.query.mockResolvedValue({ rows });
        const { req, res } = makeReqRes();
        await c.listarClientes(req, res);
        expect(res.json).toHaveBeenCalledWith(rows);
    });

    test('retorna array vazio quando não há clientes', async () => {
        pool.query.mockResolvedValue({ rows: [] });
        const { req, res } = makeReqRes();
        await c.listarClientes(req, res);
        expect(res.json).toHaveBeenCalledWith([]);
    });

    test('retorna 500 em erro de banco', async () => {
        pool.query.mockRejectedValue(new Error('DB'));
        const { req, res } = makeReqRes();
        await c.listarClientes(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ erro: expect.any(String) }));
    });
});

// ── criarCliente ──────────────────────────────────────────────────────────────
describe('criarCliente', () => {
    test('cria cliente com sucesso → 201', async () => {
        const row = { id: 3, nome: 'Maria', email: 'maria@test.com' };
        pool.query.mockResolvedValue({ rows: [row] });
        const { req, res } = makeReqRes({
            body: { nome: 'Maria', documento: '123', email: 'maria@test.com', telefone: '9999', cep: '40000', endereco: 'Rua A', cidade: 'SP', estado: 'SP' }
        });
        await c.criarCliente(req, res);
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith(row);
    });

    test('retorna 500 em erro de banco', async () => {
        pool.query.mockRejectedValue(new Error('DB constraint'));
        const { req, res } = makeReqRes({ body: { nome: 'Erro' } });
        await c.criarCliente(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
    });
});

// ── editarCliente ─────────────────────────────────────────────────────────────
describe('editarCliente', () => {
    test('edita e retorna cliente atualizado', async () => {
        const row = { id: 2, nome: 'Updated', total_processos: 0 };
        pool.query
            .mockResolvedValueOnce({ rowCount: 1 })   // UPDATE
            .mockResolvedValueOnce({ rows: [row] });   // SELECT
        const { req, res } = makeReqRes({ params: { id: '2' }, body: { nome: 'Updated' } });
        await c.editarCliente(req, res);
        expect(res.json).toHaveBeenCalledWith(row);
    });

    test('retorna 404 se cliente não encontrado após update', async () => {
        pool.query
            .mockResolvedValueOnce({ rowCount: 0 })   // UPDATE
            .mockResolvedValueOnce({ rows: [] });      // SELECT
        const { req, res } = makeReqRes({ params: { id: '99' }, body: {} });
        await c.editarCliente(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });

    test('retorna 500 em erro de banco', async () => {
        pool.query.mockRejectedValue(new Error('DB'));
        const { req, res } = makeReqRes({ params: { id: '2' }, body: {} });
        await c.editarCliente(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
    });
});

// ── excluirCliente ────────────────────────────────────────────────────────────
describe('excluirCliente', () => {
    test('exclui com sucesso', async () => {
        pool.query.mockResolvedValue({ rowCount: 1 });
        const { req, res } = makeReqRes({ params: { id: '5' } });
        await c.excluirCliente(req, res);
        expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    test('retorna 404 se cliente não encontrado', async () => {
        pool.query.mockResolvedValue({ rowCount: 0 });
        const { req, res } = makeReqRes({ params: { id: '999' } });
        await c.excluirCliente(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });

    test('retorna 500 em erro de banco', async () => {
        pool.query.mockRejectedValue(new Error('DB'));
        const { req, res } = makeReqRes({ params: { id: '5' } });
        await c.excluirCliente(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
    });
});
