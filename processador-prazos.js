// Simulação da inteligência do LawTech Pro
const movimentacaoHoje = "Extinta a execução ou o cumprimento da sentença"; // Dado do seu PDF

function calcularPrazo(texto) {
    if (texto.includes("Extinta a execução")) {
        console.log("🧠 IA Identificou: Sentença de Extinção.");
        return "15 dias úteis para Recurso/Baixa";
    }
    return "Analisar manualmente";
}

console.log("🚀 Resultado para o cliente:", calcularPrazo(movimentacaoHoje));