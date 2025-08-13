#!/bin/bash

set -euo pipefail

# Deployment script for Claude Flow Tracing System
# Usage: ./scripts/deploy-tracing.sh

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENVIRONMENT="${ENVIRONMENT:-staging}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
NAMESPACE="claude-flow-${ENVIRONMENT}"
APP_NAME="tracing-system"
REGISTRY="ghcr.io"
IMAGE_NAME="ruvnet/claude-flow/tracing"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Validation functions
validate_environment() {
    if [[ ! "$ENVIRONMENT" =~ ^(staging|production)$ ]]; then
        log_error "Invalid environment: $ENVIRONMENT. Must be 'staging' or 'production'"
        exit 1
    fi
}

validate_dependencies() {
    local deps=("kubectl" "helm" "docker")
    for dep in "${deps[@]}"; do
        if ! command -v "$dep" &> /dev/null; then
            log_error "Required dependency '$dep' not found"
            exit 1
        fi
    done
}

validate_secrets() {
    local required_vars=("DEPLOY_KEY" "KUBE_CONFIG")
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var:-}" ]]; then
            log_error "Required environment variable $var not set"
            exit 1
        fi
    done
}

# Setup functions
setup_kubectl() {
    log_info "Setting up kubectl configuration..."
    
    # Create temporary kubeconfig file
    local temp_kubeconfig=$(mktemp)
    echo "$KUBE_CONFIG" | base64 -d > "$temp_kubeconfig"
    export KUBECONFIG="$temp_kubeconfig"
    
    # Test connection
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Failed to connect to Kubernetes cluster"
        rm -f "$temp_kubeconfig"
        exit 1
    fi
    
    log_success "kubectl configured successfully"
}

setup_namespace() {
    log_info "Setting up namespace: $NAMESPACE"
    
    kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
    kubectl label namespace "$NAMESPACE" app=claude-flow environment="$ENVIRONMENT" --overwrite
    
    log_success "Namespace $NAMESPACE ready"
}

# Pre-deployment checks
pre_deployment_checks() {
    log_info "Running pre-deployment checks..."
    
    # Check if image exists
    if ! docker manifest inspect "${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}" &> /dev/null; then
        log_error "Docker image ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG} not found"
        exit 1
    fi
    
    # Check cluster resources
    local available_nodes=$(kubectl get nodes --no-headers | grep -c Ready)
    if [[ $available_nodes -lt 1 ]]; then
        log_error "No ready nodes found in cluster"
        exit 1
    fi
    
    log_success "Pre-deployment checks passed"
}

# Generate Kubernetes manifests
generate_manifests() {
    log_info "Generating Kubernetes manifests..."
    
    local manifest_dir="$PROJECT_ROOT/k8s/tracing"
    mkdir -p "$manifest_dir"
    
    # ConfigMap for tracing configuration
    cat > "$manifest_dir/configmap.yaml" << EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: tracing-config
  namespace: $NAMESPACE
  labels:
    app: $APP_NAME
    environment: $ENVIRONMENT
data:
  config.json: |
    {
      "environment": "$ENVIRONMENT",
      "tracing": {
        "enabled": true,
        "sampleRate": $([ "$ENVIRONMENT" = "production" ] && echo "0.1" || echo "1.0"),
        "exporters": {
          "jaeger": {
            "enabled": true,
            "endpoint": "http://jaeger-collector:14268/api/traces"
          },
          "console": {
            "enabled": $([ "$ENVIRONMENT" = "production" ] && echo "false" || echo "true")
          }
        },
        "resources": {
          "service.name": "$APP_NAME",
          "service.version": "$IMAGE_TAG",
          "deployment.environment": "$ENVIRONMENT"
        }
      },
      "metrics": {
        "enabled": true,
        "port": 9090,
        "path": "/metrics"
      },
      "healthCheck": {
        "enabled": true,
        "port": 8080,
        "path": "/health"
      }
    }
EOF

    # Deployment
    cat > "$manifest_dir/deployment.yaml" << EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: $APP_NAME
  namespace: $NAMESPACE
  labels:
    app: $APP_NAME
    environment: $ENVIRONMENT
    version: $IMAGE_TAG
spec:
  replicas: $([ "$ENVIRONMENT" = "production" ] && echo "3" || echo "1")
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  selector:
    matchLabels:
      app: $APP_NAME
      environment: $ENVIRONMENT
  template:
    metadata:
      labels:
        app: $APP_NAME
        environment: $ENVIRONMENT
        version: $IMAGE_TAG
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
        prometheus.io/path: "/metrics"
    spec:
      containers:
      - name: tracing
        image: $REGISTRY/$IMAGE_NAME:$IMAGE_TAG
        imagePullPolicy: Always
        ports:
        - name: http
          containerPort: 3000
          protocol: TCP
        - name: metrics
          containerPort: 9090
          protocol: TCP
        - name: health
          containerPort: 8080
          protocol: TCP
        env:
        - name: NODE_ENV
          value: "$ENVIRONMENT"
        - name: CONFIG_PATH
          value: "/etc/config/config.json"
        volumeMounts:
        - name: config
          mountPath: /etc/config
          readOnly: true
        livenessProbe:
          httpGet:
            path: /health
            port: health
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /health/ready
            port: health
          initialDelaySeconds: 5
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 2
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        securityContext:
          runAsNonRoot: true
          runAsUser: 1001
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop:
            - ALL
      volumes:
      - name: config
        configMap:
          name: tracing-config
      securityContext:
        fsGroup: 1001
      serviceAccountName: $APP_NAME
EOF

    # Service
    cat > "$manifest_dir/service.yaml" << EOF
apiVersion: v1
kind: Service
metadata:
  name: $APP_NAME
  namespace: $NAMESPACE
  labels:
    app: $APP_NAME
    environment: $ENVIRONMENT
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "9090"
spec:
  type: ClusterIP
  ports:
  - name: http
    port: 80
    targetPort: http
    protocol: TCP
  - name: metrics
    port: 9090
    targetPort: metrics
    protocol: TCP
  selector:
    app: $APP_NAME
    environment: $ENVIRONMENT
EOF

    # ServiceAccount
    cat > "$manifest_dir/serviceaccount.yaml" << EOF
apiVersion: v1
kind: ServiceAccount
metadata:
  name: $APP_NAME
  namespace: $NAMESPACE
  labels:
    app: $APP_NAME
    environment: $ENVIRONMENT
automountServiceAccountToken: false
EOF

    # HorizontalPodAutoscaler (production only)
    if [[ "$ENVIRONMENT" = "production" ]]; then
        cat > "$manifest_dir/hpa.yaml" << EOF
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: $APP_NAME
  namespace: $NAMESPACE
  labels:
    app: $APP_NAME
    environment: $ENVIRONMENT
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: $APP_NAME
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 50
        periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 25
        periodSeconds: 60
EOF
    fi
    
    log_success "Kubernetes manifests generated"
}

