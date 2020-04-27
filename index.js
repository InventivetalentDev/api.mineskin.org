var express = require('express');
var app = express();
var http = require('http');
var server = http.Server(app);
var session = require("express-session");
var Util = require('./util');
var bodyParser = require("body-parser");
var expressValidator = require('express-validator')
var fileUpload = require('express-fileupload');
var mongoose = require("mongoose");
var cookieParser = require("cookie-parser");
var Cookies = require("cookies");
var extend = require('util')._extend
var restClient = new (require("node-rest-client")).Client()
var unirest = require("unirest");
var crypto = require('crypto');
var fs = require('fs')
var morgan = require('morgan')
var rfs = require("rotating-file-stream");
var rateLimit = require("express-rate-limit");
var Optimus = require("optimus-js");
var path = require('path')
var colors = require("colors");
var config = require("./config");
var port = process.env.PORT || config.port || 3014;

require("rootpath")();
require('console-stamp')(console, 'HH:MM:ss.l');

// require("./statusMonitor")(app, config);

app.use(function (req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
        res.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS, DELETE, PUT");
        res.header("Access-Control-Allow-Headers", "X-Requested-With, Accept, Content-Type, Origin");
        res.header("Access-Control-Request-Headers", "X-Requested-With, Accept, Content-Type, Origin");
        return res.sendStatus(200);
    } else {
        return next();
    }
});
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json({extended: true}));
app.use(expressValidator());
app.use(fileUpload());
app.use(function (req, res, next) {
    req.realAddress = req.header("x-real-ip") || req.realAddress;
    res.header("X-Mineskin-Server", config.server || "default");
    next();
})

app.use("/.well-known",express.static(".well-known"));

var swStats = require('swagger-stats');
app.use(swStats.getMiddleware( config.swagger));

// create a rotating write stream
var accessLogStream = rfs('access.log', {
    interval: '1d', // rotate daily
    path: path.join(__dirname, 'log'),
    compress: "gzip"
})

// setup the logger
app.use(morgan('combined', {stream: accessLogStream}))
morgan.token('remote-addr', function (req) {
    return req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
});

colors.setTheme({
    silly: 'rainbow',
    input: 'grey',
    prompt: 'grey',
    info: 'green',
    data: 'grey',
    help: 'cyan',
    warn: 'yellow',
    debug: 'cyan',
    error: 'red'
});

// Databse
require("./db/db")(mongoose, config);

// API methods
app.get("/", function (req, res) {
    res.json({msg: "Hi!"});
});

app.get("/encrypt/:text", function (req, res) {
    res.json({enc: Util.crypto.encrypt(req.params.text)});
});

app.get("/decrypt/:text", function (req, res) {
    res.json({dec: Util.crypto.decrypt(req.params.text)});
});

var optimus = new Optimus(config.optimus.prime, config.optimus.inverse, config.optimus.random);
console.log("Optimus Test:", optimus.encode(Math.floor(Date.now() / 10)));

var limiter = rateLimit({
    windowMs: 2*60*1000, // 2 minutes,
    max:6,
    message:JSON.stringify({error:"Too many requests"}),
    keyGenerator:function (req) {
        return  req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.realAddress || req.connection.remoteAddress
    }
})

/// Routes
require("./routes/generate")(app, config, optimus, limiter);
require("./routes/get")(app);
require("./routes/render")(app);
require("./routes/util")(app);
require("./routes/admin")(app);
require("./routes/accountManager")(app, config);

function exitHandler(err) {
    if (err) {
        console.log("\n\n\n\n\n\n\n\n");
        console.log(err);
        console.log("\n\n\n");
    }
    process.exit();
}


server.listen(port, function () {
    console.log('listening on *:' + port);
});

process.on("exit", exitHandler);
process.on("SIGINT", exitHandler);
process.on("uncaughtException", exitHandler);
