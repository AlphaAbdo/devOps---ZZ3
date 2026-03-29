# pixelwar Makefile
# Chaque target est idempotente.

CLUSTER     := pixelwar
NAMESPACE   := pixelwar
KUBECONFIG  := terraform/kubeconfig
TAG         := local

export KUBECONFIG
export OWNER  := local
export IMAGE_TAG := $(TAG)

.DEFAULT_GOAL := help

.PHONY: help all setup cluster images monitoring deploy deploy-local destroy

help:
	@echo ""
	@echo "  make all          — tout le stack from scratch"
	@echo "  make setup        — ansible : installe docker/kind/kubectl/helm/tf"
	@echo "  make cluster      — terraform : crée le cluster kind"
	@echo "  make images       — build + charge les images docker dans kind"
	@echo "  make monitoring   — installe kube-prometheus-stack via helm"
	@echo "  make deploy       — applique les manifests k8s (CI, images ghcr.io)"
	@echo "  make deploy-local — idem mais avec les images locales"


all: setup cluster monitoring deploy-local

# setup de la machine
setup:
	ansible-playbook -i ansible/inventory.ini ansible/setup.yml --ask-become-pass

# cluster kind
cluster:
	terraform -chdir=terraform init -upgrade
	terraform -chdir=terraform apply -auto-approve

# images docker
images:
	docker build -t pixelwar-backend:$(TAG)  app/backend
	docker build -t pixelwar-frontend:$(TAG) app/frontend
	kind load docker-image pixelwar-backend:$(TAG)  --name $(CLUSTER)
	kind load docker-image pixelwar-frontend:$(TAG) --name $(CLUSTER)

# images locales, pas besoin de ghcr.io — on force IfNotPresent pour pas pull
deploy-local: images
	kubectl apply -f k8s/namespace.yaml
	kubectl apply -f k8s/redis/
	kubectl apply -f k8s/backend/secret.yaml
	kubectl apply -f k8s/backend/service.yaml
	kubectl apply -f k8s/frontend/service.yaml
	kubectl apply -f k8s/netpol/
	sed 's|ghcr.io/$${OWNER}/pixelwar-backend:$${IMAGE_TAG}|pixelwar-backend:$(TAG)|g' \
	  k8s/backend/deployment.yaml  | kubectl apply -f -
	sed 's|ghcr.io/$${OWNER}/pixelwar-frontend:$${IMAGE_TAG}|pixelwar-frontend:$(TAG)|g' \
	  k8s/frontend/deployment.yaml | kubectl apply -f -

# monitoring prometheus/grafana
monitoring:
	helm repo add prometheus-community https://prometheus-community.github.io/helm-charts --force-update
	helm repo update
	helm upgrade --install kube-prom \
	  prometheus-community/kube-prometheus-stack \
	  --namespace monitoring \
	  --create-namespace \
	  --set grafana.sidecar.dashboards.enabled=true \
	  --wait
	kubectl apply -f k8s/monitoring/servicemonitor-backend.yaml
	kubectl apply -f k8s/monitoring/grafana-dashboard.yaml

# deploy CI (images ghcr.io)
deploy:
	kubectl apply -f k8s/namespace.yaml
	kubectl apply -f k8s/redis/
	kubectl apply -f k8s/backend/secret.yaml
	kubectl apply -f k8s/backend/service.yaml
	kubectl apply -f k8s/frontend/service.yaml
	kubectl apply -f k8s/netpol/
	envsubst < k8s/backend/deployment.yaml  | kubectl apply -f -
	envsubst < k8s/frontend/deployment.yaml | kubectl apply -f -
	kubectl rollout status deployment/backend  -n $(NAMESPACE) --timeout=120s
	kubectl rollout status deployment/frontend -n $(NAMESPACE) --timeout=120s

destroy:
	helm uninstall kube-prom -n monitoring 2>/dev/null || true
	kubectl delete namespace monitoring 2>/dev/null || true
	terraform -chdir=terraform destroy -auto-approve
