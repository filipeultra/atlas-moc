# Contrato v3 · Atlas MOC · Modo real + painel de sol compacto

Leia também `docs/CONTRATO-V2.md` (as regras da seção 0 continuam valendo: dono de arquivo, nunca falha silenciosa, pt-BR sem travessão, mobile primeiro, não regredir).
Projeto: `C:\Users\User\Documents\ULTRA REVENUE IA\TESTES\MAPA-IMOVEIS-3D`. Data de coleta: **07/10/2026**.

## 1. Objetivo

1. **Painel de sol compacto**: hoje cobre o centro do prédio/mapa. Deve ficar embaixo, no centro, bem menor.
2. **Modo real**: além dos dados fictícios, um conjunto de **~100 anúncios reais e únicos** de imóveis em Montes Claros/MG (OLX, portais, imobiliárias e construtoras locais), com fotos reais, deduplicados, navegável no mesmo mapa 3D. Uma "OLX premium" focada em imóveis.

## 2. Regras de coleta (valem para todo agente que toca a web)

- **Só fatos do anúncio.** Preço, aluguel, condomínio, IPTU, áreas, quartos, suítes, banheiros, vagas, andar, bairro, rua (sem número), tipo, finalidade, características (lista curta), nome do prédio/condomínio, construtora, previsão de entrega. Campo que o anúncio não mostra = `null`. **Nunca inventar, nunca estimar.**
- **Descrição:** resumo próprio de 1 a 2 frases, com palavras suas. Proibido copiar o texto do anúncio.
- **Fotos:** guardar só as **URLs** das fotos (até 6 por imóvel), exibidas direto da fonte com crédito. Não baixar fotos para o projeto.
- **Dados pessoais:** proibido guardar nome, telefone, e-mail ou WhatsApp de **pessoa física** (anunciante particular vira `"Particular"`). Nome comercial de imobiliária/construtora e CRECI de empresa podem ficar.
- **Endereço:** nunca número da casa/apto. No máximo rua + bairro.
- **Proveniência obrigatória:** cada imóvel tem `fonte.url` (link do anúncio original), `fonte.site`, `fonte.anunciante`, `coletado_em`.
- **Ritmo:** requisições sequenciais por site, com pausa (≥ 2 s entre páginas do mesmo domínio). Nada de paralelismo contra o mesmo site (já tomamos bloqueio de IP no YouTube assim).
- **Bloqueio:** HTTP 403/429, CAPTCHA, tela de verificação ou login obrigatório = **parar naquela fonte** e registrar. Proibido contornar CAPTCHA, trocar user-agent para se passar por outro cliente ou usar truques anti-bot.
- **Navegador:** o painel de navegador do app é **um só**. Só o agente explicitamente autorizado no seu prompt pode usá-lo. Os demais usam WebFetch/WebSearch/curl.
- Fora de Montes Claros (cidade) = descartar. Anúncio expirado/removido = descartar.

## 3. Esquema dos dados reais

Arquivo final: `dados/real/imoveis.json` (UTF-8). Brutos por fonte: `dados/real/brutos/<fonte>.json` (mesmo esquema, sem dedup). Scripts de coleta/consolidação: `ferramentas/coleta/`.

```json
{
  "meta": {
    "coletado_em": "2026-10-07",
    "total": 100,
    "fontes": [{ "site": "OLX", "url_busca": "https://...", "anuncios_brutos": 40, "status": "ok | bloqueado | parcial", "obs": "..." }],
    "dedup": { "brutos": 160, "duplicatas_mescladas": 35, "agrupados_em_predios": 25 },
    "aviso": "Anúncios públicos coletados em 07/10/2026. Fotos e textos pertencem aos anunciantes. Protótipo interno, não publicar."
  },
  "imoveis": [
    {
      "id": "R-0001",
      "finalidade": "venda | locacao | lancamento",
      "tipo": "apartamento | casa | cobertura | terreno | comercial | lancamento",
      "titulo": "Apartamento 3 quartos no Ibituruna",
      "bairro": "Ibituruna",
      "rua": "Rua X" ,
      "predio": "Edifício Y" ,
      "lat": -16.73, "lng": -43.88,
      "precisao_local": "rua | bairro | empreendimento",
      "preco": 650000, "aluguel": null, "condominio": 550, "iptu_anual": null,
      "area_m2": 98, "area_terreno_m2": null,
      "quartos": 3, "suites": 1, "banheiros": 2, "vagas": 2, "andar": null,
      "caracteristicas": ["Varanda gourmet", "Elevador"],
      "descricao": "Resumo próprio, 1 a 2 frases.",
      "fotos": [{ "url": "https://...jpg", "credito": "Imobiliária Z" }],
      "fonte": { "site": "OLX", "url": "https://...", "anunciante": "Imobiliária Z | Particular", "codigo": "123", "publicado_em": "2026-09-30" },
      "outras_fontes": [{ "site": "VivaReal", "url": "https://...", "anunciante": "Imobiliária W", "preco": 655000 }],
      "unidades": [{ "rotulo": "Apto 302", "area_m2": 98, "quartos": 3, "preco": 650000, "aluguel": null, "url": "https://..." }],
      "construtora": null, "entrega_prevista": null,
      "coletado_em": "2026-10-07"
    }
  ]
}
```

