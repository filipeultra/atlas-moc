# Contrato v2 · Atlas MOC

Fonte única de verdade para a rodada v2. Cada agente lê este arquivo inteiro antes de começar.
Projeto: `C:\Users\User\Documents\ULTRA REVENUE IA\TESTES\MAPA-IMOVEIS-3D` (HTML/CSS/JS puro, módulos ES, sem build).
Bibliotecas por CDN, versões fixas: MapLibre GL JS **4.7.1** (global `maplibregl`), three.js **0.160.0** (importmap `three`, `three/addons/`).
Código-fonte do MapLibre para consulta: `curl -sL https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl-dev.js` (não chute API: confira).

## 0. Regras que valem para todos

1. **Dono de arquivo.** Na fase de construção, cada agente só cria/edita os arquivos listados como seus (seção 1). Precisa de algo no arquivo de outro? Registre em `desvios` no relatório final. Nunca edite arquivo alheio.
2. **Nada de navegador** na fase de construção (o painel é um só e compartilhado). Prove com `node --check`, testes em Node e leitura de código.
3. **Nunca falha silenciosa.** Todo `catch` faz `console.error('[modulo]', err)` com o erro real e propaga para a UI uma mensagem específica (via `eventos.aoErro(msg)` nos módulos 3D, `aviso(msg,'erro')` no shell). Proibido mensagem genérica sozinha.
4. **Nada hardcoded do que varia.** Limiares, cores de status, qualidade, fuso: constantes nomeadas no topo do módulo ou configuração.
5. **Texto de interface em português do Brasil**, sem travessão (use vírgula, dois-pontos, ponto médio "·").
6. **Mobile primeiro.** Alvos de toque ≥ 44 px, `env(safe-area-inset-*)`, nada que dependa de hover para funcionar.
7. **Preservar comportamentos v1** (seção 9). Regressão é falha.
8. Comentários no estilo do código existente: poucos, em português, explicando o porquê.

## 1. Mapa de donos

| Agente | Arquivos (exclusivos) |
|---|---|
| `sol-dados` | `js/sol.js` (novo), `tests/sol.test.mjs` (novo), `tests/run.mjs`, `ferramentas/gerar_dados_demo.py`, `dados/*.json`, `package.json` |
| `icones-pwa` | `js/icones-ui.js` (novo), `manifest.webmanifest` (novo), `sw.js` (novo), `icons/*` (novo) |
| `cidade` | `js/cidade.js`, `js/icones3d.js` |
| `predio` | `js/predio.js`, `js/layout-predio.js` (criado na integração: distribuição das unidades no andar, pura, usada também por `js/ui/insolacao.js`) |
| `shell` | `index.html`, `css/app.css`, `js/main.js`, `js/config.js` (novo), `js/ui/*.js` (novos, se quiser modularizar) |

`js/fluxo.js` não muda (só leitura).

## 2. `js/sol.js` (agente sol-dados) · módulo puro, sem DOM e sem three

```js
export const MOC = { lat: -16.7350, lng: -43.8617, fusoHoras: -3 }; // Montes Claros, America/Sao_Paulo, sem horário de verão desde 2019
export function posicaoSol(dataUTC, lat, lng)                 // Date → { azimute, elevacao } em graus. azimute: 0 = norte, sentido horário, [0,360). elevacao: [-90,90]
export function dataLocalParaUTC(dataISO, minutos, fusoHoras = MOC.fusoHoras) // 'AAAA-MM-DD' + minutos locais (0..1439) → Date
export function posicaoSolLocal(dataISO, minutos, lat = MOC.lat, lng = MOC.lng) // atalho dos dois acima
export function nascerPorDoSol(dataISO, lat = MOC.lat, lng = MOC.lng) // → { nascer, meioDia, porDoSol } em minutos locais (elevação -0,833°)
export function janelaDeSol(dataISO, azimuteFachada, lat = MOC.lat, lng = MOC.lng, passoMin = 5)
  // sol direto numa fachada: sol acima do horizonte E à frente da fachada (|Δazimute| < 90°)
  // → { faixas: [[iniMin, fimMin], ...], minutos: total, inicio: min|null, fim: min|null }
export function fatorDia(elevacao)   // 0 = noite, 1 = dia. smoothstep entre -6° e +8°. ÚNICA definição de dia/noite do app
export const LIMIAR_NOITE = 0.5;     // fatorDia < LIMIAR_NOITE → convenção "noite" (luz acesa = vendida)
export function rotuloOrientacao(azimute) // 'Norte' | 'Nordeste' | 'Leste' | 'Sudeste' | 'Sul' | 'Sudoeste' | 'Oeste' | 'Noroeste'
export function fmtHora(minutos)          // 'HH:MM'
export function hojeMOC()                 // → { dataISO, minutos } do relógio atual no fuso de Montes Claros
```

