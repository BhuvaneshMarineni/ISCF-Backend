require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const requireAuth = require('./lib/auth/requireAuth');
// const requireAdmin = require('./lib/auth/requireAdmin'); // use only for user-management routes

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use('/api/admin', requireAuth);
app.use('/api', routes);

app.use(errorHandler);

module.exports = app;
