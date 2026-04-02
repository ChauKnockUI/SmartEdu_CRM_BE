#!/bin/bash

# Script to initialize databases for EduCRM microservices
# Run this after starting PostgreSQL container

echo "🚀 Initializing EduCRM Databases..."

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL to be ready..."
sleep 10

# Create databases
echo "📦 Creating databases..."

psql -h localhost -U educrm -d postgres -c "CREATE DATABASE educrm_auth;" 2>/dev/null || echo "Database educrm_auth already exists"
psql -h localhost -U educrm -d postgres -c "CREATE DATABASE educrm_lms;" 2>/dev/null || echo "Database educrm_lms already exists"
psql -h localhost -U educrm -d postgres -c "CREATE DATABASE educrm_crm;" 2>/dev/null || echo "Database educrm_crm already exists"
psql -h localhost -U educrm -d postgres -c "CREATE DATABASE educrm_finance;" 2>/dev/null || echo "Database educrm_finance already exists"
psql -h localhost -U educrm -d postgres -c "CREATE DATABASE educrm_ai;" 2>/dev/null || echo "Database educrm_ai already exists"
psql -h localhost -U educrm -d postgres -c "CREATE DATABASE educrm_notifications;" 2>/dev/null || echo "Database educrm_notifications already exists"

echo "✅ Database initialization complete!"
echo ""
echo "📊 Available databases:"
echo "  - educrm_auth (Authentication & Users)"
echo "  - educrm_lms (Learning Management)"
echo "  - educrm_crm (Customer Relationship Management)"
echo "  - educrm_finance (Financial Management)"
echo "  - educrm_ai (AI & Analytics)"
echo "  - educrm_notifications (Notification System)"
echo ""
echo "🔧 Next steps:"
echo "  1. Run migrations for each service: npm run migrate"
echo "  2. Seed initial data if needed"
echo "  3. Start the services: docker-compose up -d"