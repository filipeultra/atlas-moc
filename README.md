# Atlas MOC: imóveis 3D de Montes Claros (protótipo)

Inspirado no post de @gustavowmoraes ("Tabela em 3D", Instagram, 05/10/2026): um espelho de vendas
em que cada janela acesa do prédio é uma unidade vendida. Aqui o conceito foi estendido para a
cidade inteira: um mapa 3D de Montes Claros com cada imóvel (venda, locação, lançamento) como um
ícone 3D clicável.

**No modo Demonstração (padrão), todos os imóveis, preços, corretores e lançamentos são fictícios.** Só as
coordenadas dos bairros são reais (centroides do Nominatim/OpenStreetMap, consultados em 06/10/2026).
O modo **Anúncios reais** (v3) mostra anúncios públicos de Montes Claros coletados em 07/10/2026, com fotos
exibidas direto da fonte, crédito e link do anúncio original. Protótipo interno: não publicar.

## Rodar

Precisa de um servidor HTTP (módulos ES não abrem por `file://`).

```bash
python -m http.server 8792
```

Abrir `http://localhost:8792/`. Precisa de internet: mapa base (OpenFreeMap), MapLibre e three.js vêm de CDN.

## O que tem

**Modo Cidade** (`#/cidade`)
- Mapa 3D (MapLibre + prédios extrudados do OSM), noite e dia.
- Um ícone 3D por imóvel, girando, com a cor da finalidade: azul venda, laranja locação, dourado lançamento.
  Formato do ícone pelo tipo: casa, apartamento, cobertura, terreno, comercial, lançamento (torre com grua).
- Etiqueta de preço sobre o ícone a partir do zoom 14,6.
- Filtros: finalidade, tipo, bairro, quartos, preço, busca livre (código, bairro, característica). Lista sincronizada com o mapa.
- Clique no ícone ou no card: voa até o imóvel e abre a ficha (preço, custo mensal da locação, áreas, características,
  corretor, "Enviar ao cliente pelo WhatsApp", "Copiar ficha", "Abrir no Maps").
- Lançamento: resumo (disponíveis, % vendido, % obra, "a partir de") e botão para o espelho 3D.

**Modo Prédio** (`#/predio/<id>`), o equivalente ao vídeo
- Prédio montado a partir da tabela: cada unidade é um volume clicável no 3D.
- Noite: luz acesa = vendida, apagada = disponível, laranja = reservada. Dia: verde = disponível.
- Espelho por pavimento (grade andar × final) ligado ao 3D: passar o mouse destaca, clicar gira a câmera até a unidade.
- Ficha da unidade: área privativa, pavimento e cota, vagas, valor de tabela, R$/m², fluxo de pagamento,
  "Disponível anterior / Próximo disponível", envio pelo WhatsApp.
- Câmeras Frente, Lateral, Fundos, Rooftop; Girar; Contornar disponíveis; filtro por tipologia.
- Modo Obra: alvenaria pronta, esqueleto de estrutura, grua, e os andares futuros como volumes translúcidos na cor do status.

**v2: em comum às duas vistas**
- Controlador de sol (botão no topo ou tecla S): data, hora de 05:00 a 20:30, play do dia; luz, sombra e céu
  do mapa e do prédio seguem a posição real do sol em Montes Claros. Ficha da unidade com bloco Insolação
  (faces da unidade e horário de sol direto) e "Ver vista da janela".
- Configurações (engrenagem): ícones 3D, pinos ou ocultos; mapa 2D ou 3D; prédios da cidade; nomes de ruas,
  bairros e pontos de interesse; etiquetas de preço; agrupar imóveis; animações; qualidade; tema; medidor de desempenho.
- Espaço + arrastar (botão esquerdo ou direito) gira e inclina a câmera; bússola própria; atalhos (tecla ?).
- Seleção do cliente (coração) com link `#/selecao/MC-1001,L:serra-azul`.
- Instalável como app (PWA) e com modo offline para o que já foi visto.

**v3: modo real e sol compacto**
- Topo: controle **[Demonstração | Anúncios reais]** ao lado do selo (no celular ele fica no topo da lista).
  Trocar recarrega a página com `?dados=real` (ou sem o parâmetro, para a demonstração) e a escolha fica no
  aparelho (`atlas-moc:dados:v1`). Abrir a página sem parâmetro e sem rota usa a última escolha; link com rota
  (`#/imovel/...`, `#/selecao/...`) sem o parâmetro é da demonstração. Links copiados ou compartilhados no modo
  real levam o `?dados=real`.
- Modo real lê `dados/real/imoveis.json` (esquema no `docs/CONTRATO-V3.md` §3). Arquivo ausente, JSON inválido
  ou sem anúncios válidos: aviso com o motivo e o app volta para a demonstração. Anúncio com dado essencial
  inválido (id, tipo, finalidade, coordenadas fora de Montes Claros, bairro) fica fora do mapa, com aviso.
- Ficha real: galeria (setas, contador, arrastar no celular; fotos `lazy` e `no-referrer`; foto que a fonte não
  serve mais vira "Foto indisponível na fonte"), crédito "Foto: anunciante via site", **Onde está anunciado**
  (anúncio original e outras fontes), **Unidades neste prédio** quando vários anúncios são do mesmo prédio,
  selo **Localização aproximada** quando a posição é pelo bairro. Campo que o anúncio não traz não aparece.
- Lançamento real: fotos, construtora, entrega, "a partir de" ou "sob consulta", sem espelho 3D. A aba Prédio
  segue com os lançamentos de demonstração, marcados com o selo **Demonstração**.
- Seleção do cliente separada por modo (`atlas-moc:selecao:real:v1` no modo real).
- Painel de sol compacto embaixo no centro: recolhido (padrão) é uma linha (hora, "az 252° · el 32°", play,
  expandir, fechar) mais o slider; expandido mostra nascer/pôr, atalhos de hora e de data. O estado fica salvo
  (`atlas-moc:sol-painel:v1`). No celular, o mesmo cartão flutua logo acima da folha de baixo.
- O service worker não intercepta nem guarda fotos de terceiros.

Links compartilháveis: `#/imovel/MC-1029`, `#/lancamento/serra-azul`, `#/predio/serra-azul/1406`, `#/selecao/MC-1001,MC-1029`.

## Arquivos

| Caminho | Papel |
|---|---|
| `index.html`, `css/app.css` | Interface |
| `js/main.js` | Rotas, filtros, lista, fichas, ligação entre as vistas |
| `js/cidade.js` | Mapa + camada three.js dos ícones (clique por projeção na tela, sem raycast) |
| `js/icones3d.js` | Geometria low-poly de cada tipo de imóvel |
| `js/predio.js` | Cena do prédio, cidade low-poly ao redor, modos Noite/Dia/Obra |
| `js/sol.js` | Posição do sol (NOAA/Meeus), nascer e pôr, janela de sol numa fachada, dia/noite (puro) |
| `js/layout-predio.js` | Distribuição das unidades no andar, usada pela cena e pela insolação (puro) |
| `js/config.js`, `js/ui/*.js` | Configurações persistidas e componentes da interface (painéis, folhas, teclado, bússola, PWA) |
| `js/icones-ui.js` | Ícones Lucide (ISC) usados na interface |
| `sw.js`, `manifest.webmanifest`, `icons/` | App instalável e cache offline |
| `js/fluxo.js` | Cálculo do fluxo de pagamento em centavos inteiros e formatadores (puro, testável) |
| `dados/imoveis.json`, `dados/lancamentos.json` | Dados de demonstração |
| `dados/real/imoveis.json` | Anúncios reais deduplicados (modo real); brutos e log de dedup em `dados/real/` |
| `js/ui/real.js`, `js/ui/modo-dados.js` | Ficha, card e validação dos anúncios reais; escolha do modo de dados |
| `ferramentas/gerar_dados_demo.py` | Gera os dados (semente fixa) |
| `tests/run.mjs` | Canário do fluxo + integridade dos dados |

## Trocar pelos dados reais

O app só lê os dois JSON. Para usar a carteira real, basta gerar os mesmos campos a partir do CRM ou da planilha:

- Imóvel: `id, finalidade (venda|locacao), tipo, bairro, lat, lng, preco | aluguel, condominio, iptu_anual,
  area_m2, quartos, suites, banheiros, vagas, caracteristicas[], descricao, corretor_id, atualizado_em`.
- Lançamento: `tipologias{}`, `unidades[]` com `andar, final, tipologia, status, valor_tabela_centavos`,
  `fluxo[]` com `pct_bp` (10000 = 100%) e `parcelas`, `predio{}` com largura, profundidade, pé-direito, pódio, cores.

O fluxo de pagamento é configuração do lançamento, não constante no código. Se a soma não der 100%, a ficha mostra o erro em vez de calcular.

## Testes

```bash
npm test
```

Roda `tests/run.mjs` (fluxo e dados), `sol.test.mjs` (sol contra referência do suncalc), `config.test.mjs`,
`insolacao.test.mjs`, `sw.test.mjs` (estratégias do service worker com cache simulado) e `integracao.test.mjs`
(imports, contrato entre a interface e as vistas 3D, precache contra o disco, manifest, fichas renderizadas com os dados reais).
O `integracao.test.mjs` também roda `tests/ui-real.test.mjs`: fichas e cards do modo real com a fixture
`tests/fixtures/real-exemplo.json` (6 anúncios fictícios: agrupado, outras fontes, lançamento sem preço, locação,
terreno sem quartos, foto quebrada, campos nulos, título com HTML), escape, escolha do modo pela URL, painel de
sol recolhido e SW sem cache de fotos; se `dados/real/imoveis.json` existir, renderiza todos os anúncios dele.

Verifica: âncoras do fluxo calculadas à mão, recusa de fluxo que não soma 100%, fechamento no centavo das 226 unidades,
status e tipologias válidos, ids únicos, imóveis dentro do perímetro de Montes Claros.