Validação obrigatória: comparar `posicaoSol` com a biblioteca independente `suncalc@2` (instalar só no scratchpad, nunca no projeto) em ≥ 60 instantes (datas espalhadas no ano, horas de 5h a 19h) em Montes Claros. Erro máximo aceito: 0,3° em azimute e elevação. Lembrete: no suncalc 1.x o azimute é medido a partir do sul, positivo para oeste; o suncalc 2.x (2.1.1) já devolve graus a partir do norte, sentido horário, e `altitude` com refração (nota da integração). Registrar o erro máximo medido no relatório e num comentário do teste. Âncoras adicionais em `tests/sol.test.mjs`: elevação ao meio-dia solar no equinócio ≈ 90 − |lat|; `fatorDia` monotônico; `janelaDeSol` de fachada norte no inverno (21/06) > fachada sul no mesmo dia.

## 3. Dados (agente sol-dados)

- Acrescentar `predio.orientacao_graus` (azimute da normal da fachada frontal; 0 = frente para o norte) em cada lançamento: `serra-azul` 20, `mirante-sul` 190, `vivere-prates` 100.
- Regerar com o gerador. Provar com script que **nenhum outro valor mudou** nos JSON (diff estrutural antes/depois: único campo novo).
- `tests/run.mjs` passa a checar `orientacao_graus` em [0,360) e a rodar também os testes de `sol.test.mjs` (ou `package.json` `test` roda os dois). Saída com código 1 se algo falhar.

## 4. `js/config.js` (agente shell)

```js
export const PADRAO = {
  icones: '3d',            // '3d' | 'pinos' | 'ocultos'
  visao: '3d',             // '3d' | '2d'
  prediosCidade: true,     // extrusões do OSM
  nomesRuas: true,
  nomesBairros: true,
  pontosInteresse: false,
  etiquetasPreco: true,
  agrupar: true,           // clusters
  animacoes: true,         // padrão real: !matchMedia('(prefers-reduced-motion: reduce)').matches
  qualidade: 'auto',       // 'auto' | 'alta' | 'equilibrada' | 'economica'
  tema: 'escuro',          // 'escuro' | 'claro' | 'auto'
  medidor: false,          // overlay de FPS e draw calls
};
export function carregarConfig()          // localStorage 'atlas-moc:config:v1', try/catch, mescla com PADRAO
export function salvarConfig(cfg)
export function resolverQualidade(q)      // 'auto' → 'alta' | 'equilibrada' | 'economica' (mobile, deviceMemory, hardwareConcurrency)
```

Os módulos 3D recebem a config **já resolvida** (`qualidade` nunca chega como `'auto'`).

## 5. `js/cidade.js` v2 (agente cidade)

```js
export async function criarCidade({ container, camadaEtiquetas, itens, eventos, config, sol })
// itens: [{ id, tipo, finalidade, lat, lng, rotulo }]   (tipo: casa|apartamento|cobertura|terreno|comercial|lancamento; finalidade: venda|locacao|lancamento)
// eventos: { aoPassar(id|null, clientX, clientY), aoClicar(id), aoErro(msg), aoPronto(), aoMudarCamera({ bearing, pitch, zoom }) }
// sol: { azimute, elevacao }
return {
  map,
  filtrar(idsVisiveis /* Set */),
  destacar(id | null),
  selecionar(id | null, { voar = true, padding } = {}),
  configurar(parcial),          // qualquer subconjunto das chaves da config (seção 4); aplica na hora
  sol({ azimute, elevacao }),
  girar(deltaGraus), inclinar(deltaGraus), norte(),
  enquadrarTudo(padding),       // fitBounds nos itens visíveis
  redimensionar(),
  diagnostico(),                // → { drawCalls, instancias, quadros, modoRender: 'continuo' | 'sob-demanda', icones }
};
```

