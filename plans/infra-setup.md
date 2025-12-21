# Plano: Infraestrutura Local de Desenvolvimento

## Ambiente de Teste

Este guia foi testado na seguinte configuração:

| Item | Valor |
|------|-------|
| Sistema | Ubuntu 24.04 LTS Server |
| RAM | 25 GB |
| CPU | 6 vCPUs |
| Disco | 80 GB |
| IP | 192.168.0.201 |
| User | user |

### Requisitos por Cenário

| Cenário | CPU | RAM | Serviços |
|---------|-----|-----|----------|
| Mínimo | 2 | 8 GB | MinIO, libSQL, Keycloak |
| Básico | 2 | 16 GB | + Rancher |
| Completo | 4+ | 24 GB | + GitLab |

### Distribuição de Recursos (6 CPU / 25GB RAM)

| Serviço | CPU Req | CPU Lim | Mem Req | Mem Lim |
|---------|---------|---------|---------|---------|
| k3s + sistema | - | - | ~2 GB | - |
| MinIO | 250m | 500m | 512 MB | 1 GB |
| libSQL Primary | 100m | 500m | 256 MB | 512 MB |
| libSQL Replica | 50m | 250m | 128 MB | 256 MB |
| Keycloak | 250m | 1000m | 1 GB | 2 GB |
| Rancher | 250m | 1000m | 1 GB | 2 GB |
| GitLab webservice | 300m | 1500m | 2 GB | 3 GB |
| GitLab sidekiq | 200m | 1000m | 1 GB | 2 GB |
| GitLab gitaly | 100m | 500m | 512 MB | 1 GB |
| GitLab postgres | 100m | 500m | 512 MB | 1 GB |
| GitLab redis | 50m | 250m | 256 MB | 512 MB |
| GitLab outros | 100m | 300m | 256 MB | 512 MB |
| **Total Requests** | ~1.75 | - | ~9.5 GB | - |
| **Total Limits** | - | ~7.3 | - | ~16 GB |

## Objetivo

Configurar ambiente de desenvolvimento que simula produção com:
- Servidor Ubuntu 24 LTS (192.168.0.201)
- k3s (Kubernetes leve)
- DNS local (*.home)
- Serviços: GitLab, MinIO, Keycloak, Rancher, libSQL (com réplica)

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│  Clientes (Mac/Linux/Windows)                                   │
│                                                                 │
│  DNS: *.home → 192.168.0.201                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Ubuntu 24 LTS (192.168.0.201)                                  │
│  user: user                                                 │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  k3s                                                       │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │  Traefik Ingress (:80, :443)                         │  │ │
│  │  │  + cert-manager (TLS self-signed)                    │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  │                           │                                │ │
│  │  ┌────────────────────────▼─────────────────────────────┐  │ │
│  │  │  Namespaces                                          │  │ │
│  │  │                                                      │  │ │
│  │  │  [gitlab]     gitlab.example.com                            │  │ │
│  │  │  [minio]      minio.home / s3.home                   │  │ │
│  │  │  [keycloak]   keycloak.home                          │  │ │
│  │  │  [rancher]    rancher.home                           │  │ │
│  │  │  [libsql]     libsql.home (primary + replica)        │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  │                                                            │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │  Storage: local-path-provisioner (padrão k3s)        │  │ │
│  │  │  Path: /var/lib/rancher/k3s/storage                  │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Fase 1: Preparar Ubuntu

### 1.1 Acesso SSH do Mac

```bash
# No Mac - configurar SSH sem senha
ssh-copy-id user@192.168.0.201

# Testar
ssh user@192.168.0.201
```

### 1.2 Atualizar sistema

```bash
# No Ubuntu
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git htop
```

### 1.3 Configurar hostname

```bash
sudo hostnamectl set-hostname k3s-dev
echo "192.168.0.201 k3s-dev" | sudo tee -a /etc/hosts
```

### 1.4 Desabilitar swap (requisito k8s)

```bash
sudo swapoff -a
sudo sed -i '/ swap / s/^/#/' /etc/fstab
```

---

