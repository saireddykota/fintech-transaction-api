# Fintech Transaction API

A production-grade NestJS REST API for secure financial transaction processing and hedge fund portfolio management. Built to address the engineering challenges of high-volume institutional trading platforms — real-time transaction processing, portfolio reconciliation, and secure financial data management at scale.

## Overview

This API implements the core backend infrastructure patterns used in institutional financial platforms — the same architectural decisions that drive performance and reliability in hedge fund portfolio management systems handling millions of transactions daily.

### Key Engineering Decisions

**MongoDB with optimized compound indexing** — Financial transaction queries are complex: filter by portfolio, date range, asset class, and settlement status simultaneously. Poorly indexed queries on transaction collections degrade from milliseconds to seconds under load. This API implements compound indexes aligned with actual query patterns, achieving significant reductions in query response times on high-volume portfolios.

**Apache Kafka for event-driven transaction processing** — Synchronous transaction processing creates bottlenecks during peak trading periods. This API decouples transaction ingestion from settlement processing using Kafka, enabling the system to absorb high-volume trade events without degrading API response times. Partitioned by `portfolioId` for ordered, parallel processing across portfolios.

**Redis caching layer** — Financial reference data (instrument details, account configurations, portfolio snapshots) is read frequently but changes infrequently. Redis caching eliminates unnecessary MongoDB reads for this data, reducing database load and improving API latency for all portfolio-level queries.

**Role-based access control** — Institutional financial APIs serve multiple user types with different access requirements: traders, portfolio managers, analysts, compliance officers, and operations staff. This API implements granular RBAC ensuring each role accesses only the data and operations appropriate to their function.

