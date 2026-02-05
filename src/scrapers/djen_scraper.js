/**
 * 🎯 SCRAPER COMUNICA PJE - VERSÃO ULTRA RESILIENTE
 * 
 * ✅ Windows (desenvolvimento)
 * ✅ Linux local (servidor)
 * ✅ Render.com (produção) - COM RETRY E TIMEOUT ALTO
 */

const pool = require('../config/db');
const path = require('path');
const fs = require('fs');

const isRender = process.env.RENDER === 'true' || process.env.RENDER_SERVICE_NAME !== undefined;
const isWindows = process.platform === 'win32';

console.log('🔍 [AMBIENTE]:', isRender ? 'RENDER' : 'LOCAL');

let puppeteer;
let chromium = null;

if (isRender) {
    try {
        puppeteer = require('puppeteer-core');
        chromium = require('@sparticuz/chromium');
        console.log('✅ puppeteer-core + chromium');
    } catch (err) {
        console.warn('⚠️ Fallback: puppeteer padrão');
        puppeteer = require('puppeteer');
        chromium = null;
    }
} else {
    puppeteer = require('puppeteer');
    console.log(`✅ puppeteer (${isWindows ? 'Windows' : 'Linux'})`);
}

async function getBrowserConfig() {
    if (isRender && chromium) {
        const executablePath = await chromium.executablePath();
        
        return {
            args: [
                ...chromium.args,
                '--single-process',
                '--no-zygote',
                '--disable-dev-shm-usage'
            ],
            defaultViewport: chromium.defaultViewport,
            executablePath: executablePath,
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
            timeout: 180000, // ✅ 3 MINUTOS
            protocolTimeout: 180000
        };
    } else {
        return {
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ],
            timeout: 60000
        };
    }
}