## Fase 2: Instalar k3s

### 2.1 Instalar k3s

```bash
curl -sfL https://get.k3s.io | sh -s - \
  --write-kubeconfig-mode 644 \
  --disable traefik \
  --node-name k3s-dev
```

> Nota: Desabilitamos o Traefik padrão para instalar versão mais recente via Helm.

### 2.2 Verificar instalação

```bash
sudo kubectl get nodes
sudo kubectl get pods -A
```

### 2.3 Configurar kubectl para usuário

```bash
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config
chmod 600 ~/.kube/config
```

### 2.4 Instalar Helm

```bash
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

---

## Fase 3: Configurar Ingress e TLS

### 3.1 Instalar Traefik via Helm

```bash
helm repo add traefik https://traefik.github.io/charts
helm repo update

kubectl create namespace traefik

helm install traefik traefik/traefik \
  --namespace traefik \
  --set ingressClass.enabled=true \
  --set ingressClass.isDefaultClass=true \
  --set service.type=LoadBalancer \
  --set 'ports.web.redirections.entryPoint.to=websecure' \
  --set 'ports.web.redirections.entryPoint.scheme=https' \
  --set ports.websecure.tls.enabled=true
```

### 3.2 Instalar cert-manager

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.0/cert-manager.yaml

# Aguardar pods ficarem ready
kubectl wait --for=condition=Ready pods --all -n cert-manager --timeout=120s
```

### 3.3 Criar ClusterIssuer self-signed

```bash
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: selfsigned-issuer
spec:
  selfSigned: {}
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: home-ca
  namespace: cert-manager
spec:
  isCA: true
  commonName: home-ca
  secretName: home-ca-secret
  privateKey:
    algorithm: ECDSA
    size: 256
  issuerRef:
    name: selfsigned-issuer
    kind: ClusterIssuer
---
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: home-ca-issuer
spec:
  ca:
    secretName: home-ca-secret
EOF
```

---

## Fase 4: Deploy dos Serviços

### 4.1 MinIO

```bash
kubectl create namespace minio

helm repo add minio https://charts.min.io/
helm repo update

# Criar arquivo de valores (evita problemas de escaping)
cat > /tmp/minio-values.yaml << EOF
rootUser: admin
rootPassword: REDACTED-LOCAL-PASSWORD
mode: standalone
persistence:
  size: 50Gi
resources:
  requests:
    memory: 1Gi
    cpu: 250m
  limits:
    memory: 2Gi
    cpu: 1000m
ingress:
  enabled: true
  ingressClassName: traefik
  hosts:
    - minio.home
  annotations:
    cert-manager.io/cluster-issuer: home-ca-issuer
  tls:
    - secretName: minio-tls
      hosts:
        - minio.home
consoleIngress:
  enabled: true
  ingressClassName: traefik
  hosts:
    - console.minio.home
  annotations:
    cert-manager.io/cluster-issuer: home-ca-issuer
  tls:
    - secretName: minio-console-tls
      hosts:
        - console.minio.home
EOF

helm install minio minio/minio --namespace minio -f /tmp/minio-values.yaml
```

### 4.2 libSQL (Primary + Replica)

> **Nota:** Não usar `args` - a imagem libsql-server espera env vars, não argumentos de linha de comando.

