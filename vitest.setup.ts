// Dummy connection strings so the db client constructs in unit tests.
// postgres-js does not open a socket until a query runs, so these are never dialed;
// tests only build queries and assert their generated SQL.
process.env.DATABASE_URL ??= 'postgres://user:password@localhost:5432/test'
process.env.DATABASE_URL_DIRECT ??= 'postgres://user:password@localhost:5432/test'