async function buscarPublicacoesDJEN(oab, uf, escritorioId, dataInicio = null, dataFim = null) {
    console.log(`\n🎯 [COMUNICA PJE] Iniciando...`);
    console.log(`   Ambiente: ${isRender ? 'RENDER' : 'LOCAL'}`);
    console.log(`   OAB: ${oab} / UF: ${uf}`);
    
    let browser = null;
    
    try {
        const oabNumeros = oab.replace(/\D/g, '');
        const oabSemZeros = oabNumeros.replace(/^0+/, '');
        
        let dataInicioStr, dataFimStr;
        
        if (dataInicio && dataFim) {
            dataInicioStr = dataInicio;
            dataFimStr = dataFim;
        } else {
            const hoje = new Date();
            const noventaDiasAtras = new Date();
            noventaDiasAtras.setDate(hoje.getDate() - 90);
            dataInicioStr = noventaDiasAtras.toISOString().split('T')[0];
            dataFimStr = hoje.toISOString().split('T')[0];
        }
        
        console.log(`   📅 Período: ${dataInicioStr} a ${dataFimStr}`);
        
        const url = `https://comunica.pje.jus.br/consulta?dataDisponibilizacaoInicio=${dataInicioStr}&dataDisponibilizacaoFim=${dataFimStr}&numeroOab=${oabSemZeros}&ufOab=${uf}`;
        
        console.log(`\n🔗 URL: ${url}`);
        console.log('🌐 Abrindo navegador...');
        
        const config = await getBrowserConfig();
        browser = await puppeteer.launch(config);
        console.log('   ✅ Navegador aberto');
        
        const page = await browser.newPage();
        
        // ✅ TIMEOUT MUITO ALTO NO RENDER
        const timeout = isRender ? 180000 : 30000; // 3 min vs 30s
        await page.setDefaultNavigationTimeout(timeout);
        await page.setDefaultTimeout(timeout);
        console.log(`   ⏱️ Timeout: ${timeout / 1000}s`);
        
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        );
        
        // Otimização Render
        if (isRender) {
            console.log('   🚀 Bloqueando recursos pesados');
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                const type = req.resourceType();
                if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
                    req.abort();
                } else {
                    req.continue();
                }
            });
        }
        
        const screenshotDir = path.join(__dirname, '..', 'debug_screenshots');
        if (!fs.existsSync(screenshotDir)) {
            fs.mkdirSync(screenshotDir, { recursive: true });
        }
        
        // ✅ NAVEGAÇÃO COM RETRY (3 TENTATIVAS)
        console.log('⏳ Carregando página (até 3 tentativas)...');
        
        let carregou = false;
        let tentativa = 1;
        let ultimoErro = null;
        
        while (!carregou && tentativa <= 3) {
            try {
                console.log(`   Tentativa ${tentativa}/3...`);
                
                await page.goto(url, {
                    waitUntil: tentativa === 1 ? 'domcontentloaded' : 'load',
                    timeout: timeout
                });
                
                carregou = true;
                console.log('   ✅ Página carregada!');
                
            } catch (err) {
                ultimoErro = err;
                console.log(`   ⚠️ Tentativa ${tentativa} falhou: ${err.message.substring(0, 50)}`);
                tentativa++;
                
                if (tentativa <= 3) {
                    console.log('   ⏳ Aguardando 10s antes de tentar novamente...');
                    await new Promise(r => setTimeout(r, 10000));
                }
            }
        }
        
        if (!carregou) {
            throw new Error(`Não foi possível carregar após 3 tentativas. Último erro: ${ultimoErro.message}`);
        }
        
        // Aguardar conteúdo
        const waitTime = isRender ? 15000 : 5000;
        console.log(`⏳ Aguardando conteúdo (${waitTime / 1000}s)...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        await page.screenshot({ 
            path: path.join(screenshotDir, 'comunica_pje.png'),
            fullPage: true 
        });
        console.log('📸 Screenshot salvo');
        
        const todasPublicacoes = [];
        const processosJaVistos = new Set();
        
        console.log(`\n📄 ===== PROCESSANDO =====`);
        
        const abas = await detectarAbas(page);
        console.log(`📊 ${abas.length} abas encontradas`);
        
        if (abas.length === 0) {
            const pubs = await extrairPublicacoesPagina(page, '');
            adicionarPublicacoesUnicas(pubs, todasPublicacoes, processosJaVistos);
        } else {
            for (let i = 0; i < abas.length; i++) {
                const aba = abas[i];
                console.log(`🔍 Aba ${i + 1}/${abas.length}: ${aba.texto}`);
                
                try {
                    await clicarAba(page, aba);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    const pubsAba = await extrairPublicacoesPagina(page, aba.texto);
                    const novos = adicionarPublicacoesUnicas(pubsAba, todasPublicacoes, processosJaVistos);
                    
                    console.log(`   ✅ ${pubsAba.length} intimações (${novos} novas)`);
                } catch (errAba) {
                    console.error(`   ❌ ${errAba.message}`);
                }
            }
        }
        
        console.log(`\n✅ Total: ${todasPublicacoes.length} intimações`);
        
        await browser.close();
        
        return await salvarPublicacoes(todasPublicacoes, escritorioId);
        
    } catch (err) {
        console.error('❌ Erro:', err.message);
        
        if (browser) {
            try { await browser.close(); } catch (e) {}
        }
        
        return {
            ok: false,
            erro: err.message,
            total: 0,
            novas: 0,
            duplicadas: 0
        };
    }
}

async function detectarAbas(page) {
    return await page.evaluate(() => {
        let botoes = [];
        let elementos = Array.from(document.querySelectorAll('button[role="tab"]'));
        
        if (elementos.length === 0) {
            elementos = Array.from(document.querySelectorAll('button, a, div'))
                .filter(el => /TJ[A-Z]{2}|TRF\d/i.test(el.innerText || ''));
        }
        
        elementos.forEach(el => {
            const texto = (el.innerText || '').trim();
            if (/TJ[A-Z]{2}|TRF\d/i.test(texto) && texto.length < 20) {
                botoes.push({ texto: texto });
            }
        });
        
        return botoes;
    });
}

async function clicarAba(page, aba) {
    await page.evaluate((abaTexto) => {
        const elementos = Array.from(document.querySelectorAll('button[role="tab"], button, a, div'));
        for (const el of elementos) {
            if ((el.innerText || '').trim() === abaTexto) {
                el.click();
                return true;
            }
        }
        return false;
    }, aba.texto);
}

async function extrairPublicacoesPagina(page, abaAtiva) {
    return await page.evaluate(() => {
        const items = [];
        const seletores = ['[class*="intimacao"]', '[class*="comunicacao"]', 'article', '.card'];
        
        let elementos = [];
        for (const sel of seletores) {
            elementos = Array.from(document.querySelectorAll(sel));
            if (elementos.length > 0) break;
        }
        
        if (elementos.length > 0) {
            elementos.forEach(elem => {
                try {
                    const texto = (elem.innerText || '').trim();
                    const matchProc = texto.match(/(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/);
                    if (!matchProc) return;
                    
                    const matchData = texto.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                    
                    items.push({
                        processo: matchProc[1],
                        data: matchData ? matchData[0] : new Date().toLocaleDateString('pt-BR'),
                        conteudo: texto.replace(/\s+/g, ' ').substring(0, 5000),
                        tribunal: 'PJE',
                        tipo: 'Intimação Eletrônica'
                    });
                } catch (err) {}
            });
            return items;
        }
        
        const textoCompleto = document.body.innerText;
        const processosMatch = Array.from(new Set(
            textoCompleto.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g) || []
        ));
        
        processosMatch.forEach((proc) => {
            const escProc = proc.replace(/[.-]/g, '\\$&');
            const regex = new RegExp(escProc + '([\\s\\S]{100,3000}?)(?=\\d{7}-\\d{2}\\.\\d{4}\\.\\d\\.\\d{2}\\.\\d{4}|$)', 'i');
            const match = textoCompleto.match(regex);
            
            if (match) {
                const conteudo = (proc + ' ' + match[1]).replace(/\s+/g, ' ').trim();
                const matchData = conteudo.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                
                items.push({
                    processo: proc,
                    data: matchData ? matchData[0] : new Date().toLocaleDateString('pt-BR'),
                    conteudo: conteudo.substring(0, 5000),
                    tribunal: 'PJE',
                    tipo: 'Intimação Eletrônica'
                });
            }
        });
        
        return items;
    });
}

function adicionarPublicacoesUnicas(pubs, todasPublicacoes, processosJaVistos) {
    let novos = 0;
    for (const pub of pubs) {
        if (!processosJaVistos.has(pub.processo)) {
            processosJaVistos.add(pub.processo);
            todasPublicacoes.push(pub);
            novos++;
        }
    }
    return novos;
}

async function salvarPublicacoes(publicacoes, escritorioId) {
    console.log(`\n💾 Salvando ${publicacoes.length} publicações...`);
    
    let novas = 0;
    let duplicadas = 0;
    
    for (const pub of publicacoes) {
        try {
            const existe = await pool.query(
                'SELECT id FROM publicacoes WHERE numero_processo = $1 AND escritorio_id = $2',
                [pub.processo, escritorioId]
            );
            
            if (existe.rowCount > 0) {
                duplicadas++;
                continue;
            }
            
            let dataSql = null;
            const partesData = pub.data.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (partesData) {
                dataSql = `${partesData[3]}-${partesData[2]}-${partesData[1]}`;
            } else {
                dataSql = new Date().toISOString().split('T')[0];
            }
            
            await pool.query(
                `INSERT INTO publicacoes 
                 (escritorio_id, numero_processo, data_publicacao, conteudo, tribunal, tipo, status)
                 VALUES ($1, $2, $3, $4, $5, $6, 'pendente')`,
                [escritorioId, pub.processo, dataSql, pub.conteudo, pub.tribunal, pub.tipo]
            );
            
            novas++;
        } catch (errDb) {
            console.error(`❌ ${errDb.message}`);
        }
    }
    
    console.log(`✅ ${novas} novas, ${duplicadas} duplicadas`);
    
    return {
        ok: true,
        total: publicacoes.length,
        novas: novas,
        duplicadas: duplicadas,
        mensagem: novas > 0 ? `${novas} novas intimações!` : 'Nenhuma nova.'
    };
}

module.exports = {
    buscarPublicacoesDJEN
};