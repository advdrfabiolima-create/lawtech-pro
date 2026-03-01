const { validarSenha, validarCPF, validarCNPJ, validarDocumento } = require('../utils/validators');

describe('validarSenha', () => {
    test('rejeita senha curta', () => {
        const r = validarSenha('Ab1');
        expect(r.valida).toBe(false);
        expect(r.erro).toMatch(/mínimo 8/);
    });

    test('rejeita senha sem maiúscula', () => {
        const r = validarSenha('abcdef1g');
        expect(r.valida).toBe(false);
        expect(r.erro).toMatch(/maiúscula/);
    });

    test('rejeita senha sem minúscula', () => {
        const r = validarSenha('ABCDEF1G');
        expect(r.valida).toBe(false);
        expect(r.erro).toMatch(/minúscula/);
    });

    test('rejeita senha sem número', () => {
        const r = validarSenha('Abcdefgh');
        expect(r.valida).toBe(false);
        expect(r.erro).toMatch(/número/);
    });

    test('aceita senha válida', () => {
        const r = validarSenha('Senha123');
        expect(r.valida).toBe(true);
        expect(r.erro).toBeUndefined();
    });

    test('rejeita senha nula', () => {
        const r = validarSenha(null);
        expect(r.valida).toBe(false);
    });

    test('rejeita senha vazia', () => {
        const r = validarSenha('');
        expect(r.valida).toBe(false);
    });
});

describe('validarCPF', () => {
    test('rejeita CPF com todos dígitos iguais', () => {
        expect(validarCPF('111.111.111-11')).toBe(false);
    });

    test('rejeita CPF com comprimento errado', () => {
        expect(validarCPF('123')).toBe(false);
    });

    test('aceita CPF válido', () => {
        // CPF válido gerado matematicamente
        expect(validarCPF('529.982.247-25')).toBe(true);
    });

    test('aceita CPF sem formatação', () => {
        expect(validarCPF('52998224725')).toBe(true);
    });

    test('rejeita CPF com dígitos verificadores errados', () => {
        expect(validarCPF('529.982.247-26')).toBe(false);
    });
});

describe('validarCNPJ', () => {
    test('rejeita CNPJ com todos dígitos iguais', () => {
        expect(validarCNPJ('11.111.111/1111-11')).toBe(false);
    });

    test('rejeita CNPJ com comprimento errado', () => {
        expect(validarCNPJ('123')).toBe(false);
    });

    test('aceita CNPJ válido', () => {
        expect(validarCNPJ('11.222.333/0001-81')).toBe(true);
    });

    test('aceita CNPJ sem formatação', () => {
        expect(validarCNPJ('11222333000181')).toBe(true);
    });
});

describe('validarDocumento', () => {
    test('identifica CPF', () => {
        const r = validarDocumento('529.982.247-25');
        expect(r.tipo).toBe('CPF');
        expect(r.valido).toBe(true);
    });

    test('identifica CNPJ', () => {
        const r = validarDocumento('11.222.333/0001-81');
        expect(r.tipo).toBe('CNPJ');
        expect(r.valido).toBe(true);
    });

    test('rejeita documento inválido', () => {
        const r = validarDocumento('123');
        expect(r.valido).toBe(false);
        expect(r.tipo).toBeNull();
    });

    test('trata null graciosamente', () => {
        const r = validarDocumento(null);
        expect(r.valido).toBe(false);
    });
});