**Security-first design** — Financial APIs are high-value attack targets. This API implements JWT authentication, API rate limiting (per-second and per-minute), Helmet security headers, CORS restrictions, input validation with whitelisting, and non-root Docker execution. The CI/CD pipeline includes automated security scanning and dependency auditing.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Angular Trading UI                     │
│              (lazy-loaded financial modules)              │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTPS / JWT
┌──────────────────────▼──────────────────────────────────┐
│               NestJS API (this service)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ Transactions│  │  Portfolio  │  │      Auth       │  │
│  │  Controller │  │  Controller │  │    Controller   │  │
│  └──────┬──────┘  └──────┬──────┘  └─────────────────┘  │
│         │                │                               │
│  ┌──────▼──────────────────────────────────────────┐    │
│  │              Services Layer                       │    │
│  │  • Transaction processing & validation            │    │
│  │  • Portfolio aggregation                          │    │
│  │  • Kafka event publishing                         │    │
│  └──────┬──────────────────────┬────────────────────┘    │
│         │                      │                          │
│  ┌──────▼──────┐      ┌────────▼───────┐                 │
│  │   MongoDB   │      │     Redis      │                  │
│  │(transactions│      │ (reference data│                  │
│  │ portfolios) │      │ portfolio cache│                  │
│  └─────────────┘      └────────────────┘                  │
└──────────────────────┬──────────────────────────────────┘
                       │ Kafka events
┌──────────────────────▼──────────────────────────────────┐
│              Kafka Event Streaming                        │
│  Topics: transactions.events, portfolio.updates,          │
│          transactions.settlement, audit.log               │
└─────────────────────────────────────────────────────────┘
```

## Features

### Transaction Processing
- Full instrument coverage: equities, fixed income, FX swaps, option exercises, dividends
- Atomic transaction creation with immediate Kafka event publication
- Status workflow enforcement (PENDING → PROCESSING → SETTLED)
- Comprehensive audit logging for regulatory compliance

### Portfolio Management
- Real-time portfolio summary via optimized MongoDB aggregation pipelines
- Asset class breakdown with notional value calculations
- Redis-cached portfolio snapshots for low-latency reads

### Security
- JWT authentication with role-based access control
- 6 distinct roles: trader, portfolio_manager, analyst, compliance, operations, admin
- Rate limiting: 10 req/sec, 200 req/min per client
- Helmet security headers
- Input validation with class-validator whitelisting
- Non-root Docker execution

### Event Streaming (Kafka)
- Idempotent producer — exactly-once delivery for financial events
- Partitioned by portfolioId for ordered, parallel processing
- Topics: transaction events, settlement events, portfolio updates, audit log
- GZIP compression, 7-day retention

## Getting Started

### Prerequisites
- Node.js 20+
- MongoDB 7.0+
- Redis 7.2+
- Apache Kafka 3.5+ (or Confluent Platform)

### Installation

```bash
git clone https://github.com/saireddykota/fintech-transaction-api.git
cd fintech-transaction-api
npm install
cp .env.example .env
# Edit .env with your connection strings
npm run start:dev
```

### Docker Compose (recommended for local development)

```bash
docker-compose up -d
```

## API Endpoints

### Transactions
```
POST   /api/v1/transactions                          — Create transaction
GET    /api/v1/transactions                          — Query transactions
GET    /api/v1/transactions/:transactionId           — Get by ID
PATCH  /api/v1/transactions/:transactionId/status   — Update status
GET    /api/v1/transactions/portfolio/:id/summary   — Portfolio summary
```

### Supported Transaction Types
| Type | Description |
|------|-------------|
| `BUY` | Equity / fixed income purchase |
| `SELL` | Equity / fixed income sale |
| `FX_SWAP` | Foreign exchange swap with forward leg |
| `OPTION_EXERCISE` | Option contract exercise |
| `DIVIDEND` | Dividend receipt |
| `INTEREST` | Interest payment / receipt |
| `REBALANCE` | Portfolio rebalancing transaction |

### Supported Asset Classes
`EQUITY` · `FIXED_INCOME` · `FX` · `DERIVATIVE` · `ALTERNATIVE` · `CASH`

## Performance Characteristics

| Operation | Strategy | Target Latency |
|-----------|----------|----------------|
| Transaction query (portfolio) | Compound index + Redis cache | < 50ms |
| Portfolio summary | MongoDB aggregation pipeline | < 200ms |
| Transaction create | Write + Kafka publish | < 100ms |
| Reference data lookup | Redis cache | < 5ms |

## MongoDB Index Strategy

Compound indexes aligned with financial query patterns:

```typescript
// Portfolio history — most common query pattern
{ portfolioId: 1, tradeDate: -1 }

// Pending settlement processing
{ portfolioId: 1, status: 1, tradeDate: -1 }

// Account activity by instrument type
{ accountId: 1, type: 1, tradeDate: -1 }

// Settlement date processing (end-of-day jobs)
{ status: 1, settlementDate: 1 }

// Portfolio composition by asset class
{ portfolioId: 1, assetClass: 1, status: 1 }
```

## Testing

```bash
npm run test          # Unit tests
npm run test:cov      # Coverage report
npm run test:e2e      # End-to-end tests
```

## CI/CD

GitHub Actions pipeline:
1. **Security audit** — npm audit + OWASP dependency check
2. **Lint & type check** — ESLint + TypeScript compiler
3. **Test suite** — Jest with MongoDB and Redis services
4. **Docker build & push** — GHCR on main branch merges

## Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Framework | NestJS 10 | API structure, DI, modules |
| Language | TypeScript 5 | Type safety for financial data |
| Database | MongoDB 7 + Mongoose | Transaction and portfolio storage |
| Cache | Redis 7 + ioredis | Reference data and query caching |
| Messaging | Apache Kafka + kafkajs | Async transaction event streaming |
| Auth | Passport + JWT | Authentication and authorization |
| Validation | class-validator | Input validation and sanitization |
| Security | Helmet + Throttler | API security hardening |
| Container | Docker + Alpine | Minimal production image |
| CI/CD | GitHub Actions | Automated testing and deployment |

## Author

**Venkata Sai Kumar Reddy Kota**
Senior Full-Stack Engineer | Fintech Infrastructure
[LinkedIn](https://linkedin.com/in/sai-reddy-k-65aba114b) · [GitHub](https://github.com/saireddykota)
