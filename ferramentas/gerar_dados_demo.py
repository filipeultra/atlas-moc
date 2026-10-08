"""Gera os dados FICTÍCIOS de demonstração do protótipo (imóveis avulsos + lançamentos).

Tudo aqui é inventado, com semente fixa (mesma saída a cada execução).
Só as coordenadas dos bairros são reais: centroides do Nominatim/OpenStreetMap,
consultados em 06/10/2026. Os imóveis caem num raio de ~350 m do centroide do bairro.

Uso:  python ferramentas/gerar_dados_demo.py
Saída: dados/imoveis.json, dados/lancamentos.json
"""
import json
import math
import random
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SEMENTE = 20261006

# Centroides reais (Nominatim/OSM, addresstype=suburb), 06/10/2026.
BAIRROS = {
    "Centro": (-16.7229868, -43.8653481), "Ibituruna": (-16.7259860, -43.8858605),
    "Todos os Santos": (-16.7175000, -43.8733313), "Morada do Sol": (-16.7409868, -43.8820411),
    "Major Prates": (-16.7479525, -43.8783718), "Cândida Câmara": (-16.7351112, -43.8745973),
    "Jardim São Luiz": (-16.7305493, -43.8781164), "Vila Brasília": (-16.7152651, -43.8679722),
    "Melo": (-16.7247132, -43.8743827), "São José": (-16.7211400, -43.8576512),
    "Augusta Mota": (-16.7455484, -43.8825990), "Funcionários": (-16.7358509, -43.8789318),
    "Jaraguá": (-16.6786466, -43.8224888), "Delfino Magalhães": (-16.7360963, -43.8380528),
    "Santo Expedito": (-16.7371648, -43.8714839), "Morada do Parque": (-16.7577718, -43.8849486),
    "Planalto": (-16.6986746, -43.8366816), "Cidade Nova": (-16.7403293, -43.8656474),
    "Interlagos": (-16.7151983, -43.8304803), "São Norberto": (-16.7276312, -43.8803051),
    "Alto São João": (-16.7151826, -43.8544490), "Canelas": (-16.7440690, -43.8668898),
    "Vila Mauricéia": (-16.7185714, -43.8819647), "Esplanada": (-16.7131021, -43.8404582),
    "Jardim Panorama": (-16.7155887, -43.8782880), "Sagrada Família": (-16.7397563, -43.8764815),
    "Santa Rita": (-16.7324406, -43.8587359), "Independência": (-16.7181987, -43.8146446),
    "Ipiranga": (-16.7209320, -43.8464664), "Maracanã": (-16.7613045, -43.8661363),
}

# Faixa de preço por m² (venda) e por m² (aluguel mensal). Inventadas para a demo,
# NÃO são pesquisa de mercado.
FAIXAS = {
    "alto":    {"apto": (7000, 9500), "casa": (5500, 8000), "terreno": (1400, 2400), "comercial": (6500, 9000), "aluguel": (32, 45)},
    "medio":   {"apto": (4500, 6500), "casa": (3500, 5000), "terreno": (700, 1300),  "comercial": (4500, 6500), "aluguel": (21, 30)},
    "popular": {"apto": (3000, 4200), "casa": (2500, 3600), "terreno": (350, 700),   "comercial": (3000, 4200), "aluguel": (14, 20)},
}
PADRAO = {
    "alto": ["Ibituruna", "Morada do Sol", "Jardim São Luiz", "Todos os Santos", "Funcionários", "Melo",
             "São Norberto", "Vila Mauricéia", "Cândida Câmara"],
    "popular": ["Jaraguá", "Delfino Magalhães", "Planalto", "Interlagos", "Independência", "Maracanã"],
}


def padrao_do(bairro):
    for p, lista in PADRAO.items():
        if bairro in lista:
            return p
    return "medio"


CORRETORES = [
    {"id": "c1", "nome": "Ana Ribeiro", "creci": "CRECI-MG 00001 (exemplo)", "cor": "#3b82f6"},
    {"id": "c2", "nome": "Carlos Mendes", "creci": "CRECI-MG 00002 (exemplo)", "cor": "#f59e0b"},
    {"id": "c3", "nome": "Juliana Freitas", "creci": "CRECI-MG 00003 (exemplo)", "cor": "#10b981"},
    {"id": "c4", "nome": "Rafael Antunes", "creci": "CRECI-MG 00004 (exemplo)", "cor": "#ec4899"},
]