```bash
kubectl create namespace libsql

cat <<EOF | kubectl apply -f -
# Primary libSQL
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: libsql-primary
  namespace: libsql
spec:
  serviceName: libsql-primary
  replicas: 1
  selector:
    matchLabels:
      app: libsql
      role: primary
  template:
    metadata:
      labels:
        app: libsql
        role: primary
    spec:
      containers:
      - name: libsql
        image: ghcr.io/tursodatabase/libsql-server:latest
        ports:
        - containerPort: 8080
          name: http
        - containerPort: 5001
          name: grpc
        env:
        - name: SQLD_NODE
          value: primary
        resources:
          requests:
            memory: 512Mi
            cpu: 100m
          limits:
            memory: 1Gi
            cpu: 500m
        volumeMounts:
        - name: data
          mountPath: /var/lib/sqld
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 10Gi
---
# Replica libSQL
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: libsql-replica
  namespace: libsql
spec:
  serviceName: libsql-replica
  replicas: 1
  selector:
    matchLabels:
      app: libsql
      role: replica
  template:
    metadata:
      labels:
        app: libsql
        role: replica
    spec:
      containers:
      - name: libsql
        image: ghcr.io/tursodatabase/libsql-server:latest
        ports:
        - containerPort: 8080
          name: http
        env:
        - name: SQLD_NODE
          value: replica
        - name: SQLD_PRIMARY_URL
          value: "http://libsql-primary:5001"
        resources:
          requests:
            memory: 256Mi
            cpu: 50m
          limits:
            memory: 512Mi
            cpu: 250m
        volumeMounts:
        - name: data
          mountPath: /var/lib/sqld
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 10Gi
---
# Services
apiVersion: v1
kind: Service
metadata:
  name: libsql-primary
  namespace: libsql
spec:
  selector:
    app: libsql
    role: primary
  ports:
  - port: 8080
    targetPort: 8080
    name: http
  - port: 5001
    targetPort: 5001
    name: grpc
---
apiVersion: v1
kind: Service
metadata:
  name: libsql-replica
  namespace: libsql
spec:
  selector:
    app: libsql
    role: replica
  ports:
  - port: 8080
    targetPort: 8080
    name: http
---
# Ingress for primary (write)
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: libsql-primary
  namespace: libsql
  annotations:
    cert-manager.io/cluster-issuer: home-ca-issuer
spec:
  ingressClassName: traefik
  tls:
  - hosts:
    - libsql.home
    secretName: libsql-tls
  rules:
  - host: libsql.home
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: libsql-primary
            port:
              number: 8080
---
# Ingress for replica (read)
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: libsql-replica
  namespace: libsql
  annotations:
    cert-manager.io/cluster-issuer: home-ca-issuer
spec:
  ingressClassName: traefik
  tls:
  - hosts:
    - libsql-ro.home
    secretName: libsql-replica-tls
  rules:
  - host: libsql-ro.home
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: libsql-replica
            port:
              number: 8080
EOF
```

### 4.3 Keycloak

> **Nota:** Bitnami moveu para modelo pago. Usar imagem oficial.

```bash
kubectl create namespace keycloak

cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: keycloak
  namespace: keycloak
spec:
  replicas: 1
  selector:
    matchLabels:
      app: keycloak
  template:
    metadata:
      labels:
        app: keycloak
    spec:
      containers:
      - name: keycloak
        image: quay.io/keycloak/keycloak:26.0
        args: ["start-dev"]
        env:
        - name: KC_BOOTSTRAP_ADMIN_USERNAME
          value: admin
        - name: KC_BOOTSTRAP_ADMIN_PASSWORD
          value: REDACTED-LOCAL-PASSWORD
        - name: KC_PROXY_HEADERS
          value: xforwarded
        - name: KC_HOSTNAME_URL
          value: https://keycloak.home
        - name: KC_HOSTNAME_ADMIN_URL
          value: https://keycloak.home
        - name: KC_HOSTNAME_STRICT
          value: "false"
        - name: KC_HTTP_ENABLED
          value: "true"
        - name: JAVA_OPTS_APPEND
          value: "-Xms512m -Xmx1536m"
        ports:
        - containerPort: 8080
          name: http
        resources:
          requests:
            memory: 1Gi
            cpu: 250m
          limits:
            memory: 2Gi
            cpu: 1000m
---
apiVersion: v1
kind: Service
metadata:
  name: keycloak
  namespace: keycloak
spec:
  selector:
    app: keycloak
  ports:
  - port: 8080
    targetPort: 8080
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: keycloak
  namespace: keycloak
  annotations:
    cert-manager.io/cluster-issuer: home-ca-issuer
spec:
  ingressClassName: traefik
  tls:
  - hosts:
    - keycloak.home
    secretName: keycloak-tls
  rules:
  - host: keycloak.home
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: keycloak
            port:
              number: 8080
EOF
```

