/**
 * 🎯 SCRAPER COMUNICA PJE - VERSÃO UNIVERSAL
 * 
 * ✅ Windows (desenvolvimento)
 * ✅ Linux (servidor local)
 * ✅ Render.com (produção)
 */

const pool = require('../config/db');
const path = require('path');
const fs = require('fs');

// ✅ DETECÇÃO AUTOMÁTICA DE AMBIENTE - CORRIGIDA
const isRender = process.env.RENDER === 'true';
const isProduction = process.env.NODE_ENV === 'production';
const isWindows = process.platform === 'win32';

// ✅ Usar puppeteer-core APENAS no Render, não em produção local
const shouldUseChromium = isRender && !isWindows;

let puppeteer;
let chromium = null;

// Carregar dependências corretas baseado no ambiente
if (shouldUseChromium) {
    // PRODUÇÃO NO RENDER (Linux serverless)
    try {
        puppeteer = require('puppeteer-core');
        chromium = require('@sparticuz/chromium');
        console.log('✅ Modo RENDER: puppeteer-core + @sparticuz/chromium');
    } catch (err) {
        console.warn('⚠️ Fallback para puppeteer padrão');
        puppeteer = require('puppeteer');
        chromium = null;
    }
} else {
    // DESENVOLVIMENTO ou PRODUÇÃO LOCAL (Windows/Linux com Chrome instalado)
    puppeteer = require('puppeteer');
    console.log(`✅ Modo ${isWindows ? 'DESENVOLVIMENTO WINDOWS' : 'LOCAL'}: puppeteer`);
}

async function getBrowserConfig() {
    // ✅ Usar chromium APENAS se estiver no Render
    if (shouldUseChromium && chromium) {
        console.log('   🚀 Usando Chromium serverless (Render)');
        return {
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true
        };
    } else {
        // Local - Deixar Puppeteer encontrar Chrome automaticamente
        console.log('   🖥️ Usando Chrome/Chromium local');
        return {
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu'
            ]
            // ✅ NÃO definir executablePath - deixa Puppeteer achar sozinho
        };
    }
}