CARAC = {
    "casa": ["Piscina", "Área gourmet", "Quintal", "Portão eletrônico", "Energia solar", "Edícula", "Jardim", "Closet"],
    "apartamento": ["Varanda gourmet", "Elevador", "Portaria 24h", "Academia", "Piscina no condomínio", "Salão de festas", "Armários planejados", "Vista para a Serra"],
    "cobertura": ["Terraço com piscina", "Churrasqueira", "Vista para a Serra", "Elevador privativo", "Armários planejados", "Hidromassagem"],
    "terreno": ["Plano", "Escriturado", "Esquina", "Murado", "Rua asfaltada", "Aclive leve"],
    "comercial": ["Vitrine para a rua", "Banheiro privativo", "Ar-condicionado", "Estacionamento", "Pé-direito duplo", "Acessibilidade"],
}


def jitter(rng, lat, lng, raio_m=350):
    ang = rng.uniform(0, 2 * math.pi)
    d = raio_m * math.sqrt(rng.random())
    dlat = (d * math.cos(ang)) / 111_320
    dlng = (d * math.sin(ang)) / (111_320 * math.cos(math.radians(lat)))
    return round(lat + dlat, 6), round(lng + dlng, 6)


def arred(v, passo):
    return int(round(v / passo) * passo)


def gerar_imoveis(rng):
    imoveis = []
    seq = 1001
    pesos_tipo = [("apartamento", 40), ("casa", 32), ("terreno", 9), ("comercial", 11), ("cobertura", 8)]
    tipos, pesos = zip(*pesos_tipo)
    for bairro, (lat, lng) in BAIRROS.items():
        padrao = padrao_do(bairro)
        n = {"alto": rng.randint(4, 6), "medio": rng.randint(3, 4), "popular": rng.randint(2, 3)}[padrao]
        for _ in range(n):
            tipo = rng.choices(tipos, pesos)[0]
            if tipo == "cobertura" and padrao == "popular":
                tipo = "apartamento"
            finalidade = "locacao" if rng.random() < 0.38 and tipo != "terreno" else "venda"
            plat, plng = jitter(rng, lat, lng)
            f = FAIXAS[padrao]
            item = {"id": f"MC-{seq}", "finalidade": finalidade, "tipo": tipo, "bairro": bairro,
                    "lat": plat, "lng": plng, "corretor_id": rng.choice(CORRETORES)["id"],
                    "atualizado_em": f"2026-{rng.choice(['08', '09', '09', '10'])}-{rng.randint(1, 28):02d}"}
            seq += 1
            if tipo == "apartamento":
                q = rng.choices([1, 2, 3, 4], [12, 45, 35, 8])[0]
                area = round(rng.uniform(38, 52) + q * rng.uniform(16, 24), 1)
                item.update(quartos=q, suites=min(q, rng.choice([0, 1, 1, q])), banheiros=max(1, min(q, rng.randint(1, 3))),
                            vagas=rng.choice([1, 1, 2]) if q >= 2 else 1, area_m2=area,
                            andar=rng.randint(1, 14), condominio=arred(area * rng.uniform(4.5, 9), 10))
                item["titulo"] = f"Apartamento {q} quarto{'s' if q > 1 else ''}" + (f", {item['suites']} suíte{'s' if item['suites'] > 1 else ''}" if item["suites"] else "")
                m2 = f["apto"]
            elif tipo == "cobertura":
                q = rng.choice([3, 4])
                area = round(rng.uniform(170, 290), 1)
                item.update(quartos=q, suites=q, banheiros=q + 1, vagas=rng.choice([2, 3]), area_m2=area,
                            andar=rng.randint(10, 18), condominio=arred(area * rng.uniform(6, 10), 10))
                item["titulo"] = f"Cobertura duplex {q} suítes"
                m2 = (f["apto"][0] * 1.1, f["apto"][1] * 1.2)
            elif tipo == "casa":
                q = rng.choices([2, 3, 4, 5], [20, 45, 28, 7])[0]
                area = round(rng.uniform(60, 80) + q * rng.uniform(22, 40), 1)
                item.update(quartos=q, suites=rng.randint(1, max(1, q - 1)), banheiros=rng.randint(2, q + 1),
                            vagas=rng.randint(1, 4), area_m2=area, area_terreno_m2=arred(area * rng.uniform(1.4, 2.4), 10),
                            condominio=0)
                item["titulo"] = f"Casa {q} quartos" + (" com piscina" if padrao == "alto" and rng.random() < .5 else "")
                m2 = f["casa"]
            elif tipo == "terreno":
                area = arred(rng.uniform(250, 900), 10)
                item.update(quartos=0, suites=0, banheiros=0, vagas=0, area_m2=area, area_terreno_m2=area, condominio=0)
                item["titulo"] = f"Lote {area:.0f} m²"
                m2 = f["terreno"]
            else:  # comercial
                area = round(rng.uniform(30, 220), 1)
                item.update(quartos=0, suites=0, banheiros=rng.randint(1, 2), vagas=rng.randint(0, 3), area_m2=area,
                            condominio=arred(area * rng.uniform(3, 7), 10) if rng.random() < .5 else 0)
                item["titulo"] = rng.choice(["Sala comercial", "Loja de rua", "Ponto comercial"]) + f" {area:.0f} m²"
                m2 = f["comercial"]

            if finalidade == "venda":
                item["preco"] = arred(item["area_m2"] * rng.uniform(*m2), 5000)
                item["aluguel"] = None
                item["iptu_anual"] = arred(item["preco"] * rng.uniform(0.0025, 0.0045), 10)
            else:
                base = item["area_m2"] if tipo != "casa" else item["area_m2"] * 0.85
                item["preco"] = None
                item["aluguel"] = arred(base * rng.uniform(*f["aluguel"]), 50)
                item["iptu_anual"] = arred(item["aluguel"] * rng.uniform(0.5, 0.9), 10)

            caracs = CARAC[tipo]
            item["caracteristicas"] = rng.sample(caracs, k=min(len(caracs), rng.randint(2, 4)))
            item["descricao"] = descricao(item)
            item["destaque"] = rng.random() < 0.12
            imoveis.append(item)
    return imoveis


