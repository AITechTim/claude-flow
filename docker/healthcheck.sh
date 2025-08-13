#!/bin/sh

# Health check script for Claude Flow Tracing System
# Checks multiple endpoints to ensure service health

set -e

HEALTH_PORT="${HEALTH_PORT:-8080}"
METRICS_PORT="${METRICS_PORT:-9090}"
TIMEOUT="${HEALTH_TIMEOUT:-5}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Logging functions
log_info() {
    echo "${GREEN}[HEALTH]${NC} $1" >&2
}

log_warning() {
    echo "${YELLOW}[HEALTH]${NC} $1" >&2
}

log_error() {
    echo "${RED}[HEALTH]${NC} $1" >&2
}

# Check if service is responding
check_endpoint() {
    local url="$1"
    local name="$2"
    local expected_status="${3:-200}"
    
    if response=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" "$url" 2>/dev/null); then
        if [ "$response" = "$expected_status" ]; then
            log_info "$name endpoint healthy (HTTP $response)"
            return 0
        else
            log_error "$name endpoint returned HTTP $response (expected $expected_status)"
            return 1
        fi
    else
        log_error "$name endpoint unreachable"
        return 1
    fi
}

# Check if service is ready for traffic
check_readiness() {
    local url="http://localhost:$HEALTH_PORT/health/ready"
    
    if response=$(curl -s --max-time "$TIMEOUT" "$url" 2>/dev/null); then
        if echo "$response" | grep -q '"ready":true'; then
            log_info "Service is ready for traffic"
            return 0
        else
            log_warning "Service not ready for traffic: $response"
            return 1
        fi
    else
        log_error "Readiness check failed"
        return 1
    fi
}

# Check metrics endpoint
check_metrics() {
    local url="http://localhost:$METRICS_PORT/metrics"
    
    if response=$(curl -s --max-time "$TIMEOUT" "$url" 2>/dev/null); then
        if echo "$response" | grep -q "# HELP"; then
            log_info "Metrics endpoint healthy"
            return 0
        else
            log_error "Metrics endpoint returned invalid response"
            return 1
        fi
    else
        log_error "Metrics endpoint unreachable"
        return 1
    fi
}

# Check memory usage
check_memory() {
    if [ -r /proc/meminfo ]; then
        mem_total=$(grep MemTotal /proc/meminfo | awk '{print $2}')
        mem_available=$(grep MemAvailable /proc/meminfo | awk '{print $2}')
        mem_used=$((mem_total - mem_available))
        mem_percent=$((mem_used * 100 / mem_total))
        
        if [ "$mem_percent" -gt 90 ]; then
            log_warning "High memory usage: ${mem_percent}%"
            return 1
        else
            log_info "Memory usage: ${mem_percent}%"
            return 0
        fi
    else
        log_warning "Cannot check memory usage"
        return 0
    fi
}

# Check disk space
check_disk() {
    disk_usage=$(df /app | tail -1 | awk '{print $5}' | sed 's/%//')
    
    if [ "$disk_usage" -gt 90 ]; then
        log_warning "High disk usage: ${disk_usage}%"
        return 1
    else
        log_info "Disk usage: ${disk_usage}%"
        return 0
    fi
}

# Main health check
main() {
    local exit_code=0
    
    log_info "Starting health check..."
    
    # Basic health check
    if ! check_endpoint "http://localhost:$HEALTH_PORT/health" "Health"; then
        exit_code=1
    fi
    
    # Readiness check
    if ! check_readiness; then
        exit_code=1
    fi
    
    # Metrics check
    if ! check_metrics; then
        exit_code=1
    fi
    
    # Resource checks
    if ! check_memory; then
        exit_code=1
    fi
    
    if ! check_disk; then
        exit_code=1
    fi
    
    if [ $exit_code -eq 0 ]; then
        log_info "All health checks passed"
    else
        log_error "One or more health checks failed"
    fi
    
    return $exit_code
}

# Execute health check
main "$@"