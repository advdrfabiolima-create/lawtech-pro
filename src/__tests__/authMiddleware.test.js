// Mock dependencies before requiring
jest.mock('../config/db', () => ({
    query: jest.fn()
}));
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));
jest.mock('../utils/cache', () => ({
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn()
}));
jest.mock('../config/jwt', () => ({
    verify: jest.fn()
}));

const pool = require('../config/db');
const cache = require('../utils/cache');
const { verify: jwtVerify } = require('../config/jwt');
const authMiddleware = require('../middlewares/authMiddleware');

function makeReqRes() {
    const req = { headers: {} };
    const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
    };
    const next = jest.fn();
    return { req, res, next };
}

describe('authMiddleware', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.MASTER_EMAIL = 'master@test.com';
    });

    test('retorna 401 sem Authorization header', async () => {
        const { req, res, next } = makeReqRes();
        await authMiddleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
        expect(next).not.toHaveBeenCalled();
    });

    test('retorna 401 para token 2fa', async () => {
        const { req, res, next } = makeReqRes();
        req.headers.authorization = 'Bearer token_2fa';
        jwtVerify.mockReturnValue({ id: 1, scope: '2fa' });

        await authMiddleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ erro: expect.stringContaining('2FA') }));
    });

    test('retorna 401 para token portal_cliente', async () => {
        const { req, res, next } = makeReqRes();
        req.headers.authorization = 'Bearer token_portal';
        jwtVerify.mockReturnValue({ id: 1, scope: 'portal_cliente' });

        await authMiddleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
    });

    test('retorna 401 quando usuário não encontrado no banco', async () => {
        const { req, res, next } = makeReqRes();
        req.headers.authorization = 'Bearer valid_token';
        jwtVerify.mockReturnValue({ id: 999 });
        cache.get.mockResolvedValue(null);
        pool.query.mockResolvedValue({ rows: [] });

        await authMiddleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
    });

    test('usa cache quando disponível', async () => {
        const { req, res, next } = makeReqRes();
        req.headers.authorization = 'Bearer valid_token';
        jwtVerify.mockReturnValue({ id: 1 });

        const cachedUser = {
            id: 1, nome: 'Dr. Teste', email: 'teste@test.com', role: 'admin',
            escritorio_id: 1, is_master: false, email_verificado: true,
            plano_financeiro_status: 'pago', plano_id: 1, trial_expira_em: null
        };
        cache.get.mockResolvedValue(cachedUser);

        await authMiddleware(req, res, next);
        expect(pool.query).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalled();
        expect(req.user).toBeDefined();
        expect(req.user.email).toBe('teste@test.com');
    });

    test('busca no banco e salva no cache quando cache miss', async () => {
        const { req, res, next } = makeReqRes();
        req.headers.authorization = 'Bearer valid_token';
        jwtVerify.mockReturnValue({ id: 1 });
        cache.get.mockResolvedValue(null);

        const dbUser = {
            id: 1, nome: 'Dr. Teste', email: 'teste@test.com', role: 'admin',
            escritorio_id: 1, is_master: false, email_verificado: true,
            plano_financeiro_status: 'pago', plano_id: 1, trial_expira_em: null
        };
        pool.query.mockResolvedValue({ rows: [dbUser] });

        await authMiddleware(req, res, next);
        expect(pool.query).toHaveBeenCalledTimes(1);
        expect(cache.set).toHaveBeenCalledWith('auth:user:1', dbUser, 60);
        expect(next).toHaveBeenCalled();
    });

    test('bloqueia trial expirado além do grace period', async () => {
        const { req, res, next } = makeReqRes();
        req.headers.authorization = 'Bearer valid_token';
        jwtVerify.mockReturnValue({ id: 1 });
        cache.get.mockResolvedValue(null);

        const expiredDate = new Date();
        expiredDate.setDate(expiredDate.getDate() - 10); // 10 dias atrás
        pool.query.mockResolvedValue({
            rows: [{
                id: 1, nome: 'Dr. Expirado', email: 'expirado@test.com', role: 'admin',
                escritorio_id: 1, is_master: false, email_verificado: false,
                plano_financeiro_status: 'trial', plano_id: 1,
                trial_expira_em: expiredDate.toISOString()
            }]
        });

        await authMiddleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(402);
        expect(next).not.toHaveBeenCalled();
    });

    test('permite acesso dentro do grace period (3 dias)', async () => {
        const { req, res, next } = makeReqRes();
        req.headers.authorization = 'Bearer valid_token';
        jwtVerify.mockReturnValue({ id: 1 });
        cache.get.mockResolvedValue(null);

        const recentExpiry = new Date();
        recentExpiry.setDate(recentExpiry.getDate() - 2); // 2 dias atrás (dentro do grace period)
        pool.query.mockResolvedValue({
            rows: [{
                id: 1, nome: 'Dr. Grace', email: 'grace@test.com', role: 'admin',
                escritorio_id: 1, is_master: false, email_verificado: true,
                plano_financeiro_status: 'trial', plano_id: 1,
                trial_expira_em: recentExpiry.toISOString()
            }]
        });

        await authMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('retorna 401 para token inválido (exceção jwt)', async () => {
        const { req, res, next } = makeReqRes();
        req.headers.authorization = 'Bearer bad_token';
        jwtVerify.mockImplementation(() => { throw new Error('jwt malformed'); });

        await authMiddleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    test('master nunca é bloqueado mesmo com trial expirado', async () => {
        const { req, res, next } = makeReqRes();
        req.headers.authorization = 'Bearer master_token';
        jwtVerify.mockReturnValue({ id: 99 });
        cache.get.mockResolvedValue(null);

        const farExpired = new Date();
        farExpired.setFullYear(farExpired.getFullYear() - 1);
        pool.query.mockResolvedValue({
            rows: [{
                id: 99, nome: 'Master', email: 'master@test.com', role: 'admin',
                escritorio_id: 1, is_master: true, email_verificado: true,
                plano_financeiro_status: 'trial', plano_id: 1,
                trial_expira_em: farExpired.toISOString()
            }]
        });

        await authMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.user.eh_master).toBe(true);
    });
});
