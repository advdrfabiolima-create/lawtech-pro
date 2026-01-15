require('dotenv').config();
const axios = require('axios');

async function consultarGoogle() {
    const chave = process.env.GEMINI_API_KEY;
    console.log("--- Consultando Permissões da Chave Final: " + chave.slice(-4) + " ---");
    
    try {
        // Chamada direta para a API da Google para listar os modelos
        const url = `https://generativelanguage.googleapis.com/v1/models?key=${chave}`;
        const res = await axios.get(url);
        
        console.log("SUCESSO! Sua chave pode usar estes modelos:");
        res.data.models.forEach(m => {
            console.log("-> " + m.name.replace('models/', ''));
        });
    } catch (e) {
        console.error("ERRO CRÍTICO:");
        if (e.response) {
            console.log(e.response.data);
        } else {
            console.log(e.message);
        }
    }
}
consultarGoogle();