Regras do esquema:
- `finalidade` e `tipo` como acima; lançamento = `finalidade: "lancamento"`, `tipo: "lancamento"`, com `construtora`, `entrega_prevista` (se houver), `preco` = "a partir de" (se houver), `unidades` = tipologias/plantas se o site mostrar.
- Venda: `preco` > 0 e `aluguel` null. Locação: `aluguel` > 0 e `preco` null. Lançamento: `preco` pode ser null ("sob consulta").
- `lat/lng` dentro do perímetro de Montes Claros (`-16.80 < lat < -16.64`, `-43.93 < lng < -43.78`).
- `precisao_local`: `rua` (geocodificado pela rua + bairro no Nominatim), `empreendimento` (endereço público de lançamento/condomínio), `bairro` (centroide do bairro + deslocamento aleatório de até 250 m, para não empilhar pinos).
- `unidades` só quando vários anúncios são do **mesmo prédio/condomínio** (ver seção 4). Sem isso, `null`.
- `fotos`: só URLs que respondem HTTP 200 com `content-type` de imagem (testar com HEAD/GET de range, sem salvar).

## 4. Deduplicação (o coração do modo real)

1. **Mesmo imóvel em fontes diferentes ou repostado:** mesmo `tipo` e `finalidade`, mesmo bairro, área a ±3% (ou ±2 m²), mesmos quartos, preço a ±7%; evidência forte extra: mesmo nome de prédio, mesma rua, fotos com o mesmo nome de arquivo/mesmas dimensões. → **um** item; o anúncio mais completo vira `fonte`, os outros vão para `outras_fontes`.
2. **Vários anúncios no mesmo prédio/condomínio** (unidades diferentes): mesmo `predio` (nome) ou mesma rua + mesmo empreendimento → **um** item do tipo do prédio, com `unidades` listando cada anúncio; preço do item = menor preço das unidades ("a partir de").
3. Registrar cada decisão de dedup num log `dados/real/dedup-log.json` (`[{ "mantido": "R-0003", "mesclados": ["olx:123", "zap:456"], "regra": 1, "motivo": "..." }]`) para auditoria.
4. Meta: **~100 itens únicos** e variados. Cotas aproximadas: apartamento venda 25 · apartamento aluguel 15 · casa venda 20 · casa aluguel 8 · terreno/lote 10 · comercial (venda ou aluguel) 10 · cobertura 3+ · lançamento 6+. Espalhar por bairros (não concentrar 40 no Ibituruna).

## 5. Interface (agente UI)

**Painel de sol compacto** (`js/ui/sol-painel.js`, CSS): embaixo no centro, largura máx ~460 px no desktop, cabe em 1 linha + slider quando **recolhido** (padrão): ícone, hora (≤ 22 px), leitura curta "az 252° · el 32°", play, botão expandir (chevron), fechar. O slider fica sempre visível, fino. **Expandido** mostra atalhos (Manhã, Meio-dia, Tarde, Noite, Agora), data e atalhos de data (Hoje, 21 jun, 21 dez, 20 mar), nascer/pôr. Estado recolhido/expandido persistido. No mobile, mesmo formato compacto acima da barra inferior. Altura recolhida alvo: ≤ 96 px.

**Modo real** (shell):
- No topo, ao lado do selo: controle segmentado **[Demonstração | Anúncios reais]** com ícones. Em modo real o selo vira "Anúncios reais · 07/10/2026" com dica explicando a origem.
- Troca de modo = query `?dados=real` (ou ausente = demonstração) + recarga da página; persistir a última escolha em localStorage (`atlas-moc:dados:v1`). Links compartilhados preservam o modo.
- Carrega `dados/real/imoveis.json`. Falha (arquivo ausente/JSON inválido) = aviso específico na tela e volta ao modo demonstração com explicação.
- **Ficha real:** galeria de fotos (carrossel com setas, contador "3/6", swipe no mobile, `loading="lazy"`, `referrerpolicy="no-referrer"`, `decoding="async"`); foto que falha = placeholder visível "Foto indisponível na fonte" (registrar no console); crédito "Foto: <anunciante> via <site>"; bloco **Onde está anunciado** com o link do anúncio original (`fonte.url`) e `outras_fontes` ("Também anunciado por..."); **Unidades neste prédio** quando houver `unidades`; selo "Localização aproximada" quando `precisao_local` = `bairro`; dados ausentes não aparecem (nada de "null"/"undefined"/"R$ 0").
- **Lista/cards** em modo real com miniatura da foto (lazy) e contador de unidades quando agrupado.
- Lançamentos reais: ficha com fotos, construtora, entrega, "a partir de", link; **sem** botão de espelho 3D (não há tabela de unidades). A aba Prédio continua mostrando os lançamentos de demonstração com selo "Demonstração".
- Filtros, busca, ordenação, seleção do cliente e compartilhar funcionam igual com os dados reais.
- Rodapé/nota no modo real com o `meta.aviso`.
- `sw.js`: não cachear fotos de terceiros sem limite (ou não cachear; se cachear, teto de entradas).

Donos na v3: **UI** = `index.html`, `css/app.css`, `js/main.js`, `js/config.js`, `js/ui/*`, `js/cidade.js` (só se precisar), `sw.js`, `tests/integracao.test.mjs` e novos testes de UI, `README.md`. **Dados** = `dados/real/**`, `ferramentas/coleta/**`, `tests/real.test.mjs` (novo: valida o esquema, perímetro, ids únicos, ausência de dados pessoais por regex de telefone/e-mail, proveniência, regras de venda/locação, sem duplicata pelas regras da seção 4).