### 4.4 GitLab

> **Requisitos:** Mínimo 8GB RAM livre, 4+ CPUs. Recomendado 24GB RAM e 6 CPUs.
> **Nota ARM64:** O MinIO bundled do GitLab não suporta ARM64. Usar MinIO externo.

```bash
kubectl create namespace gitlab

helm repo add gitlab https://charts.gitlab.io/
helm repo update

# Criar secrets para conexão com MinIO externo
cat > /tmp/gitlab-rails-storage.yaml << EOF
provider: AWS
region: us-east-1
aws_access_key_id: admin
aws_secret_access_key: REDACTED-LOCAL-PASSWORD
endpoint: http://minio.minio.svc.cluster.local:9000
path_style: true
EOF

cat > /tmp/gitlab-backups-storage.yaml << EOF
[default]
aws_access_key_id = admin
aws_secret_access_key = REDACTED-LOCAL-PASSWORD
EOF

kubectl create secret generic gitlab-rails-storage -n gitlab \
  --from-file=connection=/tmp/gitlab-rails-storage.yaml

kubectl create secret generic gitlab-backups-storage -n gitlab \
  --from-file=config=/tmp/gitlab-backups-storage.yaml

# Criar secret para senha root
kubectl create secret generic gitlab-root-password -n gitlab \
  --from-literal=password='REDACTED-LOCAL-PASSWORD'

# Criar arquivo de valores (ARM64 compatible)
cat > /tmp/gitlab-values.yaml << 'EOF'
global:
  hosts:
    domain: home
    externalIP: 192.168.0.201
  edition: ce
  # Senha root fixa
  initialRootPassword:
    secret: gitlab-root-password
    key: password
  ingress:
    class: traefik
    configureCertmanager: false
    annotations:
      cert-manager.io/cluster-issuer: home-ca-issuer
  # Usar MinIO externo (ARM64 compatible)
  minio:
    enabled: false
  appConfig:
    object_store:
      enabled: true
      proxy_download: true
      connection:
        secret: gitlab-rails-storage
        key: connection
    lfs:
      bucket: gitlab-lfs
    artifacts:
      bucket: gitlab-artifacts
    uploads:
      bucket: gitlab-uploads
    packages:
      bucket: gitlab-packages
    backups:
      bucket: gitlab-backups

certmanager:
  installCRDs: false

nginx-ingress:
  enabled: false

prometheus:
  install: false

gitlab-runner:
  install: false

registry:
  enabled: false

gitlab:
  webservice:
    minReplicas: 1
    maxReplicas: 1
    resources:
      requests:
        memory: 2Gi
        cpu: 300m
      limits:
        memory: 3Gi
        cpu: 1500m
  sidekiq:
    minReplicas: 1
    maxReplicas: 1
    resources:
      requests:
        memory: 1Gi
        cpu: 200m
      limits:
        memory: 2Gi
        cpu: 1000m
  gitlab-shell:
    minReplicas: 1
    maxReplicas: 1
    resources:
      requests:
        memory: 64Mi
        cpu: 10m
      limits:
        memory: 128Mi
        cpu: 100m
  gitaly:
    resources:
      requests:
        memory: 512Mi
        cpu: 100m
      limits:
        memory: 1Gi
        cpu: 500m
  toolbox:
    backups:
      objectStorage:
        config:
          secret: gitlab-backups-storage
          key: config
    resources:
      requests:
        memory: 64Mi
        cpu: 10m
      limits:
        memory: 128Mi
        cpu: 100m
  kas:
    minReplicas: 1
    maxReplicas: 1
    resources:
      requests:
        memory: 64Mi
        cpu: 10m
      limits:
        memory: 128Mi
        cpu: 100m

postgresql:
  resources:
    requests:
      memory: 512Mi
      cpu: 100m
    limits:
      memory: 1Gi
      cpu: 500m

redis:
  resources:
    requests:
      memory: 256Mi
      cpu: 50m
    limits:
      memory: 512Mi
      cpu: 250m
EOF

helm install gitlab gitlab/gitlab \
  --namespace gitlab \
  --timeout 15m \
  -f /tmp/gitlab-values.yaml
```

