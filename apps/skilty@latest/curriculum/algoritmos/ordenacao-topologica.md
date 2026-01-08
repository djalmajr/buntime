# Ordenação Topológica

**Trilha:** Algoritmos de Grafos
**Nível:** Intermediário
**Duração estimada:** 8-12 horas
**Pré-requisitos:** Estruturas de Dados Básicas, Recursão

---

## Visão Geral

Ordenação topológica é um algoritmo fundamental para resolver problemas de dependências. Usado em gerenciadores de pacotes (npm, pip), sistemas de build (Make, Webpack), pipelines de CI/CD, e até planilhas (Excel recalcula células em ordem).

Ao completar esta trilha, você será capaz de:

- Modelar problemas como grafos direcionados
- Implementar o algoritmo de Kahn
- Implementar ordenação via DFS
- Detectar dependências circulares
- Paralelizar execução de tarefas independentes

---

## Skill Tree

```
┌─────────────┐
│   Grafos    │
│   Básico    │
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌─────────────┐
│     BFS     │────▶│     DFS     │
└──────┬──────┘     └──────┬──────┘
       │                   │
       └─────────┬─────────┘
                 │
                 ▼
       ┌─────────────────┐
       │    Ordenação    │
       │   Topológica    │
       └────────┬────────┘
                │
       ┌────────┼────────┐
       │        │        │
       ▼        ▼        ▼
┌──────────┐ ┌──────┐ ┌──────────┐
│ Detecção │ │Kahn  │ │ Paraleli-│
│ de Ciclos│ │vs DFS│ │  zação   │
└──────────┘ └──────┘ └──────────┘
```

---

## Skills

### Skill 1: Grafos Básico

**Conceito:**
Grafo é uma estrutura com vértices (nós) conectados por arestas. Grafos direcionados têm arestas com direção (A → B). DAG (Directed Acyclic Graph) é um grafo direcionado sem ciclos.

**Você vai aprender:**
- Representação como lista de adjacência
- Diferença entre grafo direcionado e não-direcionado
- O que é um DAG e por que importa
- Conceito de grau de entrada (in-degree) e saída (out-degree)

**Recursos:**
- Visualização: https://visualgo.net/en/graphds
- Artigo: Graph Data Structure (GeeksforGeeks)

**Exercícios:**

| # | Descrição | Dificuldade |
|---|-----------|-------------|
| 1 | Implementar grafo como `dict[str, list[str]]` | Fácil |
| 2 | Função `neighbors(node)` que retorna vizinhos | Fácil |
| 3 | Função `in_degree(node)` que conta arestas entrando | Médio |
| 4 | Função `has_cycle()` que detecta se há ciclo | Médio |

**Critérios de domínio:**
- [ ] Sabe criar grafo a partir de lista de arestas
- [ ] Sabe calcular in-degree e out-degree
- [ ] Entende a diferença entre DAG e grafo com ciclos

---

### Skill 2: BFS (Busca em Largura)

**Conceito:**
BFS explora um grafo "em ondas" - primeiro todos os vizinhos diretos, depois os vizinhos dos vizinhos, etc. Usa uma **fila** (FIFO).

**Você vai aprender:**
- Travessia nível por nível
- Uso de fila para controlar ordem
- Encontrar menor caminho em grafos não-ponderados

**Exercícios:**

| # | Descrição | Dificuldade |
|---|-----------|-------------|
| 1 | BFS que imprime nós na ordem visitada | Fácil |
| 2 | BFS que retorna distância de origem a todos os nós | Médio |
| 3 | BFS que encontra caminho mais curto entre dois nós | Médio |

**Critérios de domínio:**
- [ ] Sabe implementar BFS com fila
- [ ] Entende por que BFS encontra menor caminho
- [ ] Sabe quando usar BFS vs DFS

---

### Skill 3: DFS (Busca em Profundidade)

**Conceito:**
DFS explora um grafo "até o fim" antes de voltar - vai o mais fundo possível em cada ramo. Usa **pilha** (recursão ou explícita).

