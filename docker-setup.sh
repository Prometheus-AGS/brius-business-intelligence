#!/bin/bash

# Mastra Docker Setup Script
# This script helps set up and manage the Mastra Docker environment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    if ! command_exists docker; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    if ! command_exists docker-compose; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    print_success "Prerequisites check passed"
}

# Function to setup environment file
setup_env() {
    print_status "Setting up environment file..."
    
    if [ ! -f .env ]; then
        if [ -f .env.example ]; then
            cp .env.example .env
            print_success "Created .env file from .env.example"
            print_warning "Please edit .env file with your actual credentials before starting services"
        else
            print_error ".env.example file not found"
            exit 1
        fi
    else
        print_warning ".env file already exists, skipping creation"
    fi
}

# Function to start services
start_services() {
    print_status "Starting Docker services..."
    
    # Check if .env file has been configured
    if grep -q "your_aws_access_key_id" .env 2>/dev/null; then
        print_warning "Please configure your .env file with actual credentials before starting services"
        print_warning "Edit the following variables in .env:"
        print_warning "  - AWS_ACCESS_KEY_ID"
        print_warning "  - AWS_SECRET_ACCESS_KEY"
        print_warning "  - AI_GATEWAY_API_KEY"
        print_warning "  - LANGFUSE_PUBLIC_KEY (optional)"
        print_warning "  - LANGFUSE_SECRET_KEY (optional)"
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
    
    docker-compose up -d
    print_success "Services started successfully"
    
    print_status "Waiting for services to be ready..."
    sleep 10
    
    # Check service health
    check_services
}

# Function to stop services
stop_services() {
    print_status "Stopping Docker services..."
    docker-compose down
    print_success "Services stopped successfully"
}

# Function to check service status
check_services() {
    print_status "Checking service status..."
    
    # Check PostgreSQL
    if docker-compose exec -T postgres pg_isready -U mastra -d mastra >/dev/null 2>&1; then
        print_success "PostgreSQL is ready"
    else
        print_error "PostgreSQL is not ready"
    fi
    
    # Check Langfuse
    if curl -f http://localhost:3000/api/public/health >/dev/null 2>&1; then
        print_success "Langfuse is ready"
    else
        print_warning "Langfuse is not ready (this may take a few more seconds)"
    fi
    
    # Check Mastra
    if curl -f http://localhost:4000/health >/dev/null 2>&1; then
        print_success "Mastra playground is ready"
    else
        print_warning "Mastra playground is not ready (this may take a few more seconds)"
    fi
    
    print_status "Service URLs:"
    echo "  - Mastra Playground: http://localhost:4000"
    echo "  - Langfuse Dashboard: http://localhost:3000"
    echo "  - PostgreSQL: localhost:5432"
}

# Function to show logs
show_logs() {
    if [ -n "$1" ]; then
        print_status "Showing logs for $1..."
        docker-compose logs -f "$1"
    else
        print_status "Showing logs for all services..."
        docker-compose logs -f
    fi
}

# Function to reset database
reset_database() {
    print_warning "This will delete all data in the PostgreSQL database!"
    read -p "Are you sure? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_status "Resetting database..."
        docker-compose down -v
        docker-compose up -d postgres
        print_success "Database reset successfully"
    fi
}

# Function to show help
show_help() {
    echo "Mastra Docker Setup Script"
    echo ""
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  setup     - Check prerequisites and setup environment"
    echo "  start     - Start all services"
    echo "  stop      - Stop all services"
    echo "  restart   - Restart all services"
    echo "  status    - Check service status"
    echo "  logs      - Show logs for all services"
    echo "  logs <service> - Show logs for specific service"
    echo "  reset-db  - Reset PostgreSQL database (WARNING: deletes all data)"
    echo "  help      - Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 setup"
    echo "  $0 start"
    echo "  $0 logs mastra"
    echo "  $0 status"
}

# Main script logic
case "${1:-help}" in
    setup)
        check_prerequisites
        setup_env
        ;;
    start)
        check_prerequisites
        start_services
        ;;
    stop)
        stop_services
        ;;
    restart)
        stop_services
        sleep 2
        start_services
        ;;
    status)
        check_services
        ;;
    logs)
        show_logs "$2"
        ;;
    reset-db)
        reset_database
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        print_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac