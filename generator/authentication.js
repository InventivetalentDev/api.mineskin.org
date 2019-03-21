var uuid = require('uuid/v4');
var urls = require("./urls");
var request = require("request");
var Util = require("../util");

// Schemas
var Account = require("../db/schemas/account").Account;
var Skin = require("../db/schemas/skin").Skin;
var Traffic = require("../db/schemas/traffic").Traffic;

module.exports = {};

module.exports.authenticate = function (account, cb) {
    console.log("[Auth] authenticate(" + account.username + ")");
    // Callback to login
    var loginCallback = function (account) {
        console.log(("[Auth] (#" + account.id + ") Logging in with Username+Password").info);
        if (!account.clientToken)
            account.clientToken = uuid();
        console.log(("[Auth] POST " + urls.authenticate).debug);
        request({
            method: "POST",
            url: urls.authenticate,
            headers: {
                "User-Agent": "MineSkin.org",
                "Content-Type": "application/json",
                "X-Forwarded-For": account.requestIp,
                "REMOTE_ADDR": account.requestIp
            },
            json: true,
            body: {
                agent: {
                    name: "Minecraft",
                    version: 1
                },
                username: account.username,
                password: Util.crypto.decrypt(account.passwordNew),
                clientToken: account.clientToken,
                requestUser: true
            }
        }, function (err, response, body) {
            console.log("Auth Body:".debug)
            console.log(("" + JSON.stringify(body)).debug);
            if (err || body.error) {
                cb(err || body, null);
                return console.log(err);
            }

            // Get new token
            // account.clientToken = body.clientToken;
            account.accessToken = body.accessToken;
            account.save(function (err, account) {
                cb(null, account);
            })
        })
        // ygg.auth({
        //     user: account.username,
        //     pass: Util.crypto.decrypt(account.passwordNew),
        //     token: account.clientToken,
        //     ip: account.requestIp,
        //     agent: "MineSkin"
        // }, function (err, data) {
        //     if (err) {
        //         cb(err, null);
        //         return console.log(err);
        //     }
        //     console.log(JSON.stringify(data).debug);
        //
        //     // Get new token
        //     account.clientToken = data.clientToken;
        //     account.accessToken = data.accessToken;
        //     cb(null, account);
        // })
    };

    console.log(("[Auth] (#" + account.id + ") Authenticating account #" + account.id).info);
    if (account.clientToken && account.accessToken) {
        function refresh() {
            console.info("[Auth] (#" + account.id + ") Refreshing tokens");
            console.debug("[Auth] POST " + urls.refresh);
            request({
                method: "POST",
                url: urls.refresh,
                headers: {
                    "User-Agent": "MineSkin.org",
                    "Content-Type": "application/json",
                    "X-Forwarded-For": account.requestIp,
                    "REMOTE_ADDR": account.requestIp
                },
                json: true,
                body: {
                    accessToken: account.accessToken,
                    clientToken: account.clientToken,
                    requestUser: true
                }
            }, function (err, response, body) {
                console.log("[Auth] Refresh Body:".debug)
                console.log(("[Auth] " + JSON.stringify(body)).debug);
                if (err || body.error) {
                    console.log(err)
                    account.accessToken = null;
                    account.save(function (err, account) {
                        console.log(("[Auth] Couldn't refresh accessToken").debug);

                        // Login
                        // module.exports.signout(account, function (err) {
                        //     if (err) console.log((err).warn);
                        loginCallback(account);
                        // })
                    })
                } else {
                    console.log("[Auth] (#" + account.id + ") got a new accessToken");
                    account.accessToken = body.accessToken;
                    account.save(function (err, account) {
                        console.log(("[Auth] (#" + account.id + ") Logging in with AccessToken").info);
                        cb(null, account);
                    })
                }
            })
        }

        console.log("[Auth] (#" + account.id + ") validating tokens");
        console.log(("[Auth] POST " + urls.validate).debug);
        request({
            method: "POST",
            url: urls.validate,
            headers: {
                "User-Agent": "MineSkin.org",
                "Content-Type": "application/json",
                "X-Forwarded-For": account.requestIp,
                "REMOTE_ADDR": account.requestIp
            },
            json: true,
            body: {
                accessToken: account.accessToken,
                clientToken: account.clientToken,
                requestUser: true
            }
        }, function (err, response, body) {
            console.log("[Auth] Validate Body:".debug)
            console.log(("" + JSON.stringify(body)).debug);
            if (err || response.statusCode < 200 || response.statusCode > 230 || (body && body.error)) {
                console.info("[Auth] Couldn't validate tokens");
                console.log(err)
                refresh();
            } else {
                console.info("[Auth] Tokens are still valid!");
                cb(null, account);
            }
        })

        // ygg.refresh(account.accessToken, account.clientToken, account.requestIp, function (err, token, body) {
        //     console.log(err)
        //     if (!err) {
        //         // Old token is still valid
        //         account.accessToken = token;
        //         account.save(function (err, account) {
        //             console.log(("[Auth] (#" + account.id + ") Logging in with AccessToken").info);
        //             cb(account);
        //         })
        //     } else {
        //         console.log(("Couldn't refresh accessToken").debug);
        //         // Login
        //         module.exports.signout(account, function (err) {
        //             if (err) console.log((err).warn);
        //             loginCallback();
        //         })
        //     }
        // })
    } else {
        console.log(("[Auth] Account (#" + account.id + ") doesn't have accessToken").debug);
        // Login
        loginCallback(account);
    }
};