**Você vai aprender:**
- Travessia recursiva
- Estados: não visitado, em processamento, visitado
- Detecção de ciclos via pilha de recursão

**Exercícios:**

| # | Descrição | Dificuldade |
|---|-----------|-------------|
| 1 | DFS recursivo que imprime nós | Fácil |
| 2 | DFS iterativo com pilha explícita | Médio |
| 3 | DFS que detecta ciclo em grafo direcionado | Médio |

**Critérios de domínio:**
- [ ] Sabe implementar DFS recursivo e iterativo
- [ ] Entende os três estados de um nó durante DFS
- [ ] Sabe detectar ciclos com DFS

---

### Skill 4: Ordenação Topológica

**Conceito:**
Ordenar vértices de um DAG de forma que, para toda aresta A → B, A venha antes de B no resultado. Só funciona em DAGs (grafos sem ciclos).

**Você vai aprender:**
- Algoritmo de Kahn (BFS-based)
- Algoritmo via DFS
- Quando usar cada abordagem
- Detecção de ciclos como subproduto

**Algoritmo de Kahn:**
```python
from collections import deque

def kahn(graph: dict[str, list[str]]) -> list[str]:
    # Calcular in-degree
    in_degree = {v: 0 for v in graph}
    for neighbors in graph.values():
        for n in neighbors:
            in_degree[n] += 1

    # Começar com nós sem dependências
    queue = deque(v for v in graph if in_degree[v] == 0)
    result = []

    while queue:
        v = queue.popleft()
        result.append(v)
        for neighbor in graph[v]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    if len(result) != len(graph):
        raise ValueError("Ciclo detectado!")

    return result
```

**Exercícios:**

| # | Descrição | Dificuldade |
|---|-----------|-------------|
| 1 | Implementar Kahn para grafo fixo | Médio |
| 2 | Implementar ordenação topológica via DFS | Médio |
| 3 | Comparar resultados de Kahn vs DFS | Fácil |
| 4 | Retornar TODAS as ordens topológicas válidas | Difícil |

**Critérios de domínio:**
- [ ] Sabe implementar Kahn's algorithm
- [ ] Sabe implementar ordenação via DFS
- [ ] Entende quando cada um é preferível
- [ ] Sabe detectar ciclos como efeito colateral

---

### Skill 5: Paralelização de Tarefas

**Conceito:**
Em Kahn's algorithm, todos os nós na fila num dado momento são independentes e podem executar em paralelo. Isso é a base de sistemas de build e CI/CD.

**Você vai aprender:**
- Identificar tarefas paralelizáveis
- Processar em "ondas" ou "níveis"
- Sincronização e dependências

**Exercícios:**

| # | Descrição | Dificuldade |
|---|-----------|-------------|
| 1 | Modificar Kahn para retornar níveis (listas de listas) | Médio |
| 2 | Executar tarefas com `asyncio.gather()` por nível | Médio |
| 3 | Calcular tempo total com execução paralela vs sequencial | Médio |

**Critérios de domínio:**
- [ ] Sabe agrupar tarefas por nível de dependência
- [ ] Sabe executar tarefas independentes em paralelo
- [ ] Entende o ganho de performance da paralelização

---

## Mini-Bosses

### Mini-Boss 1: Dependency Resolver

**Contexto:**
Construir um resolvedor de dependências para um gerenciador de pacotes simples.

**Input:**
```json
{
  "express": ["body-parser", "cookie-parser"],
  "body-parser": ["bytes", "content-type"],
  "cookie-parser": ["cookie"],
  "bytes": [],
  "content-type": [],
  "cookie": []
}
```

**Requisitos:**
- [ ] Retornar ordem de instalação correta
- [ ] Detectar e reportar dependências circulares
- [ ] Lidar com dependências opcionais (marcadas com `?`)
- [ ] Output legível: `Installing: bytes, content-type, cookie, body-parser, cookie-parser, express`

**Validação automática:**
- Testes com grafos válidos
- Testes com ciclos (deve falhar graciosamente)
- Testes com dependências opcionais

