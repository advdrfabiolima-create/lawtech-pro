
    if (!API.getToken()) window.location.href = '/login.html';

    let taxaSelicAtual = 0.0085;

    async function carregarInfoRodape() {
        try {
            console.log('🔄 Carregando informações do rodapé...');

            const resUser = await API.get('/api/auth/me');
            const dataUser = await resUser.json();

            if (dataUser.ok) {
                // Atualiza o e-mail na sidebar
                const emailEl = document.getElementById('userEmail');
                if(emailEl) {
                    emailEl.innerText = dataUser.usuario.email || 'Não disponível';
                    console.log('✅ Email atualizado:', dataUser.usuario.email);
                }

                // --- LÓGICA DO CABEÇALHO PADRONIZADA ---
                const nomeCompleto = dataUser.usuario.nome || 'Advogado';

                // 1. Define apenas o Primeiro Nome no texto
                const primeiroNome = nomeCompleto.trim().split(' ')[0];
                const nameEl = document.getElementById('userNameHeader');
                if(nameEl) nameEl.innerText = primeiroNome;

                // 2. Define as Iniciais no Círculo (Primeiro e Último nome)
                const partes = nomeCompleto.trim().split(' ').filter(n => n);
                let iniciais = partes[0][0]; // Pega a letra do primeiro nome

                if (partes.length > 1) {
                    iniciais += partes[partes.length - 1][0]; // Pega a letra do último nome
                }

                const circulo = document.getElementById('userCircle');
                if (circulo) {
                    circulo.innerText = iniciais.toUpperCase();
                }
            }

            // Busca informação do Plano
            const resPlan = await API.get('/api/plano-consumo');
            const dataPlan = await resPlan.json();
            const planEl = document.getElementById('planNameFooter');
            if(planEl) {
                planEl.innerText = dataPlan.plano || 'Free';
                console.log('✅ Plano atualizado:', dataPlan.plano);
            }

        } catch (err) {
            console.error("❌ Erro ao carregar rodapé:", err);
        }
    }

    function toggleUserMenu() {
        const m = document.getElementById('userDropdown');
        if (m) m.style.display = getComputedStyle(m).display === 'none' ? 'block' : 'none';
    }

    window.addEventListener('click', (e) => {
        if (!e.target.closest('#userCircle') && !e.target.closest('#userDropdown')) {
            const m = document.getElementById('userDropdown');
            if(m) m.style.display = 'none';
        }
    });

    function toggleCitacao() {
        const select = document.getElementById('jurosIncidencia');
        const div = document.getElementById('divCitacao');
        div.style.display = select.value === 'citacao' ? 'block' : 'none';
    }

    function mascaraCNJ(i) {
        let v = i.value.replace(/\D/g, "");
        if (v.length > 20) v = v.substring(0, 20);
        if (v.length <= 7) i.value = v;
        else if (v.length <= 9) i.value = v.replace(/(\d{7})(\d{2})/, "$1-$2");
        else if (v.length <= 13) i.value = v.replace(/(\d{7})(\d{2})(\d{4})/, "$1-$2.$3");
        else if (v.length <= 14) i.value = v.replace(/(\d{7})(\d{2})(\d{4})(\d{1})/, "$1-$2.$3.$4");
        else if (v.length <= 16) i.value = v.replace(/(\d{7})(\d{2})(\d{4})(\d{1})(\d{2})/, "$1-$2.$3.$4.$5");
        else i.value = v.replace(/(\d{7})(\d{2})(\d{4})(\d{1})(\d{2})(\d{4})/, "$1-$2.$3.$4.$5.$6");
    }

    function aplicarMascaraDinheiro(i) {
        let v = i.value.replace(/\D/g, "");
        v = (v / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        i.value = v;
    }

    function moneyToFloat(s) {
        if (!s) return 0;
        return parseFloat(s.replace(/R\$/g, "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".")) || 0;
    }

    function addLinha() {
        const row = document.getElementById('listaValores').insertRow();
        row.innerHTML = `
            <td><input type="text" class="val-bruto" placeholder="0,00"></td>
            <td><input type="date" class="val-data"></td>
            <td><input type="text" class="val-desc" placeholder="Descrição"></td>
            <td><button class="btn-remover-linha" style="color:var(--danger);border:none;background:none;cursor:pointer;font-weight:bold;">✕</button></td>
        `;
    }

    function calcularJurosFases(valor, dataInicio, dataFim) {
        let inicio = new Date(dataInicio); let fim = new Date(dataFim);
        if (inicio >= fim) return 0;
        const dCC = new Date('2003-01-11'); const dSelic = new Date('2024-08-30'); 
        let totalJuros = 0; let dataAtual = new Date(inicio);
        while (dataAtual < fim) {
            let taxaMensal = 0.01; 
            if (dataAtual < dCC) taxaMensal = 0.005; 
            else if (dataAtual >= dSelic) taxaMensal = taxaSelicAtual;
            totalJuros += valor * taxaMensal;
            dataAtual.setMonth(dataAtual.getMonth() + 1);
        }
        return totalJuros;
    }

    function gerarMemoriaMensal(desc, valNominal, dI, dF, indiceSelecionado, dIJuros, valCorrigido) {
        const f  = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const fp = (v) => (v * 100).toFixed(4).replace('.', ',') + '%';
        const dCC    = new Date('2003-01-11');
        const dSelic = new Date('2024-08-30');
        const dIpca  = new Date('2024-09-01');

        // ── Correção monetária mês a mês ─────────────────────────────────────
        let rowsCorr = '';
        let valAtual = valNominal;
        let dataAtual = new Date(dI);
        let totalMeses = 0;

        while (dataAtual < dF) {
            totalMeses++;
            const mesAno = dataAtual.toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' });
            let nomeIndice, taxa;
            if (indiceSelecionado === 'inpc') {
                nomeIndice = 'INPC'; taxa = 0.0055;
            } else {
                if (dataAtual < dIpca) { nomeIndice = 'INPC'; taxa = 0.0048; }
                else                   { nomeIndice = 'IPCA'; taxa = 0.0050; }
            }
            const corrMes = valAtual * taxa;
            valAtual += corrMes;
            rowsCorr += `<tr>
                <td style="text-align:center;">${mesAno}</td>
                <td style="text-align:center;">${nomeIndice}</td>
                <td style="text-align:right;">${fp(taxa)}</td>
                <td style="text-align:right;">${f(corrMes)}</td>
                <td style="text-align:right;font-weight:600;">${f(valAtual)}</td>
            </tr>`;
            dataAtual.setMonth(dataAtual.getMonth() + 1);
        }

        // ── Juros de mora mês a mês ──────────────────────────────────────────
        let rowsJuros = '';
        let jAcum = 0;
        let hasJuros = false;

        if (dIJuros < dF) {
            hasJuros = true;
            dataAtual = new Date(dIJuros);
            while (dataAtual < dF) {
                const mesAno = dataAtual.toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' });
                let taxaJ, fase;
                if (dataAtual < dCC)    { taxaJ = 0.005;          fase = 'ANTES DO CC/2002'; }
                else if (dataAtual >= dSelic) { taxaJ = taxaSelicAtual; fase = 'SELIC (LEI 14.905/24)'; }
                else                    { taxaJ = 0.01;            fase = 'CC/2002, ART. 406'; }
                const jMes = valCorrigido * taxaJ;
                jAcum += jMes;
                rowsJuros += `<tr>
                    <td style="text-align:center;">${mesAno}</td>
                    <td>${fase}</td>
                    <td style="text-align:right;">${fp(taxaJ)}</td>
                    <td style="text-align:right;">${f(jMes)}</td>
                    <td style="text-align:right;font-weight:600;">${f(jAcum)}</td>
                </tr>`;
                dataAtual.setMonth(dataAtual.getMonth() + 1);
            }
        }

        const sTh = 'background:#1e3a5f;color:#fff;padding:5px 8px;font-size:10px;letter-spacing:0.4px;';
        const sTd = 'padding:4px 8px;border-bottom:1px solid #e2e8f0;font-size:11px;';
        const sTab = 'width:100%;border-collapse:collapse;margin-top:6px;';

        return `<details style="margin-bottom:12px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            <summary style="background:#f1f5f9;padding:10px 14px;cursor:pointer;font-weight:700;font-size:11px;color:#1e3a5f;list-style:none;display:flex;justify-content:space-between;align-items:center;user-select:none;">
                <span>📋 ${desc.toUpperCase()} — ${f(valNominal)} → ${f(valCorrigido)} (${totalMeses} MES${totalMeses !== 1 ? 'ES' : ''})</span>
                <span style="color:#64748b;font-size:10px;">▼ EXPANDIR MEMÓRIA</span>
            </summary>
            <div style="padding:12px 14px;">
                <div style="font-size:10px;font-weight:700;color:#1e3a5f;margin-bottom:4px;letter-spacing:0.5px;">CORREÇÃO MONETÁRIA — MÊS A MÊS</div>
                <table style="${sTab}">
                    <thead><tr>
                        <th style="${sTh}text-align:center;">MÊS/ANO</th>
                        <th style="${sTh}text-align:center;">ÍNDICE</th>
                        <th style="${sTh}text-align:right;">TAXA</th>
                        <th style="${sTh}text-align:right;">CORREÇÃO DO MÊS</th>
                        <th style="${sTh}text-align:right;">SALDO CORRIGIDO</th>
                    </tr></thead>
                    <tbody>
                        <tr><td style="${sTd}text-align:center;">INICIAL</td><td style="${sTd}">—</td><td style="${sTd}">—</td><td style="${sTd}">—</td><td style="${sTd}text-align:right;font-weight:600;">${f(valNominal)}</td></tr>
                        ${rowsCorr}
                    </tbody>
                </table>
                ${hasJuros ? `<div style="font-size:10px;font-weight:700;color:#1e3a5f;margin:10px 0 4px;letter-spacing:0.5px;">JUROS DE MORA — MÊS A MÊS (BASE: ${f(valCorrigido)})</div>
                <table style="${sTab}">
                    <thead><tr>
                        <th style="${sTh}text-align:center;">MÊS/ANO</th>
                        <th style="${sTh}">FASE / LEGISLAÇÃO</th>
                        <th style="${sTh}text-align:right;">TAXA</th>
                        <th style="${sTh}text-align:right;">JUROS DO MÊS</th>
                        <th style="${sTh}text-align:right;">JUROS ACUMULADOS</th>
                    </tr></thead>
                    <tbody>${rowsJuros}</tbody>
                </table>` : ''}
            </div>
        </details>`;
    }

    async function processarCalculo() {
        try {
            const checkRes = await API.get('/api/calculos/historico');
            
            if (checkRes.status === 402) {
                const data = await checkRes.json();
                const msg = data.message || "Os Cálculos Jurídicos estão disponíveis apenas nos planos Avançado e Premium.";
                exibirAvisoUpgrade(msg);
                return;
            }
        } catch (e) {
            console.error('Erro ao verificar plano:', e);
        }
        
        const dataF = new Date(document.getElementById('dataFinal').value);
        const incidencia = document.getElementById('jurosIncidencia').value;
        const dataCitacao = new Date(document.getElementById('dataCitacao').value);
        const indiceSelecionado = document.getElementById('indice').value;
        const corpo = document.getElementById('corpoMemoria');
        corpo.innerHTML = "";
        let pAcum = 0; let jAcum = 0;
        let htmlMemoriaMensal = '';
        const f = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const eventosTimeline = [];

        // Preencher índice e incidência de juros no cabeçalho do relatório
        const indiceLabels = {
            'tjdft': 'ÍNDICE: INPC (ATÉ AGO/2024) + IPCA (A PARTIR SET/2024) — TJDFT',
            'inpc':  'ÍNDICE: INPC — TODO O PERÍODO'
        };
        document.getElementById('outIndiceLabel').innerText = indiceLabels[indiceSelecionado] || ('ÍNDICE: ' + indiceSelecionado.toUpperCase());
        const dataCitacaoFormatada = incidencia === 'citacao' && !isNaN(dataCitacao)
            ? dataCitacao.toLocaleDateString('pt-BR')
            : '';
        document.getElementById('outJurosLabel').innerText = incidencia === 'citacao'
            ? `JUROS MORATÓRIOS: A PARTIR DA CITAÇÃO (${dataCitacaoFormatada})`
            : 'JUROS MORATÓRIOS: DESDE O VENCIMENTO DE CADA VERBA';

        const custasRaw = document.getElementById('custas').value || "0,00";
        const custas = moneyToFloat(custasRaw);

        document.querySelectorAll('#listaValores tr').forEach(row => {
            const valRaw = row.querySelector('.val-bruto').value || "0,00";
            const valNominal = moneyToFloat(valRaw);
            const dRaw = row.querySelector('.val-data').value;

            if (valNominal > 0 && dRaw) {
                const dI = new Date(dRaw);
                const dF = new Date(document.getElementById('dataFinal').value);
                
                const meses = (dF.getFullYear() - dI.getFullYear()) * 12 + (dF.getMonth() - dI.getMonth());
                
                let fatorCorrecao = 1.0;
                if (indiceSelecionado === 'inpc') {
                    fatorCorrecao = 1 + (meses * 0.0055);
                } else {
                    fatorCorrecao = 1 + (meses * 0.0048);
                }

                const valCorrigido = valNominal * fatorCorrecao;
                let dIJuros = dI;
                if (incidencia === 'citacao' && !isNaN(dataCitacao)) {
                    dIJuros = dataCitacao > dI ? dataCitacao : dI;
                }
                const juros = calcularJurosFases(valCorrigido, dIJuros, dF);
                const total = valCorrigido + juros;

                pAcum += valCorrigido;
                jAcum += juros;

                const desc = row.querySelector('.val-desc').value || "VERBA";
                htmlMemoriaMensal += gerarMemoriaMensal(desc, valNominal, dI, dF, indiceSelecionado, dIJuros, valCorrigido);

                // Eventos para a timeline
                eventosTimeline.push({ data: dI.toLocaleDateString('pt-BR'), tipo: 'verba',    descricao: '📌 <strong>' + desc + '</strong> — valor nominal: ' + f(valNominal) });
                eventosTimeline.push({ data: dI.toLocaleDateString('pt-BR') + ' → ' + dF.toLocaleDateString('pt-BR'), tipo: 'correcao', descricao: '📈 Correção monetária — acréscimo: ' + f(valCorrigido - valNominal) });
                eventosTimeline.push({ data: dIJuros.toLocaleDateString('pt-BR') + ' → ' + dF.toLocaleDateString('pt-BR'), tipo: 'juros',    descricao: '⚖️ Juros moratórios — ' + f(juros) });
                const dJurosLabel = incidencia === 'citacao' && !isNaN(dataCitacao) && dataCitacao > dI
                    ? `${dIJuros.toLocaleDateString('pt-BR')}<br><span style="font-size:10px;color:#6b7280;">(CITAÇÃO)</span>`
                    : `${dI.toLocaleDateString('pt-BR')}<br><span style="font-size:10px;color:#6b7280;">(VENCIMENTO)</span>`;
                corpo.innerHTML += `<tr>
                    <td>${desc}</td>
                    <td>${dI.toLocaleDateString('pt-BR')}</td>
                    <td>${f(valCorrigido)}</td>
                    <td style="font-size:13px;">${dJurosLabel}</td>
                    <td>${f(juros)}</td>
                    <td><strong>${f(total)}</strong></td>
                </tr>`;
            }
        });

        // 🚀 CÁLCULO CORRETO: Honorários sobre SUBTOTAL (principal corrigido + juros)
        const subtotal = pAcum + jAcum;
        const percHon = parseFloat(document.getElementById('percHon').value) / 100;
        const honorarios = subtotal * percHon;

        // 🚀 MULTA 523: 10% sobre (SUBTOTAL + CUSTAS + HONORÁRIOS)
        let multa523 = 0, hon523 = 0;
        if (document.getElementById('multa523').checked) {
            multa523 = (subtotal + custas + honorarios) * 0.1;
        }
        if (document.getElementById('honor523').checked) {
            hon523 = (subtotal + custas + honorarios) * 0.1;
        }

        const total = subtotal + custas + honorarios + multa523 + hon523;

        document.getElementById('resSub').innerText = f(subtotal);
        document.getElementById('resCustas').innerText = f(custas);
        document.getElementById('outPercHon').innerText = (percHon * 100).toFixed(0);
        document.getElementById('resHon').innerText = f(honorarios);
        document.getElementById('resMulta').innerText = f(multa523);
        document.getElementById('resHon523').innerText = f(hon523);
        document.getElementById('resTotal').innerText = f(total);

        document.getElementById('linhaMulta').style.display = multa523 > 0 ? 'table-row' : 'none';
        document.getElementById('linhaHon523').style.display = hon523 > 0 ? 'table-row' : 'none';

        document.getElementById('outProc').innerText = document.getElementById('procNum').value;
        document.getElementById('outCredor').innerText = document.getElementById('credor').value;
        document.getElementById('outDevedor').innerText = document.getElementById('devedor').value;
        document.getElementById('outDataF').innerText = dataF.toLocaleDateString('pt-BR');
        document.getElementById('dataGeracao').innerText = new Date().toLocaleString('pt-BR');

        const wrapMensal = document.getElementById('memoriaDetalhadaWrap');
        if (wrapMensal) {
            wrapMensal.innerHTML = htmlMemoriaMensal
                ? `<div style="font-size:11px;font-weight:700;color:#1e3a5f;letter-spacing:0.5px;padding:16px 20px 8px;">MEMÓRIA DE CÁLCULO DETALHADA (MÊS A MÊS)</div>${htmlMemoriaMensal}`
                : '';
            wrapMensal.style.display = htmlMemoriaMensal ? 'block' : 'none';
        }

        // Evento final da timeline
        eventosTimeline.push({ data: dataF.toLocaleDateString('pt-BR'), tipo: 'total', descricao: '✅ <strong>Valor total atualizado</strong> — ' + f(total) });
        renderTimeline(eventosTimeline);

        document.getElementById('resCalculo').style.display = 'block';
        document.getElementById('resCalculo').scrollIntoView({ behavior: 'smooth' });
    }

    async function salvarNoBanco() {
        const processo = document.getElementById('procNum').value;
        const totalStr = document.getElementById('resTotal').innerText;
        const total = moneyToFloat(totalStr);

        if (!processo || isNaN(total)) return alert("Calcule primeiro!");

        const agora = new Date().toLocaleString('pt-BR');
        
        let memoriaTexto = `[EMISSAO]: ${agora}\n`;
        memoriaTexto += `[PROCESSO]: ${processo}\n`;
        memoriaTexto += `[CREDOR]: ${document.getElementById('credor').value}\n`;
        memoriaTexto += `[DEVEDOR]: ${document.getElementById('devedor').value}\n`;
        memoriaTexto += `[DATABASE]: ${document.getElementById('dataFinal').value}\n`;
        memoriaTexto += `[INDICE]: ${document.getElementById('indice').value}\n`;
        const jurosInc = document.getElementById('jurosIncidencia').value;
        memoriaTexto += `[JUROS_INCIDENCIA]: ${jurosInc}\n`;
        if (jurosInc === 'citacao') {
            memoriaTexto += `[DATA_CITACAO]: ${document.getElementById('dataCitacao').value}\n`;
        }
        memoriaTexto += `\n`;
        
        document.querySelectorAll('#corpoMemoria tr').forEach(row => {
            const cols = row.querySelectorAll('td');
            if (cols.length >= 6) {
                // col[0]=desc, col[1]=vencimento, col[2]=base corrigida, col[3]=juros desde, col[4]=juros mora, col[5]=total
                const jurosDesde = cols[3].innerText.replace(/\n/g, ' ').trim();
                memoriaTexto += `VERBA|${cols[0].innerText}|${cols[2].innerText}|${jurosDesde}|${cols[4].innerText}|${cols[5].innerText}\n`;
            }
        });

        memoriaTexto += `\n[CUSTAS]: ${document.getElementById('resCustas').innerText}\n`;
        memoriaTexto += `[HONORARIOS]: ${document.getElementById('resHon').innerText}\n`;
        memoriaTexto += `[MULTA]: ${document.getElementById('resMulta').innerText}\n`;
        memoriaTexto += `[HONORARIOS523]: ${document.getElementById('resHon523').innerText}\n`;

        const dadosParaSalvar = {
            processo,
            credor: document.getElementById('credor').value,
            devedor: document.getElementById('devedor').value,
            dataFinal: document.getElementById('dataFinal').value,
            total: total,
            memoria: memoriaTexto 
        };

        try {
            const res = await API.post('/api/calculos/salvar', dadosParaSalvar);
            const data = await res.json();
            // ✅ Interceptar erro 402 (Recurso bloqueado)
            if (res.status === 402) {
                const msg = data.message || "Os Cálculos Jurídicos estão disponíveis apenas nos planos Avançado e Premium.";
                exibirAvisoUpgrade(msg);
                return;
            }
            if (res.ok) { alert("✅ Cálculo salvo com sucesso!"); carregarHistorico(); }
        } catch (e) { alert("Erro ao salvar."); }
    }    
    
    async function carregarHistorico() {
        try {
            const res = await API.get('/api/calculos/historico');
            const dados = await res.json();
            const container = document.getElementById('listaHistorico');

            if (!dados || dados.length === 0) {
                container.innerHTML = "<p style='color:var(--muted); font-size:12px; padding:10px;'>Nenhum cálculo recente.</p>";
                return;
            }

            container.innerHTML = dados.slice(0, 10).map(c => `
                <div class="hist-item" style="display:flex;justify-content:space-between;align-items:center;padding:12px;border-bottom:1px solid var(--border);">
                    <div>
                        <strong style="display:block;font-size:13px;color:var(--sidebar);">${c.processo_numero || 'SEM PROCESSO'}</strong>
                        <small style="color:var(--muted);font-size:10px;">${new Date(c.data_calculo).toLocaleDateString()}</small>
                    </div>
                    <div style="display:flex;align-items:center;gap:15px;">
                        <span style="color:var(--primary);font-weight:700;font-size:14px;">
                            R$ ${parseFloat(c.total_devido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <button class="btn-hist-ver" data-memoria="${btoa(unescape(encodeURIComponent(c.memoria_calculo || '')))}" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--muted);" title="Ver Memória">
                            <i data-lucide="eye" style="width:18px;height:18px;pointer-events:none;"></i>
                        </button>
                        <button class="btn-hist-del" data-id="${c.id}" style="background:none;border:none;cursor:pointer;padding:4px;color:#ef4444;" title="Excluir">
                            <i data-lucide="trash-2" style="width:18px;height:18px;pointer-events:none;"></i>
                        </button>
                    </div>
                </div>
            `).join('');

            if (typeof lucide !== 'undefined') lucide.createIcons();
        } catch (e) { console.error("Erro histórico:", e); }
    }

    function verMemoria(memoriaBase64) {
        try {
            const texto = decodeURIComponent(escape(atob(memoriaBase64)));
            
            const extrair = (chave) => {
                const regex = new RegExp(`\\[${chave}\\]:\\s*(.*)`, "i");
                const m = texto.match(regex);
                if (m) return m[1].trim();
                const regexAntiga = new RegExp(`${chave}:\\s*(.*)`, "i");
                return texto.match(regexAntiga)?.[1]?.trim() || "";
            };

            const database = extrair("DATABASE") || extrair("Data Base") || "";
            document.getElementById('procNum').value = extrair("PROCESSO") || "";
            document.getElementById('credor').value = extrair("CREDOR") || "";
            document.getElementById('devedor').value = extrair("DEVEDOR") || "";
            document.getElementById('dataFinal').value = database;

            // Restaurar índice e incidência de juros
            const indiceHist = extrair("INDICE") || "tjdft";
            const jurosIncHist = extrair("JUROS_INCIDENCIA") || "valores";
            const indiceLabels = {
                'tjdft': 'ÍNDICE: INPC (ATÉ AGO/2024) + IPCA (A PARTIR SET/2024) — TJDFT',
                'inpc':  'ÍNDICE: INPC — TODO O PERÍODO'
            };
            document.getElementById('outIndiceLabel').innerText = indiceLabels[indiceHist] || ('ÍNDICE: ' + indiceHist.toUpperCase());
            const dataCitHist = extrair("DATA_CITACAO") || "";
            const dataCitHistFormatada = dataCitHist ? new Date(dataCitHist).toLocaleDateString('pt-BR') : '';
            document.getElementById('outJurosLabel').innerText = jurosIncHist === 'citacao'
                ? `JUROS MORATÓRIOS: A PARTIR DA CITAÇÃO${dataCitHistFormatada ? ' (' + dataCitHistFormatada + ')' : ''}`
                : 'JUROS MORATÓRIOS: DESDE O VENCIMENTO DE CADA VERBA';

            const custasStr = extrair("CUSTAS") || "R$ 0,00";
            const honorariosStr = extrair("HONORARIOS") || "R$ 0,00";
            const multaStr = extrair("MULTA") || "R$ 0,00";
            const honorarios523Str = extrair("HONORARIOS523") || "R$ 0,00";

            document.getElementById('custas').value = custasStr.replace('R$', '').trim();

            const corpo = document.getElementById('corpoMemoria');
            const listaLancamentos = document.getElementById('listaValores');
            corpo.innerHTML = "";
            listaLancamentos.innerHTML = "";

            // Limpar memória mensal (não disponível em histórico)
            const wrapMensal = document.getElementById('memoriaDetalhadaWrap');
            if (wrapMensal) { wrapMensal.innerHTML = ''; wrapMensal.style.display = 'none'; }

            const dataFinalFmt = database ? new Date(database).toLocaleDateString('pt-BR') : '—';
            let subtotalAcumulado = 0;
            const eventosTimeline = [];
            texto.split('\n').forEach(linha => {
                if (linha.startsWith('VERBA|')) {
                    const parts = linha.split('|');
                    let desc, base, jurosDesde, juros, total;
                    if (parts.length >= 6) {
                        // Formato novo: VERBA|desc|base|jurosDesde|juros|total
                        [, desc, base, jurosDesde, juros, total] = parts;
                    } else {
                        // Formato antigo: VERBA|desc|base|juros|total
                        [, desc, base, juros, total] = parts;
                        jurosDesde = '—';
                    }
                    subtotalAcumulado += moneyToFloat(total);
                    corpo.innerHTML += `<tr><td>${desc}</td><td>Histórica</td><td>${base}</td><td style="font-size:11px;">${jurosDesde}</td><td>${juros}</td><td><strong>${total}</strong></td></tr>`;
                    const jdLimpo = jurosDesde.replace(/<[^>]*>/g, '').replace(/\(CITAÇÃO\)/gi,'').replace(/\(VENCIMENTO\)/gi,'').trim() || '—';
                    eventosTimeline.push({ data: jdLimpo, tipo: 'verba',    descricao: '📌 <strong>' + desc + '</strong> — base corrigida: ' + base });
                    eventosTimeline.push({ data: jdLimpo + ' → ' + dataFinalFmt, tipo: 'juros', descricao: '⚖️ Juros moratórios — ' + juros });
                    
                    const row = listaLancamentos.insertRow();
                    row.innerHTML = `
                        <td><input type="text" class="val-bruto" value="${base.replace('R$', '').trim()}"></td>
                        <td><input type="date" class="val-data" value="${database}"></td>
                        <td><input type="text" class="val-desc" value="${desc}"></td>
                        <td><button class="btn-remover-linha" style="color:var(--danger);border:none;background:none;cursor:pointer;font-weight:bold;">✕</button></td>
                    `;
                }
            });

            const f = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            const vCustas = moneyToFloat(custasStr);
            const vHonor = moneyToFloat(honorariosStr);
            const vMulta = moneyToFloat(multaStr);
            const vHonor523 = moneyToFloat(honorarios523Str);

            document.getElementById('resSub').innerText = f(subtotalAcumulado);
            document.getElementById('resCustas').innerText = f(vCustas);
            document.getElementById('resHon').innerText = f(vHonor);

            const linhaMulta = document.getElementById('linhaMulta');
            if (vMulta > 0) {
                linhaMulta.style.display = 'table-row';
                document.getElementById('resMulta').innerText = f(vMulta);
            } else {
                linhaMulta.style.display = 'none';
            }

            const linhaHon523 = document.getElementById('linhaHon523');
            if (vHonor523 > 0) {
                linhaHon523.style.display = 'table-row';
                document.getElementById('resHon523').innerText = f(vHonor523);
            } else {
                linhaHon523.style.display = 'none';
            }

            document.getElementById('resTotal').innerText = f(subtotalAcumulado + vCustas + vHonor + vMulta + vHonor523);
            document.getElementById('dataGeracao').innerText = "REEMISSÃO DE HISTÓRICO: " + (extrair("EMISSAO") || "Histórico");
            document.getElementById('outProc').innerText = document.getElementById('procNum').value;
            document.getElementById('outCredor').innerText = document.getElementById('credor').value;
            document.getElementById('outDevedor').innerText = document.getElementById('devedor').value;
            document.getElementById('outDataF').innerText = database ? new Date(database).toLocaleDateString('pt-BR') : "";

            const totalGeralStr = f(subtotalAcumulado + vCustas + vHonor + vMulta + vHonor523);
            eventosTimeline.push({ data: dataFinalFmt, tipo: 'total', descricao: '✅ <strong>Valor total atualizado</strong> — ' + totalGeralStr });
            renderTimeline(eventosTimeline);

            document.getElementById('resCalculo').style.display = 'block';
            document.getElementById('resCalculo').scrollIntoView({ behavior: 'smooth' });

        } catch (e) {
            alert("Erro ao processar dados.");
        }
    }

    async function confirmarExclusao(id) {
        if (!confirm("Deseja realmente excluir este registro?")) return;
        try {
            const res = await API.delete(`/api/calculos/excluir/${id}`);
            if (res.ok) { 
                alert("✅ Registro removido."); 
                carregarHistorico(); 
            }
        } catch (e) { 
            alert("Erro ao conectar ao servidor."); 
        }
    }

    function renderTimeline(eventos) {
        const container = document.getElementById('timelineEventos');
        const wrapper   = document.getElementById('timelineCalculo');
        if (!container || !wrapper) return;
        container.innerHTML = '';
        if (!eventos || eventos.length === 0) { wrapper.style.display = 'none'; return; }
        wrapper.style.display = 'block';
        eventos.forEach(ev => {
            const item = document.createElement('div');
            item.className = 'timeline-item';
            item.setAttribute('data-tipo', ev.tipo || 'verba');
            item.innerHTML = `<div class="timeline-date">${ev.data}</div><div class="timeline-desc">${ev.descricao}</div>`;
            container.appendChild(item);
        });
    }

    function editarCampos() {
        window.scrollTo({top: 0, behavior: 'smooth'});
        const areaInputs = document.querySelector('.section-card');
        areaInputs.style.boxShadow = "0 0 15px rgba(37, 99, 235, 0.3)";
        setTimeout(() => areaInputs.style.boxShadow = "none", 2000);
    }

    function logout() {
        localStorage.removeItem('token');
        sessionStorage.removeItem('token');
        window.location.href = '/login.html';
    }

    function limparBolinha() {
        const dot = document.getElementById('dotNotificacao');
        if (dot) dot.style.display = 'none';
    }

    // Badge de novo lead CRM — polling global em todas as páginas
    (function() {
        const _tk = API.getToken();
        if (!_tk) return;
        function _checkLeadBadge() {
            fetch('/api/crm/metricas', { headers: { Authorization: 'Bearer ' + _tk } })
                .then(r => r.ok ? r.json() : null)
                .then(d => {
                    if (!d) return;
                    const atual = d.leads || 0;
                    const vs = localStorage.getItem('crm_leads_visto');
                    if (vs === null) { localStorage.setItem('crm_leads_visto', atual); return; }
                    const dot = document.getElementById('dotNotificacao');
                    if (dot) dot.style.display = atual > parseInt(vs) ? 'inline-block' : 'none';
                }).catch(() => {});
        }
        _checkLeadBadge();
        setInterval(_checkLeadBadge, 60000);
    })();

    function exibirAvisoUpgrade(mensagem) {
        const overlay = document.createElement('div');
        overlay.id = "overlay-upgrade";
        overlay.style = "position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:20000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(5px);";
        overlay.innerHTML = `
        <div style="background:#fff;padding:40px;border-radius:20px;text-align:center;max-width:420px;">
            <div style="font-size:50px;">⚖️</div>
            <h3 style="margin-top:15px;color:#0f172a;">RECURSO AVANÇADO</h3>
            <p style="color:#64748b;margin:15px 0 25px 0;line-height:1.6;">${mensagem}</p>
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:15px;margin-bottom:25px;text-align:left;">
                <p style="margin:0;font-size:13px;color:#92400e;line-height:1.6;">
                    <strong>⚖️ PLANO AVANÇADO INCLUI:</strong><br>
                    • CÁLCULOS JURÍDICOS ILIMITADOS<br>
                    • ATUALIZAÇÃO MONETÁRIA AUTOMÁTICA<br>
                    • HISTÓRICO COMPLETO DE CÁLCULOS<br>
                    • EXPORTAÇÃO EM PDF<br>
                    • SUPORTE ESPECIALIZADO
                </p>
            </div>
            <button class="btn-upgrade-planos" style="background:linear-gradient(135deg,#fbbf24 0%,#f59e0b 100%);color:#000;border:none;padding:14px 28px;border-radius:10px;font-weight:800;cursor:pointer;width:100%;margin-bottom:10px;">
                🎯 VER PLANOS E PREÇOS
            </button>
            <button class="btn-upgrade-fechar" style="background:none;border:none;color:#64748b;cursor:pointer;font-weight:600;padding:8px;">
                DEPOIS
            </button>
        </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('.btn-upgrade-planos').addEventListener('click', () => { window.location.href = '/planos-page'; });
        overlay.querySelector('.btn-upgrade-fechar').addEventListener('click', () => overlay.remove());
    }

    // 🚀 INICIALIZAÇÃO COM GARANTIA DUPLA
    document.addEventListener('DOMContentLoaded', async () => {
        console.log('📄 DOM carregado');
        setTimeout(async () => {
            await carregarInfoRodape();
            await carregarHistorico();
        }, 100);
        if (typeof lucide !== 'undefined') lucide.createIcons();

        document.getElementById('linkIaMenu')?.addEventListener('click', toggleIaMenu);
        document.getElementById('linkCrmNav')?.addEventListener('click', limparBolinha);
        document.getElementById('linkCrm')?.addEventListener('click', limparBolinha);
        document.getElementById('btnPrint').addEventListener('click', () => window.print());
        document.getElementById('btnProcessarCalculo').addEventListener('click', processarCalculo);
        document.getElementById('btnSalvarHistorico').addEventListener('click', salvarNoBanco);
        document.getElementById('userCircle')?.addEventListener('click', toggleUserMenu);
        document.getElementById('linkLogout')?.addEventListener('click', (e) => { e.preventDefault(); logout(); });
        document.getElementById('procNum').addEventListener('input', (e) => mascaraCNJ(e.target));
        document.getElementById('btnAddLinha').addEventListener('click', addLinha);
        document.getElementById('jurosIncidencia').addEventListener('change', toggleCitacao);
        document.getElementById('custas').addEventListener('input', (e) => aplicarMascaraDinheiro(e.target));
        document.getElementById('btnEditarCampos').addEventListener('click', editarCampos);

        // Delegação para inputs e botões gerados dinamicamente em listaValores
        document.getElementById('listaValores').addEventListener('input', (e) => {
            if (e.target.classList.contains('val-bruto')) aplicarMascaraDinheiro(e.target);
        });
        document.getElementById('listaValores').addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-remover-linha')) e.target.closest('tr').remove();
        });

        // Delegação para histórico (olho e lixeira)
        document.getElementById('listaHistorico').addEventListener('click', (e) => {
            const btnVer = e.target.closest('.btn-hist-ver');
            if (btnVer) { verMemoria(btnVer.dataset.memoria); return; }
            const btnDel = e.target.closest('.btn-hist-del');
            if (btnDel) confirmarExclusao(btnDel.dataset.id);
        });
    });

    window.onload = async () => { 
        console.log('🌐 Window carregado');
        await carregarInfoRodape(); 
        await carregarHistorico(); 
        if (typeof lucide !== 'undefined') lucide.createIcons(); 
    };

    function toggleIaMenu(event) {
    event.preventDefault(); // impede navegação imediata
    const submenu = document.getElementById('submenu-ia');
    submenu.classList.toggle('open');
}


(function(){var t=localStorage.getItem('token');if(!t)return;var _ci;function checkChat(){fetch('/api/chat/nao-lidas',{headers:{Authorization:'Bearer '+t}}).then(function(r){if(r.status===402){clearInterval(_ci);return null;}return r.json()}).then(function(d){if(!d||!d.ok)return;var total=Object.values(d.naoLidas).reduce(function(a,b){return a+b},0);var b=document.getElementById('chatBadge');if(b){b.style.display=total>0?'inline-flex':'none';b.textContent=total>99?'99+':total}}).catch(function(){})}checkChat();_ci=setInterval(checkChat,30000);})();