Requisitos:
- **Desempenho dos ícones 3D:** `InstancedMesh` por geometria (`tipo|finalidade`) + uma instância para anéis, uma para sombras, uma para hastes. Meta: **≤ 25 draw calls** na camada com os 119 itens (hoje são ~476 meshes). Matrizes só são recalculadas quando há animação ou a câmera mudou.
- **Render sob demanda:** com `animacoes: false`, nada de `triggerRepaint` em laço; a camada só desenha quando o MapLibre redesenha. Com animação ligada, laço contínuo, pausado com `document.hidden`. `diagnostico().quadros` conta os `render()` da camada (para provar 0 quadros parado).
- **`icones`:** `'3d'` (camada custom), `'pinos'` (camadas nativas do MapLibre sobre uma fonte GeoJSON `imoveis`: círculo com borda, cor da finalidade, lançamento maior e dourado, hover/seleção por `feature-state`), `'ocultos'` (nada, exceto o item selecionado, que continua visível).
- **`agrupar`:** fonte GeoJSON com `cluster: true` (raio ~50 px, `clusterMaxZoom` 14). Bolha nativa com contagem; clique na bolha faz `easeTo` no zoom de expansão (`getClusterExpansionZoom` **retorna Promise** no 4.7.1). No modo `'3d'`, ícone 3D só para ponto não agrupado. `filtrar()` atualiza a fonte (`setData`) para os clusters refletirem os filtros.
- **`visao: '2d'`:** `setMaxPitch(0)` e pitch 0, extrusões escondidas, e ícones efetivos viram `'pinos'` (salvo `'ocultos'`). Voltar a `'3d'` restaura `maxPitch` 78 e pitch ~56 com animação.
- **Rótulos do mapa:** `nomesRuas` (camadas `symbol` de `source-layer` `transportation_name`, incluindo escudos), `nomesBairros` (`place`), `pontosInteresse` (`poi`). Reaplicar sempre após troca de estilo.
- **`etiquetasPreco`:** só a partir do zoom 14,6, com descarte de sobreposição (retângulos na tela; prioridade: selecionado, hover, lançamento). Posições atualizadas só quando a câmera muda ou há animação.
- **Sol:** `setLight({ anchor: 'map', position: [1.15, azimute, 90 - clamp(elevacao, 0, 90)], color, intensity })`; `setSky` com cores por `fatorDia` (noite azul-marinho, crepúsculo com horizonte alaranjado, dia azul); luz direcional dos ícones vinda do sol. Estilo base: `fatorDia < 0,45` → noite (fiord adaptado), `> 0,55` → dia (liberty), histerese para não piscar. Após `style.load`, reaplicar camadas, rótulos, sky, light.
- **Espaço + arrastar = orbitar.** Com Espaço pressionado (ignorar se o foco estiver em input/select/textarea/contenteditable; `preventDefault` para não rolar a página), cursor `grab`/`grabbing`; arrastar com botão esquerdo **ou direito** gira (dx → bearing, ~0,35°/px) e inclina (dy → pitch, ~0,25°/px, respeitando maxPitch). `dragPan` desligado durante. Solta em `keyup`/`blur`. Botão direito sem espaço mantém o padrão do MapLibre. Remover o `NavigationControl` padrão (o shell desenha bússola própria usando `girar/inclinar/norte` e `aoMudarCamera`).
- Atribuição do mapa continua visível (exigência das licenças OSM/OpenFreeMap).

## 6. `js/predio.js` v2 (agente predio)

```js
export function criarPredio({ canvas, eventos, config })
// eventos: { aoPassar(unidade|null, x, y), aoClicar(unidade), aoErro(msg) }
return {
  carregar(lancamento), ativar(bool), modo('comercial' | 'obra'),
  sol({ azimute, elevacao }),            // substitui luz('noite'|'dia')
  estadoLuz(),                           // 'noite' | 'dia' = fatorDia(elevacao) < LIMIAR_NOITE ? 'noite' : 'dia' (importar de sol.js)
  configurar(parcial),                   // animacoes, qualidade
  camera('frente' | 'lateral' | 'fundos' | 'topo'),
  girar(bool),                           // auto-rotação
  girarPasso(deltaGraus), inclinar(deltaGraus), norte(),
  contorno(bool), filtrar(fn), destacar(numero | null), destacarAndar(andar | null),
  selecionar(numero | null, { focar }),
  vistaDaUnidade(numero | null),         // câmera na janela da unidade olhando para fora; null volta à órbita
  emVista(),                             // número da unidade em vista ou null
  enquadrar(esq, dir),
  diagnostico(),                         // → { drawCalls, triangulos, quadros, modoRender, sombras }
};
```