async function buscarPublicacoesDJEN(oab, uf, escritorioId, dataInicio = null, dataFim = null) {
    console.log(`\n🎯 [COMUNICA PJE] Iniciando busca...`);
    console.log(`   🌍 Ambiente: ${isRender ? 'RENDER' : isWindows ? 'WINDOWS' : 'LINUX LOCAL'}`);
    console.log(`   📦 NODE_ENV: ${process.env.NODE_ENV || 'não definido'}`);
    console.log(`   💻 Platform: ${process.platform}`);
    console.log(`   🔧 Usando Chromium: ${shouldUseChromium ? 'SIM' : 'NÃO'}`);
    console.log(`   OAB: ${oab}`);
    console.log(`   UF: ${uf}`);
    console.log(`   Escritório ID: ${escritorioId}`);
    
    let browser = null;
    
    try {
        const oabNumeros = oab.replace(/\D/g, '');
        const oabSemZeros = oabNumeros.replace(/^0+/, '');
        
        console.log(`   OAB formatada: ${oabSemZeros}`);
        
        let dataInicioStr, dataFimStr;
        
        if (dataInicio && dataFim) {
            dataInicioStr = dataInicio;
            dataFimStr = dataFim;
            console.log(`   📅 Período PERSONALIZADO: ${dataInicio} a ${dataFim}`);
        } else {
            const hoje = new Date();
            const noventaDiasAtras = new Date();
            noventaDiasAtras.setDate(hoje.getDate() - 90);
            
            dataInicioStr = noventaDiasAtras.toISOString().split('T')[0];
            dataFimStr = hoje.toISOString().split('T')[0];
            
            console.log(`   📅 Período PADRÃO (90 dias): ${dataInicioStr} a ${dataFimStr}`);
        }
        
        const url = `https://comunica.pje.jus.br/consulta?dataDisponibilizacaoInicio=${dataInicioStr}&dataDisponibilizacaoFim=${dataFimStr}&numeroOab=${oabSemZeros}&ufOab=${uf}`;
        
        console.log(`\n🔗 URL: ${url}`);
        console.log('🌐 Abrindo navegador...');
        
        // ✅ Obter configuração correta para o ambiente
        const config = await getBrowserConfig();
        
        browser = await puppeteer.launch(config);
        console.log('   ✅ Navegador aberto com sucesso');
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );
        
        const screenshotDir = path.join(__dirname, '..', 'debug_screenshots');
        if (!fs.existsSync(screenshotDir)) {
            fs.mkdirSync(screenshotDir, { recursive: true });
        }
        
        console.log('⏳ Carregando resultados...');
        
        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        await page.screenshot({ 
            path: path.join(screenshotDir, 'comunica_pje_pagina.png'),
            fullPage: true 
        });
        console.log('📸 Screenshot salvo');
        
        const todasPublicacoes = [];
        const processosJaVistos = new Set();
        
        console.log(`\n📄 ========== PROCESSANDO INTIMAÇÕES ==========`);
        
        // Detectar abas
        console.log('📊 Detectando abas...');
        const abas = await detectarAbas(page);
        
        console.log(`   ✅ ${abas.length} abas encontradas`);
        abas.forEach((aba, idx) => {
            console.log(`      ${idx + 1}. ${aba.texto}`);
        });
        
        if (abas.length === 0) {
            console.log('   ⚠️ Nenhuma aba. Extraindo conteúdo direto...');
            const pubs = await extrairPublicacoesPagina(page, '');
            adicionarPublicacoesUnicas(pubs, todasPublicacoes, processosJaVistos);
        } else {
            // Processar cada aba
            for (let i = 0; i < abas.length; i++) {
                const aba = abas[i];
                console.log(`\n   🔍 Aba ${i + 1}/${abas.length}: ${aba.texto}`);
                
                try {
                    await clicarAba(page, aba);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    const pubsAba = await extrairPublicacoesPagina(page, aba.texto);
                    const novos = adicionarPublicacoesUnicas(pubsAba, todasPublicacoes, processosJaVistos);
                    
                    console.log(`      ✅ ${pubsAba.length} intimações (${novos} novas)`);
                    
                } catch (errAba) {
                    console.error(`      ❌ Erro: ${errAba.message}`);
                }
            }
        }
        
        console.log(`\n✅ Total: ${todasPublicacoes.length} intimações únicas`);
        console.log(`   Processos únicos: ${processosJaVistos.size}`);
        
        await page.screenshot({ 
            path: path.join(screenshotDir, 'comunica_pje_final.png'),
            fullPage: true 
        });
        
        await browser.close();
        
        return await salvarPublicacoes(todasPublicacoes, escritorioId);
        
    } catch (err) {
        console.error('❌ [COMUNICA PJE] Erro:', err.message);
        console.error('Stack trace:', err.stack);
        
        if (browser) {
            try {
                await browser.close();
            } catch (e) {
                console.error('Erro ao fechar navegador:', e.message);
            }
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
    const abas = await page.evaluate(() => {
        let botoes = [];
        let elementos = Array.from(document.querySelectorAll('button[role="tab"]'));
        
        if (elementos.length === 0) {
            elementos = Array.from(document.querySelectorAll('button, a, div'))
                .filter(el => {
                    const texto = el.innerText || '';
                    return /TJ[A-Z]{2}|TRF\d/i.test(texto);
                });
        }
        
        elementos.forEach(el => {
            const texto = (el.innerText || el.textContent || '').trim();
            if (/TJ[A-Z]{2}|TRF\d/i.test(texto) && texto.length < 20) {
                botoes.push({
                    texto: texto,
                    elemento: el.outerHTML.substring(0, 200)
                });
            }
        });
        
        return botoes;
    });
    
    return abas;
}

async function clicarAba(page, aba) {
    await page.evaluate((abaTexto) => {
        const elementos = Array.from(document.querySelectorAll('button[role="tab"], button, a, div'));
        for (const el of elementos) {
            const texto = (el.innerText || el.textContent || '').trim();
            if (texto === abaTexto) {
                el.click();
                return true;
            }
        }
        return false;
    }, aba.texto);
}

async function extrairPublicacoesPagina(page, abaAtiva) {
    const publicacoes = await page.evaluate(() => {
        const items = [];
        
        const seletoresIntimacao = [
            '[class*="intimacao"]',
            '[class*="comunicacao"]',
            '[class*="publicacao"]',
            '[class*="resultado"]',
            'article',
            '.card',
            '[class*="item"]'
        ];
        
        let elementos = [];
        for (const sel of seletoresIntimacao) {
            elementos = Array.from(document.querySelectorAll(sel));
            if (elementos.length > 0) break;
        }
        
        if (elementos.length > 0) {
            elementos.forEach(elem => {
                try {
                    const textoElem = elem.innerText || elem.textContent || '';
                    const matchProc = textoElem.match(/(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/);
                    if (!matchProc) return;
                    
                    const processo = matchProc[1];
                    const matchData = textoElem.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                    const data = matchData ? matchData[0] : new Date().toLocaleDateString('pt-BR');
                    
                    const conteudo = textoElem
                        .replace(/\s+/g, ' ')
                        .trim()
                        .substring(0, 5000);
                    
                    if (conteudo.length > 100) {
                        items.push({
                            processo: processo,
                            data: data,
                            conteudo: conteudo,
                            tribunal: 'PJE',
                            tipo: 'Intimação Eletrônica'
                        });
                    }
                } catch (err) {}
            });
            
            return items;
        }
        
        const textoCompleto = document.body.innerText;
        const processosMatch = Array.from(new Set(
            textoCompleto.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g) || []
        ));
        
        if (processosMatch.length === 0) return [];
        
        processosMatch.forEach((proc) => {
            const escProc = proc.replace(/[.-]/g, '\\$&');
            const regex = new RegExp(
                escProc + '([\\s\\S]{100,3000}?)' +
                '(?=' + '\\d{7}-\\d{2}\\.\\d{4}\\.\\d\\.\\d{2}\\.\\d{4}' + '|$)',
                'i'
            );
            
            const match = textoCompleto.match(regex);
            
            if (match) {
                const conteudo = (proc + ' ' + match[1])
                    .replace(/\s+/g, ' ')
                    .trim();
                
                const matchData = conteudo.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                const data = matchData ? matchData[0] : new Date().toLocaleDateString('pt-BR');
                
                if (conteudo.length > 100) {
                    items.push({
                        processo: proc,
                        data: data,
                        conteudo: conteudo.substring(0, 5000),
                        tribunal: 'PJE',
                        tipo: 'Intimação Eletrônica'
                    });
                }
            }
        });
        
        return items;
    });
    
    return publicacoes;
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
    let erros = 0;
    
    for (const pub of publicacoes) {
        try {
            const existe = await pool.query(
                `SELECT id FROM publicacoes 
                 WHERE numero_processo = $1 AND escritorio_id = $2`,
                [pub.processo, escritorioId]
            );
            
            if (existe.rowCount > 0) {
                duplicadas++;
                continue;
            }
            
            let dataSql = null;
            try {
                const partesData = pub.data.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                if (partesData) {
                    dataSql = `${partesData[3]}-${partesData[2]}-${partesData[1]}`;
                }
            } catch (errData) {
                dataSql = new Date().toISOString().split('T')[0];
            }
            
            await pool.query(
                `INSERT INTO publicacoes 
                 (escritorio_id, numero_processo, data_publicacao, conteudo, 
                  tribunal, tipo, status)
                 VALUES ($1, $2, $3, $4, $5, $6, 'pendente')`,
                [escritorioId, pub.processo, dataSql, pub.conteudo, pub.tribunal, pub.tipo]
            );
            
            novas++;
            
        } catch (errDb) {
            erros++;
            console.error(`   ❌ Erro ao salvar ${pub.processo}: ${errDb.message}`);
        }
    }
    
    console.log(`✅ Salvas: ${novas} novas, ${duplicadas} duplicadas`);
    
    return {
        ok: true,
        total: publicacoes.length,
        novas: novas,
        duplicadas: duplicadas,
        erros: erros,
        mensagem: novas > 0 
            ? `${novas} novas intimações!` 
            : publicacoes.length > 0
                ? `${publicacoes.length} intimações (já cadastradas)`
                : 'Nenhuma intimação encontrada.'
    };
}

async function testarScraper() {
    console.log('🧪 Testando Comunica PJe...\n');
    const resultado = await buscarPublicacoesDJEN('051.288', 'BA', 1);
    console.log('\n📋 Resultado:');
    console.log(JSON.stringify(resultado, null, 2));
}

module.exports = {
    buscarPublicacoesDJEN,
    testarScraper
};