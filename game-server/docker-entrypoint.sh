#!/bin/sh
# Create kubeconfig from in-cluster service account credentials
set -e

KUBE_DIR="/root/.kube"
mkdir -p "$KUBE_DIR"

# API server URL from pod environment
API_SERVER="https://${KUBERNETES_SERVICE_HOST}:${KUBERNETES_SERVICE_PORT}"

# Use service account token and CA cert (auto-mounted in every pod)
TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)
CA_FILE="/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
NAMESPACE=$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace)

kubectl config set-cluster in-cluster \
  --server="$API_SERVER" \
  --certificate-authority="$CA_FILE" \
  --embed-certs=true

kubectl config set-credentials sa-user \
  --token="$TOKEN"

kubectl config set-context in-cluster \
  --cluster=in-cluster \
  --user=sa-user \
  --namespace="$NAMESPACE"

kubectl config use-context in-cluster

echo "Kubeconfig set for $API_SERVER (namespace: $NAMESPACE)"

exec node server.js
