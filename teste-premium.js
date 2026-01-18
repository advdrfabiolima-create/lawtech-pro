const pool = require('./src/config/db');

async function simularPublicacoes() {
    try {
        console.log("🚀 Iniciando Simulação de Dados Premium (Modo Amplo)...");

        // BUSCA QUALQUER ESCRITÓRIO ATIVO NO BANCO
        const esc = await pool.query(
            "SELECT id, nome, oab FROM escritorios WHERE plano_financeiro_status = 'ativo' LIMIT 1"
        );

        if (esc.rowCount === 0) {
            console.log("❌ Erro: Nenhum escritório com status 'ativo' encontrado no Neon.");
            return;
        }

        const escritorioId = esc.rows[0].id;
        console.log(`📡 Injetando dados para: ${esc.rows[0].nome} (ID: ${escritorioId})`);

        const simulacoes = [
            {
                processo: '0034009-53.2025.8.05.0080',
                conteudo: 'SENTENÇA PROCEDENTE: Julgo extinto o processo com resolução de mérito.',
                tribunal: 'TJBA'
            },
            {
                processo: '0012345-67.2025.8.05.0001',
                conteudo: 'ACORDO HOMOLOGADO: Partes transacionam o valor da causa.',
                tribunal: 'TJBA'
            }
        ];

        for (const sim of simulacoes) {
            await pool.query(
    `INSERT INTO publicacoes_djen (numero_processo, conteudo, data_publicacao, tribunal, escritorio_id) 
     VALUES ($1, $2, NOW(), $3, $4) ON CONFLICT DO NOTHING`,
    [sim.processo, sim.conteudo, sim.tribunal, escritorioId]
);
        }

        console.log("\n✨ SUCESSO! Dados injetados com sucesso.");
        console.log("👉 Acesse: http://localhost:3000/api/publicacoes/listar");
        process.exit();

    } catch (err) {
        console.error("❌ Erro crítico na simulação:", err.message);
        process.exit(1);
    }
}

simularPublicacoes();