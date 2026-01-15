require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function listar() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    try {
        // Em versões recentes, podemos tentar listar os modelos disponíveis
        console.log("Sua chave está tentando conectar...");
        // Tentativa de acesso direto para teste de validade
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }, { apiVersion: 'v1' });
        const result = await model.generateContent("Oi");
        console.log("CONEXÃO ESTABELECIDA COM SUCESSO!");
    } catch (e) {
        console.log("ERRO AO CONECTAR:", e.message);
        console.log("\n--- Ação Necessária ---");
        console.log("Se o erro persistir, sua chave API (final " + process.env.GEMINI_API_KEY.slice(-4) + ") pode estar sem permissão.");
    }
}
listar();