/**
 * Migration 001 — Secondary tables
 *
 * Contains all tables/columns that were previously managed inline inside
 * iniciarSistema() in server.js. Uses ifNotExists everywhere so it is
 * safe to run against an already-bootstrapped database.
 */

exports.up = async (pgm) => {
    // ── webhook_events ─────────────────────────────────────────────────────────
    pgm.createTable('webhook_events', {
        id:           { type: 'serial', primaryKey: true },
        event_id:     { type: 'varchar(255)', notNull: true, unique: true },
        source:       { type: 'varchar(50)', notNull: true },
        processed_at: { type: 'timestamp', default: pgm.func('NOW()') }
    }, { ifNotExists: true });

    // ── logs_sistema ───────────────────────────────────────────────────────────
    pgm.createTable('logs_sistema', {
        id:           { type: 'serial', primaryKey: true },
        escritorio_id:{ type: 'integer' },
        servico:      { type: 'varchar(100)' },
        tipo_erro:    { type: 'varchar(100)' },
        mensagem_erro:{ type: 'text' },
        criado_em:    { type: 'timestamp', default: pgm.func('NOW()') }
    }, { ifNotExists: true });
    pgm.createIndex('logs_sistema', 'criado_em', { name: 'idx_logs_sistema_criado', ifNotExists: true });

    // ── audit_log ──────────────────────────────────────────────────────────────
    pgm.createTable('audit_log', {
        id:           { type: 'serial', primaryKey: true },
        usuario_id:   { type: 'integer' },
        email:        { type: 'varchar(255)' },
        escritorio_id:{ type: 'integer' },
        tipo_evento:  { type: 'varchar(100)' },
        acao:         { type: 'varchar(100)' },
        descricao:    { type: 'text' },
        metadata:     { type: 'jsonb' },
        ip:           { type: 'varchar(45)' },
        user_agent:   { type: 'text' },
        criado_em:    { type: 'timestamp', default: pgm.func('NOW()') }
    }, { ifNotExists: true });
    pgm.createIndex('audit_log', 'acao',       { name: 'idx_audit_log_acao',    ifNotExists: true });
    pgm.createIndex('audit_log', 'usuario_id', { name: 'idx_audit_log_usuario', ifNotExists: true });
    pgm.createIndex('audit_log', 'criado_em',  { name: 'idx_audit_log_created', ifNotExists: true });

    // ── consentimentos ─────────────────────────────────────────────────────────
    pgm.createTable('consentimentos', {
        id:         { type: 'serial', primaryKey: true },
        usuario_id: { type: 'integer', notNull: true },
        tipo:       { type: 'varchar(50)', notNull: true },
        aceito:     { type: 'boolean', notNull: true },
        ip:         { type: 'varchar(45)' },
        created_at: { type: 'timestamp', default: pgm.func('NOW()') }
    }, { ifNotExists: true });
    pgm.createIndex('consentimentos', 'usuario_id', { name: 'idx_consentimentos_usuario', ifNotExists: true });

    // ── transacoes ─────────────────────────────────────────────────────────────
    pgm.createTable('transacoes', {
        id:           { type: 'serial', primaryKey: true },
        escritorio_id:{ type: 'integer' },
        gateway_id:   { type: 'varchar(255)' },
        gateway:      { type: 'varchar(50)' },
        valor:        { type: 'numeric(10,2)' },
        status:       { type: 'varchar(50)' },
        descricao:    { type: 'text' },
        created_at:   { type: 'timestamp', default: pgm.func('NOW()') }
    }, { ifNotExists: true });
    pgm.createIndex('transacoes', 'gateway_id', {
        name: 'idx_transacoes_gateway_id_unique',
        unique: true,
        where: 'gateway_id IS NOT NULL',
        ifNotExists: true
    });

    // ── feriados_suspensoes ────────────────────────────────────────────────────
    pgm.createTable('feriados_suspensoes', {
        id:           { type: 'serial', primaryKey: true },
        escritorio_id:{ type: 'integer', notNull: true },
        titulo:       { type: 'varchar(200)', notNull: true },
        data:         { type: 'date', notNull: true },
        tipo:         { type: 'varchar(20)', notNull: true },
        abrangencia:  { type: 'varchar(20)', default: "'local'" },
        recorrente:   { type: 'boolean', default: false },
        created_at:   { type: 'timestamp', default: pgm.func('NOW()') }
    }, { ifNotExists: true });

    // ── config_alertas ─────────────────────────────────────────────────────────
    pgm.createTable('config_alertas', {
        id:           { type: 'serial', primaryKey: true },
        escritorio_id:{ type: 'integer', notNull: true, unique: true },
        dias_alerta_1:{ type: 'integer', default: 7 },
        dias_alerta_2:{ type: 'integer', default: 3 },
        dias_alerta_3:{ type: 'integer', default: 1 },
        email_ativo:  { type: 'boolean', default: true },
        inapp_ativo:  { type: 'boolean', default: true },
        hora_envio:   { type: 'varchar(5)', default: "'08:00'" },
        updated_at:   { type: 'timestamp', default: pgm.func('NOW()') }
    }, { ifNotExists: true });

    // ── notificacoes ───────────────────────────────────────────────────────────
    pgm.createTable('notificacoes', {
        id:           { type: 'serial', primaryKey: true },
        escritorio_id:{ type: 'integer', notNull: true },
        usuario_id:   { type: 'integer', notNull: true },
        prazo_id:     { type: 'integer' },
        tipo:         { type: 'varchar(20)', notNull: true },
        titulo:       { type: 'varchar(300)' },
        mensagem:     { type: 'text' },
        lida:         { type: 'boolean', default: false },
        enviada_em:   { type: 'timestamp', default: pgm.func('NOW()') }
    }, { ifNotExists: true });
    pgm.createIndex('notificacoes', ['usuario_id', 'lida'], { name: 'idx_notificacoes_usuario', ifNotExists: true });

    // ── chat_mensagens ─────────────────────────────────────────────────────────
    pgm.createTable('chat_mensagens', {
        id:              { type: 'serial', primaryKey: true },
        escritorio_id:   { type: 'integer', notNull: true },
        remetente_id:    { type: 'integer', notNull: true },
        destinatario_id: { type: 'integer' },
        conteudo:        { type: 'text', notNull: true },
        lida:            { type: 'boolean', default: false },
        arquivo_nome:    { type: 'varchar(255)' },
        arquivo_path:    { type: 'varchar(500)' },
        criado_em:       { type: 'timestamp', default: pgm.func('NOW()') }
    }, { ifNotExists: true });
    pgm.createIndex('chat_mensagens', ['escritorio_id', 'criado_em'], { name: 'idx_chat_escritorio_criado', ifNotExists: true });
    pgm.createIndex('chat_mensagens', 'remetente_id',    { name: 'idx_chat_remetente',    ifNotExists: true });
    pgm.createIndex('chat_mensagens', 'destinatario_id', { name: 'idx_chat_destinatario', ifNotExists: true });

    // ── lead_atividades ────────────────────────────────────────────────────────
    pgm.createTable('lead_atividades', {
        id:           { type: 'serial', primaryKey: true },
        lead_id:      { type: 'integer', notNull: true },
        escritorio_id:{ type: 'integer', notNull: true },
        tipo:         { type: 'varchar(50)', notNull: true },
        descricao:    { type: 'text' },
        criado_em:    { type: 'timestamp', default: pgm.func('NOW()') }
    }, { ifNotExists: true });
    pgm.createIndex('lead_atividades', 'lead_id',      { name: 'idx_lead_ativ_lead',      ifNotExists: true });
    pgm.createIndex('lead_atividades', ['escritorio_id', 'criado_em'], { name: 'idx_lead_ativ_escritorio', ifNotExists: true });

    // ── documentos ────────────────────────────────────────────────────────────
    pgm.createTable('documentos', {
        id:               { type: 'serial', primaryKey: true },
        escritorio_id:    { type: 'integer', notNull: true },
        processo_id:      { type: 'integer' },
        usuario_id:       { type: 'integer', notNull: true },
        nome:             { type: 'varchar(300)', notNull: true },
        descricao:        { type: 'text' },
        categoria:        { type: 'varchar(80)', notNull: true, default: "'outros'" },
        tags:             { type: 'text' },
        arquivo_nome:     { type: 'varchar(300)', notNull: true },
        arquivo_original: { type: 'varchar(300)', notNull: true },
        mimetype:         { type: 'varchar(100)', notNull: true },
        tamanho:          { type: 'integer', notNull: true },
        versao:           { type: 'integer', notNull: true, default: 1 },
        documento_pai_id: { type: 'integer' },
        eh_modelo:        { type: 'boolean', notNull: true, default: false },
        criado_em:        { type: 'timestamp', default: pgm.func('NOW()') },
        atualizado_em:    { type: 'timestamp', default: pgm.func('NOW()') }
    }, { ifNotExists: true });
    pgm.createIndex('documentos', 'escritorio_id',  { name: 'idx_doc_escritorio', ifNotExists: true });
    pgm.createIndex('documentos', ['processo_id', 'escritorio_id'], { name: 'idx_doc_processo', ifNotExists: true });
    pgm.createIndex('documentos', ['escritorio_id', 'eh_modelo'], {
        name: 'idx_doc_modelo',
        where: 'eh_modelo = true',
        ifNotExists: true
    });
    pgm.createIndex('documentos', 'documento_pai_id', { name: 'idx_doc_pai', ifNotExists: true });

    // ── assinaturas_digitais ───────────────────────────────────────────────────
    pgm.createTable('assinaturas_digitais', {
        id:                    { type: 'serial', primaryKey: true },
        documento_id:          { type: 'integer', notNull: true },
        escritorio_id:         { type: 'integer', notNull: true },
        usuario_id:            { type: 'integer', notNull: true },
        clicksign_document_key:{ type: 'varchar(200)' },
        status:                { type: 'varchar(50)', notNull: true, default: "'criando'" },
        signatarios:           { type: 'jsonb', default: "'[]'::jsonb" },
        mensagem:              { type: 'text' },
        deadline:              { type: 'date' },
        link_assinatura:       { type: 'text' },
        criado_em:             { type: 'timestamp', default: pgm.func('NOW()') },
        atualizado_em:         { type: 'timestamp', default: pgm.func('NOW()') },
        concluido_em:          { type: 'timestamp' }
    }, { ifNotExists: true });
    pgm.createIndex('assinaturas_digitais', 'documento_id',  { name: 'idx_assdig_doc', ifNotExists: true });
    pgm.createIndex('assinaturas_digitais', 'escritorio_id', { name: 'idx_assdig_esc', ifNotExists: true });

    // ── andamentos_processuais ─────────────────────────────────────────────────
    pgm.createTable('andamentos_processuais', {
        id:              { type: 'serial', primaryKey: true },
        processo_id:     { type: 'integer', notNull: true, references: '"processos"', onDelete: 'CASCADE' },
        escritorio_id:   { type: 'integer', notNull: true },
        usuario_id:      { type: 'integer' },
        data_andamento:  { type: 'date', notNull: true },
        tipo:            { type: 'varchar(50)', default: "'outros'" },
        titulo:          { type: 'varchar(200)', notNull: true },
        descricao:       { type: 'text' },
        visivel_cliente: { type: 'boolean', default: false },
        fonte:           { type: 'varchar(20)', default: "'manual'" },
        criado_em:       { type: 'timestamptz', default: pgm.func('NOW()') }
    }, { ifNotExists: true });
    pgm.createIndex('andamentos_processuais', 'processo_id', { name: 'idx_andamentos_processo', ifNotExists: true });

    // ── reunioes ───────────────────────────────────────────────────────────────
    pgm.createTable('reunioes', {
        id:               { type: 'serial', primaryKey: true },
        escritorio_id:    { type: 'integer', notNull: true },
        cliente_id:       { type: 'integer', references: '"clientes"' },
        usuario_id:       { type: 'integer', references: '"usuarios"' },
        titulo:           { type: 'varchar(200)', notNull: true },
        descricao:        { type: 'text' },
        data_hora:        { type: 'timestamptz', notNull: true },
        duracao_minutos:  { type: 'integer', default: 60 },
        daily_room_name:  { type: 'varchar(150)' },
        daily_room_url:   { type: 'varchar(400)' },
        status:           { type: 'varchar(20)', default: "'agendada'" },
        peer_host_id:     { type: 'varchar(100)' },
        anotacoes:        { type: 'text' },
        criado_em:        { type: 'timestamptz', default: pgm.func('NOW()') },
        atualizado_em:    { type: 'timestamptz', default: pgm.func('NOW()') }
    }, { ifNotExists: true });
    pgm.createIndex('reunioes', 'escritorio_id', { name: 'idx_reunioes_escritorio', ifNotExists: true });

    // ── Column additions (idempotent via IF NOT EXISTS) ────────────────────────
    pgm.addColumns('escritorios', {
        retry_count:                   { type: 'integer', default: 0 }
    }, { ifNotExists: true });
    pgm.addColumns('escritorios', {
        clicksign_addon_ativo:         { type: 'boolean', default: false }
    }, { ifNotExists: true });
    pgm.addColumns('escritorios', {
        clicksign_addon_limite:        { type: 'integer', default: 20 }
    }, { ifNotExists: true });
    pgm.addColumns('escritorios', {
        clicksign_addon_usado:         { type: 'integer', default: 0 }
    }, { ifNotExists: true });
    pgm.addColumns('escritorios', {
        clicksign_addon_periodo_inicio: { type: 'timestamp' }
    }, { ifNotExists: true });
    pgm.addColumns('escritorios', {
        clicksign_addon_stripe_sub_id: { type: 'varchar(200)' }
    }, { ifNotExists: true });
    pgm.addColumns('escritorios', {
        clicksign_api_key:             { type: 'text' }
    }, { ifNotExists: true });
    pgm.addColumns('escritorios', {
        preferencia_pagamento:         { type: 'varchar(10)', default: "'cartao'" }
    }, { ifNotExists: true });
    pgm.addColumns('escritorios', {
        ical_token:                    { type: 'varchar(64)' }
    }, { ifNotExists: true });
    pgm.addColumns('escritorios', {
        logo_arquivo:                  { type: 'varchar(200)' }
    }, { ifNotExists: true });
    pgm.addColumns('escritorios', {
        logo_base64:                   { type: 'text' }
    }, { ifNotExists: true });
    pgm.addColumns('escritorios', {
        logo_path_base64:              { type: 'text' }
    }, { ifNotExists: true });
    pgm.addColumns('escritorios', {
        assinatura_base64:             { type: 'text' }
    }, { ifNotExists: true });

    pgm.addColumns('usuarios', {
        is_master:                 { type: 'boolean', default: false }
    }, { ifNotExists: true });
    pgm.addColumns('usuarios', {
        ultimo_acesso:             { type: 'timestamptz' }
    }, { ifNotExists: true });
    pgm.addColumns('usuarios', {
        reset_token:               { type: 'varchar(255)' }
    }, { ifNotExists: true });
    pgm.addColumns('usuarios', {
        reset_token_expira:        { type: 'timestamptz' }
    }, { ifNotExists: true });
    pgm.addColumns('usuarios', {
        totp_secret:               { type: 'text' }
    }, { ifNotExists: true });
    pgm.addColumns('usuarios', {
        totp_ativo:                { type: 'boolean', default: false }
    }, { ifNotExists: true });
    pgm.addColumns('usuarios', {
        totp_backup_codes:         { type: 'text' }
    }, { ifNotExists: true });
    pgm.addColumns('usuarios', {
        totp_ativado_em:           { type: 'timestamptz' }
    }, { ifNotExists: true });
    pgm.addColumns('usuarios', {
        email_verificado:          { type: 'boolean', default: false }
    }, { ifNotExists: true });
    pgm.addColumns('usuarios', {
        email_verificacao_token:   { type: 'varchar(64)' }
    }, { ifNotExists: true });
    pgm.addColumns('usuarios', {
        email_verificacao_expira:  { type: 'timestamptz' }
    }, { ifNotExists: true });

    pgm.addColumns('leads', {
        score:                       { type: 'integer', default: 0 }
    }, { ifNotExists: true });
    pgm.addColumns('leads', {
        ultima_movimentacao:         { type: 'timestamp', default: pgm.func('NOW()') }
    }, { ifNotExists: true });
    pgm.addColumns('leads', {
        email_boas_vindas_enviado:   { type: 'boolean', default: false }
    }, { ifNotExists: true });

    pgm.addColumns('clientes', {
        portal_token:          { type: 'varchar(64)' }
    }, { ifNotExists: true });
    pgm.addColumns('clientes', {
        portal_token_expira_em:{ type: 'timestamptz' }
    }, { ifNotExists: true });
};

exports.down = async () => {
    // No-op — never drop production tables automatically.
};
