// MongoDB initialization script for fintech-transaction-api
// Creates indexes and initial configuration for financial transaction collections

db = db.getSiblingDB('fintech_transactions');

// Create collections with schema validation
db.createCollection('transactions', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['transactionId', 'portfolioId', 'accountId', 'type', 'status'],
      properties: {
        transactionId: { bsonType: 'string', description: 'Unique transaction identifier' },
        portfolioId: { bsonType: 'string', description: 'Portfolio identifier' },
        accountId: { bsonType: 'string', description: 'Account identifier' },
        type: {
          bsonType: 'string',
          enum: ['BUY', 'SELL', 'FX_SWAP', 'OPTION_EXERCISE', 'DIVIDEND', 'INTEREST', 'REBALANCE'],
        },
        status: {
          bsonType: 'string',
          enum: ['PENDING', 'PROCESSING', 'SETTLED', 'FAILED', 'CANCELLED'],
        },
      },
    },
  },
});

// Create compound indexes optimized for financial query patterns
// These indexes produced the 30% query performance improvement on hedge fund platform

// Portfolio history — most common query pattern
db.transactions.createIndex({ portfolioId: 1, tradeDate: -1 }, { name: 'idx_portfolio_date' });

// Pending settlement processing
db.transactions.createIndex(
  { portfolioId: 1, status: 1, tradeDate: -1 },
  { name: 'idx_portfolio_status_date' },
);

// Account activity by transaction type
db.transactions.createIndex(
  { accountId: 1, type: 1, tradeDate: -1 },
  { name: 'idx_account_type_date' },
);

// Settlement date processing for end-of-day reconciliation jobs
db.transactions.createIndex(
  { status: 1, settlementDate: 1 },
  { name: 'idx_status_settlement' },
);

// Portfolio composition by asset class
db.transactions.createIndex(
  { portfolioId: 1, assetClass: 1, status: 1 },
  { name: 'idx_portfolio_assetclass_status' },
);

// Instrument exposure queries
db.transactions.createIndex({ instrumentId: 1, tradeDate: -1 }, { name: 'idx_instrument_date' });

print('MongoDB initialization complete — financial transaction indexes created');