module.exports.completeChallenges = function (account, cb) {
    if (!account.security || account.security.length === 0) {
        console.log("[Auth] (#" + account.id + ") Skipping security questions as there are no answers configured");
        // No security questions set
        cb(account);
        return;
    }

    // Check if we can access
    console.log(("[Auth] GET " + urls.security.location).debug);
    request({
        url: urls.security.location,
        headers: {
            "User-Agent": "MineSkin.org",
            "Content-Type": "application/json",
            "Authorization": "Bearer " + account.accessToken,
            "X-Forwarded-For": account.requestIp,
            "REMOTE_ADDR": account.requestIp
        }
    }, function (err, response, body) {
        if (err) return console.log(err);

        if (!response || response.statusCode < 200 || response.statusCode > 230) {// Not yet answered
            console.log(("[Auth] (#" + account.id + ") Completing challenges").debug);
            console.log(account.security.debug);

            // Get the questions
            request({
                url: urls.security.challenges,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + account.accessToken,
                    "X-Forwarded-For": account.requestIp,
                    "REMOTE_ADDR": account.requestIp
                }
            }, function (err, response, body) {
                if (err) return console.log(err);
                console.debug(body);

                var questions = JSON.parse(body);
                var answers = [];
                questions.forEach(function (question) {
                    answers.push({id: question.answer.id, answer: account.security});
                });
                // console.log(JSON.stringify(answers).debug);


                // Post answers
                console.log(("[Auth] POST " + urls.security.location).debug);
                request({
                    method: "POST",
                    url: urls.security.location,
                    headers: {
                        "User-Agent": "MineSkin.org",
                        "Content-Type": "application/json",
                        "Authorization": "Bearer " + account.accessToken,
                        "X-Forwarded-For": account.requestIp,
                        "REMOTE_ADDR": account.requestIp
                    },
                    json: answers
                }, function (err, response, body) {
                    if (err) return console.log(err);

                    if (response.statusCode >= 200 && response.statusCode < 300) {
                        console.log("[Auth] (#" + account.id + ") challenges completed");
                        // Challenges completed
                        cb(account);
                    } else {
                        console.log(("[Auth] (#" + account.id + ") Failed to complete security challenges").warn);
                        cb();
                    }
                })
            })
        } else {
            cb(account);
        }
    })
}

module.exports.signout = function (account, cb) {
    // ygg.signout(account.username, Util.crypto.decrypt(account.passwordNew), account.requestIp, cb);
    account.accessToken = null;
    // account.clientToken = null;
    console.log(("[Auth] POST " + urls.signout).debug);
    request({
        method: "POST",
        url: urls.signout,
        headers: {
            "User-Agent": "MineSkin.org",
            "Content-Type": "application/json",
            "X-Forwarded-For": account.requestIp,
            "REMOTE_ADDR": account.requestIp
        },
        json: true,
        body: {
            username: account.username,
            password: Util.crypto.decrypt(account.passwordNew)
        }
    }, function (err, response, body) {
        console.log("Signout Body:".debug)
        console.log(("" + JSON.stringify(body)).debug);
        if (err) {
            cb(err);
            return console.log(err);
        }

        cb();
    })
};