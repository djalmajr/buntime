# 🎯 Plano de Implementação: Charts Fix + Performance Boost

## 📋 Problemas Identificados

### 🚨 Problemas Críticos (Alta Prioridade)

1. **Vazamento de Componentes** - Fragmentos não são destruídos/recriados corretamente
2. **Vazamento de Hooks** - Conexões SSE e hooks React persistem entre navegações
3. **Renderização Inadequada** - Componentes tentam renderizar gráficos em páginas erradas
4. **Performance Degradation** - Múltiplos warnings de charts (width/height = 0)

## 🛠️ Soluções Propostas

### 1. 🔥 Correção do Sistema de Fragmentos (P1)

#### Problema: Fragmentos não são destruídos/recriados corretamente
```typescript
// plugins/piercing/src/client/fragment-host.ts
disconnectedCallback(): void {
  // 🧹 Adicionar timeout + cleanup robusto
  setTimeout(() => {
    if (this.cleanup) {
      this[MESSAGE_BUS_PROP].clearAllHandlers();
      
      for (const handler of this.cleanupHandlers) {
        try {
          handler();
        } catch (error) {
          console.warn('Error during cleanup:', error);
        }
      }
      this.cleanupHandlers = [];
    }
    
    // Limpar referências e disparar evento global
    this.fragmentHost = null;
    window.dispatchEvent(new CustomEvent('piercing-fragment-cleanup', {
      detail: { fragmentId: this.currentFragmentId }
    }));
    
    PiercingFragmentOutlet.unmountedFragmentIds.delete(this.currentFragmentId);
    this.currentFragmentId = null;
  }, 100);
}
```

### 2. 🧹 Correção do MetricsPage (P1)

#### Problema: Componente não faz cleanup dos hooks ao desmontar
```typescript
// plugins/plugin-metrics/client/components/metrics-page.tsx
export function MetricsPage() {
  const [currentPath, setCurrentPath] = useState(getFragmentUrl());

  // 🧹 Cleanup robusto + roteamento corrigido
  useEffect(() => {
    let isCleaningUp = false;
    
    const cleanup = () => {
      if (!isCleaningUp) {
        isCleaningUp = true;
        console.log('🧹 MetricsPage unmounting - cleaning up hooks');
        
        // Forçar garbage collection
        setTimeout(() => {
          // Limpar estado global
          if (window.__PIERCING_STATE__) {
            Object.keys(window.__PIERCING_STATE__).forEach(key => {
              delete window.__PIERCING_STATE__[key];
            });
          }
          
          // Limpar cliente piercing
          if (window.__PIERCING_CLIENT__) {
            (window.__PIERCING_CLIENT__ as any)?._cleanup?.();
            delete window.__PIERCING_CLIENT__;
          }
          
          console.log('🧹 Cleanup completed');
          isCleaningUp = false;
        }, 50);
      }
    };
    
    // Executar apenas em rotas não-metrics
    const isMetricsRoute = currentPath === "/" || currentPath === "" || 
                          currentPath.startsWith("/metrics/");
    
    if (!isMetricsRoute) {
      cleanup();
    }
    
    return cleanup;
  }, [currentPath]);

  // 🔄 Lógica de roteamento corrigida
  function getFragmentUrl(): string {
    const outlet = document.querySelector("piercing-fragment-outlet[data-fragment-url]");
    if (outlet) {
      return outlet.getAttribute("data-fragment-url") || "/";
    }
    
    const pathname = window.location.pathname;
    const baseHref = document.querySelector("base")?.getAttribute("href") || "/";
    
    if (baseHref !== "/") {
      const basePath = baseHref.replace(/\/$/, "");
      if (pathname.startsWith(basePath)) {
        return pathname.slice(basePath.length) || "/";
      }
    }
    
    return pathname;
  }
}
```

### 3. 📏 Correção dos Charts (P1)

#### Problema: Charts renderizam com container de tamanho 0x0
```typescript
// plugins/plugin-metrics/client/components/ui/chart.tsx
function ChartContainer({ children, config, className, ...props }: ChartContainerProps) {
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // 📏 ResizeObserver + fallback seguro
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerSize({ width, height });
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  });

  // 📏 Evitar renderização com tamanho zero
  const shouldRenderChart = containerSize.width > 0 && containerSize.height > 0;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        ref={containerRef}
        data-slot="chart"
        className={cn(
          "w-full h-full min-h-[300px] relative",
          // Indicador visual para debugging
          containerSize.width === 0 && "border-2 border-red-500"
        )}
        style={{
          // Forçar dimensões mínimas
          ...(containerSize.width === 0 && { 
            width: '300px', 
            height: '300px' 
          })
        }}
        {...props}
      >
        {shouldRenderChart ? (
          <RechartsPrimitive.ResponsiveContainer width="100%" height="100%">
            {children}
          </RechartsPrimitive.ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center text-muted-foreground">
            <ChartLoadingSkeleton />
          </div>
        )}
      </div>
    </ChartContext.Provider>
  );
}
```

## 🎯 Resultados Esperados

### ✅ P1 - Pós-correção
- ✅ Eliminação dos warnings de charts
- ✅ Components não vazam entre rotas
- ✅ Sistema de fragmentos estável

### 📈 Prioridades Futuras

### 🟡 P2 - Melhorias de Performance (Média Prioridade)
1. **Lazy Loading** - Carregar charts apenas quando visível
2. **Virtual Scrolling** - Otimizar renderização de grandes volumes de dados
3. **Chart Memoization** - Evitar re-renders desnecessários

### 🟢 P3 - Correções de Acessibilidade (Baixa Prioridade)
1. **Contraste melhorado** - Garantir WCAG compliance
2. **Navegação por teclado** - Suporte completo a accessibility
3. **Screen reader** - ARIA labels melhorados

### 🔵 P4 - Monitoramento e Observabilidade (Baixa Prioridade)
1. **Performance Metrics** - Tempo de renderização, uso de memória
2. **Error Tracking** - Captura e relatório de erros
3. **Health Checks** - Verificação automática de integridade

---

**Status:** ✅ **Plano completo e priorizado para implementação**