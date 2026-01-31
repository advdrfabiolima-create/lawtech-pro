// teste-env.js
require('dotenv').config();

console.log("==========================================");
console.log("   SISTEMA DE DIAGNÓSTICO LAWTECH PRO     ");
console.log("==========================================");

const chavesParaVerificar = [
    'ASAAS_API_KEY',
    'ASAAS_URL',
    'DATABASE_URL',
    'JWT_SECRET'
];

chavesParaVerificar.forEach(chave => {
    const valor = process.env[chave];
    if (valor) {
        // Mostra apenas os 5 primeiros caracteres para segurança
        console.log(`✅ ${chave}: CARREGADA (Inicia com: ${valor.substring(0, 8)}...)`);
    } else {
        console.log(`❌ ${chave}: NÃO ENCONTRADA OU VAZIA`);
    }
});

console.log("==========================================");
console.log("Ambiente NODE_ENV:", process.env.NODE_ENV || "não definido");
console.log("==========================================");