**Obter senha root após instalação:**

```bash
kubectl get secret gitlab-gitlab-initial-root-password -n gitlab \
  -o jsonpath='{.data.password}' | base64 -d; echo
```

### 4.5 Rancher

> **Nota:** Usar `ingress.tls.source=rancher` para certificados self-signed sem configurar CA manualmente.

```bash
kubectl create namespace cattle-system

helm repo add rancher-stable https://releases.rancher.com/server-charts/stable
helm repo update

helm install rancher rancher-stable/rancher \
  --namespace cattle-system \
  --set hostname=rancher.home \
  --set replicas=1 \
  --set bootstrapPassword=REDACTED-LOCAL-PASSWORD \
  --set ingress.tls.source=rancher
```

---

## Fase 5: Configurar DNS nos Clientes

### 5.1 macOS

```bash
# Instalar dnsmasq
brew install dnsmasq

# Configurar resolução
echo "address=/.home/192.168.0.201" >> $(brew --prefix)/etc/dnsmasq.conf

# Criar resolver do macOS
sudo mkdir -p /etc/resolver
echo "nameserver 127.0.0.1" | sudo tee /etc/resolver/home

# Iniciar serviço
sudo brew services start dnsmasq

# Testar
ping gitlab.example.com
dig gitlab.example.com @127.0.0.1
```

### 5.2 Linux (Ubuntu/Debian)

**Opção A: systemd-resolved (recomendado)**

```bash
# Criar arquivo de configuração
sudo mkdir -p /etc/systemd/resolved.conf.d
sudo tee /etc/systemd/resolved.conf.d/home.conf << EOF
[Resolve]
DNS=192.168.0.201
Domains=~home
EOF

# Reiniciar resolved
sudo systemctl restart systemd-resolved

# Testar
resolvectl query gitlab.example.com
```

**Opção B: dnsmasq**

```bash
# Instalar
sudo apt install dnsmasq

# Configurar
echo "address=/.home/192.168.0.201" | sudo tee -a /etc/dnsmasq.conf

# Configurar NetworkManager para usar dnsmasq
sudo tee /etc/NetworkManager/conf.d/dnsmasq.conf << EOF
[main]
dns=dnsmasq
EOF

# Reiniciar serviços
sudo systemctl restart dnsmasq
sudo systemctl restart NetworkManager

# Testar
ping gitlab.example.com
```

**Opção C: /etc/hosts (simples, manual)**

```bash
# Adicionar entradas manualmente
sudo tee -a /etc/hosts << EOF
192.168.0.201 gitlab.example.com
192.168.0.201 minio.home
192.168.0.201 console.minio.home
192.168.0.201 keycloak.home
192.168.0.201 rancher.home
192.168.0.201 libsql.home
192.168.0.201 libsql-ro.home
EOF
```

### 5.3 Windows 11

**Opção A: Adicionar ao arquivo hosts (simples)**

1. Abrir Notepad como Administrador
2. Arquivo > Abrir: `C:\Windows\System32\drivers\etc\hosts`
3. Adicionar no final:

```
192.168.0.201 gitlab.example.com
192.168.0.201 minio.home
192.168.0.201 console.minio.home
192.168.0.201 keycloak.home
192.168.0.201 rancher.home
192.168.0.201 libsql.home
192.168.0.201 libsql-ro.home
```

4. Salvar e fechar
5. Abrir PowerShell como Admin e executar:

```powershell
ipconfig /flushdns
```

**Opção B: Acquia Dev Desktop / Acrylic DNS Proxy (wildcard)**

1. Baixar Acrylic DNS Proxy: https://mayakron.altervista.org/support/acrylic/Home.htm
2. Instalar
3. Editar `AcrylicHosts.txt`:

```
192.168.0.201 *.home
```

