// const mysql = require("mysql2/promise");

// const pool = mysql.createPool({
//   host: process.env.DB_HOST || "127.0.0.1",
//   port: Number(process.env.DB_PORT || 3306),
//   user: process.env.DB_USER,
//   password: process.env.DB_PASS,
//   database: process.env.DB_NAME || "isro_portal",
//   waitForConnections: true,
//   connectionLimit: 10,
//   namedPlaceholders: true,
//   timezone: "Z",            // store/read DATETIME as UTC
//   multipleStatements: false // safer default
// });

// module.exports = { pool };


const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME || "isro_portal",
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  dateStrings: true,        // Return dates as strings (avoids JS Date object timezone shifts)
  multipleStatements: false
});

module.exports = { pool };
