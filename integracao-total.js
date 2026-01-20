require('dotenv').config();
const { Pool } = require('pg');
const axios = require('axios'); // Necessário para o envio de e-mail via Brevo

// Configuração da conexão com o Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 1. INTELIGÊNCIA JURÍDICA (Dicionário de Regras)
function processarInteligencia(textoMovimentacao) {
    const texto = textoMovimentacao.toLowerCase();
    
    if (texto.includes("extinta a execução") || texto.includes("sentença")) {
        return { tipo: "RECURSO", dias: 15, desc: "Prazo para Apelação/Recurso (Sentença)" };
    }
    if (texto.includes("manifestar") || texto.includes("juntada de petição")) {
        return { tipo: "MANIFESTAÇÃO", dias: 5, desc: "Prazo para Manifestação (Petição)" };
    }
    if (texto.includes("intimação pje") || texto.includes("citado")) {
        return { tipo: "DEFESA", dias: 15, desc: "Prazo para Contestação/Defesa" };
    }
    return { tipo: "REVISÃO", dias: 2, desc: "Análise Necessária (Movimentação Geral)" };
}

// 2. FUNÇÃO DE ENVIO DE E-MAIL (BREVO)
async function enviarAlertaEmail(analise, npu) {
    const url = 'https://api.brevo.com/v3/smtp/email';
    const data = {
        sender: { name: "LawTech Pro", email: "contato@lawtechpro.com.br" },
        to: [{ email: "adv.drfabiolima@gmail.com" }], // Altere para seu e-mail se desejar
        subject: `⚠️ NOVO PRAZO: Processo ${npu}`,
        htmlContent: `
            <h3>Novo prazo identificado automaticamente!</h3>
            <p><strong>Processo:</strong> ${npu}</p>
            <p><strong>Tipo:</strong> ${analise.tipo}</p>
            <p><strong>Ação:</strong> ${analise.desc}</p>
            <p><strong>Prazo sugerido:</strong> ${analise.dias} dias úteis.</p>
            <br><p>Verifique seu Dashboard no LawTech Pro.</p>
        `
    };

    try {
        await axios.post(url, data, {
            headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' }
        });
        console.log("📧 Alerta de e-mail enviado via Brevo!");
    } catch (error) {
        console.error("❌ Falha ao enviar e-mail:", error.message);
    }
}

async function processarLawTechPro() {
    const npu = "00016193020258050080"; 
    console.log(`🚀 Iniciando automação LawTech Pro para o processo: ${npu}`);

    try {
        // 1. CAPTURA DO DADO
        const dadoCapturado = {
            tribunal: "TJBA",
            texto: "Extinta a execução ou o cumprimento da sentença",
            data: new Date()
        };

        // 2. APLICAÇÃO DA INTELIGÊNCIA
        const analise = processarInteligencia(dadoCapturado.texto);
        let dataLimite = new Date();
        dataLimite.setDate(dataLimite.getDate() + analise.dias);

        console.log(`⚖️  Inteligência aplicada: ${analise.tipo} (${analise.dias} dias)`);

        // 3. GRAVAÇÃO NO NEON (Processo)
        const queryProcesso = `
            INSERT INTO processos (numero, escritorio_id)
            VALUES ($1, 1)
            ON CONFLICT (numero) DO NOTHING
            RETURNING id;
        `;
        const resProcesso = await pool.query(queryProcesso, [npu]);
        
        let processoId;
        if (resProcesso.rows.length > 0) {
            processoId = resProcesso.rows[0].id;
        } else {
            const resBusca = await pool.query("SELECT id FROM processos WHERE numero = $1", [npu]);
            processoId = resBusca.rows[0].id;
        }

        // 4. GRAVAÇÃO DO PRAZO
        await pool.query(`
            INSERT INTO prazos (processo_id, tipo, descricao, data_limite, status, usuario_id, escritorio_id)
            VALUES ($1, $2, $3, $4, 'aberto', 1, 1)
        `, [processoId, analise.tipo, analise.desc, dataLimite]);

        console.log("✅ Dados sincronizados no Banco de Dados!");

        // 5. DISPARO DO ALERTA
        await enviarAlertaEmail(analise, npu);

    } catch (err) {
        console.error("❌ Erro na integração:", err.message);
    } finally {
        await pool.end();
        console.log("🏁 Ciclo finalizado.");
    }
}

processarLawTechPro();