const config = require('../config');
const { JsonDatabase } = require('./jsonDatabase');
const db = new JsonDatabase(config.dataDir);
module.exports = db;