Requisitos:
- **Render sob demanda:** desenhar só quando algo muda (controles/amortecimento, tween de câmera, auto-rotação, hover, seleção, sol, resize, animação ativa). Parado = 0 quadros (provar via `diagnostico().quadros`). Pausar com `document.hidden`. O pulso da unidade selecionada só anima com `animacoes: true`; sem animação, destaque estático.
- **Sol e sombras:** `DirectionalLight` com `castShadow`. O sol chega em coordenadas do mundo; converter para o referencial do prédio (frente = +z) com `lancamento.predio.orientacao_graus` (A): `θ' = azimute − A + 180`; direção = `(sin θ'·cos e, sin e, −cos θ'·cos e)`. Projetam sombra: núcleo, lajes, varandas, aletas, pódio, grua, prédios do entorno, árvores. Recebem: chão, praça, quadras, prédios do entorno, núcleo. Câmera de sombra ortográfica cobrindo ~±220 m em torno do prédio. Céu com gradiente por `fatorDia` + tom de crepúsculo perto do horizonte + disco do sol na direção certa; estrelas e janelas da cidade somem com o dia.
- **Convenção de cores:** noite = luz acesa vendida; dia = verde disponível (v1, `COR_JANELA`). Decidida só por `estadoLuz()`.
- **Qualidade:** `alta` (pixelRatio ≤ 2, bloom, sombra 2048), `equilibrada` (≤ 1,5, bloom, sombra 1024), `economica` (1, sem bloom e sem composer, sem sombra, cidade com metade das instâncias via `mesh.count`). Trocável em tempo real (exceto antialias).
- **Espaço + arrastar = orbitar** também aqui (com Espaço, botão direito também gira). `girarPasso/inclinar/norte` para o teclado (norte = câmera olhando a fachada de frente).
- **`vistaDaUnidade`:** câmera 0,6 m para fora da janela principal, na altura da janela, olhando para fora (FOV ~60). Usuário pode olhar em volta (órbita com alvo a ~0,1 m à frente). `null` restaura a câmera anterior.
- **`destacarAndar`:** contorno do andar inteiro.

## 7. `js/icones-ui.js`, PWA (agente icones-pwa)

```js
export const ICONES = { nome: '<path .../>' /* conteúdo interno do SVG Lucide 24x24 */ };
export function icone(nome, { tamanho = 16, classe = '', titulo = '' } = {})
  // → '<svg class="i ${classe}" width height viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">…</svg>'
  // nome inexistente: console.error + retorna SVG vazio (nunca lança)
```
Ícones reais do Lucide (licença ISC, citar no topo do arquivo), baixados de `https://unpkg.com/lucide-static@latest/icons/<nome>.svg`. Nomes obrigatórios (chave → ícone Lucide):
`mapa`→map, `predio`→building-2, `sol`→sun, `lua`→moon, `nascer`→sunrise, `por`→sunset, `play`→play, `pausa`→pause, `config`→settings-2, `camadas`→layers, `busca`→search, `filtro`→sliders-horizontal, `fechar`→x, `voltar`→arrow-left, `dir`→chevron-right, `esq`→chevron-left, `baixo`→chevron-down, `cama`→bed-double, `banho`→bath, `carro`→car, `regua`→ruler, `area`→scan, `casa`→house, `apartamento`→building, `cobertura`→hotel, `terreno`→land-plot, `comercial`→store, `lancamento`→construction, `pin`→map-pin, `compartilhar`→share-2, `whatsapp`→message-circle, `copiar`→copy, `link`→link, `coracao`→heart, `olho`→eye, `ocultar`→eye-off, `camera`→video, `girar`→rotate-3d, `bussola`→compass, `mais`→plus, `menos`→minus, `cubo`→box, `plano`→square, `contorno`→scan-line, `obra`→hard-hat, `etiqueta`→tag, `calendario`→calendar, `relogio`→clock, `info`→info, `alerta`→triangle-alert, `teclado`→keyboard, `lista`→list, `externo`→external-link, `check`→check, `tema`→sun-moon, `desempenho`→gauge, `animacao`→sparkles, `agrupar`→circle-dot, `rua`→signpost, `poi`→landmark, `vista`→binoculars, `andar`→layers-3, `instalar`→download, `limpar`→filter-x, `vendido`→badge-check, `topo`→arrow-up-from-dot, `frente`→panel-bottom, `lateral`→panel-right, `fundos`→panel-top.
Se algum nome do Lucide não existir, escolher o equivalente mais próximo e registrar no relatório.