# Deploy application
deploy_application() {
    log_info "Deploying tracing system to $ENVIRONMENT..."
    
    local manifest_dir="$PROJECT_ROOT/k8s/tracing"
    
    # Apply manifests
    kubectl apply -f "$manifest_dir/" --namespace="$NAMESPACE"
    
    # Wait for deployment to be ready
    log_info "Waiting for deployment to be ready..."
    if ! kubectl rollout status deployment/"$APP_NAME" --namespace="$NAMESPACE" --timeout=300s; then
        log_error "Deployment failed or timed out"
        kubectl get events --namespace="$NAMESPACE" --sort-by='.lastTimestamp'
        exit 1
    fi
    
    log_success "Deployment completed successfully"
}

# Post-deployment verification
post_deployment_checks() {
    log_info "Running post-deployment verification..."
    
    # Check pod status
    local pods=$(kubectl get pods -l app="$APP_NAME" --namespace="$NAMESPACE" --output=jsonpath='{.items[*].metadata.name}')
    if [[ -z "$pods" ]]; then
        log_error "No pods found for application $APP_NAME"
        exit 1
    fi
    
    # Check pod health
    for pod in $pods; do
        local ready=$(kubectl get pod "$pod" --namespace="$NAMESPACE" --output=jsonpath='{.status.conditions[?(@.type=="Ready")].status}')
        if [[ "$ready" != "True" ]]; then
            log_error "Pod $pod is not ready"
            kubectl describe pod "$pod" --namespace="$NAMESPACE"
            exit 1
        fi
        log_success "Pod $pod is healthy"
    done
    
    # Test service endpoint
    local service_ip=$(kubectl get service "$APP_NAME" --namespace="$NAMESPACE" --output=jsonpath='{.spec.clusterIP}')
    if kubectl run test-pod --rm -i --restart=Never --image=curlimages/curl:latest --namespace="$NAMESPACE" -- curl -f "http://$service_ip/health" --max-time 10; then
        log_success "Health check endpoint responding"
    else
        log_error "Health check endpoint not responding"
        exit 1
    fi
    
    log_success "Post-deployment checks passed"
}

# Rollback function
rollback_deployment() {
    log_warning "Rolling back deployment..."
    kubectl rollout undo deployment/"$APP_NAME" --namespace="$NAMESPACE"
    kubectl rollout status deployment/"$APP_NAME" --namespace="$NAMESPACE" --timeout=300s
    log_success "Rollback completed"
}

# Cleanup function
cleanup() {
    if [[ -n "${KUBECONFIG:-}" ]] && [[ -f "$KUBECONFIG" ]]; then
        rm -f "$KUBECONFIG"
    fi
}

# Main deployment function
main() {
    log_info "Starting deployment of tracing system"
    log_info "Environment: $ENVIRONMENT"
    log_info "Image Tag: $IMAGE_TAG"
    log_info "Namespace: $NAMESPACE"
    
    # Set up cleanup trap
    trap cleanup EXIT
    trap 'rollback_deployment; cleanup; exit 1' ERR
    
    # Run deployment steps
    validate_environment
    validate_dependencies
    validate_secrets
    setup_kubectl
    setup_namespace
    pre_deployment_checks
    generate_manifests
    deploy_application
    post_deployment_checks
    
    log_success "Tracing system deployment completed successfully!"
    log_info "Application URL: https://tracing-${ENVIRONMENT}.claude-flow.dev"
    log_info "Metrics URL: https://tracing-${ENVIRONMENT}.claude-flow.dev/metrics"
}

# Script execution
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi