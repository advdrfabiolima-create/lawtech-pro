/**
 * Validação de senha forte
 * Mínimo 8 caracteres, 1 maiúscula, 1 minúscula, 1 número
 */
function validarSenha(senha) {
    if (!senha || senha.length < 8) {
        return { valida: false, erro: 'A senha deve ter no mínimo 8 caracteres' };
    }
    if (!/[A-Z]/.test(senha)) {
        return { valida: false, erro: 'A senha deve conter pelo menos uma letra maiúscula' };
    }
    if (!/[a-z]/.test(senha)) {
        return { valida: false, erro: 'A senha deve conter pelo menos uma letra minúscula' };
    }
    if (!/[0-9]/.test(senha)) {
        return { valida: false, erro: 'A senha deve conter pelo menos um número' };
    }
    return { valida: true };
}

/**
 * Validação de CPF com dígitos verificadores
 */
function validarCPF(cpf) {
    cpf = (cpf || '').replace(/\D/g, '');
    if (cpf.length !== 11) return false;

    // Rejeita CPFs com todos os dígitos iguais
    if (/^(\d)\1{10}$/.test(cpf)) return false;

    // Primeiro dígito verificador
    let soma = 0;
    for (let i = 0; i < 9; i++) {
        soma += parseInt(cpf.charAt(i)) * (10 - i);
    }
    let resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf.charAt(9))) return false;

    // Segundo dígito verificador
    soma = 0;
    for (let i = 0; i < 10; i++) {
        soma += parseInt(cpf.charAt(i)) * (11 - i);
    }
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf.charAt(10))) return false;

    return true;
}

/**
 * Validação de CNPJ com dígitos verificadores
 */
function validarCNPJ(cnpj) {
    cnpj = (cnpj || '').replace(/\D/g, '');
    if (cnpj.length !== 14) return false;

    // Rejeita CNPJs com todos os dígitos iguais
    if (/^(\d)\1{13}$/.test(cnpj)) return false;

    const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

    let soma = 0;
    for (let i = 0; i < 12; i++) {
        soma += parseInt(cnpj.charAt(i)) * pesos1[i];
    }
    let resto = soma % 11;
    const dig1 = resto < 2 ? 0 : 11 - resto;
    if (parseInt(cnpj.charAt(12)) !== dig1) return false;

    soma = 0;
    for (let i = 0; i < 13; i++) {
        soma += parseInt(cnpj.charAt(i)) * pesos2[i];
    }
    resto = soma % 11;
    const dig2 = resto < 2 ? 0 : 11 - resto;
    if (parseInt(cnpj.charAt(13)) !== dig2) return false;

    return true;
}

/**
 * Valida CPF ou CNPJ baseado no tamanho
 */
function validarDocumento(documento) {
    const limpo = (documento || '').replace(/\D/g, '');
    if (limpo.length === 11) {
        return { valido: validarCPF(limpo), tipo: 'CPF', documento: limpo };
    }
    if (limpo.length === 14) {
        return { valido: validarCNPJ(limpo), tipo: 'CNPJ', documento: limpo };
    }
    return { valido: false, tipo: null, documento: limpo };
}

module.exports = { validarSenha, validarCPF, validarCNPJ, validarDocumento };
