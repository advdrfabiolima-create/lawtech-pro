/**
 * 🎯 SCRAPER COMUNICA PJE - VERSÃO FINAL CORRIGIDA
 * 
 * ✅ Extração de conteúdo SEPARADO (não mistura intimações)
 * ✅ Período padrão: 90 dias
 * ✅ Sem paginação (impossível com Angular)
 * ✅ Remove duplicatas
 */

const puppeteer = require('puppeteer');
const pool = require('../config/db');
const path = require('path');
const fs = require('fs');

async function buscarPublicacoesDJEN(oab, uf, escritorioId, dataInicio = null, dataFim = null) {
    console.log(`\n🎯 [COMUNICA PJE] Iniciando busca...`);
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
            // Padrão: 90 dias
            const hoje = new Date();
            const noventaDiasAtras = new Date();
            noventaDiasAtras.setDate(hoje.getDate() - 90);
            
            dataInicioStr = noventaDiasAtras.toISOString().split('T')[0];
            dataFimStr = hoje.toISOString().split('T')[0];
            
            console.log(`   📅 Período PADRÃO (90 dias): ${dataInicioStr} a ${dataFimStr}`);
        }
        
        const url = `https://comunica.pje.jus.br/consulta?dataDisponibilizacaoInicio=${dataInicioStr}&dataDisponibilizacaoFim=${dataFimStr}&numeroOab=${oabSemZeros}&ufOab=${uf}`;
        
        console.log(`\n🔗 URL: ${url}`);
        console.log('\n🌐 Abrindo navegador...');
        
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu'
            ],
            timeout: 60000
        });
        
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
        
        if (browser) {
            try {
                await browser.close();
            } catch (e) {}
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

/**
 * 🎯 EXTRAÇÃO MELHORADA - SEPARA CONTEÚDO POR INTIMAÇÃO
 */
async function extrairPublicacoesPagina(page, abaAtiva) {
    const publicacoes = await page.evaluate(() => {
        const items = [];
        
        // ESTRATÉGIA 1: Procurar por elementos estruturados
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
            if (elementos.length > 0) {
                console.log(`Usando seletor: ${sel} (${elementos.length} elementos)`);
                break;
            }
        }
        
        // Se encontrou elementos estruturados
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
                } catch (err) {
                    console.error('Erro ao processar elemento:', err.message);
                }
            });
            
            return items;
        }
        
        // ESTRATÉGIA 2: Extração por regex com separação
        const textoCompleto = document.body.innerText;
        const processosMatch = Array.from(new Set(
            textoCompleto.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g) || []
        ));
        
        if (processosMatch.length === 0) {
            return [];
        }
        
        // Para cada processo, isolar seu conteúdo
        processosMatch.forEach((proc, idx) => {
            // Regex que captura desde o processo até o próximo ou fim
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