4. Configurar adaptador de rede para usar 127.0.0.1 como DNS primário:
   - Configurações > Rede e Internet > Ethernet/Wi-Fi > Propriedades
   - IPv4 > Propriedades > Usar os seguintes endereços de servidor DNS
   - DNS preferencial: 127.0.0.1
   - DNS alternativo: 8.8.8.8

5. Reiniciar serviço Acrylic:

```powershell
net stop "Acrylic DNS Proxy"
net start "Acrylic DNS Proxy"
```

**Opção C: PowerShell (temporário, por sessão)**

```powershell
# Adiciona ao cache DNS local (não persiste após reinício)
Add-DnsClientNrptRule -Namespace ".home" -NameServers "192.168.0.201"

# Ver regras
Get-DnsClientNrptRule

# Remover
Get-DnsClientNrptRule | Where-Object Namespace -eq ".home" | Remove-DnsClientNrptRule
```

---

## Fase 6: Configurar kubectl no Mac

### 6.1 Copiar kubeconfig

```bash
scp user@192.168.0.201:~/.kube/config ~/.kube/k3s-home-config

# Ajustar IP no arquivo
sed -i '' 's/127.0.0.1/192.168.0.201/' ~/.kube/k3s-home-config
```

### 6.2 Usar contexto

```bash
export KUBECONFIG=~/.kube/k3s-home-config
kubectl get nodes
kubectl get pods -A
```

---

## Fase 7: Confiar nos certificados

### 7.1 Exportar CA do cluster

```bash
kubectl get secret home-ca-secret -n cert-manager -o jsonpath='{.data.ca\.crt}' | base64 -d > home-ca.crt
```

### 7.2 macOS

```bash
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain home-ca.crt
```

### 7.3 Linux

```bash
sudo cp home-ca.crt /usr/local/share/ca-certificates/home-ca.crt
sudo update-ca-certificates
```

### 7.4 Windows 11

1. Duplo clique no arquivo `home-ca.crt`
2. Instalar Certificado
3. Máquina Local > Avançar
4. Colocar todos os certificados no repositório: "Autoridades de Certificação Raiz Confiáveis"
5. Concluir

Ou via PowerShell (Admin):

```powershell
Import-Certificate -FilePath "home-ca.crt" -CertStoreLocation Cert:\LocalMachine\Root
```

---

## URLs Finais

| Serviço | URL | Credenciais |
|---------|-----|-------------|
| GitLab | https://gitlab.example.com | root / REDACTED-LOCAL-PASSWORD |
| MinIO Console | https://console.minio.home | admin / REDACTED-LOCAL-PASSWORD |
| MinIO API | https://minio.home | admin / REDACTED-LOCAL-PASSWORD |
| Keycloak | https://keycloak.home | admin / REDACTED-LOCAL-PASSWORD |
| Rancher | https://rancher.home | admin / REDACTED-LOCAL-PASSWORD |
| libSQL (write) | https://libsql.home | - |
| libSQL (read) | https://libsql-ro.home | - |

> **Nota:** O GitLab mantém a senha original pois o reset via rails console requer mais recursos.
> Para alterar, use a interface web: Admin Area > Users > root > Edit > Password.

---

## Comandos Úteis

```bash
# Ver todos os pods
kubectl get pods -A

# Ver ingresses
kubectl get ingress -A

# Ver logs de um pod
kubectl logs -n gitlab -l app=webservice -f

# Reiniciar deployment
kubectl rollout restart deployment -n minio minio

# Ver uso de recursos
kubectl top nodes
kubectl top pods -A

# Ver certificados
kubectl get certificates -A
kubectl get certificaterequests -A
```

---

## Requisitos de Hardware

| Recurso | Mínimo | Recomendado |
|---------|--------|-------------|
| CPU | 4 cores | 8 cores |
| RAM | 16 GB | 32 GB |
| Disco | 100 GB | 200 GB SSD |

> GitLab sozinho consome ~8GB RAM. Considere desabilitar se recursos forem limitados.

---

## Problemas Encontrados Durante Instalação

### 1. SSH - Host key verification failed
**Problema:** Primeira conexão SSH falha por host desconhecido.
**Solução:**
```bash
ssh-keyscan -H 192.168.0.201 >> ~/.ssh/known_hosts
```

