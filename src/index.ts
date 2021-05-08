import * as sourceMapSupport from "source-map-support";
import * as Sentry from "@sentry/node";
import * as Tracing from "@sentry/tracing";
import * as path from "path";
import * as fs from "fs";
import * as express from "express";
import "express-async-errors";
import { ErrorRequestHandler, Express, NextFunction, Request, Response } from "express";
import { Puller } from "express-git-puller";
import { connectToMongo } from "./database/database";
import RotatingFileStream from "rotating-file-stream";
import * as morgan from "morgan";
import * as bodyParser from "body-parser";
import * as fileUpload from "express-fileupload";
import * as session from "express-session";
import { generateRoute, getRoute, renderRoute, testerRoute, utilRoute, accountManagerRoute } from "./routes";
import { MOJ_DIR, Temp, UPL_DIR, URL_DIR } from "./generator/Temp";
import { Time } from "@inventivetalent/loading-cache";
import { getConfig } from "./typings/Configs";
import { MineSkinError, MineSkinRequest, GenerateRequest, isBreadRequest } from "./typings";
import { apiRequestsMiddleware } from "./util/metrics";
import { error, info, warn } from "./util/colors";
import { corsMiddleware, getAndValidateRequestApiKey, hasOwnProperty } from "./util";
import { AuthenticationError } from "./generator/Authentication";
import { Generator, GeneratorError } from "./generator/Generator";
import gitsha from "@inventivetalent/gitsha";

sourceMapSupport.install();

const config = getConfig();
const port = process.env.PORT || config.port || 3014;

let updatingApp = true;

console.log("\n" +
    "  ==== STARTING UP ==== " +
    "\n");

const app: Express = express();


