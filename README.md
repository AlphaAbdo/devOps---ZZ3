# Pixel War — Projet DevOps ISIMA 2026

Canvas collaboratif de pixels (grille 50×50) où plusieurs navigateurs peignent
en temps réel. Le canvas est un prétexte — l'objet du projet c'est l'infra.

> **Note** — Le pipeline CI/CD a été testé localement avec [`act`](https://github.com/nektos/act)
> avant le push (`act push -j lint`, `act push -j build --secret GITHUB_TOKEN=...`).

---

## Architecture

```
               ┌──────────── cluster kind (3 nœuds) ──────────────┐
               │                                                    │
browser ──►    │  NodePort:30080 ──► frontend (nginx, ×2)          │
               │                        │                           │
               │                        ├── /api/* ──► backend ×2  │
               │                        └── /ws    ──► backend ×2  │
               │                                         │          │
               │                                      redis (PVC)  │
               │                                                    │
               │  namespace monitoring : Prometheus + Grafana       │
               └────────────────────────────────────────────────────┘
                            ▲
                    GitHub Actions CI/CD
```

**Frontend** — fichiers statiques servis par Nginx. Nginx fait aussi reverse-proxy
vers le backend (`/api/` et `/ws`) pour éviter les problèmes de CORS côté navigateur.
Pas de framework, pas de bundler — juste du HTML/JS vanilla.

**Backend** — Express + WebSocket (`ws`). Reçoit les pixels via `POST /api/pixel`,
les stocke dans Redis, et broadcast en WebSocket à tous les clients connectés.
Expose `/metrics` (Prometheus) et `/healthz` (probes K8s).

**Redis** — état global stocké dans un hash Redis (`HSET pixelgrid x,y couleur`).
Les écritures sont atomiques, la persistance AOF + RDB assure que le canvas
survit aux restarts de pods tant que le PVC est intact.

---

## Choix techniques

| Élément | Choix | Pourquoi |
|---|---|---|
| Langage backend | Node.js | WebSocket + REST dans un seul fichier, rien à compiler |
| État partagé | Redis | Atomicité sur les HSET, persistance AOF, léger |
| Images de base | `node:20-alpine`, `nginx:1.27-alpine` | Surface d'attaque réduite |
| Cluster local | kind (3 nœuds) | Reproductible sur un laptop, pas de cloud |
| Provisioning | Terraform + provider `tehcyx/kind` | Infra déclarative, cluster recréable en une commande |
| Setup machine | Ansible | Idempotent, évite les "fonctionne sur ma machine" |
| CI/CD | GitHub Actions (`ubuntu-latest`) | Lint → build → push → deploy sur chaque push `main` |
| Monitoring | kube-prometheus-stack (Helm) | Prometheus + Grafana + CRDs d'un seul `helm install` |

J'ai pas utilisé Helm pour l'app elle-même — le projet est petit et le YAML brut
est plus lisible pour un relecteur qui n'a pas Helm installé.

---

## Sécurité

- **Non-root** — backend uid 1001, frontend uid 101 (nginx), Redis uid 999
- **Filesystem read-only** — `readOnlyRootFilesystem: true` + `allowPrivilegeEscalation: false` sur backend et frontend ; volumes `emptyDir` pour les répertoires que nginx doit écrire
- **Capabilities** — `drop: [ALL]` sur backend et frontend
- **NetworkPolicies** — deny-all par défaut sur le namespace `pixelwar`, règles explicites : `externe → frontend`, `frontend → backend`, `backend → redis`, `monitoring → backend`
- **Secrets** — credentials Redis dans un `Secret` K8s monté via `envFrom`, rien de hardcodé dans les images

---

## CI/CD

Pipeline GitHub Actions, 3 jobs enchaînés :

1. **lint** — `hadolint` sur les deux Dockerfiles + `yamllint` sur `k8s/` et `ansible/`
2. **build** — build + push des images sur `ghcr.io` (push `main` uniquement, pas sur les PRs)
3. **deploy** — crée un cluster kind éphémère, charge les images depuis `ghcr.io`, `kubectl apply` + attente du rollout + test de fumée, tout ça sur `ubuntu-latest` sans infrastructure externe

---

## Résilience

- Backend en **2 replicas** — un pod mort ne coupe pas le service
- Redis avec **PVC** — les données survivent aux restarts et re-schedulings de pod
- Cluster kind avec **2 workers** — on peut cordon/drain un nœud pendant que l'app tourne
- Reconnexion WebSocket côté client avec backoff (3 s) en cas de coupure

---

## Observabilité

ServiceMonitor Prometheus sur l'endpoint `/metrics` du backend.
Dashboard Grafana "Pixel War" importé automatiquement via ConfigMap (4 panels :
pixels/s, connexions WS actives, heap mémoire, event loop lag).

```bash
kubectl port-forward svc/kube-prom-grafana -n monitoring 3001:80
# http://localhost:3001  —  admin / prom-operator
```

---

## Lancer le projet

> **TL;DR** : `make all` fait tout d'un coup.

```bash
# prérequis : docker, kind, kubectl, helm, terraform
# le playbook installe tout si besoin
ansible-playbook -i ansible/inventory.ini ansible/setup.yml --ask-become-pass

# cluster + monitoring + app
make all

# accès
open http://localhost:30080
```

Détail des étapes si besoin :

```bash
terraform -chdir=terraform init && terraform -chdir=terraform apply -auto-approve
export KUBECONFIG=terraform/kubeconfig
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts && helm repo update
helm upgrade --install kube-prom prometheus-community/kube-prometheus-stack \
  --namespace monitoring --create-namespace \
  --set grafana.sidecar.dashboards.enabled=true --wait
make deploy-local
kubectl apply -f k8s/monitoring/
```

Nettoyage : `make destroy`

---

## Arborescence

```
pixelwar/
├── app/
│   ├── frontend/       Nginx + HTML/JS (index.html, app.js, Dockerfile)
│   └── backend/        Express + ws + Redis (server.js, Dockerfile)
├── terraform/          Provisioning du cluster kind
├── ansible/            Setup de la machine hôte
├── k8s/
│   ├── namespace.yaml
│   ├── redis/          PVC + Deployment + Service
│   ├── backend/        Secret + Deployment + Service
│   ├── frontend/       Deployment + Service (NodePort 30080)
│   ├── monitoring/     ServiceMonitor + ConfigMap dashboard Grafana
│   └── netpol/         deny-all + règles d'autorisation
├── .github/workflows/  ci.yml
├── .yamllint.yml
├── .hadolint.yaml
└── Makefile
```
