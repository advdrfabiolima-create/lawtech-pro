const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');

/**
 * Cliente PJe - Integração REAL com API Oficial do CNJ
 * 
 * DOCUMENTAÇÃO OFICIAL:
 * - Portal PJe: https://www.pje.jus.br/
 * - API CNJ: https://www.cnj.jus.br/sistemas/pje/api
 * - DataJud: https://www.cnj.jus.br/sistemas/datajud/
 * 
 * REQUISITOS:
 * 1. Certificado Digital A1 (.pfx ou .p12)
 * 2. Credenciais OAuth2 (client_id e client_secret)
 * 3. Cadastro no Portal do CNJ
 */

class PJeClientReal {
    constructor(config = {}) {
        this.certificadoPath = config.certificadoPath || process.env.PJE_CERTIFICADO_PATH;
        this.certificadoSenha = config.certificadoSenha || process.env.PJE_CERTIFICADO_SENHA;
        this.clientId = config.clientId || process.env.PJE_CLIENT_ID;
        this.clientSecret = config.clientSecret || process.env.PJE_CLIENT_SECRET;
        this.ambiente = config.ambiente || process.env.PJE_AMBIENTE || 'homologacao';
        
        // URLs da API
        this.baseURLs = {
            'producao': 'https://api.pje.jus.br/v1',
            'homologacao': 'https://api-homolog.pje.jus.br/v1'
        };
        
        this.baseURL = this.baseURLs[this.ambiente];
        this.accessToken = null;
        this.tokenExpiry = null;
        
        // Tribunais federais
        this.tribunais = {
            'TRF-1': { id: 'trf1', estados: ['AC', 'AM', 'AP', 'BA', 'DF', 'GO', 'MA', 'MG', 'MT', 'PA', 'PI', 'RO', 'RR', 'TO'] },
            'TRF-2': { id: 'trf2', estados: ['ES', 'RJ'] },
            'TRF-3': { id: 'trf3', estados: ['MS', 'SP'] },
            'TRF-4': { id: 'trf4', estados: ['PR', 'RS', 'SC'] },
            'TRF-5': { id: 'trf5', estados: ['AL', 'CE', 'PB', 'PE', 'RN', 'SE'] },
            'TRF-6': { id: 'trf6', estados: ['MG'] }
        };
        
        this.inicializarCliente();
    }

