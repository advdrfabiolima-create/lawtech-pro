const cron = require('node-cron');
const pool = require('../config/db');
const axios = require('axios');

/**
 * Motor de Agendamentos LawTech Pro
 * Gerencia alertas de prazos (1min) e busca de publicações (03h e 12h)
 */
const iniciarAgendamentos = () => {
    
    // --- TAREFA 1: VERIFICAR PRAZOS VENCIDOS E ENVIAR E-MAIL ---
    // Roda a cada minuto para garantir alertas em tempo real
    cron.schedule('* * * * *', async () => {
        console.log('⏰ Verificando prazos vencidos e enviando alertas...');

        try {
            // 1. Busca prazos vencidos ainda abertos
            const result = await pool.query(`
                SELECT id FROM prazos
                WHERE status = 'aberto' AND data_limite < NOW()
            `);

            for (const prazo of result.rows) {
                // Marca como vencido no banco
                await pool.query(`UPDATE prazos SET status = 'vencido' WHERE id = $1`, [prazo.id]);
                
                // Registra alerta para processamento de e-mail
                await pool.query(
                    `INSERT INTO alertas (prazo_id, tipo) VALUES ($1, 'prazo_vencido')`,
                    [prazo.id]
                );
                console.log(`🚨 Alerta criado para prazo ${prazo.id}`);
            }

            // 2. Busca alertas ainda não enviados para disparar e-mail via Brevo
            const alertasPendentes = await pool.query(`
                SELECT a.id AS alerta_id, a.tipo, p.data_limite, pr.numero AS processo_numero
                FROM alertas a
                JOIN prazos p ON p.id = a.prazo_id
                JOIN processos pr ON pr.id = p.processo_id
                WHERE a.enviado = false
            `);

            for (const alerta of alertasPendentes.rows) {
                try {
                    await axios.post('https://api.brevo.com/v3/smtp/email', {
                        sender: { name: 'LawTech Pro Alertas', email: process.env.BREVO_SENDER },
                        to: [{ email: process.env.ALERTA_EMAIL_DESTINO, name: 'Responsável Jurídico' }],
                        subject: '⚠️ Alerta de Prazo Jurídico',
                        htmlContent: `
                            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
                                <h2 style="color: #ef4444;">⚠️ Prazo Vencido</h2>
                                <p><strong>Processo:</strong> ${alerta.processo_numero}</p>
                                <p><strong>Tipo:</strong> ${alerta.tipo}</p>
                                <p><strong>Data limite:</strong> ${new Date(alerta.data_limite).toLocaleDateString('pt-BR')}</p>
                                <hr>
                                <p style="font-size: 12px; color: #666;">Enviado automaticamente por LawTech Pro.</p>
                            </div>`
                    }, {
                        headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' }
                    });

                    await pool.query(`UPDATE alertas SET enviado = true WHERE id = $1`, [alerta.alerta_id]);
                    console.log(`📧 E-mail de alerta enviado: ${alerta.alerta_id}`);
                } catch (err) {
                    console.error(`❌ Erro ao disparar e-mail: ${err.message}`);
                }
            }
        } catch (error) {
            console.error('❌ Erro no cron de prazos:', error.message);
        }
    });

    // --- TAREFA 2: BUSCA DE PUBLICAÇÕES VIA API (03:00 e 12:00) ---
    // Agendamento duplo para máxima cobertura dos diários oficiais
    const agendarBuscaPublicacoes = () => {
        const horarios = ['0 3 * * *', '0 12 * * *']; 

        horarios.forEach(horario => {
            cron.schedule(horario, async () => {
                const rotulo = horario === '0 3 * * *' ? 'Madrugada (03h)' : 'Meio-dia (12h)';
                console.log(`⏰ [CRON] Iniciando varredura de publicações: ${rotulo}...`);
                
                try {
                    // Busca todos os escritórios ativos (SaaS multi-tenant)
                    const escritorios = await pool.query('SELECT id, oab, uf FROM escritorios WHERE oab IS NOT NULL');

                    for (const esc of escritorios.rows) {
                        console.log(`📡 Consultando provedor para OAB: ${esc.oab}/${esc.uf}`);

                        // Chamada para o provedor de dados jurídicos (OAB API)
                        const response = await axios.get(`https://api.provedor.com/v1/monitoramento/oab/${esc.oab}/${esc.uf}`, {
                            headers: { 'api-key': process.env.API_JURIDICA_KEY }
                        });

                        const publicacoes = response.data.itens || [];

                        for (const pub of publicacoes) {
                            // Salva no banco com tratamento de conflito (evita duplicar se a API repetir o dado)
                            await pool.query(`
                                INSERT INTO publicacoes (escritorio_id, numero_processo, conteudo, data_publicacao, tribunal)
                                VALUES ($1, $2, $3, $4, $5)
                                ON CONFLICT (numero_processo, data_publicacao) DO NOTHING
                            `, [esc.id, pub.processo, pub.texto, pub.data, pub.tribunal]);
                        }
                    }
                    console.log(`✅ Varredura ${rotulo} concluída com sucesso.`);
                } catch (error) {
                    console.error(`❌ Erro na varredura ${rotulo}:`, error.message);
                }
            });
        });
    };

    // Inicializa a sub-tarefa de publicações
    agendarBuscaPublicacoes();

    console.log('✅ Sistema de Agendamentos Ativado (Fábio Lima da Silva - OAB/BA 51.288)');
};

module.exports = { iniciarAgendamentos };