async function init() {
    console.log("Node Version " + process.version);

    {
        console.log("Creating temp directories");
        try {
            fs.mkdirSync(URL_DIR);
        } catch (e) {
        }
        try {
            fs.mkdirSync(UPL_DIR);
        } catch (e) {
        }
        try {
            fs.mkdirSync(MOJ_DIR);
        } catch (e) {
        }
    }

    {
        console.log("Initializing Sentry")
        Sentry.init({
            dsn: config.sentry.dsn,
            release: await gitsha(),
            integrations: [
                new Sentry.Integrations.Http({ tracing: true }),
                new Tracing.Integrations.Express({ app })
            ],
            serverName: config.server,
            tracesSampleRate: 0.02,
            sampleRate: 0.5
        });

        app.use(Sentry.Handlers.requestHandler());
        app.use(Sentry.Handlers.tracingHandler());
    }

    {
        console.log("Creating logger")

        // create a rotating write stream
        const accessLogStream = RotatingFileStream('access.log', {
            interval: '1d', // rotate daily
            path: path.join(__dirname, 'log'),
            compress: "gzip"
        });

        // setup the logger
        app.use(morgan('combined', { stream: accessLogStream }))
        morgan.token('remote-addr', (req, res): string => {
            return req.headers['x-real-ip'] as string || req.headers['x-forwarded-for'] as string || req.connection.remoteAddress || "";
        });


    }


    {
        console.log("Setting up express middleware")

        app.set("trust proxy", 1);
        app.use(bodyParser.urlencoded({ extended: true, limit: '50kb' }));
        app.use(bodyParser.json({ limit: '20kb' }));
        app.use(fileUpload());
        app.use((req, res, next) => {
            res.header("X-MineSkin-Server", config.server || "default");
            next();
        });
        app.use(apiRequestsMiddleware);

        app.use("/.well-known", express.static(".well-known"));
    }

    {// Git Puller
        console.log("Setting up git puller");

        const puller = new Puller({
            ...{
                events: ["push"],
                branches: ["master"],
                vars: {
                    appName: "mineskin"
                },
                commandOrder: ["pre", "git", "install", "post"],
                commands: {
                    git: [
                        "git fetch --all",
                        "git reset --hard origin/master"
                    ],
                    install: [
                        "npm install",
                        "npm run build"
                    ],
                    post: [
                        "pm2 restart $appName$"
                    ]
                },
                delays: {
                    install: Math.ceil(Math.random() * 200),
                    post: 5000 + Math.ceil(Math.random() * 10000)
                }
            },
            ...config.puller
        });
        puller.on("before", (req: Request, res: Response) => {
            updatingApp = true;
            console.log(process.cwd());
        });
        app.use(function (req: Request, res: Response, next: NextFunction) {
            if (updatingApp) {
                res.status(503).send({ err: "app is updating" });
                return;
            }
            next();
        });
        app.use(config.puller.endpoint, bodyParser.json({ limit: '100kb' }), puller.middleware);
    }

    {
        console.log("Connecting to database")
        await connectToMongo(config);
    }

    {
        console.log("Registering routes");

        app.get("/", corsMiddleware, function (req, res) {
            res.json({ msg: "Hi!" });
        });

        app.get("/openapi.yml", corsMiddleware, (req, res) => {
            res.sendFile("/openapi.yml", { root: `${ __dirname }/..` });
        });
        app.get("/openapi", (req, res) => {
            res.redirect("https://openapi.inventivetalent.dev/?https://api.mineskin.org/openapi.yml");
        });

        generateRoute.register(app);
        getRoute.register(app);
        renderRoute.register(app);
        accountManagerRoute.register(app);
        testerRoute.register(app);
        utilRoute.register(app);

    }

    const preErrorHandler: ErrorRequestHandler = (err, req: Request, res: Response, next: NextFunction) => {
        console.warn(warn((isBreadRequest(req) ? req.breadcrumb + " " : "") + "Error in a route " + err.message));
        if (err instanceof MineSkinError) {
            Sentry.setTags({
                "error_type": err.name,
                "error_code": err.code
            });
            if (err instanceof AuthenticationError || err instanceof GeneratorError) {
                addErrorDetailsToSentry(err);
            }
            if (err.httpCode) {
                Sentry.setTag("error_httpcode", `${ err.httpCode }`);
                res.status(err.httpCode);
            } else {
                res.status(500);
            }
        } else {
            Sentry.setTag("unhandled_error", err.name)
        }
        next(err);
    };
    app.use(preErrorHandler);
    app.use(Sentry.Handlers.errorHandler({
        shouldHandleError: (error) => {
            if (error.status === 400) {
                return Math.random() < 0.2;
            }
            return true;
        }
    }));
    const errorHandler: ErrorRequestHandler = (err, req: Request, res: Response, next: NextFunction) => {
        if (err instanceof MineSkinError) {
            getAndValidateRequestApiKey(req).then(key => {
                Generator.getDelay().then(delay => {
                    res.json({
                        success: false,
                        errorType: err.name,
                        errorCode: err.code,
                        error: err.msg,
                        nextRequest: (Date.now() / 1000) + delay
                    });
                }).catch(e => Sentry.captureException(e));
            }).catch(e => Sentry.captureException(e));
        } else {
            res.status(500).json({
                success: false,
                error: "An unexpected error occurred"
            })
        }
    }
    app.use(errorHandler);
}

function addErrorDetailsToSentry(err: AuthenticationError | GeneratorError): void {
    Sentry.setExtra("error_account", err.account?.id);
    Sentry.setExtra("error_details", err.details);
    if (err.details instanceof Error) {
        console.warn(warn(err.details.message));
        Sentry.setExtra("error_details_error", err.details.name);
        Sentry.setExtra("error_details_message", err.details.message);
    }
    if (err.details && err.details.response) {
        Sentry.setExtra("error_response", err.details.response);
        Sentry.setExtra("error_response_data", err.details.response.data);
    }
}


init().then(() => {
    setTimeout(() => {
        console.log("Starting app");
        app.listen(port, function () {
            console.log(info(" ==> listening on *:" + port + "\n"));
            setTimeout(() => {
                updatingApp = false;
                console.log(info("Accepting connections."));
            }, 1000);
        });
    }, 1000);
});