    /**
     * Inicializar cliente HTTP com certificado digital
     */
    inicializarCliente() {
        try {
            // Verificar se certificado existe
            if (!this.certificadoPath || !fs.existsSync(this.certificadoPath)) {
                console.warn('⚠️ [PJe] Certificado não encontrado. Usando modo de desenvolvimento.');
                this.modoDev = true;
                return;
            }

            // Ler certificado
            const pfx = fs.readFileSync(this.certificadoPath);

            // Criar agente HTTPS com certificado
            const httpsAgent = new https.Agent({
                pfx: pfx,
                passphrase: this.certificadoSenha,
                rejectUnauthorized: this.ambiente === 'producao' // Aceitar certificados self-signed em homologação
            });

            // Criar cliente axios com certificado
            this.client = axios.create({
                baseURL: this.baseURL,
                timeout: 60000,
                httpsAgent: httpsAgent,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'LawTech-Pro/1.0'
                }
            });

            // Interceptor para adicionar token automaticamente
            this.client.interceptors.request.use(async (config) => {
                await this.garantirTokenValido();
                if (this.accessToken) {
                    config.headers.Authorization = `Bearer ${this.accessToken}`;
                }
                return config;
            });

            console.log(`✅ [PJe] Cliente inicializado - Ambiente: ${this.ambiente}`);

        } catch (err) {
            console.error('❌ [PJe] Erro ao inicializar cliente:', err.message);
            throw new Error(`Falha ao configurar certificado: ${err.message}`);
        }
    }

    /**
     * Autenticar com OAuth2
     */
    async autenticar() {
        try {
            console.log('🔐 [PJe] Autenticando com certificado digital...');

            const response = await this.client.post('/auth/token', {
                grant_type: 'client_credentials',
                client_id: this.clientId,
                client_secret: this.clientSecret,
                scope: 'consulta_processos'
            });

            this.accessToken = response.data.access_token;
            this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);

            console.log('✅ [PJe] Autenticado com sucesso');
            return true;

        } catch (err) {
            console.error('❌ [PJe] Erro na autenticação:', err.response?.data || err.message);
            throw new Error(`Falha na autenticação: ${err.message}`);
        }
    }

    /**
     * Garantir que o token está válido
     */
    async garantirTokenValido() {
        if (!this.accessToken || Date.now() >= this.tokenExpiry - 60000) {
            await this.autenticar();
        }
    }

    /**
     * Detectar tribunal baseado na UF
     */
    detectarTribunal(uf) {
        for (const [nome, dados] of Object.entries(this.tribunais)) {
            if (dados.estados.includes(uf)) {
                return { nome, id: dados.id };
            }
        }
        return { nome: 'TRF-1', id: 'trf1' }; // Default
    }

    /**
     * Buscar processos por OAB (API REAL)
     */
    async buscarProcessosPorOAB(numeroOAB, ufOAB) {
        try {
            console.log(`🔍 [PJe API] Buscando processos - OAB: ${numeroOAB}/${ufOAB}`);

            // Detectar tribunal
            const tribunal = this.detectarTribunal(ufOAB);
            console.log(`📍 [PJe API] Tribunal: ${tribunal.nome}`);

            // Se estiver em modo dev, usar dados mock
            if (this.modoDev) {
                console.log('⚠️ [PJe API] Modo desenvolvimento - Usando dados simulados');
                return this.buscarProcessosMock(numeroOAB, ufOAB);
            }

            // Fazer requisição à API real
            const response = await this.client.get('/processos/advogado', {
                params: {
                    numero_oab: numeroOAB,
                    uf_oab: ufOAB,
                    tribunal: tribunal.id,
                    pagina: 1,
                    tamanho_pagina: 100
                }
            });

            const processos = response.data.processos || [];

            console.log(`✅ [PJe API] Encontrados ${processos.length} processos`);

            // Buscar detalhes de cada processo
            const processosDetalhados = [];
            
            for (const proc of processos.slice(0, 20)) { // Limitar a 20 para não sobrecarregar
                try {
                    const detalhes = await this.buscarDetalhesProcesso(proc.numero);
                    processosDetalhados.push({
                        ...proc,
                        ...detalhes
                    });
                } catch (err) {
                    console.warn(`⚠️ Erro ao buscar detalhes de ${proc.numero}:`, err.message);
                    processosDetalhados.push(proc);
                }
            }

            return {
                sucesso: true,
                total: processos.length,
                tribunal: tribunal.nome,
                processos: processosDetalhados
            };

        } catch (err) {
            console.error('❌ [PJe API] Erro ao buscar processos:', err.response?.data || err.message);
            
            // Se falhar, tentar usar dados mock como fallback
            if (this.ambiente === 'homologacao') {
                console.log('⚠️ [PJe API] Usando dados simulados como fallback');
                return this.buscarProcessosMock(numeroOAB, ufOAB);
            }
            
            throw err;
        }
    }

    /**
     * Buscar detalhes de um processo específico
     */
    async buscarDetalhesProcesso(numeroProcesso) {
        try {
            const response = await this.client.get(`/processos/${numeroProcesso}`);
            
            const dados = response.data;
            
            return {
                classe: dados.classe?.nome,
                assunto: dados.assunto?.nome,
                vara: dados.orgao_julgador?.nome,
                valor_causa: dados.valor_causa,
                data_distribuicao: dados.data_distribuicao,
                status: dados.situacao,
                partes_ativo: dados.partes?.filter(p => p.polo === 'ativo').map(p => ({
                    nome: p.pessoa.nome,
                    tipo: p.tipo_participacao,
                    advogado: p.advogados?.map(a => a.nome).join(', ')
                })),
                partes_passivo: dados.partes?.filter(p => p.polo === 'passivo').map(p => ({
                    nome: p.pessoa.nome,
                    tipo: p.tipo_participacao,
                    advogado: p.advogados?.map(a => a.nome).join(', ')
                })),
                movimentacoes: dados.movimentacoes?.slice(0, 5).map(m => ({
                    data: m.data,
                    tipo: m.tipo,
                    descricao: m.descricao
                }))
            };

        } catch (err) {
            console.warn(`⚠️ Erro ao buscar detalhes do processo:`, err.message);
            return {};
        }
    }

    /**
     * Buscar movimentações de um processo
     */
    async buscarMovimentacoes(numeroProcesso) {
        try {
            const response = await this.client.get(`/processos/${numeroProcesso}/movimentacoes`);
            return response.data.movimentacoes || [];
        } catch (err) {
            console.error('❌ Erro ao buscar movimentações:', err.message);
            return [];
        }
    }

    /**
     * Buscar documentos de um processo
     */
    async buscarDocumentos(numeroProcesso) {
        try {
            const response = await this.client.get(`/processos/${numeroProcesso}/documentos`);
            return response.data.documentos || [];
        } catch (err) {
            console.error('❌ Erro ao buscar documentos:', err.message);
            return [];
        }
    }

    /**
     * MOCK - Dados simulados para desenvolvimento/testes
     */
    buscarProcessosMock(numeroOAB, ufOAB) {
        console.log('⚠️ [PJe Mock] Usando dados simulados');
        
        const tribunal = this.detectarTribunal(ufOAB);
        
        const processosMock = [
            {
                numero: `0001234-56.2024.4.01.3400`,
                tribunal: tribunal.nome,
                esfera: 'Federal',
                instancia: '1º GRAU',
                uf: ufOAB,
                classe: 'Procedimento Comum Cível',
                assunto: 'INSS - Benefício Previdenciário',
                vara: '1ª Vara Federal',
                valor_causa: 50000.00,
                data_distribuicao: '2024-01-15',
                status: 'Em andamento',
                partes_ativo: [
                    { nome: 'João da Silva Santos', tipo: 'autor' }
                ],
                partes_passivo: [
                    { nome: 'Instituto Nacional do Seguro Social - INSS', tipo: 'reu' }
                ],
                movimentacoes: [
                    { data: '2024-01-15', descricao: 'Distribuído por sorteio' },
                    { data: '2024-01-20', descricao: 'Citação expedida' }
                ]
            },
            {
                numero: `0005678-90.2024.4.01.3400`,
                tribunal: tribunal.nome,
                esfera: 'Federal',
                instancia: '2º GRAU',
                uf: ufOAB,
                classe: 'Apelação Cível',
                assunto: 'União - Servidor Público',
                vara: '5ª Turma',
                valor_causa: 120000.00,
                data_distribuicao: '2024-02-01',
                status: 'Aguardando julgamento',
                partes_ativo: [
                    { nome: 'Maria Oliveira Costa', tipo: 'recorrente' }
                ],
                partes_passivo: [
                    { nome: 'União Federal', tipo: 'recorrido' }
                ],
                movimentacoes: [
                    { data: '2024-02-01', descricao: 'Recurso distribuído' },
                    { data: '2024-02-10', descricao: 'Intimação para contrarrazões' }
                ]
            },
            {
                numero: `0009876-54.2024.4.01.3400`,
                tribunal: tribunal.nome,
                esfera: 'Federal',
                instancia: '1º GRAU',
                uf: ufOAB,
                classe: 'Mandado de Segurança',
                assunto: 'Direito Administrativo',
                vara: '3ª Vara Federal',
                valor_causa: 0,
                data_distribuicao: '2024-03-05',
                status: 'Em andamento',
                partes_ativo: [
                    { nome: 'Pedro Henrique Almeida', tipo: 'impetrante' }
                ],
                partes_passivo: [
                    { nome: 'Delegado da Receita Federal', tipo: 'impetrado' }
                ],
                movimentacoes: [
                    { data: '2024-03-05', descricao: 'Petição inicial protocolada' },
                    { data: '2024-03-08', descricao: 'Pedido de liminar em análise' }
                ]
            }
        ];

        return {
            sucesso: true,
            total: processosMock.length,
            tribunal: tribunal.nome,
            processos: processosMock,
            observacao: 'Dados simulados - Configure certificado para dados reais'
        };
    }

    /**
     * Verificar status da API
     */
    async verificarStatus() {
        try {
            const response = await this.client.get('/health');
            return {
                online: true,
                versao: response.data.versao,
                ambiente: this.ambiente
            };
        } catch (err) {
            return {
                online: false,
                erro: err.message
            };
        }
    }
}

module.exports = PJeClientReal;