**PWA** (o shell coloca as tags no `<head>` e registra o SW; este agente não edita `index.html`):
- `manifest.webmanifest`: name "Atlas MOC · Imóveis 3D", short_name "Atlas MOC", start_url "./", scope "./", display "standalone", background_color e theme_color "#070d1f", icons `icons/icon-192.png`, `icons/icon-512.png`, `icons/icon-maskable-512.png` (purpose maskable), mais `icons/apple-touch-icon.png` (180).
- Ícones gerados com Python/PIL: marca (montanha + sol em traço dourado `#e4bd68` sobre `#070d1f`), maskable com área segura de 80%.
- `sw.js`: precache do app shell (index.html, css, js/*, dados/*, manifest, ícones); same-origin GET com **network-first** (timeout 3 s, cai no cache: nunca servir JS velho quando há rede); CDNs versionados (unpkg, jsdelivr, fonts.gstatic) **cache-first**; Google Fonts CSS e `tiles.openfreemap.org` **stale-while-revalidate** com teto de entradas (aparar o mais antigo, ~1500 tiles); navegação offline cai no `index.html` em cache. Ignorar não-GET. `skipWaiting` + `clients.claim`. Versão em constante.

## 8. Shell (agente shell): `index.html`, `css/app.css`, `js/main.js`, `js/config.js`, `js/ui/*`

**Tipografia:** remover Fraunces e qualquer serifa. Pilha: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", Roboto, system-ui, sans-serif`; carregar Inter variável (Google Fonts) para quem não tem SF. Números grandes peso 650–700, `letter-spacing: -0.02em`, `tabular-nums`. Títulos peso 600–650, `-0.015em`. Visual limpo tipo Apple/ClickUp: menos dourado, mais neutro, dourado só como acento.

**Ícones** (`icone()` de `js/icones-ui.js`) em: alternador Cidade/Prédio, finalidade, botões de câmera, sol, configurações, busca, chips de tipo, specs da ficha (cama, banho, carro, área), ações (compartilhar, WhatsApp, copiar, externo), fechar, avisos, cards da lista (metadados), barra do prédio. No mobile (< 860 px) a barra do prédio vira só ícones com `aria-label` e `title`.

**Temas:** tokens CSS para `escuro` (padrão) e `claro`; `auto` segue `prefers-color-scheme`. `[data-tema]` no `<html>`. O mapa base não depende do tema (depende do sol).

**Controlador de sol** (mesmo estado nas duas vistas): botão `sol` no topo abre painel (desktop: flutuante embaixo, centro; mobile: folha). Contém: data (`input type=date` + atalhos Hoje, 21 jun (inverno), 21 dez (verão), 20 mar (equinócio)); slider de hora 05:00–20:30, passo 5 min; leitura "14:30 · azimute 312° · elevação 41°"; "nascer 05:58 · pôr 17:41"; play/pausa animando 05:00 → 20:30 em ~14 s; atalhos Manhã 8h, Meio-dia, Tarde 16h, Noite 20h; "Agora". Estado inicial: hoje, 20:00 (preserva a primeira impressão noturna do v1). Toda mudança: `posicaoSolLocal` → `cidade.sol()` e `predio.sol()`; depois re-render da legenda e da grade usando `predio.estadoLuz()` (paridade de visões). Os botões Noite/Dia da v1 saem (viram os atalhos Noite 20h e Meio-dia).

**Ficha da unidade:** bloco **Insolação**: face(s) da unidade (`rotuloOrientacao`), "Sol direto em DD/MM: 06:12–11:40 (5h28)" via `janelaDeSol` com o azimute da face (frente = A, fundos = A+180, lateral direita +x = A−90, esquerda −x = A+90; unidade de canto mostra as duas faces), nota "Sem considerar sombra de prédios vizinhos.". Botão **Ver vista da janela** (`vistaDaUnidade`), alterna para "Sair da vista".

**Menu de configurações** (ícone engrenagem; desktop: popover à direita; mobile: folha cheia), agrupado:
- Mapa: Ícones [3D | Pinos | Ocultar] · Visão [3D | 2D] · Prédios da cidade em 3D · Nomes de ruas · Nomes de bairros · Pontos de interesse · Etiquetas de preço · Agrupar imóveis próximos
- Movimento e desempenho: Animações · Qualidade [Automática | Alta | Equilibrada | Econômica] · Mostrar medidor de desempenho
- Interface: Tema [Escuro | Claro | Automático] · Atalhos de teclado
- App: Instalar (via `beforeinstallprompt`; no iOS, instrução "Compartilhar → Adicionar à Tela de Início") · estado do modo offline (SW ativo ou motivo da falha)
- Restaurar padrão
Persistir com `salvarConfig`; aplicar na hora com `cidade.configurar()` / `predio.configurar()`.

**Bússola própria** (canto inferior direito do mapa, acima da atribuição): mostra o bearing (gira com `aoMudarCamera`), clique = `norte()`; botões +/− zoom, 2D/3D. No prédio: botões de girar ±15°.

**Teclado** (ignorar quando o foco está em campo de texto): `Espaço`+arrastar orbitar · `Q`/`E` girar 15° · `T`/`G` inclinar · `N` norte · `2`/`3` visão 2D/3D · `S` abre o sol · `L` lista · `/` busca · `?` atalhos · `Esc` fecha o que estiver aberto. Overlay de atalhos com ícones.

**Seleção do cliente:** coração nos cards e na ficha (imóveis e lançamentos); contador no topo; painel com a lista, "Compartilhar seleção" (`navigator.share` quando existir, senão WhatsApp/copiar) com link `#/selecao/MC-1001,MC-1029,L:serra-azul`, "Mostrar só a seleção no mapa", "Limpar". Persistir em localStorage. A rota `#/selecao/...` filtra o mapa para esses ids e abre o painel (é o que o cliente recebe).

**Compartilhar** na ficha: `navigator.share` quando disponível; senão WhatsApp e copiar.

**Mobile:** folhas com arraste no puxador e 3 pontos de parada (recolhida ~64 px, meio ~50vh, cheia ~88vh), arrastar para baixo fecha a ficha; `safe-area`; topo compacto; barra do prédio só com ícones.

**Medidor de desempenho** (config `medidor`): overlay pequeno com FPS e `diagnostico()` da vista ativa.

**PWA:** `<link rel="manifest" href="manifest.webmanifest">`, `<meta name="theme-color" content="#070d1f">`, `apple-touch-icon`, `apple-mobile-web-app-capable`; registrar `sw.js` só em http(s); falha → `console.error` + estado mostrado na seção App das configurações.

**Desempenho do shell:** `preconnect` aos CDNs, `modulepreload` do three; listas renderizadas sem layout thrash; `predio.js` carregado sob demanda (import dinâmico) e nada do shell importa `predio.js` estaticamente.

## 9. Comportamentos v1 que não podem regredir

Rotas `#/cidade`, `#/imovel/ID`, `#/lancamento/ID`, `#/predio/ID`, `#/predio/ID/NUM` · filtros (finalidade, tipo, bairro, quartos, preço, busca, ordem) e lista sincronizada com o mapa · voo com padding descontando painéis · dica (tooltip) no hover · etiquetas de preço · ficha do imóvel (custo mensal da locação, IPTU ÷ 12) · ficha do lançamento e botão para o espelho · prédio: hover/clique 3D, grade por pavimento ligada ao 3D, foco da câmera ao clicar na grade, filtro de tipologia, contorno de disponíveis, câmeras, girar, modo Obra (esqueleto, grua, volumes translúcidos), enquadramento descontando painéis · fluxo de pagamento em centavos com erro visível se não somar 100% · disponível anterior/próximo · folhas inferiores no mobile · avisos de erro visíveis · `node tests/run.mjs` passando.

## 10. Metas medíveis (verificadas depois no navegador)

| Meta | Como medir |
|---|---|
| Camada de ícones 3D ≤ 25 draw calls com 119 itens | `cidade.diagnostico().drawCalls` |
| Mapa parado com animações desligadas: 0 quadros da camada em 2 s | `diagnostico().quadros` antes/depois |
| Prédio parado (sem animação, sem girar): 0 quadros em 2 s | `predio.diagnostico().quadros` |
| Sol: erro ≤ 0,3° contra suncalc | `node tests/sol.test.mjs` |
| Dados: só `orientacao_graus` novo | diff estrutural no relatório |