def descricao(i):
    t, b = i["tipo"], i["bairro"]
    c = ", ".join(x.lower() for x in i["caracteristicas"][:3])
    if t == "terreno":
        return f"Lote de {i['area_m2']:.0f} m² no {b}, {c}. Documentação em ordem (exemplo)."
    if t == "comercial":
        return f"Espaço comercial de {i['area_m2']:.0f} m² no {b}, com {c}. Bom fluxo de passagem (exemplo)."
    return f"{i['titulo']} no {b}, {i['area_m2']:.0f} m² privativos, com {c}. Imóvel de demonstração, dados fictícios."


# ---------------------------------------------------------------- lançamentos
# predio.orientacao_graus: azimute da normal da fachada frontal (0 = frente para o norte, sentido horário).
# Usado pelo sol (sombras do prédio e insolação das unidades). Não consome o gerador aleatório.

def gerar_lancamento(rng, cfg):
    tip = cfg["tipologias"]
    unidades = []
    andares = list(range(cfg["andar_inicial"], cfg["andar_inicial"] + cfg["andares_tipo"]))
    for andar in andares:
        for final, chave in enumerate(cfg["planta"], start=1):
            unidades.append({"andar": andar, "final": final, "tipologia": chave})
    if cfg.get("coberturas"):
        topo = andares[-1] + 1
        for final, chave in enumerate(cfg["coberturas"], start=1):
            unidades.append({"andar": topo, "final": final, "tipologia": chave})
    amin = andares[0]
    for u in unidades:
        t = tip[u["tipologia"]]
        fator_andar = 1 + cfg["premio_andar"] * (u["andar"] - amin)
        valor = t["area_m2"] * cfg["preco_m2"] * fator_andar * (1 + t.get("premio_posicao", 0))
        u["numero"] = f"{u['andar']}{u['final']:02d}"
        u["valor_tabela_centavos"] = int(round(valor * 100))
        # andares baixos e altos vendem primeiro; meio da torre sobra mais
        meio = (u["andar"] - amin) / max(1, len(andares) - 1)
        p_vendida = cfg["vendido_alvo"] + 0.18 * (abs(meio - 0.5) * 2 - 0.5)
        r = rng.random()
        u["status"] = "vendida" if r < p_vendida else ("reservada" if r < p_vendida + 0.05 else "disponivel")
    return {k: v for k, v in cfg.items() if k not in ("planta", "coberturas", "vendido_alvo", "andares_tipo", "andar_inicial")} | {
        "andares": sorted({u["andar"] for u in unidades}),
        "unidades": unidades,
    }


