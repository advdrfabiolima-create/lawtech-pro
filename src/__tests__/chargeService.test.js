// Mock dependencies before requiring the module
jest.mock('axios');
jest.mock('../config/db', () => ({
    query: jest.fn()
}));
jest.mock('../utils/retry', () => ({
    withRetry: jest.fn((fn) => fn())
}));
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

const axios = require('axios');
const pool = require('../config/db');

// Set env var before requiring (stripe requires STRIPE_SECRET_KEY)
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.ASAAS_API_KEY = 'fake_asaas_key';

const {
    getAsaasHeaders,
    cobrarViaAsaas,
    processarCobrancaCartao,
    registrarTransacao,
    ASAAS_BASE_URL
} = require('../services/chargeService');

describe('getAsaasHeaders', () => {
    test('retorna headers com access_token e Content-Type', () => {
        const headers = getAsaasHeaders();
        expect(headers).toHaveProperty('access_token', 'fake_asaas_key');
        expect(headers).toHaveProperty('Content-Type', 'application/json');
    });
});

describe('ASAAS_BASE_URL', () => {
    test('usa URL de produção por padrão', () => {
        expect(ASAAS_BASE_URL).toContain('asaas.com');
    });
});

describe('cobrarViaAsaas', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('retorna sucesso quando status é CONFIRMED', async () => {
        pool.query.mockResolvedValueOnce({
            rows: [{ asaas_card_token: 'tok_card_123' }]
        });
        axios.post.mockResolvedValueOnce({
            data: { id: 'pay_123', status: 'CONFIRMED' }
        });

        const result = await cobrarViaAsaas('cus_123', 9700, 'Assinatura', 1);
        expect(result.sucesso).toBe(true);
        expect(result.transacaoId).toBe('pay_123');
        expect(result.erro).toBeNull();
    });

    test('retorna falha quando cartão não encontrado', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });

        const result = await cobrarViaAsaas('cus_123', 9700, 'Assinatura', 1);
        expect(result.sucesso).toBe(false);
        expect(result.erro).toMatch(/cartão/i);
    });

    test('retorna falha quando status é PENDING', async () => {
        pool.query.mockResolvedValueOnce({
            rows: [{ asaas_card_token: 'tok_card_123' }]
        });
        axios.post.mockResolvedValueOnce({
            data: { id: 'pay_456', status: 'PENDING' }
        });

        const result = await cobrarViaAsaas('cus_123', 9700, 'Assinatura', 1);
        expect(result.sucesso).toBe(false);
        expect(result.transacaoId).toBe('pay_456');
    });

    test('retorna falha em caso de exceção do axios', async () => {
        pool.query.mockResolvedValueOnce({
            rows: [{ asaas_card_token: 'tok_card_123' }]
        });
        axios.post.mockRejectedValueOnce(new Error('Network error'));

        const result = await cobrarViaAsaas('cus_123', 9700, 'Assinatura', 1);
        expect(result.sucesso).toBe(false);
        expect(result.erro).toBe('Network error');
    });
});

describe('processarCobrancaCartao', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('retorna falha para gateway não suportado', async () => {
        const result = await processarCobrancaCartao({
            escritorioId: 1,
            valor: 9700,
            cartaoToken: 'tok_xxx',
            gateway: 'pagarme',
            descricao: 'Teste'
        });
        expect(result.sucesso).toBe(false);
        expect(result.erro).toMatch(/não suportado/i);
    });
});

describe('registrarTransacao', () => {
    test('registra transação com mensagem_erro', async () => {
        const mockClient = { query: jest.fn() };
        await registrarTransacao(mockClient, {
            escritorioId: 1,
            gateway_id: 'pay_123',
            gateway: 'stripe',
            valor: 9700,
            status: 'recusada',
            descricao: 'Teste',
            mensagem_erro: 'Cartão recusado'
        });
        expect(mockClient.query).toHaveBeenCalledTimes(1);
        expect(mockClient.query.mock.calls[0][1]).toContain('Cartão recusado');
    });

    test('registra transação sem mensagem_erro', async () => {
        const mockClient = { query: jest.fn() };
        await registrarTransacao(mockClient, {
            escritorioId: 1,
            gateway_id: 'pay_456',
            gateway: 'stripe',
            valor: 9700,
            status: 'aprovada',
            descricao: 'Assinatura'
        });
        expect(mockClient.query).toHaveBeenCalledTimes(1);
    });
});