**Skills validadas:**
- Grafos Básico (nível 2)
- Ordenação Topológica (nível 2)

---

### Mini-Boss 2: Build System

**Contexto:**
Implementar um mini-Make que executa tarefas respeitando dependências.

**Input (Makefile simplificado):**
```makefile
app: lib.o main.o
  gcc -o app lib.o main.o

lib.o: lib.c lib.h
  gcc -c lib.c

main.o: main.c lib.h
  gcc -c main.c
```

**Requisitos:**
- [ ] Parsear dependências do Makefile
- [ ] Ordenar tarefas topologicamente
- [ ] Executar comandos na ordem correta
- [ ] Suportar target específico (`make lib.o`)
- [ ] Detectar ciclos e abortar

**Bonus:**
- [ ] Verificar timestamps e pular tarefas desnecessárias
- [ ] Executar tarefas independentes em paralelo

**Validação automática:**
- Makefiles de exemplo com diferentes estruturas
- Verificação de ordem de execução
- Teste de detecção de ciclos

**Skills validadas:**
- Ordenação Topológica (nível 3)
- Parsing Básico (nível 1)
- CLI (nível 1)

---

### Mini-Boss 3: Course Scheduler

**Contexto:**
Sistema que ajuda alunos a planejar sua grade curricular respeitando pré-requisitos.

**Input:**
```json
{
  "calculo_2": ["calculo_1"],
  "fisica_1": ["calculo_1"],
  "fisica_2": ["fisica_1", "calculo_2"],
  "mecanica": ["fisica_2"],
  "calculo_1": [],
  "programacao_1": [],
  "programacao_2": ["programacao_1"],
  "estruturas_dados": ["programacao_2"]
}
```

**Requisitos:**
- [ ] Distribuir disciplinas por semestres
- [ ] Respeitar pré-requisitos
- [ ] Limitar disciplinas por semestre (ex: máximo 5)
- [ ] Minimizar número total de semestres
- [ ] Visualização ASCII ou HTML do plano

**Output esperado:**
```
Semestre 1: calculo_1, programacao_1
Semestre 2: calculo_2, fisica_1, programacao_2
Semestre 3: fisica_2, estruturas_dados
Semestre 4: mecanica
```

**Validação automática:**
- Ordem respeita pré-requisitos
- Limite por semestre respeitado
- Número de semestres é ótimo ou próximo

**Skills validadas:**
- Ordenação Topológica (nível 2)
- Algoritmos Gulosos (nível 1)

---

## Boss: CI/CD Pipeline Engine

**Contexto:**
Construir um executor de pipelines estilo GitHub Actions / GitLab CI.

**Input (YAML):**
```yaml
name: Build and Deploy

jobs:
  checkout:
    runs-on: ubuntu
    steps:
      - run: git clone $REPO

  install:
    needs: [checkout]
    steps:
      - run: npm install

  lint:
    needs: [install]
    steps:
      - run: npm run lint

  test:
    needs: [install]
    steps:
      - run: npm test

  build:
    needs: [lint, test]
    steps:
      - run: npm run build

  deploy:
    needs: [build]
    if: github.ref == 'refs/heads/main'
    steps:
      - run: ./deploy.sh
```

**Requisitos funcionais:**
- [ ] Parser de YAML para estrutura de jobs
- [ ] Modelar jobs como DAG
- [ ] Ordenação topológica dos jobs
- [ ] Execução sequencial respeitando dependências
- [ ] Suporte a condicionais (`if`)
- [ ] Logs separados por job
- [ ] Status final: success/failure

**Requisitos técnicos:**
- [ ] Python 3.10+ ou Node.js 18+
- [ ] Testes com coverage > 70%
- [ ] CLI: `pipeline run workflow.yaml`
- [ ] Output colorido mostrando progresso

**Bonus (para nota máxima):**
- [ ] Execução paralela de jobs independentes
- [ ] Retry automático com backoff
- [ ] Timeout por job
- [ ] Variáveis de ambiente e secrets
- [ ] Cache entre runs
- [ ] Visualização do DAG (ASCII ou HTML)

**Exemplo de execução:**
```
$ pipeline run ci.yaml

[checkout] Starting...
[checkout] git clone https://github.com/user/repo
[checkout] Done (2.3s)

[install] Starting...
[install] npm install
[install] Done (15.2s)

[lint] Starting...        [test] Starting...
[lint] npm run lint       [test] npm test
[lint] Done (3.1s)        [test] Done (8.4s)

[build] Starting...
[build] npm run build
[build] Done (12.0s)

[deploy] Skipped (condition not met: github.ref != 'refs/heads/main')

Pipeline completed in 41.0s
Jobs: 5 passed, 1 skipped, 0 failed
```

**Validação automática:**
- Suite de pipelines de teste
- Verificação de ordem de execução
- Teste de jobs com falha
- Teste de condicionais
- Teste de detecção de ciclos

**Defesa oral (perguntas sugeridas):**
1. Por que você escolheu Kahn's algorithm ao invés de DFS?
2. Como você implementou a execução paralela?
3. O que acontece se um job falha no meio do pipeline?
4. Como você detectaria um ciclo no YAML antes de executar?
5. Como adicionaria suporte a `needs: [job.output]` (dependência de output)?

**Skills validadas:**
- Grafos Básico (nível 2)
- Ordenação Topológica (nível 3)
- Paralelização (nível 2)
- YAML Parsing (nível 2)
- CLI/TUI (nível 2)
- Error Handling (nível 2)
- Testing (nível 2)

---

## Raid Boss: Distributed Task Scheduler

**Contexto:**
Sistema de agendamento distribuído para workflows de dados, estilo Apache Airflow.

**Requisitos de alto nível:**
- DAGs definidos em código (Python)
- Scheduler distribuído com múltiplos workers
- Persistência de estado em banco de dados
- UI web para visualizar DAGs e execuções
- Histórico de runs com logs
- Alertas em caso de falha
- Backfill de runs passados

**Este boss requer múltiplas skills de diferentes trilhas:**
- Ordenação Topológica
- Sistemas Distribuídos
- Banco de Dados
- Frontend
- DevOps/Infra

**Detalhamento completo disponível na trilha "Sistemas Distribuídos".**

---

## Conexões com Outras Trilhas

| Trilha | Conexão |
|--------|---------|
| **Estruturas de Dados** | Filas, pilhas, dicionários |
| **Algoritmos de Busca** | BFS e DFS são fundamentos |
| **Dynamic Programming** | Shortest path em DAGs usa DP |
| **Sistemas Distribuídos** | Task scheduling, Airflow |
| **DevOps** | CI/CD pipelines, build systems |
| **Compiladores** | Resolução de imports, ordem de passes |

---

## Conquistas

| Badge | Descrição | Requisito |
|-------|-----------|-----------|
| **Graph Explorer** | Completou skill Grafos Básico | Exercícios 1-4 |
| **Cycle Breaker** | Detectou ciclo em 10 grafos diferentes | Mini-boss 1 |
| **Speed Builder** | Completou Build System em < 2h | Mini-boss 2 |
| **Pipeline Master** | Completou CI/CD Engine com todos os bonus | Boss |
| **Parallel Universe** | Executou 100+ tarefas em paralelo | Boss |
| **Topological Wizard** | Completou toda a trilha | Todos os bosses |

---

## Referências

- **Paper original:** Kahn, A. B. (1962). "Topological sorting of large networks"
- **Livro:** Cormen et al. "Introduction to Algorithms" (CLRS), Chapter 22
- **Visualização:** https://visualgo.net/en/dfsbfs
- **Prática:** https://leetcode.com/tag/topological-sort/

---

## Próximos Passos

Após completar esta trilha, você pode seguir para:

1. **Shortest Path Algorithms** - Dijkstra, Bellman-Ford
2. **Sistemas Distribuídos** - Expandir o Raid Boss
3. **Compiladores** - Usar ordenação topológica para resolução de módulos