LANCAMENTOS = [
    {
        "id": "serra-azul", "nome": "Residencial Serra Azul", "selo": "SA",
        "construtora": "Construtora Exemplo (fictícia)", "bairro": "Ibituruna", "desloc": (0.0011, -0.0009),
        "entrega_prevista": "2028-06", "tabela_data": "2026-10-01",
        "preco_m2": 9800, "premio_andar": 0.008, "vendido_alvo": 0.66,
        "andar_inicial": 3, "andares_tipo": 16,
        "planta": ["A", "B", "B", "A", "C", "C"],
        "coberturas": ["D", "D"],
        "tipologias": {
            "A": {"nome": "3 suítes", "descricao": "3 suítes · canto, varanda gourmet", "area_m2": 118.4, "quartos": 3, "suites": 3, "vagas": 2, "premio_posicao": 0.04},
            "B": {"nome": "2 quartos (1 suíte)", "descricao": "1 suíte + 1 quarto · frente, com sacada", "area_m2": 77.1, "quartos": 2, "suites": 1, "vagas": 1, "premio_posicao": 0.02},
            "C": {"nome": "2 quartos (1 suíte)", "descricao": "1 suíte + 1 quarto · fundos, vista para a Serra", "area_m2": 72.6, "quartos": 2, "suites": 1, "vagas": 1, "premio_posicao": 0},
            "D": {"nome": "Cobertura duplex", "descricao": "Cobertura duplex · 4 suítes, terraço com piscina", "area_m2": 248.0, "quartos": 4, "suites": 4, "vagas": 3, "premio_posicao": 0.08},
        },
        "predio": {"podio_pavimentos": 2, "pe_direito_m": 3.0, "largura_m": 26, "profundidade_m": 17, "cor_fachada": "#e8e1d4", "cor_detalhe": "#c9a96e",
                   "orientacao_graus": 20},
        "fluxo": [
            {"rotulo": "Entrada", "pct_bp": 1000, "parcelas": 1},
            {"rotulo": "Mensais", "pct_bp": 1500, "parcelas": 36},
            {"rotulo": "Reforços anuais", "pct_bp": 1000, "parcelas": 3},
            {"rotulo": "Na entrega das chaves (financiamento)", "pct_bp": 6500, "parcelas": 1},
        ],
        "obra": {"geral_pct": 52, "etapas": [
            {"nome": "Fundação", "pct": 100}, {"nome": "Estrutura", "pct": 74}, {"nome": "Alvenaria", "pct": 48},
            {"nome": "Instalações", "pct": 31}, {"nome": "Acabamento", "pct": 6}]},
    },
    {
        "id": "mirante-sul", "nome": "Edifício Mirante Sul", "selo": "MS",
        "construtora": "Construtora Exemplo (fictícia)", "bairro": "Morada do Sol", "desloc": (-0.0008, 0.0012),
        "entrega_prevista": "2027-12", "tabela_data": "2026-10-01",
        "preco_m2": 8200, "premio_andar": 0.01, "vendido_alvo": 0.78,
        "andar_inicial": 2, "andares_tipo": 12,
        "planta": ["A", "B", "B", "A"],
        "tipologias": {
            "A": {"nome": "3 quartos (1 suíte)", "descricao": "1 suíte + 2 quartos · canto, varanda", "area_m2": 96.5, "quartos": 3, "suites": 1, "vagas": 2, "premio_posicao": 0.03},
            "B": {"nome": "2 quartos (1 suíte)", "descricao": "1 suíte + 1 quarto · meio, sacada", "area_m2": 68.2, "quartos": 2, "suites": 1, "vagas": 1, "premio_posicao": 0},
        },
        "predio": {"podio_pavimentos": 1, "pe_direito_m": 3.0, "largura_m": 20, "profundidade_m": 15, "cor_fachada": "#dfe3e8", "cor_detalhe": "#4f7cac",
                   "orientacao_graus": 190},
        "fluxo": [
            {"rotulo": "Entrada", "pct_bp": 1500, "parcelas": 1},
            {"rotulo": "Mensais", "pct_bp": 2000, "parcelas": 24},
            {"rotulo": "Reforços semestrais", "pct_bp": 500, "parcelas": 4},
            {"rotulo": "Na entrega das chaves (financiamento)", "pct_bp": 6000, "parcelas": 1},
        ],
        "obra": {"geral_pct": 81, "etapas": [
            {"nome": "Fundação", "pct": 100}, {"nome": "Estrutura", "pct": 100}, {"nome": "Alvenaria", "pct": 92},
            {"nome": "Instalações", "pct": 70}, {"nome": "Acabamento", "pct": 38}]},
    },
    {
        "id": "vivere-prates", "nome": "Vivere Major Prates", "selo": "VP",
        "construtora": "Construtora Exemplo (fictícia)", "bairro": "Major Prates", "desloc": (0.0006, 0.0004),
        "entrega_prevista": "2029-03", "tabela_data": "2026-10-01",
        "preco_m2": 5600, "premio_andar": 0.006, "vendido_alvo": 0.41,
        "andar_inicial": 1, "andares_tipo": 10,
        "planta": ["A", "B", "B", "B", "B", "B", "B", "A"],
        "tipologias": {
            "A": {"nome": "2 quartos", "descricao": "2 quartos · canto, varanda", "area_m2": 52.3, "quartos": 2, "suites": 0, "vagas": 1, "premio_posicao": 0.03},
            "B": {"nome": "2 quartos", "descricao": "2 quartos · compacto, sacada", "area_m2": 46.8, "quartos": 2, "suites": 0, "vagas": 1, "premio_posicao": 0},
        },
        "predio": {"podio_pavimentos": 1, "pe_direito_m": 2.9, "largura_m": 34, "profundidade_m": 14, "cor_fachada": "#efe7da", "cor_detalhe": "#c2703d",
                   "orientacao_graus": 100},
        "fluxo": [
            {"rotulo": "Entrada", "pct_bp": 500, "parcelas": 1},
            {"rotulo": "Mensais", "pct_bp": 1500, "parcelas": 48},
            {"rotulo": "Na entrega das chaves (financiamento)", "pct_bp": 8000, "parcelas": 1},
        ],
        "obra": {"geral_pct": 18, "etapas": [
            {"nome": "Fundação", "pct": 85}, {"nome": "Estrutura", "pct": 22}, {"nome": "Alvenaria", "pct": 0},
            {"nome": "Instalações", "pct": 0}, {"nome": "Acabamento", "pct": 0}]},
    },
]


