/**
 * Cron de follow-up de onboarding
 *
 * Dispara dois e-mails para usuários em trial que não completaram o setup:
 *  - Dia 3: não configurou o escritório ainda
 *  - Dia 6: trial expira amanhã (último lembrete de urgência)
 *
 * Executa diariamente às 10h.
 */
const cron = require('node-cron');
const pool = require('../config/db');
const { enviarEmail } = require('../services/emailService');
const logger = require('../utils/logger');

// ─── Templates ────────────────────────────────────────────────────────────────

function htmlDia3(nome, diasRestantes) {
    return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
        <tr><td style="background:#1E3A5F;padding:28px 32px;">
          <h1 style="color:#ffffff;margin:0;font-size:22px;">LawTech Pro</h1>
          <p style="color:#93c5fd;margin:6px 0 0;font-size:13px;">Sistema de Gestão Jurídica</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="color:#1e293b;font-size:18px;margin:0 0 12px;">Olá, Dr(a). ${nome}!</h2>
          <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
            Notamos que você criou sua conta há 3 dias, mas ainda não configurou seu escritório. São apenas 2 minutos e fazem toda a diferença — o sistema só começa a funcionar de verdade após essa etapa.
          </p>
          <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
            Siga esta ordem rápida para ativar tudo:
          </p>
          <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px;">
            <tr>
              <td style="padding:10px 12px;background:#eff6ff;border-radius:8px;margin-bottom:8px;border-left:4px solid #3b82f6;">
                <strong style="color:#1d4ed8;">① Configurar escritório</strong>
                <span style="color:#64748b;font-size:13px;display:block;">Preencha nome, OAB e endereço em <em>Configurações</em></span>
              </td>
            </tr>
            <tr><td style="height:8px;"></td></tr>
            <tr>
              <td style="padding:10px 12px;background:#f0fdf4;border-radius:8px;border-left:4px solid #22c55e;">
                <strong style="color:#15803d;">② Cadastrar clientes</strong>
                <span style="color:#64748b;font-size:13px;display:block;">Adicione seus clientes no menu <em>Clientes</em></span>
              </td>
            </tr>
            <tr><td style="height:8px;"></td></tr>
            <tr>
              <td style="padding:10px 12px;background:#fefce8;border-radius:8px;border-left:4px solid #eab308;">
                <strong style="color:#a16207;">③ Cadastrar processos</strong>
                <span style="color:#64748b;font-size:13px;display:block;">Vincule os processos aos seus clientes</span>
              </td>
            </tr>
          </table>
          <p style="color:#64748b;font-size:13px;margin:0 0 24px;">
            Seu trial ainda está ativo por <strong>${diasRestantes} dias</strong>. Aproveite!
          </p>
          <div style="text-align:center;">
            <a href="https://www.lawtechpro.com.br/config"
               style="display:inline-block;background:#1E3A5F;color:#ffffff;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;">
              Configurar meu escritório agora →
            </a>
          </div>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
          <p style="color:#94a3b8;font-size:12px;margin:0;">
            Você recebe este e-mail porque está em período de trial na LawTech Pro.<br>
            <a href="https://www.lawtechpro.com.br" style="color:#3b82f6;text-decoration:none;">lawtechpro.com.br</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function htmlDia6(nome) {
    return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
        <tr><td style="background:#7f1d1d;padding:28px 32px;">
          <h1 style="color:#ffffff;margin:0;font-size:22px;">LawTech Pro</h1>
          <p style="color:#fca5a5;margin:6px 0 0;font-size:13px;">Seu trial expira amanhã</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="color:#1e293b;font-size:18px;margin:0 0 12px;">Dr(a). ${nome}, restam menos de 24 horas!</h2>
          <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
            Seu período de avaliação gratuita da LawTech Pro <strong>expira amanhã</strong>. Não perca o acesso ao sistema que vai transformar a gestão do seu escritório.
          </p>
          <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
            Ative sua assinatura agora e continue usando sem interrupção — gestão de clientes, processos, prazos automáticos, publicações DJe, assinatura digital e muito mais.
          </p>
          <div style="text-align:center;margin-bottom:24px;">
            <a href="https://www.lawtechpro.com.br/planos-page"
               style="display:inline-block;background:#dc2626;color:#ffffff;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;">
              Ativar minha assinatura agora →
            </a>
          </div>
          <p style="color:#64748b;font-size:13px;margin:0;text-align:center;">
            Dúvidas? Responda este e-mail ou fale conosco em <a href="https://www.lawtechpro.com.br" style="color:#3b82f6;">lawtechpro.com.br</a>
          </p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
          <p style="color:#94a3b8;font-size:12px;margin:0;">
            Você recebe este e-mail porque está em período de trial na LawTech Pro.<br>
            <a href="https://www.lawtechpro.com.br" style="color:#3b82f6;text-decoration:none;">lawtechpro.com.br</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Cron — 10h diariamente ───────────────────────────────────────────────────
cron.schedule('0 10 * * *', async () => {
    logger.info('[ONBOARDING] Iniciando verificação de follow-up de onboarding...');
    try {
        // Busca escritórios em trial com usuário admin
        const { rows: escritorios } = await pool.query(`
            SELECT e.id AS escritorio_id,
                   e.trial_expira_em,
                   e.oab,
                   u.nome,
                   u.email,
                   u.id AS usuario_id,
                   e.criado_em AS escritorio_criado_em
            FROM escritorios e
            JOIN usuarios u ON u.escritorio_id = e.id AND u.role = 'admin'
            WHERE e.plano_financeiro_status = 'trial'
              AND e.trial_expira_em IS NOT NULL
              AND e.trial_expira_em > NOW()
        `);

        logger.info(`[ONBOARDING] ${escritorios.length} escritório(s) em trial encontrado(s).`);

        for (const esc of escritorios) {
            const agora = new Date();
            const criadoEm = new Date(esc.escritorio_criado_em);
            const expira = new Date(esc.trial_expira_em);

            const diasDesdeRegistro = Math.floor((agora - criadoEm) / 86400000);
            const diasParaExpirar   = Math.ceil((expira - agora) / 86400000);

            // ── Verificar se onboarding está incompleto ──────────────────────
            const [clientesRes, processosRes] = await Promise.all([
                pool.query('SELECT COUNT(*) FROM clientes WHERE escritorio_id = $1 AND deletado IS NOT TRUE', [esc.escritorio_id]),
                pool.query('SELECT COUNT(*) FROM processos WHERE escritorio_id = $1', [esc.escritorio_id])
            ]);
            const temOab      = !!(esc.oab && esc.oab.trim() !== '');
            const temCliente  = parseInt(clientesRes.rows[0].count) >= 1;
            const temProcesso = parseInt(processosRes.rows[0].count) >= 1;
            const onboardingOk = temOab && temCliente && temProcesso;

            // ── E-mail Dia 3: ainda sem configuração ─────────────────────────
            if (diasDesdeRegistro === 3 && !onboardingOk) {
                logger.info(`[ONBOARDING] Enviando e-mail dia 3 para ${esc.email} (escritório ${esc.escritorio_id})`);
                await enviarEmail({
                    para: esc.email,
                    assunto: `Dr(a). ${esc.nome}, seu escritório ainda não está configurado`,
                    html: htmlDia3(esc.nome, diasParaExpirar)
                });
            }

            // ── E-mail Dia 6: penúltimo dia do trial ─────────────────────────
            if (diasParaExpirar === 1) {
                logger.info(`[ONBOARDING] Enviando e-mail dia 6 (expira amanhã) para ${esc.email} (escritório ${esc.escritorio_id})`);
                await enviarEmail({
                    para: esc.email,
                    assunto: `⚠️ Dr(a). ${esc.nome}, seu trial expira amanhã — ative agora`,
                    html: htmlDia6(esc.nome)
                });
            }
        }

        logger.info('[ONBOARDING] Follow-up concluído.');
    } catch (err) {
        logger.error({ err: err.message }, '[ONBOARDING] Erro no cron de follow-up');
    }
});
