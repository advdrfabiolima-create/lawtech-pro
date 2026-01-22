const axios = require('axios');

const API_KEY = 'SUA_CHAVE_AQUI'; 
// Mudança para o padrão exato do CNJ/DJEN
const TERMO = '51288-BA'; 

async function registrarNoEscavador() {
    console.log(`🚀 Tentativa de Registro Padrão DJEN: ${TERMO}`);
    
    try {
        const response = await axios.post('https://api.escavador.com/v1/monitoramentos', {
            tipo: "termo",
            termo: TERMO,
            frequencia: "diaria"
        }, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/json'
            }
        });

        console.log('✅ SUCESSO!');
        console.log('ID do Monitoramento:', response.data.id);

    } catch (error) {
        console.error('❌ ERRO NO REGISTRO:');
        console.error('Detalhe:', error.response?.data || error.message);
    }
}

registrarNoEscavador();