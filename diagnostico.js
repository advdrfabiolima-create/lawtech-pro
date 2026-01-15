require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function listarModelos() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    try {
        console.log("--- Consultando sua chave no Google AI Studio ---");
        // Esta função vai listar exatamente o que sua chave pode acessar
        const listModels = await genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); 
        
        // Vamos tentar um Olá com o modelo mais novo de todos
        const result = await listModels.generateContent("Olá! Se você ler isso, responda: SISTEMA ONLINE");
        console.log("RESPOSTA DA IA:", result.response.text());
        console.log("-----------------------------------------------");
    } catch (e) {
        console.error("ERRO NO DIAGNÓSTICO:", e.message);
        console.log("\nDICA DO SÊNIOR: Se aparecer 404, sua chave precisa ser gerada novamente em aistudio.google.com");
    }
}
listarModelos();