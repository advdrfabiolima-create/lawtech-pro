
        // 1. Pegar o ID do processo pela URL
        const params = new URLSearchParams(window.location.search);
        const id = params.get('id');

        // 2. Buscar dados ao carregar a página
        fetch(`/api/processos/${id}`)
            .then(res => res.json())
            .then(data => {
                document.getElementById('npu-titulo').innerText = "Processo: " + data.numero;
                document.getElementById('teor-movimentacao').innerText = data.prazo_desc || "Sem descrição";
                document.getElementById('tipo-prazo').innerText = data.prazo_tipo || "ANALISE";
                document.getElementById('data-prazo').innerText = data.data_limite ? new Date(data.data_limite).toLocaleDateString('pt-BR') : "---";

                // 3. MOSTRAR LINK DO PDF SE EXISTIR
                if (data.arquivo_url) {
                    document.getElementById('areaDownload').style.display = 'block';
                    document.getElementById('linkPdf').href = '/' + data.arquivo_url;
                    document.getElementById('msgUpload').innerText = "✅ Documento vinculado.";
                }
            })
            .catch(err => console.error("Erro ao buscar detalhes:", err));

        // 4. Função de Upload
        async function fazerUpload() {
            const fileInput = document.getElementById('pdfInput');
            if (fileInput.files.length === 0) return alert("Selecione um PDF primeiro!");

            const formData = new FormData();
            formData.append('pdf', fileInput.files[0]);

            document.getElementById('msgUpload').innerText = "Enviando...";

            const res = await fetch(`/api/processos/${id}/upload`, {
                method: 'POST',
                body: formData
            });

            if (res.ok) {
                alert("Arquivo anexado com sucesso!");
                location.reload(); // Recarrega para mostrar o link verde
            } else {
                alert("Erro no upload.");
            }
        }
    