def main():
    rng = random.Random(SEMENTE)
    imoveis = gerar_imoveis(rng)
    lancs = []
    for cfg in LANCAMENTOS:
        cfg = dict(cfg)
        lat, lng = BAIRROS[cfg["bairro"]]
        dlat, dlng = cfg.pop("desloc")
        cfg["lat"], cfg["lng"] = round(lat + dlat, 6), round(lng + dlng, 6)
        lancs.append(gerar_lancamento(rng, cfg))
    meta = {"gerado_por": "ferramentas/gerar_dados_demo.py", "semente": SEMENTE, "ficticio": True,
            "fonte_coordenadas_bairros": "Nominatim/OpenStreetMap, consultado em 06/10/2026"}
    dados = RAIZ / "dados"
    dados.mkdir(exist_ok=True)
    (dados / "imoveis.json").write_text(json.dumps({"meta": meta, "corretores": CORRETORES, "imoveis": imoveis}, ensure_ascii=False, indent=1), encoding="utf-8")
    (dados / "lancamentos.json").write_text(json.dumps({"meta": meta, "lancamentos": lancs}, ensure_ascii=False, indent=1), encoding="utf-8")
    vendas = sum(1 for i in imoveis if i["finalidade"] == "venda")
    print(f"imoveis: {len(imoveis)} (venda {vendas}, locacao {len(imoveis) - vendas})")
    for l in lancs:
        st = {}
        for u in l["unidades"]:
            st[u["status"]] = st.get(u["status"], 0) + 1
        print(f"lancamento {l['id']}: {len(l['unidades'])} unidades {st}")


if __name__ == "__main__":
    main()