### 2. SSH - Chave não reconhecida automaticamente
**Problema:** `ssh-copy-id` copiou chave com nome não padrão (`id_ed25519_tm`), SSH não tenta automaticamente.
**Solução:** Copiar chave com nome padrão:
```bash
sshpass -p 'PASSWORD' ssh-copy-id -i ~/.ssh/id_rsa.pub user@192.168.0.201
```

### 3. Traefik - Parâmetro redirectTo mudou
**Problema:** `ports.web.redirectTo.port` não existe mais no chart.
**Solução:** Usar novo formato:
```bash
--set 'ports.web.redirections.entryPoint.to=websecure'
--set 'ports.web.redirections.entryPoint.scheme=https'
```

### 4. MinIO - Request de memória muito alto (16Gi)
**Problema:** Chart MinIO pede 16GB de RAM por padrão, causando `Insufficient memory`.
**Solução:** Adicionar no values.yaml:
```yaml
resources:
  requests:
    memory: 512Mi
```

### 5. Bitnami - Imagens pagas/não encontradas
**Problema:** Desde Agosto 2025, Bitnami moveu para modelo pago. Imagens como `bitnami/keycloak` não existem mais.
**Solução:** Usar imagens oficiais:
```yaml
# Em vez de bitnami/keycloak, usar:
image: quay.io/keycloak/keycloak:26.0
```

### 6. libSQL - Args inválidos no entrypoint
**Problema:** `--enable-bottomless-replication` causa erro no entrypoint do container.
**Solução:** Remover args e usar apenas env vars:
```yaml
env:
- name: SQLD_PRIMARY_URL
  value: "http://libsql-primary:5001"
```

### 7. GitLab - Requer 8GB+ RAM
**Problema:** GitLab CE precisa de no mínimo 8GB RAM, inviável em servidores pequenos.
**Solução:** Usar servidor com mais RAM ou considerar alternativas (Gitea, Forgejo).

### 8. Rancher - Secret tls-ca não existe
**Problema:** Instalação com `ingress.tls.source=secret --set privateCA=true` espera um secret `tls-ca` que não foi criado.
**Erro:** `MountVolume.SetUp failed for volume "tls-ca-volume" : secret "tls-ca" not found`
**Solução:** Usar certificado self-signed do próprio Rancher:
```bash
helm install rancher rancher-stable/rancher \
  --namespace cattle-system \
  --set hostname=rancher.home \
  --set replicas=1 \
  --set bootstrapPassword=REDACTED-LOCAL-PASSWORD \
  --set ingress.tls.source=rancher
```

### 9. GitLab MinIO - Incompatível com ARM64
**Problema:** O MinIO bundled do GitLab chart usa imagem x86, causando `exec format error` em ARM64.
**Erro:** `exec /usr/bin/docker-entrypoint.sh: exec format error`
**Solução:** Desabilitar MinIO interno e usar MinIO externo:
```yaml
global:
  minio:
    enabled: false
  appConfig:
    object_store:
      enabled: true
      connection:
        secret: gitlab-rails-storage
        key: connection
```
E criar secrets para conexão com MinIO externo (ver seção 4.4).

### 10. GitLab - Parâmetro certmanager.install não existe
**Problema:** Tentar usar `--set certmanager.install=false` causa erro de schema validation.
**Erro:** `values don't meet the specifications of the schema(s): certmanager: additional properties 'install' not allowed`
**Solução:** Usar apenas `certmanager.installCRDs`:
```yaml
certmanager:
  installCRDs: false
```

### 11. GitLab - Object storage obrigatório
**Problema:** Com `global.minio.enabled=false`, GitLab exige configuração explícita de object storage.
**Erro:** `When consolidated object storage is enabled, for each item 'bucket' must be specified`
**Solução:** Configurar buckets e connection secret:
```yaml
global:
  appConfig:
    object_store:
      enabled: true
      connection:
        secret: gitlab-rails-storage
        key: connection
    lfs:
      bucket: gitlab-lfs
    artifacts:
      bucket: gitlab-artifacts
```

### 12. GitLab - Insufficient CPU
**Problema:** Com apenas 2 vCPUs, pods ficam em Pending por falta de CPU.
**Erro:** `0/1 nodes are available: 1 Insufficient cpu`
**Solução:** Usar no mínimo 4 vCPUs, ou reduzir drasticamente os requests de CPU:
```yaml
gitlab:
  webservice:
    resources:
      requests:
        cpu: 300m  # em vez de 500m
```

### 13. GitLab - Conflito de CRDs do cert-manager
**Problema:** Se cert-manager já está instalado, o GitLab tenta importar CRDs existentes e falha.
**Erro:** `CustomResourceDefinition "certificaterequests.cert-manager.io" exists and cannot be imported`
**Solução:** Desabilitar instalação de CRDs:
```yaml
certmanager:
  installCRDs: false
```

### 14. GitLab - Job certmanager-startupapicheck falha
**Problema:** Com cert-manager externo, o job de verificação pode falhar por timeout.
**Erro:** `job gitlab-certmanager-startupapicheck failed: BackoffLimitExceeded`
**Solução:** Garantir que cert-manager esteja 100% ready antes de instalar GitLab:
```bash
kubectl wait --for=condition=Ready pods --all -n cert-manager --timeout=120s
```

### 15. Rancher - bootstrapPassword não persiste
**Problema:** O `bootstrapPassword` do Rancher só é usado no primeiro acesso. Depois o usuário é forçado a mudar a senha, que fica persistida no banco.
**Erro:** Login com a senha configurada no Helm falha.
**Solução:** Usar `reset-password` para obter senha temporária e depois mudar via API:
```bash
# Reset para senha temporária
kubectl -n cattle-system exec $(kubectl -n cattle-system get pods -l app=rancher -o name | head -1) -- reset-password

# Mudar via API (senha deve ter 12+ caracteres, evitar ! no shell)
TOKEN=$(curl -sk "https://rancher.home/v3-public/localProviders/local?action=login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"SENHA_TEMPORARIA"}' | grep -oP '"token":"[^"]*' | cut -d\" -f4)

curl -sk "https://rancher.home/v3/users?action=changepassword" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"SENHA_TEMPORARIA","newPassword":"NOVA_SENHA_12_CHARS"}'
```

### 16. Keycloak - Mixed Content (HTTP/HTTPS)
**Problema:** Keycloak atrás de TLS termination (Traefik) gera URLs HTTP, causando erros de Mixed Content e CSP violations no browser.
**Erro:**
- `Mixed Content: The page at '<URL>' was loaded over HTTPS, but requested an insecure resource '<URL>'`
- `Framing 'http://keycloak.home/' violates Content Security Policy directive: "frame-src 'self'"`
**Solução:** Configurar variáveis de ambiente para proxy HTTPS:
```yaml
env:
- name: KC_PROXY_HEADERS
  value: xforwarded
- name: KC_HOSTNAME_URL
  value: https://keycloak.home
- name: KC_HOSTNAME_ADMIN_URL
  value: https://keycloak.home
- name: KC_HOSTNAME_STRICT
  value: "false"
- name: KC_HTTP_ENABLED
  value: "true"
```

---

## Troubleshooting

### DNS não resolve

```bash
# macOS - verificar dnsmasq
sudo brew services list | grep dnsmasq
cat /etc/resolver/home

# Linux - verificar resolved
resolvectl status
systemctl status systemd-resolved

# Windows - limpar cache
ipconfig /flushdns
nslookup gitlab.example.com
```

### Certificado não confiável

```bash
# Verificar se CA foi criado
kubectl get secret home-ca-secret -n cert-manager

# Verificar certificados dos ingresses
kubectl get certificates -A
kubectl describe certificate -n minio minio-tls
```

### Pod não inicia

```bash
# Ver eventos
kubectl describe pod <pod-name> -n <namespace>

# Ver logs
kubectl logs <pod-name> -n <namespace>

# Ver recursos disponíveis
kubectl describe node k3s-dev
```
