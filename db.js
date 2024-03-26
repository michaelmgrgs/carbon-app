const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    // ssl: {
    //     rejectUnauthorized: false, // You may need to set this option based on your SSL certificate configuration
    //   },
});

module.exports = pool;
